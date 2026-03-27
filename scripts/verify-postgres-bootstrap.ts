import {
  getPostgresBootstrapConfig,
  verifyPostgresBootstrap,
} from "../src/postgres-bootstrap";

async function main() {
  const config = getPostgresBootstrapConfig();
  const result = await verifyPostgresBootstrap(config);

  process.stdout.write(
    [
      "[mri-second-opinion] PostgreSQL bootstrap verified",
      `schema=${result.schema}`,
      `tables=${result.tables.join(",")}`,
      `statementsApplied=${result.statementsApplied}`,
    ].join(" ") + "\n",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[mri-second-opinion] PostgreSQL bootstrap failed: ${message}\n`);
  process.exitCode = 1;
});