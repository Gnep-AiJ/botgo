import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dist = path.join(process.cwd(), "dist");
const read = (file) => fs.readFileSync(path.join(dist, file), "utf8");
const home = read("index.html");
const workspace = read("workspace.html");
const admin = read("admin.html");
const headers = read("_headers");

assert.doesNotMatch(home, /motion\.css/, "生产首页不能加载布局覆盖文件");
assert.match(home, /data-workspace="web"/, "生产首页应保留 BotGo AI 入口");
assert.match(home, /data-workspace="desktop"/, "生产首页应保留 BotGo Desktop 入口");
assert.match(home, /data-workspace="guide"/, "生产首页应保留使用指南入口");
assert.doesNotMatch(home, /Codex CLI|Claude Code/, "生产首页不应展示底层 CLI 产品名");
assert.match(home, /workspace\.html\?view=chat/, "生产首页入口应跳转到 BotGo AI 工作台");
assert.match(home, /home-workspace-cta/, "生产首页应保留工作台跳转按钮");
assert.match(home, /个人订阅 \/ 企业定制/, "生产首页联系面板应说明个人与企业服务");
assert.match(workspace, /conversation-sidebar/, "生产工作区应保留会话侧栏");
assert.match(workspace, /auth-actions/, "生产工作区应保留右上认证操作");
assert.match(workspace, /data-view-link="chat"/, "生产工作区应提供 BotGo AI 顶部视图");
assert.match(workspace, /data-view-link="agents"/, "生产工作区应提供 AI Agent 顶部视图");
assert.match(workspace, /data-view-link="tutorials"/, "生产工作区应提供教程顶部视图");
assert.ok(fs.existsSync(path.join(dist, "workspace.css")), "生产目录应包含工作区样式");
assert.ok(fs.existsSync(path.join(dist, "workspace.js")), "生产目录应包含工作区脚本");
assert.match(workspace, /href="\.\/workspace\.css\?v=[a-f0-9]{12}"/, "工作台样式应使用内容版本 URL，绕过旧浏览器缓存");
assert.match(workspace, /src="\.\/workspace\.js\?v=[a-f0-9]{12}"/, "工作台脚本应使用内容版本 URL，绕过旧浏览器缓存");
assert.match(admin, /href="\.\/admin\.css\?v=[a-f0-9]{12}"/, "后台样式应使用内容版本 URL，绕过旧浏览器缓存");
assert.match(admin, /src="\.\/admin\.js\?v=[a-f0-9]{12}"/, "后台脚本应使用内容版本 URL，绕过旧浏览器缓存");
assert.match(headers, /\/\*\.css\s+Cache-Control: public, max-age=0, must-revalidate/, "未加版本号的 CSS 不应被浏览器长期缓存");
assert.match(headers, /\/\*\.js\s+Cache-Control: public, max-age=0, must-revalidate/, "未加版本号的 JS 不应被浏览器长期缓存");
assert.doesNotMatch(headers, /\/\*\.(css|js)\s+Cache-Control: public, max-age=31536000, immutable/, "CSS 与 JS 的缓存策略不应声明为 immutable");

console.log("Production homepage and workspace smoke test passed");
