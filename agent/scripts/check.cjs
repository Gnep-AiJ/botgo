const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const files = [
  path.join(root, "bin", "botgo.cjs"),
  ...fs.readdirSync(path.join(root, "lib")).filter((file) => file.endsWith(".cjs")).map((file) => path.join(root, "lib", file)),
  ...fs.readdirSync(path.join(root, "test")).filter((file) => file.endsWith(".cjs")).map((file) => path.join(root, "test", file))
];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
