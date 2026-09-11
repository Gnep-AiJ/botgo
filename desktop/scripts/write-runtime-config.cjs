const fs = require("node:fs");
const path = require("node:path");

const apiOrigin = (process.env.BOTGO_API_ORIGIN || "").replace(/\/$/, "");
if (!/^https:\/\//.test(apiOrigin)) {
  throw new Error("Missing BOTGO_API_ORIGIN. Set it to the deployed BotGo Pages address before packaging.");
}

const target = path.resolve(__dirname, "..", "runtime-config.cjs");
fs.writeFileSync(target, `module.exports = { apiOrigin: ${JSON.stringify(apiOrigin)} };\n`, "utf8");
