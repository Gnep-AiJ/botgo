import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const index = read("index.html");
const styles = read("styles.css");
const homeScript = read("app.js");

assert.match(styles, /color-scheme:\s*light dark;/, "首页应声明系统浅色和深色主题");
assert.match(styles, /@media \(prefers-color-scheme: dark\)/, "首页应提供深色主题覆盖");
assert.doesNotMatch(index, /motion\.css/, "首页不应加载覆盖原布局的 motion.css");
assert.match(
  styles,
  /\.copy--past \{ top: 16\.5%; width: min\(58vw, 760px\); height: 520px; \}/,
  "首页首段应保留上一版的文案基准",
);
assert.match(
  styles,
  /\.past-quote \{[\s\S]*?font-size: clamp\(45px, 4\.35vw, 70px\);/,
  "首页首段标题应保留上一版的视觉尺度",
);
assert.match(index, /data-workspace="web"/, "首页应声明 BotGo AI 入口");
assert.match(index, /data-workspace="desktop"/, "首页应声明 BotGo Desktop 入口");
assert.doesNotMatch(index, /Codex CLI|Claude Code/, "首页不应展示底层 CLI 产品名");
assert.match(homeScript, /workspace\.html\?view=chat/, "首页入口应跳转到 BotGo AI 工作台");
assert.match(index, /home-workspace-cta/, "首页应保留醒目的工作台跳转按钮");
assert.match(index, /个人订阅 \/ 企业定制/, "联系面板应说明个人与企业服务");
assert.match(index, /<strong>个人订阅<\/strong>\s*<p>网页对话与 BotGo Desktop<\/p>/, "联系面板应使用简洁的个人订阅服务行");
assert.match(index, /<strong>企业定制<\/strong>\s*<p>Agent、知识库与定制部署<\/p>/, "联系面板应使用企业定制服务行");
assert.doesNotMatch(index, /扫码聊聊你的生意|扫码后备注业务名称|无需支付开发费用/, "联系面板不应保留旧的扫码与费用承诺文案");
assert.doesNotMatch(index, /<small>网页对话|<small>本地终端|<small>一键安装/, "首页服务卡片不应保留难以辨认的小字说明");

const workspacePath = path.join(root, "workspace.html");
assert.ok(fs.existsSync(workspacePath), "应提供独立工作区页面");
const workspace = read("workspace.html");
assert.match(workspace, /<aside class="conversation-sidebar"/, "工作区应提供会话侧栏");
assert.match(workspace, /<div class="workspace-shell">\s*<header class="workspace-header">/, "顶部品牌与导航应属于全局工作区，而不是仅属于右侧内容栏");
assert.doesNotMatch(workspace, /<aside class="conversation-sidebar"[^>]*>\s*<a class="workspace-brand"/, "聊天页不应在侧栏重复放置 BotGo 品牌");
assert.match(workspace, /data-view-link="chat"/, "工作区顶部应提供 BotGo AI 视图");
assert.match(workspace, /data-view-link="agents"/, "工作区顶部应提供 AI Agent 视图");
assert.match(workspace, /data-view-link="tutorials"/, "工作区顶部应提供教程视图");
assert.doesNotMatch(workspace, /data-view-link="subscription"/, "订阅不应占用顶层导航");
assert.match(workspace, /id="account-popover"[^>]*hidden/, "登录后应将账户信息收纳为单一点击入口");
assert.match(workspace, /data-account-avatar/, "登录后账户入口应提供头像首字母");
assert.match(workspace, /aria-label="打开账户菜单"/, "账户入口应提供明确的无障碍名称");
assert.match(workspace, /id="account-menu"[^>]*hidden[^>]*role="dialog"/, "账户入口应提供默认隐藏的小型状态框");
assert.match(workspace, /id="account-status"[^>]*role="status"[^>]*aria-atomic="true"/, "账户小框应以单一可访问状态提示计划与额度");
assert.match(workspace, /data-open-subscription/, "账户小框应可打开账户与订阅管理");
assert.match(workspace, /<dialog id="subscription-dialog"/, "账户管理应使用独立对话框");
assert.match(workspace, /data-billing-balance/, "余额弹窗应展示当前金额余额");
assert.match(workspace, /data-recharge-option/, "余额弹窗应提供预设充值金额");
assert.match(workspace, /data-subscription-upgrade[^>]*disabled/, "充值入口应在支付配置加载前禁用");
assert.match(workspace, /BotGo Desktop/, "网页工作台应以 BotGo Desktop 作为本地开发入口");
assert.match(workspace, /data-desktop-open>查看已发布版本/, "下载入口读取实际发布元数据");
assert.doesNotMatch(workspace, /API Key|Codex CLI|Claude Code|chatgpt\.com\/download/, "网页不应暴露凭据或第三方下载入口");
assert.match(workspace, /复制安装命令/, "应用页应提供 BotGo CLI 安装入口");
assert.doesNotMatch(workspace, /agent-setup-dialog/, "网页不应保留底层 Agent 配置弹窗");
assert.match(workspace, /id="login-button"/, "登录按钮应位于工作区头部");
assert.match(workspace, /id="register-button"/, "注册按钮应位于工作区头部");
assert.match(workspace, /id="theme-toggle"[^>]*aria-label="切换主题"/, "工作区应提供可访问的明暗主题切换按钮");
assert.match(workspace, /class="theme-icon theme-icon--sun"/, "主题按钮应提供日间太阳图标");
assert.match(workspace, /class="theme-icon theme-icon--moon"/, "主题按钮应提供夜间月亮图标");
assert.doesNotMatch(workspace, /id="theme-toggle"[^>]*>\s*(?:日间|夜间)\s*<\/button>/, "主题按钮不应继续显示日间或夜间文字");
assert.match(workspace, /<dialog id="auth-dialog"/, "认证流程应使用独立对话框");
assert.doesNotMatch(workspace, /name="password"/, "邮箱验证码认证页面不应保留密码字段");

const workspaceScriptPath = path.join(root, "workspace.js");
assert.ok(fs.existsSync(workspaceScriptPath), "工作区应提供独立交互脚本");
const workspaceScript = read("workspace.js");
const workspaceStyles = read("workspace.css");
assert.match(workspaceScript, /const allowedViews = new Set\(\["chat", "agents", "tutorials"\]\)/, "脚本应限制顶层视图参数");
assert.match(workspaceScript, /const summary = account \? `余额 \$\{balance\}`/, "登录状态栏应显示金额余额");
assert.match(workspaceScript, /function setAccountMenu\(open\)/, "账户小框应由单一状态函数控制开关");
assert.match(workspaceScript, /function openSubscriptionDialog\(\)/, "账户管理弹窗应由单一函数打开");
assert.match(workspaceScript, /params\.get\("view"\) === "subscription"/, "旧订阅链接应被兼容处理");
assert.match(workspaceScript, /event\.key === "Escape" && !accountMenu\.hidden/, "账户小框应支持 Escape 关闭");
assert.match(workspaceScript, /data-billing-balance/, "余额页应与账户状态同步");
assert.match(workspaceScript, /params\.get\("view"\).*: "chat"/, "脚本应将 BotGo AI 作为工作台默认视图");
assert.match(workspaceScript, /authDialog\.showModal\(\)/, "认证按钮应打开认证对话框");
assert.match(workspaceScript, /api\("\/auth\/request-login-code"/, "登录提交应先请求邮箱验证码");
assert.match(workspaceScript, /let verificationPurpose = "register"/, "验证码确认应区分注册与登录来源");
assert.match(workspaceScript, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing/, "聊天输入应支持 Enter 发送、Shift+Enter 换行并兼容输入法");
assert.match(workspaceScript, /let chatSending = false/, "聊天请求期间必须阻止重复发送");
assert.match(workspaceScript, /replace\(\/\[０-９\]\//, "验证码应将全角数字规范化为半角数字");
assert.doesNotMatch(workspace, /desktop-release-version|desktop-release-meta|desktop-release-sha/, "用户下载弹窗不应展示版本、体积或校验值");
assert.match(workspaceScript, /desktopInstallDialog\.showModal\(\)/, "桌面端入口应打开独立说明对话框");
assert.match(workspaceScript, /localStorage\.getItem\("botgo-theme"\)/, "主题选择应在本机保存");
assert.match(workspaceScript, /function applyTheme\(theme\)/, "主题切换应集中由单一函数应用");
assert.match(workspaceScript, /themeToggle\.addEventListener\("click"/, "主题按钮应可切换明暗模式");
assert.match(workspaceScript, /themeColorMeta\?\.setAttribute\("content"/, "浏览器外壳颜色应与工作台主题同步");
assert.match(workspaceScript, /function syncThemeFromPreference\(\)/, "工作区加载时应把系统或已保存主题解析为明确的 data-theme");
assert.match(workspaceScript, /document\.documentElement\.dataset\.theme = resolvedTheme;/, "主题渲染必须使用明确的 data-theme，避免系统媒体查询穿透手动日间模式");
assert.doesNotMatch(workspaceScript, /themeToggle\.textContent\s*=/, "主题切换不应覆盖按钮内的图标");
assert.match(workspaceScript, /themeToggle\.title\s*=\s*themeLabel/, "主题图标应提供原生悬停提示");
assert.doesNotMatch(workspaceScript, /account\/codex-key|clipboard\.writeText|bootstrapCommand/, "网页脚本不应签发或复制底层凭据和命令");
assert.match(workspaceScript, /history\.replaceState/, "切换工具应更新浏览器地址");
assert.match(workspaceStyles, /color-scheme:\s*light dark;/, "工作区应跟随系统浅色和深色主题");
assert.match(workspaceStyles, /@media \(prefers-color-scheme: dark\)/, "工作区应提供系统深色主题令牌");
assert.match(workspaceStyles, /@media \(prefers-color-scheme: dark\) \{[\s\S]*?--workspace-canvas:rgb\(4 30 52 \/ 88%\);[\s\S]*?--workspace-surface:rgb\(5 35 60 \/ 84%\);[\s\S]*?--workspace-elevated:rgb\(8 47 78 \/ 90%\);/, "深色模式必须为城市蓝工作台定义完整的画布与承载层令牌");
assert.match(workspaceStyles, /\.workspace-main,\.workspace-view--chat\s*\{\s*background:var\(--workspace-canvas\);\s*\}/, "深色工作区和聊天舞台必须共享同一深色画布");
assert.match(workspaceStyles, /\.workspace-header,\.conversation-sidebar,\.content-panel,\.agent-choice,\.agent-card,\.chat-composer,dialog,\.account-menu,\.subscription-dialog\s*\{\s*background:var\(--workspace-surface\);\s*\}/, "深色模式的所有正文承载层必须覆盖遗留浅色背景");
assert.match(workspaceStyles, /\.workspace-stage \.workspace-header\s*\{\s*background:var\(--workspace-surface\);\s*\}/, "深色模式必须覆盖高优先级的透明顶部栏背景");
assert.match(workspaceStyles, /body\[data-active-view="chat"\] \.workspace-main,body\[data-active-view="agents"\] \.workspace-main,body\[data-active-view="tutorials"\] \.workspace-main,body\[data-active-view="chat"\] \.workspace-view--chat\s*\{\s*background:var\(--workspace-canvas\);\s*\}/, "深色模式必须覆盖高优先级的视图状态浅色背景");
assert.match(workspaceStyles, /body\[data-active-view="chat"\] \.conversation-sidebar\s*\{\s*background:var\(--workspace-surface\);\s*\}/, "深色模式必须覆盖聊天侧栏的视图状态浅色背景");
assert.match(workspaceStyles, /:root\[data-theme="dark"\]/, "工作区应支持手动强制夜间模式");
assert.match(workspaceStyles, /:root\[data-theme="light"\]/, "工作区应支持手动强制日间模式");
assert.match(workspaceStyles, /:root\[data-theme="light"\]\s*\{[\s\S]*?--workspace-canvas:transparent;/, "日间模式应使用统一的透明主画布显示浅色城市背景");
assert.match(workspaceStyles, /:root\[data-theme="light"\] \.workspace-main,[\s\S]*?:root\[data-theme="light"\] \.workspace-view--tutorials\s*\{\s*background:var\(--workspace-canvas\);/, "日间模式应统一覆盖对话、桌面端和指南画布");
assert.match(workspaceStyles, /:root\[data-theme="light"\] \.workspace-header,[\s\S]*?:root\[data-theme="light"\] \.subscription-dialog\s*\{[\s\S]*?background:var\(--workspace-surface\);/, "日间模式应统一所有承载层颜色");
assert.match(workspaceStyles, /:root\[data-theme="dark"\] \.workspace-main,[\s\S]*?:root\[data-theme="dark"\] \.workspace-view--tutorials\s*\{\s*background:var\(--workspace-canvas\);/, "夜间模式应把 Agent 页透明画布扩展到所有视图");
assert.match(workspaceStyles, /\.theme-toggle\s*\{[^}]*inline-size:40px;[^}]*block-size:40px;/, "主题图标按钮应具有稳定的方形点击区域");
assert.match(workspaceStyles, /\.theme-toggle\[aria-pressed="false"\]\s+\.theme-icon--sun/, "日间模式应显示太阳图标");
assert.match(workspaceStyles, /\.theme-toggle\[aria-pressed="true"\]\s+\.theme-icon--moon/, "夜间模式应显示月亮图标");
assert.match(workspaceStyles, /@media \(max-width:520px\) \{[\s\S]*?\.auth-actions\s*\{[^}]*flex-wrap:nowrap;/, "窄屏账户操作不应换行挤压导航");
assert.match(workspaceStyles, /@media \(max-width:380px\) \{[\s\S]*?\.auth-actions #login-button,[\s\S]*?\.auth-actions #register-button\s*\{[^}]*padding-inline:7px;/, "极窄屏登录与注册操作应收紧但保持可见");
assert.match(workspaceStyles, /@media \(max-width:520px\) \{[\s\S]*?dialog\s*\{[^}]*max-height:calc\(100dvh - 24px\);[^}]*overflow-y:auto;/, "手机端弹窗应限制在动态视口内并可滚动");
assert.match(workspaceStyles, /:root\[data-theme="light"\] \.agent-choice\s*\{\s*background:rgb\(233 248 255 \/ 60%\);/, "手动日间模式必须覆盖系统夜间模式遗留的桌面端卡片背景");
assert.match(workspaceStyles, /:root\[data-theme="dark"\] body\[data-active-view="agents"\] \.workspace-main\s*\{\s*background:transparent;/, "夜间 Agent 页不应保留整页深色外框");
assert.match(workspaceStyles, /\.auth-form\[hidden\]\s*\{\s*display:\s*none;/, "认证对话框一次只能显示一个表单");
assert.match(workspaceStyles, /\.workspace-stage/, "工作区应具有带 BotGo 背景的沉浸式内容舞台");
assert.match(workspaceStyles, /\.workspace-header\s*\{[^}]*grid-column:1\s*\/\s*-1/, "全局顶部应跨越聊天侧栏与内容区");
assert.match(workspaceStyles, /body\[data-active-view="agents"\],body\[data-active-view="tutorials"\]/, "Agent 和教程视图应使用同一非对话工作区状态");
assert.match(workspaceStyles, /\.conversation-sidebar\s*\{\s*display:none;\s*\}/, "非对话视图应隐藏左侧会话栏");
assert.match(workspaceStyles, /\.mobile-brand\s*\{\s*display:inline-flex;\s*\}/, "非对话视图应在顶部保留 BotGo 机器人品牌");
assert.match(workspaceStyles, /\.workspace-scrim\s*\{\s*background:linear-gradient\(100deg,rgb\(226 244 255 \/ 76%\)/, "Agent 和教程视图应减弱遮罩，保留 BotGo 城市背景");
assert.match(workspaceStyles, /body\[data-active-view="chat"\] \.workspace-scrim\s*\{\s*background:linear-gradient\(100deg,rgb\(231 247 255 \/ 72%\)/, "聊天视图应降低遮罩强度，恢复 BotGo 城市背景");
assert.match(workspaceStyles, /\.workspace-stage \.workspace-header\s*\{\s*background:linear-gradient\(180deg,rgb\(224 245 255 \/ 72%\)/, "全局顶部应使用与背景融合的透明导航表面");
assert.match(workspaceStyles, /@media \(max-width:760px\) \{[\s\S]*?\.workspace-header\s*\{[\s\S]*?grid-template-columns:minmax\(0,1fr\) auto;/, "手机端顶部应将品牌与账户操作收敛为一行");
assert.match(workspaceStyles, /@media \(max-width:760px\) \{[\s\S]*?\.workspace-nav\s*\{[\s\S]*?grid-column:1 \/ -1;[\s\S]*?overflow-x:auto;/, "手机端顶部导航应独占一行并允许横向滚动");
assert.match(workspaceStyles, /\.chat-composer\s*\{[\s\S]*?env\(safe-area-inset-bottom\)/, "手机端输入区应避开底部安全区");
assert.match(
  styles,
  /@media \(max-width: 820px\) \{[\s\S]*?\.home-workspace-cta \{[\s\S]*?top:\s*255px;[\s\S]*?left:\s*10px;/,
  "手机端 CTA 应紧随第二段标题，不再继承桌面绝对坐标",
);
assert.match(
  styles,
  /@media \(max-width: 820px\) \{[\s\S]*?\.bot-services \{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/,
  "手机端三个入口应占满三列，不应保留空白第四列",
);
assert.doesNotMatch(workspaceStyles, /\.auth-actions #login-button\{display:none\}/, "手机端不应隐藏未登录用户的登录按钮");
assert.doesNotMatch(workspaceStyles, /\.auth-actions #register-button\{display:none\}/, "手机端不应隐藏未登录用户的注册按钮");
assert.match(
  workspaceStyles,
  /\.auth-actions #login-button:not\(\[hidden\]\),[\s\S]*?\.auth-actions #register-button:not\(\[hidden\]\)\s*\{[\s\S]*?display:inline-flex;/,
  "手机端应保留未登录状态下的登录与注册操作",
);
assert.match(workspaceStyles, /\.account-avatar\s*\{/, "账户头像应使用独立的统一视觉样式");
assert.match(workspaceStyles, /\.subscription-dialog/, "账户管理弹窗应使用 BotGo 透明蓝视觉样式");
assert.match(
  workspaceStyles,
  /@media \(max-width:760px\) \{[\s\S]*?\.agent-choices \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\);[\s\S]*?\.agent-choice--desktop \{ grid-column:1 \/ -1;/,
  "手机端应将 Codex 与 Claude 并列显示，桌面版入口独占下一行",
);

assert.match(workspaceStyles, /@media \(max-width:520px\) \{[\s\S]*?\.mobile-brand\s*\{[^}]*grid-column:1;[^}]*grid-row:1;/, "窄屏品牌应固定在顶部首列");
assert.match(workspaceStyles, /@media \(max-width:520px\) \{[\s\S]*?\.auth-actions\s*\{[^}]*grid-column:2;[^}]*grid-row:1;/, "窄屏账户操作应与品牌同排显示");
assert.match(workspaceStyles, /@media \(max-width:520px\) \{[\s\S]*?\.auth-actions\s*\{[^}]*min-width:max-content;/, "窄屏账户操作组应按内容占位，避免登录与注册被挤出视口");
assert.match(workspaceStyles, /@media \(max-width:520px\) \{[\s\S]*?\.auth-actions\s*\{[^}]*width:max-content;/, "窄屏账户操作组应显式使用内容宽度，避免按钮溢出到视口外");
assert.match(workspaceStyles, /\.auth-actions #login-button:not\(\[hidden\]\),[\s\S]*?visibility:visible;[\s\S]*?opacity:1;/, "窄屏登录与注册入口必须保持可见，不能被通用样式隐去");
assert.match(workspaceStyles, /@media \(max-width:520px\) \{[\s\S]*?\.workspace-nav\s*\{[^}]*grid-column:1\s*\/\s*-1;[^}]*grid-row:2;/, "窄屏导航应独占第二行");
assert.match(workspaceStyles, /@media \(max-width:760px\) \{[\s\S]*?\.workspace-main\s*\{[^}]*min-height:calc\(100dvh - 104px/, "窄屏工作区高度应扣除两行头部");
assert.match(workspaceStyles, /:root\[data-theme="dark"\] dialog\s*\{[^}]*background:#0b3554;/, "夜间认证弹窗应使用不透明表面");
assert.match(workspaceStyles, /:root\[data-theme="dark"\] #desktop-install-dialog\s*\{[^}]*background:#0b3554;/, "夜间桌面端弹窗应覆盖高优先级浅色背景");
assert.match(workspaceStyles, /:root\[data-theme="dark"\] dialog::backdrop\s*\{[^}]*background:rgb\(0 10 22 \/ 72%\);/, "夜间弹窗遮罩应压低背景");

const dist = path.join(root, "dist");
for (const file of ["workspace.html", "workspace.css", "workspace.js"]) {
  assert.ok(fs.existsSync(path.join(dist, file)), `构建产物应包含 ${file}`);
}

console.log("Homepage and workspace contract test passed");
