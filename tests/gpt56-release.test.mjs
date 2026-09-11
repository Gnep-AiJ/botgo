import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const workspace = read("workspace.html");
const client = read("workspace.js");
const worker = read("worker/src/index.js");
const workerConfig = read("worker/wrangler.jsonc");
const codexConfig = read("desktop/lib/codex-config.cjs");
const build = read("scripts/build.mjs");

assert.match(workspace, /GPT-5\.6/, "网页应清晰展示唯一可用模型");
assert.doesNotMatch(workspace, /拆解需求|规划步骤/, "网页不应展示内部工作流提示");
assert.doesNotMatch(workspace, /\/downloads\/BotGo-Desktop-Setup\.exe/, "未托管的桌面安装包不应作为公开下载入口");
assert.doesNotMatch(client, /activeProvider|provider:\s*activeProvider|claude-sonnet/, "网页对话不应保留模型提供方切换");
assert.match(client, /model:\s*"gpt-5\.6"/, "网页对话应固定发送 GPT-5.6");

assert.match(worker, /const BOTGO_MODEL = "gpt-5\.6"/, "Worker 应集中定义唯一模型");
assert.doesNotMatch(worker, /proxyClaudeMessages|\/v1\/messages|ANTHROPIC_/, "Worker 不应保留 Anthropic 代理或路由");
assert.doesNotMatch(workerConfig, /ANTHROPIC_/, "Worker 配置不应保留 Anthropic 变量");
assert.match(worker, /model:\s*BOTGO_MODEL/, "Worker 转发请求必须使用固定模型");
assert.match(codexConfig, /model = "gpt-5\.6"/, "桌面端托管配置应固定 GPT-5.6");

assert.doesNotMatch(build, /installer\/botgo-bootstrap/, "生产构建不应发布旧命令行安装脚本");
assert.equal(exists("installer/botgo-bootstrap.ps1"), false, "旧 Windows 安装脚本应被移除");
assert.equal(exists("installer/botgo-bootstrap.sh"), false, "旧 Unix 安装脚本应被移除");
assert.equal(exists("server"), false, "已废弃 VPS 服务端不应留在发布分支");
assert.equal(exists("deploy"), false, "已废弃 VPS 部署栈不应留在发布分支");
assert.equal(exists("VPS_DEPLOYMENT.md"), false, "已废弃 VPS 文档不应留在发布分支");

console.log("GPT-5.6 release boundary test passed");
