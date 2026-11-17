// Read-only acceptance of the scoped production website release.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const base='artifacts/verification/hermes-capabilities-20261023';
const manifest=JSON.parse(fs.readFileSync(base+'/site-release-manifest.json'));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
// The custom-domain edge removes these two email-obfuscation exclusion comments.
// Observed deployed bytes otherwise match; normalize only these exact directives.
const canonical=(file,b)=>file.endsWith('.html')?Buffer.from(b.toString().replaceAll('<!--email_off-->','').replaceAll('<!--/email_off-->','')):b;
const files=[...new Set([...manifest.changed,'app.js','product-account.css','product-account.js','workspace-billing.js','chat.js'])];
const result=[];
for(let i=0;i<files.length;i+=4)await Promise.all(files.slice(i,i+4).map(async file=>{
 const expected=fs.readFileSync(path.join(manifest.output,file));
 const response=await fetch('https://botgo.win/'+file+'?release='+digest(expected).slice(0,12),{signal:AbortSignal.timeout(30000)});
 if(!response.ok||new URL(response.url).origin!=='https://botgo.win')throw Error('Website resource unavailable: '+file);
 const actual=Buffer.from(await response.arrayBuffer());
 if(digest(canonical(file,actual))!==digest(canonical(file,expected)))throw Error('Website bytes differ: '+file);
 if(file==='index.html'){
  const html=actual.toString();if(!html.includes('让想法有回响')||!html.includes('brand-bot-mark')||!html.includes('botgo-client-workspace.png'))throw Error('Homepage acceptance failed');
  const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(x=>x[1].includes('var buildVersion'))?.[1];
  const hash=crypto.createHash('sha256').update(inline.replace(/\r\n?/g,'\n')).digest('base64');
  if(!response.headers.get('content-security-policy')?.includes("'sha256-"+hash+"'"))throw Error('Live inline CSP mismatch');
 }
 result.push({file,size:actual.length,sha256:digest(actual),expectedSha256:digest(expected),edgeCommentNormalization:file.endsWith('.html'),passed:true});
}));
fs.writeFileSync(base+'/website-live-result.json',JSON.stringify({passed:true,origin:'https://botgo.win',result,time:new Date().toISOString()},null,2));
console.log('Live website exact-byte, preserved account assets, original hero, Bot logo and CSP checks passed');
