const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

function agentPaths({ platform = process.platform, localAppData = process.env.LOCALAPPDATA, xdgStateHome = process.env.XDG_STATE_HOME, home = os.homedir() } = {}) {
  const isWindows = platform === "win32";
  const join = isWindows ? path.win32.join : path.join;
  const root = isWindows
    ? join(localAppData || join(home, "AppData", "Local"), "BotGo", "Agent")
    : join(xdgStateHome || join(home, ".local", "state"), "botgo-agent");
  return {
    root,
    codexHome: join(root, "codex"),
    stateFile: join(root, "state.json"),
    platform,
    packageRoot: path.resolve(__dirname, "..")
  };
}

function ensureAgentPaths(paths, fsImpl = fs) {
  if (!paths || typeof paths.root !== "string" || typeof paths.codexHome !== "string") {
    throw new TypeError("Valid BotGo Agent paths are required");
  }
  fsImpl.mkdirSync(paths.root, { recursive: true });
  fsImpl.mkdirSync(paths.codexHome, { recursive: true });
  return paths;
}

module.exports = { agentPaths, ensureAgentPaths };
