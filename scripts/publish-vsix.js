const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const extensionDirectory = path.join(root, "src", "ef-core-commander");
const vsce = process.platform === "win32" ? "vsce.cmd" : "vsce";
const result = spawnSync(vsce, ["publish"], {
  cwd: extensionDirectory,
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
