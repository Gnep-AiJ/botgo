import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const devSource = fs.readFileSync(path.join(root, "scripts", "dev.mjs"), "utf8");
const workspaceSource = fs.readFileSync(path.join(root, "workspace.js"), "utf8");
const billingSource = fs.readFileSync(path.join(root, "workspace-billing.js"), "utf8");
assert.match(devSource, /ignoredPrefixes = \["\.tmp-", "tmp-", "layout-", "debug-"\]/, "开发预览应忽略截图、浏览器临时目录和调试产物");
assert.match(devSource, /ignoredRoots = new Set\(\[[^\]]*"desktop"[^\]]*"docs"[^\]]*"tests"[^\]]*"worker"/, "开发预览不应监听桌面端、文档、测试和 Worker 产物");
assert.match(workspaceSource, /localPreviewHost\s*&&\s*\['account','chat'\]\.includes\(params\.get\('preview'\)\)/, "演示模式必须限于本地主机和明确查询参数");
assert.match(workspaceSource, /preview@botgo\.local/, "账户演示模式应使用明确的预览身份");
assert.match(billingSource, /accountPreview[\s\S]*本地界面预览不会发起支付。/, "账户演示模式不得发起真实支付");
const port = 40000 + (process.pid % 10000);
const child = spawn(process.execPath, ["scripts/dev.mjs"], {
  cwd: root,
  env: { ...process.env, BOTGO_DEV_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

async function waitForPreview() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`开发预览未在端口 ${port} 启动：${output}`);
}

async function stopPreview() {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGINT");
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

try {
  const response = await waitForPreview();
  const html = await response.text();
  assert.match(html, /EventSource\("\/__botgo-reload"\)/, "开发预览应向页面注入自动刷新连接");

  const productionHome = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
  assert.match(productionHome, /var buildVersion = "[a-f0-9]{12}"/, "生产首页应使用内容哈希作为缓存清理版本");
  assert.doesNotMatch(productionHome, /var buildVersion = "20260825\.11"/, "生产首页不应继续使用固定缓存版本");
} finally {
  await stopPreview();
}

console.log("Live development preview test passed");
