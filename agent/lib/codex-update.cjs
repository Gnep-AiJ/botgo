const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_REGISTRY = "https://registry.npmjs.org/@openai%2fcodex";

function stableVersion(value) {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(String(value || ""));
  if (!match) return null;
  return { text: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`, parts: match.slice(1).map(Number) };
}

function selectLatestStableVersion(packument) {
  const latest = packument?.["dist-tags"]?.latest;
  const parsed = stableVersion(latest);
  if (!parsed) throw new Error("npm latest tag does not point to a stable Codex version");
  return parsed.text;
}

function compareVersions(left, right) {
  const leftVersion = stableVersion(left);
  const rightVersion = stableVersion(right);
  if (!leftVersion || !rightVersion) throw new Error("Codex version must be a stable x.y.z version");
  for (let index = 0; index < leftVersion.parts.length; index += 1) {
    if (leftVersion.parts[index] !== rightVersion.parts[index]) return leftVersion.parts[index] - rightVersion.parts[index];
  }
  return 0;
}

function installedCodexPackagePath(packageRoot) {
  return path.join(packageRoot, "node_modules", "@openai", "codex", "package.json");
}

function npmInvocation({ platform = process.platform, execPath = process.execPath, fsImpl = fs, args = [] } = {}) {
  if (platform === "win32") {
    const npmCli = path.win32.join(path.win32.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (typeof fsImpl.existsSync !== "function" || fsImpl.existsSync(npmCli)) return { command: execPath, args: [npmCli, ...args] };
  }
  return { command: platform === "win32" ? "npm.cmd" : "npm", args };
}

function readInstalledCodexVersion({ packageRoot, fsImpl = fs } = {}) {
  if (typeof packageRoot !== "string" || !packageRoot) throw new Error("A BotGo Agent package root is required");
  const packagePath = installedCodexPackagePath(packageRoot);
  let packageInfo;
  try {
    packageInfo = JSON.parse(fsImpl.readFileSync(packagePath, "utf8"));
  } catch (error) {
    const wrapped = new Error("The local Codex CLI is not installed. Run npm install in the agent directory first.");
    wrapped.cause = error;
    throw wrapped;
  }
  const parsed = stableVersion(packageInfo?.version);
  if (!parsed) throw new Error("The installed Codex CLI version is invalid");
  return parsed.text;
}

function fetchLatestStableVersionViaNpm({ registry = DEFAULT_REGISTRY, platform = process.platform, execPath = process.execPath, fsImpl = fs, spawnSyncImpl = spawnSync, env = process.env } = {}) {
  const invocation = npmInvocation({ platform, execPath, fsImpl, args: ["view", "@openai/codex", "dist-tags.latest", "--json", "--registry", registry] });
  const result = spawnSyncImpl(invocation.command, invocation.args, {
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result?.error) throw result.error;
  if (!result || result.status !== 0) throw new Error(`npm registry lookup failed with exit code ${result?.status ?? "unknown"}`);
  let latest;
  try { latest = JSON.parse(String(result.stdout || "")); } catch (error) {
    const wrapped = new Error("npm registry returned invalid Codex version data");
    wrapped.cause = error;
    throw wrapped;
  }
  return selectLatestStableVersion({ "dist-tags": { latest } });
}

async function fetchLatestStableVersion({ fetchImpl = globalThis.fetch, registry = DEFAULT_REGISTRY, platform = process.platform, execPath = process.execPath, fsImpl = fs, spawnSyncImpl = spawnSync, env = process.env } = {}) {
  let response;
  try {
    if (typeof fetchImpl !== "function") throw new Error("This Node.js version does not provide fetch");
    response = await fetchImpl(registry, { headers: { accept: "application/json" } });
  } catch (error) {
    try { return fetchLatestStableVersionViaNpm({ registry, platform, execPath, fsImpl, spawnSyncImpl, env }); }
    catch (fallbackError) { fallbackError.cause = error; throw fallbackError; }
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  return selectLatestStableVersion(payload);
}

async function inspectCodexUpdate({ packageRoot, fsImpl = fs, fetchImpl, registry = DEFAULT_REGISTRY } = {}) {
  const currentVersion = readInstalledCodexVersion({ packageRoot, fsImpl });
  const latestVersion = await fetchLatestStableVersion({ fetchImpl, registry });
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(currentVersion, latestVersion) < 0
  };
}

function applyCodexUpdate({ packageRoot, latestVersion, platform = process.platform, execPath = process.execPath, fsImpl = fs, spawnSyncImpl = spawnSync, env = process.env } = {}) {
  if (typeof packageRoot !== "string" || !packageRoot) throw new Error("A BotGo Agent package root is required");
  const parsed = stableVersion(latestVersion);
  if (!parsed) throw new Error("Codex update version must be a stable x.y.z version");
  const invocation = npmInvocation({ platform, execPath, fsImpl, args: ["install", "--save-exact", `@openai/codex@${parsed.text}`] });
  const result = spawnSyncImpl(invocation.command, invocation.args, {
    cwd: packageRoot,
    env,
    shell: false,
    windowsHide: true,
    stdio: "inherit"
  });
  if (result?.error) throw result.error;
  if (!result || result.status !== 0) throw new Error(`Codex update failed with exit code ${result?.status ?? "unknown"}`);
  return result;
}

module.exports = {
  DEFAULT_REGISTRY,
  applyCodexUpdate,
  compareVersions,
  fetchLatestStableVersion,
  fetchLatestStableVersionViaNpm,
  inspectCodexUpdate,
  installedCodexPackagePath,
  npmInvocation,
  readInstalledCodexVersion,
  selectLatestStableVersion,
  stableVersion
};
