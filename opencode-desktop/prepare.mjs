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
function remove(value,needle){
  return replace(value,needle,'');
}
function removeSection(value,start,end){
  const from=value.indexOf(start);
  const to=value.indexOf(end,from);
  if(from<0||to<0||value.indexOf(start,from+1)!==-1)throw Error(`Upstream section changed: ${start.slice(0,90)}`);
  return value.slice(0,from)+value.slice(to);
}
function brand(value){
  return value.replaceAll('OpenCode Dev','BotGo Desktop').replaceAll('OpenCode Beta','BotGo Desktop')
    .replaceAll('"OpenCode"','"BotGo"').replaceAll('ai.opencode.desktop.dev','com.botgo.desktop')
    .replaceAll('ai.opencode.desktop.beta','com.botgo.desktop').replaceAll('ai.opencode.desktop','com.botgo.desktop');
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
main=replace(main,'app.setAsDefaultProtocolClient("opencode")','app.setAsDefaultProtocolClient("botgo")');
main=replace(main,'  const updater = setupAutoUpdater(stopSidecars)','  const botgo = createBotGo()\n  void botgo.initialize()\n  const updater = setupAutoUpdater(stopSidecars, botgo)');
main=replace(main,'  void updater.start()\n  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)\n  updateTimer.unref()\n  app.once("will-quit", () => clearInterval(updateTimer))','  // BotGo checks only after a successful device login.');
main=replace(main,'  registerIpcHandlers({','  registerIpcHandlers({\n    botgo,');
main=replace(main,'    logger.log("sidecar connection started", { version: SIDECAR_VERSION })',
  '    yield* Effect.promise(() => botgo.ready)\n    void updater.start()\n    logger.log("sidecar connection started", { version: SIDECAR_VERSION })');
main=replace(main,'  yield* Fiber.await(loadingTask)','  // The login window must be available before waiting for account authorization.');
main=replace(main,'  if (windows.length) createMenu(menuDeps)','  if (windows.length) createMenu(menuDeps)\n  yield* Fiber.await(loadingTask) // Keep the initialization fiber alive while the user signs in.');
staged.set('packages/desktop/src/main/index.ts',main);
staged.set('packages/desktop/src/main/botgo-main.ts',fs.readFileSync(path.join(here,'overlay/botgo-main.ts')));
for(const file of ['bridge.cjs','network.cjs','authorize.cjs','diagnostic.cjs','credential-store.cjs','updater.cjs','verify-signature.ps1'])staged.set(`packages/desktop/src/main/botgo/${file}`,fs.readFileSync(path.join(here,'runtime',file)));
staged.set('packages/desktop/src/main/updater.ts',fs.readFileSync(path.join(here,'overlay/botgo-updater.ts')));
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
// A rebuilt local service has no record of tabs persisted by an older preview.
// Remove only the server-confirmed missing tab, then reopen a blank draft in its
// remembered project when that project is still available. Network and other
// errors keep the original upstream error handling.
let sessionPage=base('packages/app/src/pages/session.tsx');
sessionPage=replace(sessionPage,'import { useTabs } from "@/context/tabs"','import { tabKey, useTabs } from "@/context/tabs"');
sessionPage=replace(sessionPage,`  const closeTab = () => {
    if (!props.sessionID) return
    tabs.removeSessionTab({ server: props.serverKey ?? server.key, sessionId: props.sessionID })
  }`, `  const recoverMissingSession = () => {
    if (!props.sessionID || !isCurrentSessionNotFoundError(props.error, props.sessionID)) return
    const tab = { type: "session" as const, server: props.serverKey ?? server.key, sessionId: props.sessionID }
    const directory = tabs.info[tabKey(tab)]?.directory
    tabs.removeSessionTab({ server: tab.server, sessionId: tab.sessionId })
    if (directory) void tabs.newDraft({ server: tab.server, directory })
  }
  onMount(recoverMissingSession)`);
sessionPage=replace(sessionPage,'onClick={closeTab}','onClick={recoverMissingSession}');
staged.set('packages/app/src/pages/session.tsx',sessionPage);
// Translate product copy, never module names, config identifiers or licenses.
// The shared UI bundle owns quota/errors that can appear in the native shell too.
for(const directory of ['packages/app/src/i18n','packages/desktop/src/renderer/i18n','packages/ui/src/i18n']){
  for(const name of fs.readdirSync(path.join(original,directory)).filter(name=>name.endsWith('.ts'))){
    const file=`${directory}/${name}`;
    // Translation values use both quote styles and may span lines; replace only in
    // dedicated dictionaries so engine module identifiers remain untouched.
    staged.set(file,base(file).replaceAll('OpenCode','BotGo').replaceAll('opencode.ai/zen','botgo.win'));
  }
}
// These are display names consumed by the theme picker and syntax highlighter.
// Keep the upstream identifiers intact so persisted engine settings remain compatible.
staged.set('packages/ui/src/theme/context.tsx',base('packages/ui/src/theme/context.tsx').replace('opencode: "OpenCode"','opencode: "BotGo"'));
for(const file of ['packages/ui/src/context/marked-theme-register.tsx','packages/ui/src/context/marked-theme.tsx','packages/ui/src/context/marked.tsx']){
  staged.set(file,base(file).replaceAll('"OpenCode"','"BotGo"'));
}
// A Windows notification must use the installed application's icon, never fetch upstream branding.
// Keep the earlier BotGo gate and account injection: writing from the original
// source here would silently discard those renderer changes.
renderer=renderer.replace('        icon: "https://opencode.ai/favicon-96x96-v3.png",\n','');
staged.set('packages/desktop/src/renderer/index.tsx',renderer);
staged.set('packages/ui/src/components/favicon.tsx',base('packages/ui/src/components/favicon.tsx').replace('content="OpenCode"','content="BotGo"'));
staged.set('packages/app/src/components/windows-app-menu.tsx',base('packages/app/src/components/windows-app-menu.tsx').replace('>OpenCode</DropdownMenu.GroupLabel>','>BotGo</DropdownMenu.GroupLabel>'));
for(const file of ['packages/app/src/desktop-menu.ts','packages/app/src/pages/layout.tsx','packages/app/src/components/settings-general.tsx','packages/app/src/components/settings-v2/general.tsx']){
  staged.set(file,base(file).replaceAll('https://opencode.ai/desktop-feedback','mailto:gnepaij@qq.com').replace(/https:\/\/opencode\.ai\/[^"\s]*/g,'https://botgo.win/#product')
    .replace(/https:\/\/github\.com\/anomalyco\/opencode\/issues\/new[^"\s]*/g,'mailto:gnepaij@qq.com')
    .replaceAll('https://discord.com/invite/opencode','mailto:gnepaij@qq.com'));
}
// A managed desktop cannot switch to an unrelated server and bypass its gateway.
let titlebar=base('packages/app/src/components/titlebar.tsx');
titlebar=replace(titlebar,'import { IconButton } from "@opencode-ai/ui/icon-button"','import { Logo } from "@opencode-ai/ui/logo"\nimport { IconButton } from "@opencode-ai/ui/icon-button"');
titlebar=titlebar.replaceAll('<ChannelIndicator debugTools={props.debugTools} />','<div class="px-2 flex items-center"><Logo class="h-6 w-auto" /></div>');
staged.set('packages/app/src/components/titlebar.tsx',titlebar);
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
// A BotGo device session supplies the complete catalog. Persisted visibility
// choices from a prior installation must not make a valid managed catalog look
// empty, but no model is invented here: `available()` still comes from the
// authenticated local gateway.
let models=base('packages/app/src/context/models.tsx');
models=replace(models,'    const visible = (model: ModelKey) => {\n      const key = modelKey(model)\n      const state = visibility().get(key)','    const visible = (model: ModelKey) => {\n      if (model.providerID === "botgo-chat" || model.providerID === "botgo-responses") return true\n      const key = modelKey(model)\n      const state = visibility().get(key)');
staged.set('packages/app/src/context/models.tsx',models);

// Model selection may manage visibility of the server catalog, but it has no
// route to connect a third-party or custom provider.
let selectModel=base('packages/app/src/components/dialog-select-model.tsx');
selectModel=remove(selectModel,'import { decode64 } from "@/utils/base64"\n');
const selectorDirectories='  const local = useLocal()\n  const directory = () => decode64(local.slug())\n';
if(selectModel.split(selectorDirectories).length!==3)throw Error('Upstream anchor changed: model selector directories');
selectModel=selectModel.replaceAll(selectorDirectories,'');
selectModel=removeSection(selectModel,'  const handleConnectProvider = () => {','  const language = useLanguage()');
selectModel=removeSection(selectModel,'                <Tooltip placement="top" value={language.t("command.provider.connect")}>','                <Tooltip placement="top" value={language.t("dialog.model.manage")}>');
selectModel=removeSection(selectModel,'  const provider = () => {','  const manage = () => {');
selectModel=removeSection(selectModel,'      action={\n        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={provider}>','    >\n      <ModelList');
staged.set('packages/app/src/components/dialog-select-model.tsx',selectModel);

let manageModels=base('packages/app/src/components/dialog-manage-models.tsx');
manageModels=remove(manageModels,'import { Button } from "@opencode-ai/ui/button"\n');
manageModels=remove(manageModels,'import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"\n');
manageModels=remove(manageModels,'import { useDialog } from "@opencode-ai/ui/context/dialog"\n');
manageModels=remove(manageModels,'import { DialogConnectProvider } from "./dialog-connect-provider"\n');
manageModels=remove(manageModels,'import { decode64 } from "@/utils/base64"\n');
const connectModelProvider='  const dialog = useDialog()\n  const directory = () => decode64(local.slug())\n\n  const handleConnectProvider = () => {\n    void dialog.show(() => <DialogConnectProvider directory={directory} />)\n  }\n';
if(manageModels.split(connectModelProvider).length!==3)throw Error('Upstream anchor changed: model provider actions');
manageModels=manageModels.replaceAll(connectModelProvider,'');
manageModels=removeSection(manageModels,'      action={\n        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={handleConnectProvider}>','    >\n      <List');
manageModels=removeSection(manageModels,'        <ButtonV2 variant="neutral" icon="plus" onClick={handleConnectProvider}>','      </DialogHeader>');
staged.set('packages/app/src/components/dialog-manage-models.tsx',manageModels);

// The welcome surface must not invite the user to add a provider when the
// account's managed catalog is unavailable.
let newSession=base('packages/app/src/pages/new-session/new-session-view.tsx');
newSession=remove(newSession,'import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"\n');
newSession=remove(newSession,'import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"\n');
newSession=remove(newSession,'import { useSDK } from "@/context/sdk"\n');
newSession=remove(newSession,'import { useServerSync } from "@/context/server-sync"\n');
newSession=remove(newSession,'import { useProviders } from "@/hooks/use-providers"\n');
newSession=remove(newSession,'import { Persist, persisted } from "@/utils/persist"\n');
newSession=replace(newSession,'import { Show, createMemo, createSignal, type Accessor } from "solid-js"','import { Show, type Accessor } from "solid-js"');
newSession=remove(newSession,'import { createStore } from "solid-js/store"\n');
newSession=remove(newSession,'import createPresence from "solid-presence"\n');
newSession=remove(newSession,'const providerTipDismissalDuration = 30 * 24 * 60 * 60 * 1000\n\n');
newSession=remove(newSession,'        <ProviderTip />\n');
const providerTipStart=newSession.indexOf('\nfunction ProviderTip()');
if(providerTipStart<0)throw Error('Upstream anchor changed: ProviderTip');
newSession=newSession.slice(0,providerTipStart)+'\n';
staged.set('packages/app/src/pages/new-session/new-session-view.tsx',newSession);

let unpaidModels=base('packages/app/src/components/dialog-select-model-unpaid.tsx');
unpaidModels=remove(unpaidModels,'import { Button } from "@opencode-ai/ui/button"\n');
unpaidModels=remove(unpaidModels,'import { ProviderIcon } from "@opencode-ai/ui/provider-icon"\n');
unpaidModels=replace(unpaidModels,'import { popularProviders, useProviders } from "@/hooks/use-providers"','');
unpaidModels=remove(unpaidModels,'import { decode64 } from "@/utils/base64"\n');
unpaidModels=remove(unpaidModels,'  const directory = () => decode64(local.slug())\n');
unpaidModels=remove(unpaidModels,'  const providers = useProviders(directory)\n');
unpaidModels=removeSection(unpaidModels,'  const openProviders = (provider?: string) => {','  let listRef: ListRef | undefined');
unpaidModels=removeSection(unpaidModels,'      <div class="px-1.5 pb-1.5">','    </Dialog>');
staged.set('packages/app/src/components/dialog-select-model-unpaid.tsx',unpaidModels);

let unpaidModelsV2=base('packages/app/src/components/dialog-select-model-unpaid-v2.tsx');
unpaidModelsV2=remove(unpaidModelsV2,'import { ProviderIcon } from "@opencode-ai/ui/provider-icon"\n');
unpaidModelsV2=remove(unpaidModelsV2,'import { useTheme } from "@opencode-ai/ui/theme"\n');
unpaidModelsV2=remove(unpaidModelsV2,'import { useProviders } from "@/hooks/use-providers"\n');
unpaidModelsV2=remove(unpaidModelsV2,'import { decode64 } from "@/utils/base64"\n');
unpaidModelsV2=remove(unpaidModelsV2,'const featuredProviders = ["opencode", "opencode-go", "openai", "anthropic", "google", "github-copilot"]\n');
unpaidModelsV2=remove(unpaidModelsV2,'  const theme = useTheme()\n');
unpaidModelsV2=remove(unpaidModelsV2,'  const directory = () => decode64(local.slug())\n');
unpaidModelsV2=remove(unpaidModelsV2,'  const providers = useProviders(directory)\n');
unpaidModelsV2=removeSection(unpaidModelsV2,'  const openProviders = (provider?: string) => {','  const selectModel = (item: ReturnType<ModelState["list"]>[number]) => {');
unpaidModelsV2=removeSection(unpaidModelsV2,'\n\n          <div class="flex w-full flex-col">\n            <div class="flex w-full flex-col items-start rounded-lg','\n        </div>\n      </DialogBody>');
staged.set('packages/app/src/components/dialog-select-model-unpaid-v2.tsx',unpaidModelsV2);

let layout=String(staged.get('packages/app/src/pages/layout.tsx')??base('packages/app/src/pages/layout.tsx'));
layout=removeSection(layout,'      {\n        id: "provider.connect",','      {\n        id: "server.switch",');
layout=removeSection(layout,'  function connectProvider() {','  function openServer() {');
layout=removeSection(layout,'                <Button size="large" icon="plus-small" onClick={connectProvider}>','                <Button size="large" variant="ghost" onClick={() => setStore("gettingStartedDismissed", true)}>');
staged.set('packages/app/src/pages/layout.tsx',layout);

// BotGo does not surface upstream subscription or provider-connection upsells.
let usageExceeded=base('packages/app/src/pages/session/usage-exceeded-dialogs.tsx');
usageExceeded=replace(usageExceeded,'const GO_UPSELL_PROVIDERS = new Set(["opencode", "opencode-go"])','const GO_UPSELL_PROVIDERS = new Set<string>()');
staged.set('packages/app/src/pages/session/usage-exceeded-dialogs.tsx',usageExceeded);
const translations={
  en:{'botgo.login.description':'Use your BotGo account to work with local projects.','botgo.login.action':'Sign in with BotGo','botgo.login.connecting':'Connecting…','botgo.login.waiting':'Waiting for browser authorization…','botgo.login.reopen':'Open the authorization page again','botgo.login.cancel':'Cancel','botgo.error.models':'BotGo is temporarily unavailable. Please try again later.','botgo.error.session':'Your sign-in has expired. Please sign in again.','botgo.error.connection':'Sign-in could not be completed. Please try again.'},
  zh:{'botgo.login.description':'登录 BotGo 账户，开始处理本地项目。','botgo.login.action':'登录 BotGo','botgo.login.connecting':'正在连接…','botgo.login.waiting':'等待浏览器授权…','botgo.login.reopen':'重新打开授权页面','botgo.login.cancel':'取消','botgo.error.models':'BotGo 服务暂不可用，请稍后重试。','botgo.error.session':'登录已失效，请重新登录。','botgo.error.connection':'暂时无法完成登录，请重试。'}
};
Object.assign(translations.en,{'botgo.account.title':'BotGo account','botgo.account.balance':'Available balance','botgo.account.refresh':'Refresh balance','botgo.account.refreshing':'Refreshing…','botgo.account.recharge':'Add funds','botgo.account.logout':'Sign out','botgo.account.close':'Close','botgo.account.error':'Could not refresh. Please try again.'});
Object.assign(translations.zh,{'botgo.account.title':'BotGo 账户','botgo.account.balance':'可用余额','botgo.account.refresh':'刷新余额','botgo.account.refreshing':'刷新中…','botgo.account.recharge':'充值','botgo.account.logout':'退出登录','botgo.account.close':'关闭','botgo.account.error':'暂时无法刷新，请稍后重试'});
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
staged.set('packages/opencode/src/tool/botgo-image.ts',fs.readFileSync(path.join(here,'overlay/botgo-image.ts')));
let toolRegistry=base('packages/opencode/src/tool/registry.ts');
toolRegistry=replace(toolRegistry,'import { ReadTool } from "./read"\n','import { ReadTool } from "./read"\nimport { BotGoImageTool } from "./botgo-image"\n');
toolRegistry=replace(toolRegistry,'    const patchtool = yield* ApplyPatchTool\n','    const patchtool = yield* ApplyPatchTool\n    const botgoImage = process.env.BOTGO_IMAGE_MODELS ? yield* BotGoImageTool : undefined\n');
toolRegistry=replace(toolRegistry,'          ...(codeModeTool ? { execute: Tool.init(codeModeTool) } : {}),','          ...(codeModeTool ? { execute: Tool.init(codeModeTool) } : {}),\n          ...(botgoImage ? { botgoImage: Tool.init(botgoImage) } : {}),');
toolRegistry=replace(toolRegistry,'            ...(tool.execute ? [tool.execute] : []),','            ...(tool.execute ? [tool.execute] : []),\n            ...(tool.botgoImage ? [tool.botgoImage] : []),');
staged.set('packages/opencode/src/tool/registry.ts',toolRegistry);
let modelMessages=base('packages/opencode/src/session/message-v2.ts');
modelMessages=replace(modelMessages,
  'const attachments = part.state.time.compacted || options?.stripMedia ? [] : (part.state.attachments ?? [])',
  'const attachments = part.tool === "botgo_image_generation" || part.state.time.compacted || options?.stripMedia ? [] : (part.state.attachments ?? [])');
staged.set('packages/opencode/src/session/message-v2.ts',modelMessages);
staged.set('packages/opencode/test/session/message-v2.test.ts',base('packages/opencode/test/session/message-v2.test.ts')+`
test("BotGo generated image remains in the session without replaying its bytes to the model", async () => {
  const userID = "botgo-image-user"
  const assistantID = "botgo-image-assistant"
  const input: SessionV1.WithParts[] = [
    { info: userInfo(userID), parts: [{ ...basePart(userID, "prompt"), type: "text", text: "Generate an image" }] as SessionV1.Part[] },
    {
      info: assistantInfo(assistantID, userID),
      parts: [{
        ...basePart(assistantID, "image-tool"), type: "tool", callID: "image-call", tool: "botgo_image_generation",
        state: { status: "completed", input: { prompt: "A blue square" }, output: "Image saved: generated-images/image.png",
          title: "Image generated", metadata: {}, time: { start: 0, end: 1 },
          attachments: [{ ...basePart(assistantID, "image-file"), type: "file", mime: "image/png", url: "data:image/png;base64,Zm9v" }],
        },
      }] as SessionV1.Part[],
    },
  ]
  const result = await MessageV2.toModelMessages(input, model)
  expect(JSON.stringify(result)).not.toContain("Zm9v")
  expect(JSON.stringify(result)).toContain("generated-images/image.png")
})
`);
let messagePart=base('packages/session-ui/src/components/message-part.tsx');
messagePart=replace(messagePart,
  '  const render = createMemo(() => ToolRegistry.render(part().tool) ?? GenericTool)',
  `  const generatedImages = createMemo(() => {
    const value = part()
    if (value.tool !== "botgo_image_generation" || value.state.status !== "completed") return []
    return (value.state.attachments ?? []).filter(
      (attachment) => attachment.mime === "image/png" && attachment.url.startsWith("data:image/png;base64,"),
    )
  })
  const render = createMemo(() => ToolRegistry.render(part().tool) ?? GenericTool)`);
messagePart=replace(messagePart,
  '              onContentRendered={props.onContentRendered}\n            />\n          </Match>',
  `              onContentRendered={props.onContentRendered}
            />
            <For each={generatedImages()}>
              {(image) => (
                <img
                  src={image.url}
                  alt="BotGo 生成的图片"
                  style={{ display: "block", "max-width": "min(100%, 420px)", height: "auto", "border-radius": "8px", "margin-top": "12px" }}
                />
              )}
            </For>
          </Match>`);
staged.set('packages/session-ui/src/components/message-part.tsx',messagePart);
staged.set('packages/opencode/src/session/retry.ts',replace(base('packages/opencode/src/session/retry.ts'),
  'export function retryable(error: Err, provider: string) {',
  'export function retryable(error: Err, provider: string) {\n  // Only the authenticated local bridge can mark a metered attempt safe to retry.\n  if (provider.startsWith("botgo-") && (!SessionV1.APIError.isInstance(error) || error.data.responseHeaders?.["x-botgo-retryable"] !== "1")) return undefined'));
staged.set('packages/opencode/test/session/retry.test.ts',base('packages/opencode/test/session/retry.test.ts')+`
test("BotGo retries only explicitly safe failures through native backoff", () => {
  expect(SessionRetry.retryable(apiError(), "botgo-chat")).toBeUndefined()
  expect(SessionRetry.retryable(apiError(), "botgo-responses")).toBeUndefined()
  expect(SessionRetry.retryable(apiError(), "test")).toBeDefined()
  expect(SessionRetry.retryable(apiError({"x-botgo-retryable": "1"}), "botgo-chat")).toBeDefined()
  expect(SessionRetry.retryable(apiError({"x-botgo-retryable": "1"}), "botgo-responses")).toBeDefined()
  expect(SessionRetry.retryable(apiError({"x-botgo-retryable": "0"}), "botgo-chat")).toBeUndefined()
})
`);
staged.set('packages/desktop/src/main/windows.ts',brand(base('packages/desktop/src/main/windows.ts')));
staged.set('packages/desktop/src/main/constants.ts',replace(base('packages/desktop/src/main/constants.ts'),
  'export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"',
  '// BotGo updates are authenticated and signature-verified by the managed updater.\nexport const UPDATER_ENABLED = true'));
staged.set('packages/desktop/src/renderer/index.html',base('packages/desktop/src/renderer/index.html').replace('<title>OpenCode</title>','<title>BotGo</title>'));
staged.set('packages/ui/src/components/logo.tsx',fs.readFileSync(path.join(here,'overlay/logo.tsx')));
// The primary new-session surface is a large upstream wordmark. Replace that
// asset too, otherwise the old product name remains visible in the background.
staged.set('packages/ui/src/v2/components/wordmark-v2.tsx',fs.readFileSync(path.join(here,'overlay/botgo-wordmark-v2.tsx')));
staged.set('packages/desktop/resources/icons/icon.ico',fs.readFileSync(path.join(here,'overlay/botgo-desktop.ico')));
const pkg=JSON.parse(base('packages/desktop/package.json'));
pkg.name='@botgo/desktop';
pkg.version='1.3.6';
pkg.homepage='https://botgo.win';
// Keep upstream MIT authorship. Packaging is never publishing.
staged.set('packages/desktop/package.json',JSON.stringify(pkg,null,2)+'\n');
let builder=brand(base('packages/desktop/electron-builder.config.ts'));
builder=builder.replaceAll('schemes: ["opencode"]','schemes: ["botgo"]')
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
