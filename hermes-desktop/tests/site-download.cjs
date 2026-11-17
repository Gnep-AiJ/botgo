const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'artifacts/verification/hermes-capabilities-20261023');
const site=path.join(out,'site-release');app.setPath('userData',path.join(out,'site-ui-profile'));
app.whenReady().then(async()=>{
  const deadline=setTimeout(()=>{console.error('Website UI test timeout');app.exit(1);},60000);
  let win,engine,navigated;const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://local');
    if(url.pathname==='/api/desktop/releases/current'){engine=req.headers['x-botgo-client-engine'];res.setHeader('content-type','application/json');return res.end(JSON.stringify({engine:'hermes',release:{engine:'hermes',version:'2.0.0-preview.4',downloadUrl:'/download-fixture.exe'}}));}
    if(url.pathname.startsWith('/api/')){res.writeHead(401,{'content-type':'application/json'});return res.end('{}');}
    const file=path.resolve(site,'.'+(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(site+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
    res.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    win=new BrowserWindow({width:1280,height:800,show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});
    win.webContents.on('will-navigate',(event,url)=>{if(url.endsWith('/download-fixture.exe')){event.preventDefault();navigated=url;}});
    await win.loadURL('http://127.0.0.1:'+server.address().port+'/');win.showInactive();
    await win.webContents.executeJavaScript('Promise.race([Promise.all(Array.from(document.images).filter(i=>i.loading!=="lazy").map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,3000))])');
    fs.writeFileSync(path.join(out,'website-download.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.querySelector('[data-download]').click()");
    for(let i=0;i<50&&!navigated;i++)await new Promise(r=>setTimeout(r,100));
    assert.equal(engine,'hermes');assert.ok(navigated?.endsWith('/download-fixture.exe'));
    fs.writeFileSync(path.join(out,'website-download-result.json'),JSON.stringify({passed:true,engine,actualBrowserClick:true,fixtureOnly:true},null,2));
    console.log('Actual website click selects Hermes and follows the protected download response');
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{clearTimeout(deadline);win?.destroy();server.closeAllConnections();server.close();app.exit(process.exitCode||0);}
});
