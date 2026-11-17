// All edits are reproduced from the pinned upstream archive, never from dist.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {simplify} from './simplify.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)), root=path.dirname(here);
const pin=JSON.parse(fs.readFileSync(path.join(here,'upstream.json'),'utf8'));
if(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,pin.archive))).digest('hex')!==pin.sha256)throw Error('Pinned archive checksum mismatch');
const original=path.join(root,'artifacts/hermes-base'), source=path.join(root,pin.source);
const app='apps/desktop';
const require=createRequire(path.join(source,app,'package.json'));
const ts=require('typescript');
const staged=new Map();
staged.set('plugins/image_gen/botgo/__init__.py',fs.readFileSync(path.join(here,'overlay/image-provider.py'),'utf8'));
staged.set('plugins/image_gen/botgo/plugin.yaml','name: botgo\nversion: 1.0.0\ndescription: BotGo managed image generation\nauthor: BotGo\nkind: backend\n');
staged.set('plugins/tts/botgo-windows/__init__.py',fs.readFileSync(path.join(here,'overlay/windows-tts.py'),'utf8'));
staged.set('plugins/tts/botgo-windows/synthesize.ps1',fs.readFileSync(path.join(here,'overlay/windows-tts.ps1'),'utf8'));
staged.set('plugins/tts/botgo-windows/plugin.yaml','name: botgo-windows\nversion: 1.0.0\ndescription: Windows offline speech\nauthor: BotGo\nkind: backend\n');
const read=file=>fs.readFileSync(path.join(original,file),'utf8');
staged.set('hermes_cli/default_soul.py',read('hermes_cli/default_soul.py')+`\n# Migrate only untouched upstream seeds; user-authored identities remain native.\n_LEGACY_TEMPLATE_SOULS = (*_LEGACY_TEMPLATE_SOULS, DEFAULT_SOUL_MD)\nDEFAULT_SOUL_MD = DEFAULT_SOUL_MD.replace("You are Hermes Agent, built by Nous Research.", "You are BotGo, a personal AI assistant.")\n`);
staged.set('agent/prompt_builder.py',read('agent/prompt_builder.py').replace('You are Hermes Agent, built by Nous Research.', 'You are BotGo, a personal AI assistant.'));
function replace(value,needle,next){if(value.split(needle).length!==2)throw Error('Upstream anchor changed: '+needle.slice(0,100));return value.replace(needle,next);}
let cronScript=read('cron/scheduler_script.py');
cronScript=replace(cronScript,'_bash = shutil.which("bash") or ("/bin/bash" if os.path.isfile("/bin/bash") else None)','from pm.shell import bash as resolve_bash\n        _bash = resolve_bash()');
cronScript=replace(cronScript,'return [_bash, str(path)], {}, None','return [_bash, path.as_posix() if sys.platform == "win32" else str(path)], {}, None');
staged.set('cron/scheduler_script.py',cronScript);
let main=read(app+'/electron/main.ts');
main="import './botgo-env'\nimport { initializeBotGoAccount } from './botgo-account'\nimport { checkBotGoUpdates, applyBotGoUpdate } from './botgo-updates'\n"+main;
main=replace(main,'app.whenReady().then(() => {',"app.whenReady().then(async () => {\n  await initializeBotGoAccount({ isBusy: isAnyTurnInFlight, restart: () => restartLocalGatewayOwner('default'), install: () => applyUpdates() })");
const mainTree=ts.createSourceFile('main.ts',main,ts.ScriptTarget.Latest,true);
const functions=[];for(const node of mainTree.statements){if(ts.isFunctionDeclaration(node)&&node.name?.text==='createPackagedUpdateStrategy')functions.push(node);}
if(functions.length!==1)throw Error('Upstream updater strategy changed');
for(const node of functions){main=main.slice(0,node.body.getStart(mainTree))+"{ return { mechanism: 'external', check: () => checkBotGoUpdates(), apply: () => applyBotGoUpdate() } }"+main.slice(node.body.end);}
staged.set(app+'/electron/main.ts',main);
staged.set(app+'/electron/entry.ts',"import './botgo-env'\n"+read(app+'/electron/entry.ts'));
for(const file of ['botgo-account.ts','botgo-env.ts','botgo-updates.ts','botgo-weixin.ts','botgo-qq.ts'])staged.set(app+'/electron/'+file,fs.readFileSync(path.join(here,'overlay',file),'utf8'));
const preload=fs.readFileSync(path.join(here,'overlay/botgo-preload.cjs'),'utf8').split('\n').slice(1).join('\n');
staged.set(app+'/electron/preload.ts',read(app+'/electron/preload.ts')+'\n'+preload);
staged.set(app+'/src/app/settings/billing/index.tsx',fs.readFileSync(path.join(here,'overlay/billing.tsx'),'utf8'));
staged.set(app+'/src/components/brand-mark.tsx',replace(read(app+'/src/components/brand-mark.tsx'),"dark ? 'nous-girl-dark.png' : 'nous-girl.png'","dark ? 'botgo-mark.png' : 'botgo-mark.png'"));
staged.set(app+'/src/components/chat/intro.tsx',replace(replace(read(app+'/src/components/chat/intro.tsx'),"const WORDMARK = 'HERMES AGENT'","const WORDMARK = 'BotGo'"),'<Wordmark className="mb-1" text={WORDMARK} />','<Wordmark className="mb-4" width="min(26rem, 85%)" text={WORDMARK} />'));
staged.set(app+'/src/app/messaging/botgo-weixin.tsx',fs.readFileSync(path.join(here,'overlay/weixin-panel.tsx'),'utf8'));
staged.set(app+'/src/app/messaging/index.tsx',"import { BotGoWeixinPanel } from './botgo-weixin'\n"+replace(read(app+'/src/app/messaging/index.tsx'),'<div className="flex h-full min-h-0 flex-col">','<div className="flex h-full min-h-0 flex-col">\n          <BotGoWeixinPanel />'));
const identity=read(app+'/product-identity.cjs');
staged.set(app+'/product-identity.cjs',identity+`\nmodule.exports = Object.freeze({...module.exports, token:'botgo-preview', displayName:'BotGo', appId:'com.botgo.hermes.preview', channel:null, appNamePascal:'BotGoHermesPreview', artifactNamePascal:'BotGo', windowsExecutableName:'BotGo', cliName:'botgo', msixAppIdWithOrg:'BotGo.AgentPreview'})\n`);
const pkg=JSON.parse(read(app+'/package.json'));pkg.productName='BotGo';pkg.version=pin.version;pkg.description='BotGo personal Agent desktop';
staged.set(app+'/package.json',JSON.stringify(pkg,null,2)+'\n');
// Keep identifiers, imports, commands, protocol names and tool behaviour intact.
// Transform only rendered text/string tokens, with a small branded-domain map.
function brand(value){return value.replaceAll('Hermes Agent','BotGo').replaceAll('Hermes Desktop','BotGo').replaceAll('Hermes','BotGo')
 .replaceAll('https://portal.nousresearch.com','https://botgo.win/account.html')
 .replace(/https:\/\/hermes-agent\.nousresearch\.com[^\s'"`<>)]*/g,'https://botgo.win/')
 .replace(/https:\/\/github\.com\/NousResearch\/hermes-agent[^\s'"`<>)]*/gi,'https://botgo.win/');}
function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const full=path.join(directory,entry.name);if(entry.isDirectory())walk(full);else if(/\.(tsx?|html)$/.test(entry.name)&&!entry.name.includes('.test.')){
 const relative=path.relative(original,full).replaceAll('\\','/');let value=staged.get(relative)??fs.readFileSync(full,'utf8');
 if(entry.name.endsWith('.html'))value=brand(value);else{
  const tree=ts.createSourceFile(full,value,ts.ScriptTarget.Latest,true,entry.name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),edits=[];
  const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isJsxText(node)){const start=node.getStart(tree),end=node.end,raw=value.slice(start,end),next=brand(raw);if(raw!==next)edits.push({start,end,next});}ts.forEachChild(node,visit);};visit(tree);
  for(const edit of edits.sort((a,b)=>b.start-a.start))value=value.slice(0,edit.start)+edit.next+value.slice(edit.end);
 }
 if(value!==fs.readFileSync(full,'utf8')||staged.has(relative))staged.set(relative,value);
}}}
simplify({staged,read,app,replace,ts,overlay:file=>fs.readFileSync(path.join(here,'overlay',file),'utf8')});
walk(path.join(original,app,'src'));
staged.set(app+'/index.html',brand(read(app+'/index.html')));
for(const file of ['bridge.cjs','authorize.cjs','credential-store.cjs','network.cjs','diagnostic.cjs','updater.cjs'])staged.set(app+'/electron/botgo/shared/'+file,fs.readFileSync(path.join(root,'opencode-desktop/runtime',file)));
for(const file of ['gateway.cjs','config.cjs','update-channel.cjs'])staged.set(app+'/electron/botgo/'+file,fs.readFileSync(path.join(here,'runtime',file)));
staged.set(app+'/public/botgo-mark.svg',fs.readFileSync(path.join(here,'overlay/botgo-mark.svg')));
const manifestFile=path.join(source,'botgo-overlay.json');
const previous=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const manifest={};
for(const [file,value] of staged){const target=path.join(source,file);if(fs.existsSync(target)&&previous[file]&&hash(fs.readFileSync(target))!==previous[file])throw Error('Prepared source has user changes: '+file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);manifest[file]=hash(value);}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
console.log(`Prepared BotGo Hermes ${pin.commit}; ${staged.size} overlay files`);
