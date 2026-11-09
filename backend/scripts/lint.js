const { readdirSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const roots = ["src", "tests"];
let checked = 0;
let failed = 0;

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;

    checked += 1;
    const result = spawnSync(process.execPath, ["--check", fullPath], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      failed += 1;
      process.stderr.write(result.stderr || `${fullPath} failed syntax check\n`);
    }
  }
}

for (const root of roots) walk(path.resolve(root));

if (failed > 0) {
  console.error(`[lint] ${failed} of ${checked} JavaScript files failed`);
  process.exit(1);
}

console.log(`[lint] ${checked} JavaScript files passed syntax checks`);
