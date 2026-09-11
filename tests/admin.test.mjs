import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

for (const file of ["admin.html", "admin.css", "admin.js", "worker/migrations/0003_admin.sql"]) {
  assert.ok(exists(file), `管理员功能应提供 ${file}`);
}

const admin = read("admin.html");
const client = read("admin.js");
const worker = read("worker/src/index.js");
const workerConfig = read("worker/wrangler.jsonc");
const pagesConfig = read("wrangler.toml");
const migration = read("worker/migrations/0003_admin.sql");
const passwordlessMigration = "worker/migrations/0004_passwordless_auth.sql";

assert.match(admin, /id="admin-dashboard"/, "后台页面应提供受保护的数据视图");
assert.match(admin, /id="admin-test-login"/, "后台页面应提供明确标注的本地测试入口");
assert.match(admin, /id="admin-test-login" type="button" hidden/, "生产后台不应默认显示本地测试入口");
assert.match(client, /api\("\/admin\/overview"\)/, "后台页面应从受保护的管理概览接口读取数据");
assert.match(client, /isLocalPreview/, "本地测试入口应只在本机预览时可见");
assert.match(worker, /DEV_TEST_MODE/, "测试登录必须被显式的开发模式开关限制");
assert.match(worker, /\/auth\/dev-test-login/, "Worker 应提供本地测试登录端点");
assert.match(worker, /\/admin\/overview/, "Worker 应提供管理员概览端点");
assert.match(worker, /from "cloudflare:sockets"/, "验证码邮件应使用 Worker TCP Socket 传输层");
assert.match(worker, /smtp\.qq\.com/, "验证码邮件应连接 QQ SMTP 主机");
assert.match(worker, /port:\s*465/, "QQ SMTP 应通过 TLS 端口 465 发送");
assert.match(worker, /QQ_SMTP_USER/, "QQ SMTP 用户名必须从 Worker Secret 读取");
assert.match(worker, /QQ_SMTP_AUTH_CODE/, "QQ SMTP 授权码必须从 Worker Secret 读取");
assert.doesNotMatch(worker, /env\.EMAIL\.send/, "内测 QQ SMTP 路线不应依赖付费 Email Sending 绑定");
assert.match(pagesConfig, /pages_build_output_dir\s*=\s*"\.\/dist"/, "Pages 配置应明确使用构建产物目录");
assert.match(pagesConfig, /binding\s*=\s*"BOTGO_API"/, "Pages 必须声明 BotGo API 服务绑定");
assert.match(pagesConfig, /service\s*=\s*"botgo-api"/, "Pages 服务绑定必须指向 botgo-api Worker");
assert.match(worker, /CF-Connecting-IP/, "验证请求应基于匿名化的请求来源限速");
assert.match(worker, /invite_verification_requested[\s\S]*?ipHash/, "审计日志应保存匿名化的请求来源指纹");
assert.match(worker, /Too many verification requests/, "重复发送验证码应被明确拒绝");
assert.ok(exists(passwordlessMigration), "邮箱验证码登录应提供独立的 D1 迁移");
assert.match(read(passwordlessMigration), /CREATE TABLE IF NOT EXISTS email_login_codes/, "登录验证码应与邀请码注册验证码分表存储");
assert.match(worker, /\/auth\/request-login-code/, "Worker 应提供发送登录验证码端点");
assert.match(worker, /async function requestLoginCode/, "Worker 应实现登录验证码发送处理器");
assert.match(worker, /async function login\(request, env\)/, "Worker 应保留验证码确认登录处理器");
const loginHandler = worker.match(/async function login\(request, env\)[\s\S]*?\n\}/)?.[0] || "";
assert.match(loginHandler, /!\/\^\\d\{6\}\$\//, "登录验证码应接受六位数字");
assert.doesNotMatch(loginHandler, /!\/\^\\\\d\{6\}\$\//, "登录验证码不得匹配字面量反斜杠");
assert.doesNotMatch(worker, /passwordIsValid\(body\.password\)/, "注册不应再校验密码");
assert.doesNotMatch(worker, /hashPassword\(body\.password\)/, "注册不应再执行密码哈希");
assert.match(worker, /\/admin\/invites/, "Worker 应提供受保护的邀请码管理端点");
assert.match(worker, /accountStatusMatch[\s\S]*?updateAccountStatus/, "Worker 应提供受保护的用户状态管理端点");
assert.match(worker, /invite_created/, "邀请码创建操作应写入审计日志");
assert.match(worker, /account_status_changed/, "用户状态变更应写入审计日志");
assert.match(worker, /请输入邀请码。/, "注册接口应明确指出邀请码缺失");
assert.match(worker, /注册服务暂不可用，请稍后重试。/, "未捕获的注册异常应返回 JSON 错误而非 Cloudflare 错误页");
assert.match(worker, /registration_\$\{diagnostic\.stage\}/, "未捕获的注册异常应保留无敏感信息的阶段码");
assert.match(worker, /ADMIN_EMAIL/, "管理员接口应要求指定的管理员身份");
assert.match(migration, /ADD COLUMN role/, "账户表应保存管理员角色");
assert.ok(exists("dist/admin.html"), "构建产物应包含后台管理页面");

assert.doesNotMatch(workerConfig, /REPLACE_WITH_D1_DATABASE_ID/, "Worker configuration must bind a real D1 database before deployment");

console.log("Admin and verification contract test passed");
