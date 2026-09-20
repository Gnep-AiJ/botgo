import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const worker = `${read("worker/src/index.js")}\n${read("worker/src/platform-admin.js")}`;
const workerConfig = read("worker/wrangler.jsonc");
const deployment = read("DEPLOYMENT.md");
const styles = read("styles.css");

assert.match(worker, /upstream_route_members/, "Worker 应从 Web 管理的路由池读取上游端点");
assert.doesNotMatch(worker, /env\.UPSTREAM_(BASE_URL|API_KEY)/, "Worker 不应继续读取回退上游变量");
assert.doesNotMatch(worker, /env\.OPENAI_(BASE_URL|API_KEY)/, "Worker 不应使用官方 OpenAI 命名的上游变量");
assert.doesNotMatch(workerConfig, /"UPSTREAM_(BASE_URL|API_KEY)"/, "Worker 配置不应保存上游端点或密钥");
assert.doesNotMatch(workerConfig, /"OPENAI_BASE_URL"/, "Worker 配置不应暗示官方 OpenAI 上游");
assert.match(deployment, /Web admin/, "发布文档应要求通过 Web 管理上游");

assert.match(styles, /--ink:/, "官网应提供文字令牌");
assert.match(styles, /--line:/, "官网应提供边框令牌");
assert.match(styles, /:focus-visible/, "键盘焦点应可见");
assert.match(styles, /prefers-reduced-motion/, "应尊重减少动画设置");
assert.match(styles, /@media\(max-width:600px\)/, "官网应适配手机屏幕");

console.log("Upstream and theme contract test passed");
