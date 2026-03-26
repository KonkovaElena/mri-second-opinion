import { createServer } from "node:http";
import { createApp } from "./app";
import { getConfig } from "./config";

function writeLifecycleLog(event: string, details: Record<string, unknown> = {}) {
  process.stdout.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      service: "mri-second-opinion",
      type: "lifecycle",
      event,
      ...details,
    })}\n`,
  );
}

const config = getConfig();
const app = createApp(config);
const server = createServer(app);

server.listen(config.port, () => {
  writeLifecycleLog("server-started", {
    port: config.port,
    persistenceMode: config.persistenceMode,
    caseStoreFile: config.persistenceMode === "postgres" ? null : config.caseStoreFile,
  });
});

function shutdown(signal: string) {
  writeLifecycleLog("shutdown-requested", { signal });
  server.close(() => {
    writeLifecycleLog("server-closed", { signal });
    process.exitCode = 0;
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
