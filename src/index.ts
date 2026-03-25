import { createServer } from "node:http";
import { createApp } from "./app";
import { getConfig } from "./config";

const config = getConfig();
const app = createApp(config);
const server = createServer(app);

server.listen(config.port, () => {
  process.stdout.write(
    `[mri-second-opinion] listening on http://localhost:${config.port} using case store ${config.caseStoreFile}\n`,
  );
});
