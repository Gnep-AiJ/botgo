const path = require("node:path");
const fs = require("node:fs");
const packaged = path.join(process.resourcesPath || "", "agent");
const agentRoot = fs.existsSync(path.join(packaged, "lib", "native.cjs")) ? packaged : path.resolve(__dirname, "../../agent");
module.exports = {
  agentRoot,
  ...require(path.join(agentRoot, "lib", "native.cjs")),
  ...require(path.join(agentRoot, "lib", "codex-runner.cjs")),
  ...require(path.join(agentRoot, "lib", "codex-config.cjs"))
};
