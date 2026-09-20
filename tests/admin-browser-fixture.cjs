// Credential-free local browser fixture for the Admin model-service view.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const price={input:1,cached:0,write:0,output:2,longThreshold:272000,longInput:1,longOutput:1,source:'https://example.org/pricing',date:'2026-09-20',tier:'default'};
const model={id:'demo-model',name:'示例模型',upstream_id:'demo/model',enabled:0,web_enabled:0,agent_enabled:0,multiplier_ppm:null,price};
const profile={id:'fixture-profile',name:'示例上游',baseUrl:'https://upstream.example.org/v1',keyHint:'••••1234',maxConcurrency:5,activeRequests:0,assignedChannels:[],probes:[]};
const fixtures={
  '/admin/overview':{admin:{email:'fixture@example.invalid'},overview:{accounts:0,active:0,pendingVerifications:0}},
  '/admin/accounts':{accounts:[],page:1,pages:1,total:0},
  '/admin/metering':{models:[model],settings:{multiplier_ppm:300000,usd_cny_ppm:7000000,default_model:model.id},ledger:[]},
  '/admin/upstreams':{upstreams:[profile]},'/admin/routes':{routes:[]},'/admin/opencode':{routes:[]},'/admin/model-services':{drafts:[{modelId:'legacy-only',config:{name:'遗留模型'}}]},
  '/admin/desktop/releases':{releases:[]},'/admin/billing/orders':{orders:[]},'/admin/billing/plan':{paymentAvailable:false}
};
const allowed=new Set(['admin.html','admin.css','admin-layout.css','admin.js','admin-platform.js','admin-metering.js','ui-kit.js']);
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){res.setHeader('content-type','application/json');res.end(JSON.stringify(fixtures[url.pathname.slice(4)]||{}));return;}
  const file=url.pathname==='/'?'admin.html':url.pathname.slice(1);
  if(!allowed.has(file)){res.statusCode=404;res.end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,file)));
}).listen(Number(process.env.BOTGO_ADMIN_FIXTURE_PORT)||4174,'127.0.0.1',()=>console.log('Admin fixture ready'));
