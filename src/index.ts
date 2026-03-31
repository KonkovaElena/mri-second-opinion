import { createServer } from "node:http";
import { createApp } from "./app";
import { getConfig } from "./config";
import { applyServerHardening, shutdownHttpServer } from "./http-runtime";

const config = getConfig();
const app = createApp(config);
const server = createServer(app);

applyServerHardening(server, config);

let shuttingDown = false;

async function handleShutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.locals.runtimeState.isShuttingDown = true;
  process.stdout.write(`[mri-second-opinion] received ${signal}, starting graceful shutdown\n`);

  try {
    const result = await shutdownHttpServer(
      server,
      async () => {
        await app.locals.caseService.close();
      },
      config,
    );

    process.stdout.write(
      `[mri-second-opinion] graceful shutdown complete (forcedConnectionClose=${result.forcedConnectionClose})\n`,
    );
    process.exit(0);
  } catch (error) {
    process.stderr.write(
      `[mri-second-opinion] shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void handleShutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void handleShutdown("SIGTERM");
});

server.listen(config.port, () => {
  process.stdout.write(
    `[mri-second-opinion] listening on http://localhost:${config.port} using ${config.caseStoreMode} case store ${config.caseStoreFile}\n`,
  );
});
