import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const workspace = read("workspace.html");
const workspaceStyles = read("workspace.css");
const client = read("workspace.js");
const worker = read("worker/src/index.js");
const migration = read("worker/migrations/0002_codex_access.sql");

assert.match(workspace, /BotGo Desktop/, "网页应保留 BotGo Desktop 产品说明");
assert.match(workspace, /data-desktop-open>查看已发布版本/, "桌面端仅查询已发布版本");
assert.match(workspace, /id="desktop-install-dialog"/, "桌面端说明应使用独立对话框");
assert.match(client, /desktopInstallDialog\.showModal\(\)/, "客户端应打开桌面端说明对话框");
assert.doesNotMatch(workspace, /\/downloads\/BotGo-Desktop-Setup\.exe/, "未托管安装包不应在网页提供下载入口");
assert.doesNotMatch(workspace, /API Key|Codex CLI|Claude Code|chatgpt\.com\/download/, "网页不应展示凭据或第三方下载入口");
assert.doesNotMatch(client, /bootstrapCommand|\/account\/codex-key|navigator\.clipboard/, "网页脚本不应生成命令或处理凭据复制");
assert.match(workspaceStyles, /color-scheme:\s*light dark;/, "工作台应跟随系统主题");

assert.equal(fs.existsSync(path.join(root, "installer/botgo-bootstrap.ps1")), false, "旧 Windows 安装器应被移除");
assert.equal(fs.existsSync(path.join(root, "installer/botgo-bootstrap.sh")), false, "旧 Unix 安装器应被移除");
assert.match(migration, /CREATE TABLE IF NOT EXISTS subscriptions/, "迁移应保留订阅状态");
assert.match(migration, /CREATE TABLE IF NOT EXISTS api_keys/, "迁移应保留哈希化访问凭据");
assert.doesNotMatch(migration, /setup_sessions|claude/, "新的初始化数据库不应包含旧模型会话表");
assert.ok(fs.existsSync(path.join(root, "worker/migrations/0007_remove_legacy_setup_sessions.sql")), "已部署数据库应有前向清理迁移");
assert.match(worker, /\/account\/codex-key/, "Worker 应保留订阅账户的已有凭据接口");
assert.match(worker, /\/v1\/responses/, "Worker 应提供 Responses 中转端点");
assert.match(worker, /\/v1\/models/, "Worker 应提供模型列表端点");
assert.doesNotMatch(worker, /proxyClaudeMessages|\/v1\/messages/, "Worker 不应保留旧模型中转端点");
assert.match(worker, /INSERT INTO subscriptions \(account_id, plan, status\) VALUES \(\?, 'free', 'active'\)/, "验证邀请码账户应保留 Free 计划初始化");

console.log("Codex relay setup contract test passed");
