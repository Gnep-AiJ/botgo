const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/release-metadata.cjs <installer.exe>");
const absolute = path.resolve(file);
const stat = fs.statSync(absolute);
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
process.stdout.write(`${JSON.stringify({ fileName: path.basename(absolute), sizeBytes: stat.size, sha256 }, null, 2)}\n`);
