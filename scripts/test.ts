import { readdir } from "fs/promises";
import { join } from "path";
import { $ } from "bun";

// Run each test file in its own bun process to guarantee module registry isolation.
// Bun 1.3.x shares mock.module state across files in a single run.
const files = (await readdir("src", { recursive: true }) as string[])
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => join("src", f));

if (files.length === 0) {
  console.log("No test files found.");
  process.exit(0);
}

let failed = false;

for (const file of files) {
  const result = await $`bun test ${file}`.nothrow();
  if (result.exitCode !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
