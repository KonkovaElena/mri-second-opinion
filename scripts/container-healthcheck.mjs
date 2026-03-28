const port = process.env.PORT || "4010";
const target = `http://127.0.0.1:${port}/readyz`;

try {
  const response = await fetch(target);

  if (!response.ok) {
    process.stderr.write(`[container-healthcheck] ${target} returned ${response.status}\n`);
    process.exit(1);
  }
} catch (error) {
  process.stderr.write(
    `[container-healthcheck] ${target} failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}