const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const extensionDirectory = path.join(root, "src", "ef-core-commander");
const outputDirectory = path.join(root, "artifacts", "vsix");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDirectory, "package.json"), "utf8"));
const outputPath = path.join(outputDirectory, `${manifest.name}-${manifest.version}.vsix`);

fs.mkdirSync(outputDirectory, { recursive: true });

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npx, ["--yes", "@vscode/vsce", "package", "--out", outputPath], {
  cwd: extensionDirectory,
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
