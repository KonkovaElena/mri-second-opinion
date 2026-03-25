import { applyPendingMigrations } from "../src/db-migrations";

async function main() {
  const result = await applyPendingMigrations();
  const lines = [`[db:migrate] applied ${result.appliedIds.length} migration(s)`];

  if (result.appliedIds.length > 0) {
    lines.push(`[db:migrate] applied ids: ${result.appliedIds.join(", ")}`);
  }

  if (result.skippedIds.length > 0) {
    lines.push(`[db:migrate] already applied: ${result.skippedIds.join(", ")}`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

main().catch((error) => {
  process.stderr.write(`[db:migrate] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});