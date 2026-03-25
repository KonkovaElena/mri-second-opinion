import { resolve } from "node:path";

export interface AppConfig {
  nodeEnv: string;
  port: number;
  caseStoreFile: string;
}

const DEFAULT_PORT = 4010;

export function getConfig(): AppConfig {
  const rawPort = process.env.PORT;
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  const caseStoreFile = process.env.MRI_CASE_STORE_FILE ?? resolve(__dirname, "..", ".mri-data", "cases.json");

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port,
    caseStoreFile,
  };
}
