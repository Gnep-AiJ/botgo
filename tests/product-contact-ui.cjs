const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/verification/grok-contact-upgrade/contact-ui');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();
const allowed=new Set(['index.html','styles.css','product-account.css','app.js','product-account.js','workspace-billing.js','download.js']);
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')){res.setHeader('content-type','application/json');return res.end(JSON.stringify({release:null}));}const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!allowed.has(file)&&!/^assets\/[a-z0-9.-]+$/.test(file)){res.statusCode=404;return res.end();}res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(path.join(root,file)));});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(win,code){for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript(code))return;await pause(40);}throw Error('UI wait timed out: '+code);}
app.whenReady().then(async()=>{let win;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));win=new BrowserWindow({width:1180,height:900,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 const external=[];win.webContents.setWindowOpenHandler(({url})=>{external.push(url);return {action:'deny'};});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/?preview=account`);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('.site-header nav [data-open-contact]').previousElementSibling.hasAttribute('data-open-account')"),true);
 await win.webContents.executeJavaScript("window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied.push(text)},configurable:true});document.querySelector('.site-header [data-open-contact]').click()");
 await until(win,"document.querySelector('#contact-dialog').open&&document.querySelector('.contact-qr img').naturalWidth===718");
 await win.webContents.executeJavaScript("document.querySelector('.contact-qr img').decode()");
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('#contact-dialog').textContent.includes('support@example.com')&&document.querySelector('#contact-dialog').textContent.includes('YOUR_WECHAT_ID')"),true);
 await win.webContents.executeJavaScript("document.querySelector('[data-copy-contact=\"support@example.com\"]').click()");await until(win,"document.querySelector('[data-contact-status]').textContent==='邮箱已复制'");
 assert.deepEqual(await win.webContents.executeJavaScript('window.copied'),['support@example.com']);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-copy-contact=\"support@example.com\"]').textContent"),'已复制');
 win.setSize(1181,900);await pause(250);assert.equal(await win.webContents.executeJavaScript("document.querySelector('#contact-dialog').open"),true);fs.writeFileSync(path.join(out,'desktop.png'),(await win.webContents.capturePage()).toPNG());win.setSize(390,844);await pause(150);
 assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth+2'),true);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('#contact-dialog').scrollWidth<=document.querySelector('#contact-dialog').clientWidth+2"),true);
 fs.writeFileSync(path.join(out,'mobile.png'),(await win.webContents.capturePage()).toPNG());
 for(const [width,height] of [[320,740],[740,420]]){win.setSize(width,height);await pause(120);assert.equal(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth+2'),true);assert.equal(await win.webContents.executeJavaScript("document.querySelector('#contact-dialog').scrollWidth<=document.querySelector('#contact-dialog').clientWidth+2"),true);}
 win.setSize(390,844);await pause(120);
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await until(win,"!document.querySelector('#contact-dialog').open");
 await until(win,"document.activeElement.hasAttribute('data-open-contact')");
 await win.webContents.executeJavaScript("document.querySelector('.site-header [data-open-account]').click();document.querySelector('.account-feedback').click()");await until(win,"document.querySelector('#contact-dialog').open&&!document.querySelector('#account-dialog').open");
 await win.webContents.executeJavaScript("document.querySelector('[data-close-contact]').click()");await until(win,"document.querySelector('#account-dialog').open&&document.activeElement.classList.contains('account-feedback')");
 await win.webContents.executeJavaScript("document.querySelector('#logout-button').click()");await until(win,"!document.querySelector('#account-auth').hidden");
 await win.webContents.executeJavaScript("document.querySelector('#login-form').hidden=true;document.querySelector('#verify-form').hidden=false;document.querySelector('#verify-email').value='typed@example.invalid';document.querySelector('.account-feedback').click();document.querySelector('[data-close-contact]').click()");
 await until(win,"document.querySelector('#account-dialog').open&&!document.querySelector('#verify-form').hidden&&document.querySelector('#verify-email').value==='typed@example.invalid'");
 await win.webContents.executeJavaScript("document.querySelector('.account-feedback').click();navigator.clipboard.writeText=async()=>{throw Error('fixture denied')};document.querySelector('[data-copy-contact=\"YOUR_WECHAT_ID\"]').click()");
 await until(win,"document.querySelector('[data-contact-status]').classList.contains('is-error')");
 assert.ok(await win.webContents.executeJavaScript("document.querySelector('[data-contact-status]').getBoundingClientRect().height>20"));
 assert.deepEqual(external,[]);assert.equal(await win.webContents.executeJavaScript("document.querySelector('.account-feedback').tagName"),'BUTTON');
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:true,external,checks:['nav order and consistent buttons','contact panel','user QR decoded by browser','copy without OS clipboard changes','desktop/mobile no overflow','Escape and focus return','feedback restores account and input state']},null,2));console.log('Contact panel browser checks passed');win.destroy();server.close();app.exit(0);
 }catch(e){fs.writeFileSync(path.join(out,'failure.txt'),e.stack);if(win)fs.writeFileSync(path.join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());console.error(e.stack);win?.destroy();server.close();app.exit(1);}});
