const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const target = path.resolve(__dirname, "..", ".secrets", "upstream_config_key.txt");
if (fs.existsSync(target)) throw new Error("UPSTREAM_CONFIG_KEY already exists; refusing to overwrite it.");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, crypto.randomBytes(32).toString("base64url"), { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write("Generated UPSTREAM_CONFIG_KEY in the ignored .secrets directory.\n");
