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

assert.match(workspace, /id="model-picker"/, "网页应提供后端驱动的模型菜单");
assert.doesNotMatch(workspace, /拆解需求|规划步骤/, "网页不应展示内部工作流提示");
assert.doesNotMatch(workspace, /\/downloads\/BotGo-Desktop-Setup\.exe/, "未托管的桌面安装包不应作为公开下载入口");
assert.doesNotMatch(client, /activeProvider|provider:\s*activeProvider|claude-sonnet/, "网页对话不应保留模型提供方切换");
assert.match(client, /model:\s*requestModel/, "网页请求应冻结发送时所选模型");

assert.match(worker, /publicCatalog\(data,\{autoReview:desktop\?await autoReviewCapability\(env,data\):false\}\)/, "Worker 应集中提供模型目录并仅向有效 Desktop 设备返回审核能力");
assert.doesNotMatch(worker, /proxyClaudeMessages|\/v1\/messages|ANTHROPIC_/, "Worker 不应保留 Anthropic 代理或路由");
assert.doesNotMatch(workerConfig, /ANTHROPIC_/, "Worker 配置不应保留 Anthropic 变量");
assert.match(read('worker/src/metering.js'), /AUTO_REVIEW_BILLING_MODEL_ID = 'gpt-5\.6-luna'/, "原生 API-key 审核必须使用实测的 Luna 路由");
assert.match(read('worker/src/metering.js'), /selectedModel:billingModel\|\|model\.id,requestPurpose:autoReview\?'auto_review':'task'/, "审核账本必须区分所选模型、实际计费模型和请求用途");
assert.doesNotMatch(read('worker/src/metering.js'), /AUTO_REVIEW_TEMPLATE|Codex Auto Review/, "原生审核路由不应拥有独立模型目录或价格模板");
assert.match(codexConfig, /model = "gpt-5\.6"/, "桌面端兼容配置应保留服务端默认模型别名");

assert.doesNotMatch(build, /installer\/botgo-bootstrap/, "生产构建不应发布旧命令行安装脚本");
assert.equal(exists("installer/botgo-bootstrap.ps1"), false, "旧 Windows 安装脚本应被移除");
assert.equal(exists("installer/botgo-bootstrap.sh"), false, "旧 Unix 安装脚本应被移除");
assert.equal(exists("server"), false, "已废弃 VPS 服务端不应留在发布分支");
assert.equal(exists("deploy"), false, "已废弃 VPS 部署栈不应留在发布分支");
assert.equal(exists("VPS_DEPLOYMENT.md"), false, "已废弃 VPS 文档不应留在发布分支");

console.log("GPT-5.6 release boundary test passed");
