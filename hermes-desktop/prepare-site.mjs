// Preserve production files outside the requested homepage/brand update.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const base='artifacts/verification/hermes-capabilities-20261023',out=path.resolve(base,'site-release'),rollback=path.resolve(base,'site-rollback');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(rollback,{recursive:true});
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const changed=['index.html','styles.css','download.js','client-preview.js','chat.html','ui-kit.css','assets/botgo-client-workspace.png','assets/botgo-client-wechat.png','assets/botgo-client-account.png'];
const added=new Set(changed.filter(x=>x==='client-preview.js'||x.startsWith('assets/')));
const oldScreens=['assets/botgo-client-chat-original.png','assets/botgo-client-connect-original.png','assets/botgo-client-start-original.png'];
const files=[...new Set([...walk('dist').map(f=>path.relative('dist',f).replaceAll('\\','/')).filter(f=>f!=='_headers'&&!added.has(f)),...oldScreens])];
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
async function baseline(file){for(let attempt=0;attempt<3;attempt++)try{
 let r=await fetch('https://botgo.win/'+file,{redirect:'manual',signal:AbortSignal.timeout(30000)});
 if([301,302,307,308].includes(r.status)){const next=new URL(r.headers.get('location'),'https://botgo.win');if(next.origin!=='https://botgo.win'||next.pathname!==(file==='index.html'?'/':'/'+file.replace(/\.html$/,''))||next.search)throw Error('Unexpected redirect');r=await fetch(next,{redirect:'error',signal:AbortSignal.timeout(30000)});}
 if(!r.ok&&!(file==='404.html'&&r.status===404))throw Error('Baseline unavailable: '+file+' '+r.status);
 return {r,data:Buffer.from(await r.arrayBuffer())};
 }catch(error){if(attempt===2)throw error;await new Promise(r=>setTimeout(r,500*(attempt+1)));}}
const records=[];let csp,oldHome;
for(let i=0;i<files.length;i+=4)await Promise.all(files.slice(i,i+4).map(async file=>{
 const {r,data}=await baseline(file);if(file==='index.html'){csp=r.headers.get('content-security-policy');oldHome=data.toString();}
 for(const folder of [out,rollback]){const target=path.join(folder,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}
 records.push({file,sha256:digest(data),size:data.length});
}));
if(!csp?.includes("script-src 'self'"))throw Error('CSP missing');
const oldScript=[...oldHome.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(x=>x[1].includes('var buildVersion'));
let html=fs.readFileSync('dist/index.html','utf8');
const nextScript=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(x=>x[1].includes('var buildVersion'));
const normalize=s=>s.replace(/\r/g,'').replace(/var buildVersion = "[^"]+";/,'var buildVersion = "baseline";');
if(!oldScript||!nextScript||normalize(oldScript[1])!==normalize(nextScript[1]))throw Error('Homepage application logic differs from production');
html=html.replace(nextScript[0],()=>oldScript[0]);
for(const file of changed.filter(x=>!['index.html','chat.html','ui-kit.css'].includes(x))){const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join('dist',file),target);}
const mark=fs.readFileSync('index.html','utf8').match(/<span class="brand-bot-mark"[\s\S]*?<\/span>/)?.[0];if(!mark)throw Error('Bot mark missing');
let chat=fs.readFileSync(path.join(out,'chat.html'),'utf8');
if(!chat.includes('class="brand-bot-mark"')){const matches=chat.match(/<svg class="brand-mark"[\s\S]*?<\/svg>/g);if(matches?.length!==1)throw Error('Chat brand anchor changed');chat=chat.replace(matches[0],mark);}
let kit=fs.readFileSync(path.join(out,'ui-kit.css'),'utf8');
if(!kit.includes('.brand-bot-mark{'))kit+='\n'+fs.readFileSync('styles.css','utf8').split('/* Bot mark reuses the product mascot; no separate icon family. */')[1].split('/* Real client screenshots replace')[0];
fs.writeFileSync(path.join(out,'ui-kit.css'),kit);
const version=(text,file)=>text.replace(new RegExp('(\\./'+file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')(?:\\?v=[^"\\s<>]+)?','g'),'$1?v='+digest(fs.readFileSync(path.join(out,file))).slice(0,12));
chat=version(chat,'ui-kit.css');fs.writeFileSync(path.join(out,'chat.html'),chat);
for(const file of ['product-account.css','product-account.js','workspace-billing.js','download.js','client-preview.js',...changed.filter(x=>x.startsWith('assets/'))])html=version(html,file);
fs.writeFileSync(path.join(out,'index.html'),html);
const inlineHash=crypto.createHash('sha256').update(oldScript[1].replace(/\r\n?/g,'\n')).digest('base64');
const normalizedCsp=csp.replace(/'sha256-[^']+'/,"'sha256-"+inlineHash+"'");
const headers=fs.readFileSync('_headers','utf8').replace(/^  Content-Security-Policy:.*$/m,'  Content-Security-Policy: '+normalizedCsp);
for(const folder of [out,rollback])fs.writeFileSync(path.join(folder,'_headers'),headers);
fs.writeFileSync(path.join(base,'site-release-manifest.json'),JSON.stringify({baseline:records,output:out,rollback,changed,productionCspDirectivesPreserved:true,inlineHashNormalized:true,productionApplicationScriptPreserved:true,time:new Date().toISOString()},null,2));
console.log('Prepared scoped website update and rollback');
