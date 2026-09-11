import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const worker = `${read("worker/src/index.js")}\n${read("worker/src/platform-admin.js")}`;
const workerConfig = read("worker/wrangler.jsonc");
const deployment = read("DEPLOYMENT.md");
const styles = read("styles.css");

assert.match(worker, /env\.UPSTREAM_BASE_URL/, "Worker 应从中转上游地址读取端点");
assert.match(worker, /env\.UPSTREAM_API_KEY/, "Worker 应从中转上游密钥读取 Bearer 鉴权");
assert.doesNotMatch(worker, /env\.OPENAI_(BASE_URL|API_KEY)/, "Worker 不应使用官方 OpenAI 命名的上游变量");
assert.match(workerConfig, /"UPSTREAM_BASE_URL"/, "Worker 配置应明确中转上游地址");
assert.doesNotMatch(workerConfig, /"OPENAI_BASE_URL"/, "Worker 配置不应暗示官方 OpenAI 上游");
assert.match(deployment, /UPSTREAM_API_KEY/, "发布文档应要求设置中转上游密钥");

assert.match(styles, /--text-primary:/, "首页应提供语义化主文字令牌");
assert.match(styles, /--surface-panel:/, "首页应提供语义化面板令牌");
assert.match(styles, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{[^}]*--text-primary:[^;]+;[^}]*--surface-panel:/s, "深色模式应同时定义文字与面板令牌");
assert.match(styles, /\.contact-panel[^{}]*\{[^}]*color:var\(--text-primary\);[^}]*background:var\(--surface-panel\);/s, "浅色联系弹层必须使用成对的文字与背景令牌");
assert.match(styles, /--hero-copy-primary:\s*#07182d;/, "亮色城市画面上的主标题必须有不随系统主题变化的深色令牌");
assert.match(styles, /--hero-copy-secondary:\s*#315571;/, "亮色城市画面上的说明文字必须有不随系统主题变化的深色令牌");
assert.match(styles, /\.past-speaker\s*\{[^}]*color:\s*var\(--hero-copy-secondary\);/s, "首段说明文字不能继承深色模式的浅色通用文字");
assert.match(styles, /\.future-speaker\s*\{[^}]*color:\s*var\(--hero-copy-secondary\);/s, "次段说明文字不能继承深色模式的浅色通用文字");
assert.match(styles, /\.past-quote\s*\{[^}]*color:\s*var\(--hero-copy-primary\);/s, "首段主标题不能继承深色模式的浅色通用文字");
assert.match(styles, /\.future-own\s*\{[^}]*color:\s*var\(--hero-copy-primary\);/s, "次段主标题不能继承深色模式的浅色通用文字");

console.log("Upstream and theme contract test passed");
