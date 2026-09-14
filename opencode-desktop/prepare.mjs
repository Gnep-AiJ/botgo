// Reproducible branding overlay for the pinned, ignored upstream build copy.
// Never edits the old desktop, an installed app, or the original source archive.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.dirname(here);
const source=path.join(root,'artifacts/opencode');
const original=path.join(root,'artifacts/verification/opencode-bootstrap/local-source/opencode-3104c1428ec91f809e5ab86631300de41eb6952e');
const report=JSON.parse(fs.readFileSync(path.join(source,'extraction-report.json'),'utf8'));
if(report.commitLabel!=='3104c1428ec91f809e5ab86631300de41eb6952e')throw Error('Unexpected upstream source');
const manifestPath=path.join(source,'botgo-overlay.json');
const previous=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{};
const staged=new Map();
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function base(file){
  const value=fs.readFileSync(path.join(original,file));
  if(hash(value)!==report.fileSha256[file])throw Error(`Original source changed: ${file}`);
  return value.toString('utf8');
}
function replace(value,needle,next){
  if(value.split(needle).length!==2)throw Error(`Upstream anchor changed: ${needle.slice(0,90)}`);
  return value.replace(needle,next);
}
function brand(value){
  return value.replaceAll('OpenCode Dev','BotGo Preview').replaceAll('OpenCode Beta','BotGo Beta')
    .replaceAll('"OpenCode"','"BotGo"').replaceAll('ai.opencode.desktop.dev','com.botgo.opencode.preview')
    .replaceAll('ai.opencode.desktop.beta','com.botgo.opencode.beta').replaceAll('ai.opencode.desktop','com.botgo.opencode');
}
let main=brand(base('packages/desktop/src/main/index.ts'));
main='import { createBotGo } from "./botgo-main"\n'+main;
main=replace(main,'  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")','  // BotGo previews may contain real accounts; never open an unauthenticated debugging port.');
main=replace(main,'const SIDECAR_VERSION = process.env.OPENCODE_SIDECAR_V2 === "1" ? "v2" : "v1"','const SIDECAR_VERSION: string = "v1"');
main=replace(main,'  if (!TEST_ONBOARDING) migrate()','  // BotGo never imports or mutates an existing OpenCode installation.');
main=replace(main,'join(app.getPath("appData"), appId),','process.env.BOTGO_PROFILE_ROOT ?? join(app.getPath("appData"), appId),');
main=replace(main,'  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))','  app.setPath("sessionData", onboardingTestRoot ? join(onboardingTestRoot, "session") : join(app.getPath("userData"), "chromium"))');
main=replace(main,'  const shellEnv = preferAppEnv(app.getPath("userData"))',`  const shellEnv = preferAppEnv(app.getPath("userData"))
  // Every native engine data/config/cache path belongs to this BotGo installation.
  for (const name of ["DATA", "CONFIG", "CACHE", "STATE"]) {
    const directory = join(app.getPath("userData"), "engine", name.toLowerCase())
    mkdirSync(directory, { recursive: true })
    process.env[\`XDG_\${name}_HOME\`] = directory
  }
  process.env.OPENCODE_DISABLE_AUTOUPDATE = "true"
  process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"`);
main=replace(main,'app.setAsDefaultProtocolClient("opencode")','app.setAsDefaultProtocolClient("botgo-opencode")');
main=replace(main,'  registerIpcHandlers({','  const botgo = createBotGo()\n  void botgo.initialize()\n  registerIpcHandlers({\n    botgo,');
main=replace(main,'    logger.log("sidecar connection started", { version: SIDECAR_VERSION })',
  '    yield* Effect.promise(() => botgo.ready)\n    logger.log("sidecar connection started", { version: SIDECAR_VERSION })');
main=replace(main,'  yield* Fiber.await(loadingTask)','  // The login window must be available before waiting for account authorization.');
main=replace(main,'  if (windows.length) createMenu(menuDeps)','  if (windows.length) createMenu(menuDeps)\n  yield* Fiber.await(loadingTask) // Keep the initialization fiber alive while the user signs in.');
staged.set('packages/desktop/src/main/index.ts',main);
staged.set('packages/desktop/src/main/botgo-main.ts',fs.readFileSync(path.join(here,'overlay/botgo-main.ts')));
for(const file of ['bridge.cjs','authorize.cjs','diagnostic.cjs','credential-store.cjs'])staged.set(`packages/desktop/src/main/botgo/${file}`,fs.readFileSync(path.join(here,'runtime',file)));
let ipc=base('packages/desktop/src/main/ipc.ts');
ipc='import type { createBotGo } from "./botgo-main"\n'+ipc;
ipc=replace(ipc,'type Deps = {','type Deps = {\n  botgo: ReturnType<typeof createBotGo>');
ipc=replace(ipc,'export function registerIpcHandlers(deps: Deps) {',`export function registerIpcHandlers(deps: Deps) {
  const sender = (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || event.senderFrame !== event.sender.mainFrame) throw Error("Invalid BotGo IPC sender")
    const url = new URL(event.senderFrame.url)
    if (url.protocol !== "oc:" || url.host !== "renderer") throw Error("Untrusted BotGo IPC origin")
  }
  ipcMain.handle("botgo-state", event => { sender(event); return deps.botgo.state() })
  ipcMain.handle("botgo-account", event => { sender(event); return deps.botgo.account() })
  ipcMain.handle("botgo-login", event => { sender(event); return deps.botgo.login() })
  ipcMain.handle("botgo-cancel", event => { sender(event); return deps.botgo.cancel() })
  ipcMain.handle("botgo-logout", event => { sender(event); return deps.botgo.logout() })
  ipcMain.handle("botgo-usage", (event, task: string) => { sender(event); return deps.botgo.usage(task) })`);
staged.set('packages/desktop/src/main/ipc.ts',ipc);
staged.set('packages/desktop/src/preload/index.ts',replace(base('packages/desktop/src/preload/index.ts'),'const api: ElectronAPI = {',`const api: ElectronAPI = {
  botgo: {
    state: () => ipcRenderer.invoke("botgo-state"),
    account: () => ipcRenderer.invoke("botgo-account"),
    login: () => ipcRenderer.invoke("botgo-login"),
    cancel: () => ipcRenderer.invoke("botgo-cancel"),
    logout: () => ipcRenderer.invoke("botgo-logout"),
    usage: task => ipcRenderer.invoke("botgo-usage", task),
  },`));
staged.set('packages/desktop/src/preload/types.ts',replace(base('packages/desktop/src/preload/types.ts'),'export type ElectronAPI = {',`export type ElectronAPI = {
  botgo: {
    state: () => Promise<import("../main/botgo-main").BotGoState>
    account: () => Promise<{ email: string; balanceMicros: number }>
    login: () => Promise<import("../main/botgo-main").BotGoState>
    cancel: () => Promise<import("../main/botgo-main").BotGoState>
    logout: () => Promise<void>
    usage: (task: string) => Promise<unknown>
  }`));
for(const file of ['botgo-gate.tsx','botgo-gate.css','botgo-account.tsx'])staged.set(`packages/desktop/src/renderer/${file}`,fs.readFileSync(path.join(here,'overlay',file)));
let renderer='import { BotGoGate } from "./botgo-gate"\nimport { BotGoAccount } from "./botgo-account"\n'+base('packages/desktop/src/renderer/index.tsx');
renderer=replace(renderer,'{(state) => <DesktopRoot windowState={state} />}','{(state) => <BotGoGate><DesktopRoot windowState={state} /></BotGoGate>}');
renderer=replace(renderer,'              <Inner />','              <Inner />\n              <BotGoAccount />');
staged.set('packages/desktop/src/renderer/index.tsx',renderer);
// The shared web app's optional Window.api declaration conflicts with ElectronAPI.
// Keep web-only narrowing local rather than weakening every desktop IPC type.
let appSource=base('packages/app/src/app.tsx');
appSource=replace(appSource,`    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark"; scheme?: "system" | "light" | "dark" }) => Promise<void>
      exportDebugLogs?: () => Promise<string>
    }
`,'');
appSource=replace(appSource,'          void window.api?.setTitlebar?.({ mode, scheme })',`          const desktop = window as Window & { api?: { setTitlebar?: (theme: { mode: "light" | "dark"; scheme?: "system" | "light" | "dark" }) => Promise<void> } }
          void desktop.api?.setTitlebar?.({ mode, scheme })`);
staged.set('packages/app/src/app.tsx',appSource);
// Translate product copy, never module names, config identifiers or licenses.
for(const directory of ['packages/app/src/i18n','packages/desktop/src/renderer/i18n']){
  for(const name of fs.readdirSync(path.join(original,directory)).filter(name=>name.endsWith('.ts'))){
    const file=`${directory}/${name}`;
    staged.set(file,base(file).replace(/("(?:[^"\\]|\\.)*"\s*:\s*)("(?:[^"\\]|\\.)*")/g,
      (_match,key,value)=>key+value.replaceAll('OpenCode','BotGo').replaceAll('opencode.ai/zen','botgo.win')));
  }
}
for(const file of ['packages/app/src/desktop-menu.ts','packages/app/src/pages/layout.tsx','packages/app/src/components/settings-general.tsx','packages/app/src/components/settings-v2/general.tsx']){
  staged.set(file,base(file).replace(/https:\/\/opencode\.ai\/[^"\s]*/g,'https://botgo.win/workspace.html?view=tutorials')
    .replace(/https:\/\/github\.com\/anomalyco\/opencode\/issues\/new[^"\s]*/g,'https://botgo.win/workspace.html?view=tutorials')
    .replaceAll('https://discord.com/invite/opencode','https://botgo.win/workspace.html?view=tutorials'));
}
// A managed desktop cannot switch to an unrelated server and bypass its gateway.
staged.set('packages/app/src/components/titlebar.tsx',base('packages/app/src/components/titlebar.tsx')
  .replaceAll('<ChannelIndicator debugTools={props.debugTools} />','<span class="px-2 text-12-medium text-text-strong">BotGo</span>'));
let servers=base('packages/app/src/context/server.tsx');
servers=replace(servers,'return resolveServerList({ stored: store.list, props: props.servers })','return (props.servers ?? []).filter(ServerConnection.builtin)');
servers=replace(servers,'    function setActive(input: ServerConnection.Key) {','    function setActive(input: ServerConnection.Key) {\n      if (!allServers().some(server => ServerConnection.key(server) === input)) return');
servers=replace(servers,'      const url_ = normalizeServerUrl(input.http.url)','      if (allServers().length) throw Error("BotGo manages this connection")\n      const url_ = normalizeServerUrl(input.http.url)');
staged.set('packages/app/src/context/server.tsx',servers);
for(const [file,component] of [['packages/app/src/components/dialog-settings.tsx','Tabs'],['packages/app/src/components/settings-v2/dialog-settings-v2.tsx','TabsV2']]){
  let settings=base(file);
  for(const tab of ['servers','providers']){
    const expression=new RegExp(`<${component}\\.Trigger value="${tab}">[\\s\\S]*?<\\/${component}\\.Trigger>`,'g');
    settings=settings.replace(expression,'');
  }
  staged.set(file,settings);
}
const translations={
  en:{'botgo.login.description':'Use your BotGo account to work with local projects.','botgo.login.action':'Sign in with BotGo','botgo.login.connecting':'Connecting…','botgo.login.waiting':'Waiting for browser authorization…','botgo.login.reopen':'Open the authorization page again','botgo.login.cancel':'Cancel','botgo.error.models':'BotGo is temporarily unavailable. Please try again later.','botgo.error.session':'Your sign-in has expired. Please sign in again.','botgo.error.connection':'Sign-in could not be completed. Please try again.'},
  zh:{'botgo.login.description':'登录 BotGo 账户，开始处理本地项目。','botgo.login.action':'登录 BotGo','botgo.login.connecting':'正在连接…','botgo.login.waiting':'等待浏览器授权…','botgo.login.reopen':'重新打开授权页面','botgo.login.cancel':'取消','botgo.error.models':'BotGo 服务暂不可用，请稍后重试。','botgo.error.session':'登录已失效，请重新登录。','botgo.error.connection':'暂时无法完成登录，请重试。'}
};
Object.assign(translations.en,{'botgo.account.title':'BotGo account and task charges','botgo.account.balance':'Account balance','botgo.account.cost':'Current task settled charges','botgo.account.unsettled':'Some requests are awaiting settlement. Refresh after the task ends.','botgo.account.refresh':'Refresh','botgo.account.recharge':'Open billing','botgo.account.logout':'Sign out and restart','botgo.account.close':'Close'});
Object.assign(translations.zh,{'botgo.account.title':'BotGo 账户与任务费用','botgo.account.balance':'账户余额','botgo.account.cost':'当前任务已结算费用','botgo.account.unsettled':'部分请求尚未结算，请在任务结束后刷新。','botgo.account.refresh':'刷新','botgo.account.recharge':'打开充值页面','botgo.account.logout':'退出并重启','botgo.account.close':'关闭'});
for(const [locale,strings] of Object.entries(translations)){
  const file=`packages/desktop/src/renderer/i18n/${locale}.ts`;
  staged.set(file,replace(String(staged.get(file)??base(file)),'export const dict = {','export const dict = {\n'+Object.entries(strings).map(([k,v])=>`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')));
}
let config=base('packages/opencode/src/config/config.ts');
config=replace(config,'          config: result,',`          config: process.env.BOTGO_MANAGED_CONFIG ? {
            ...result,
            ...JSON.parse(process.env.BOTGO_MANAGED_CONFIG),
          } : result,`);
staged.set('packages/opencode/src/config/config.ts',config);
staged.set('packages/opencode/src/session/retry.ts',replace(base('packages/opencode/src/session/retry.ts'),
  'export function retryable(error: Err, provider: string) {',
  'export function retryable(error: Err, provider: string) {\n  if (provider.startsWith("botgo-")) return undefined // Never replay metered requests automatically.'));
staged.set('packages/opencode/test/session/retry.test.ts',base('packages/opencode/test/session/retry.test.ts')+`
test("BotGo metered requests are never automatically replayed", () => {
  expect(SessionRetry.retryable(apiError(), "botgo-chat")).toBeUndefined()
  expect(SessionRetry.retryable(apiError(), "botgo-responses")).toBeUndefined()
  expect(SessionRetry.retryable(apiError(), "test")).toBeDefined()
})
`);
staged.set('packages/desktop/src/main/windows.ts',brand(base('packages/desktop/src/main/windows.ts')));
staged.set('packages/desktop/src/main/constants.ts',replace(base('packages/desktop/src/main/constants.ts'),
  'export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"',
  '// Upstream releases must never overwrite a BotGo build. BotGo updates are wired separately.\nexport const UPDATER_ENABLED = false'));
staged.set('packages/desktop/src/renderer/index.html',base('packages/desktop/src/renderer/index.html').replace('<title>OpenCode</title>','<title>BotGo</title>'));
staged.set('packages/ui/src/components/logo.tsx',fs.readFileSync(path.join(here,'overlay/logo.tsx')));
staged.set('packages/desktop/resources/icons/icon.ico',fs.readFileSync(path.join(here,'overlay/botgo-desktop.ico')));
const pkg=JSON.parse(base('packages/desktop/package.json'));
pkg.name='@botgo/opencode-desktop';
pkg.version='0.1.0-preview.2';
pkg.homepage='https://botgo.win';
// Keep upstream MIT authorship. Packaging is never publishing.
staged.set('packages/desktop/package.json',JSON.stringify(pkg,null,2)+'\n');
let builder=brand(base('packages/desktop/electron-builder.config.ts'));
builder=builder.replaceAll('schemes: ["opencode"]','schemes: ["botgo-opencode"]')
  .replace('"opencode-desktop-${os}-${arch}.${ext}"','"BotGo-${version}-${os}-${arch}.${ext}"');
builder=replace(builder,'  extraResources: [','  extraResources: [\n    { from: "resources/icons", to: "icons" },');
// The preview is a separate app; no upstream publishing configuration is retained.
builder=builder.replace(/^\s*publish: \{ provider: "github".*\n/gm,'');
staged.set('packages/desktop/electron-builder.config.ts',builder);

// Validate all targets before any write; fail if the build copy contains user edits.
for(const [file] of staged){
  const target=path.join(source,file);
  if(!fs.existsSync(target))continue;
  const actual=hash(fs.readFileSync(target));
  const expected=previous[file]??report.fileSha256[file];
  // The upstream icon copy step generates this exact resource from icons/dev.
  const icon=file==='packages/desktop/resources/icons/icon.ico' && actual===hash(fs.readFileSync(path.join(source,'packages/desktop/icons/dev/icon.ico')));
  if(actual!==expected&&!icon)throw Error(`Refusing to overwrite changed build source: ${file}`);
}
const manifest={...previous};
for(const [file,value] of staged){
  const target=path.join(source,file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,value);
  manifest[file]=hash(value);
}
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(`BotGo overlay applied to ${staged.size} files; original archive and old desktop preserved.`);
