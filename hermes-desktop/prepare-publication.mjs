// Prepare guarded SQL only; never connects to the production database.
import fs from 'node:fs';
import crypto from 'node:crypto';
const directory='artifacts/verification/hermes-capabilities-20261023';
const read=name=>JSON.parse(fs.readFileSync(directory+'/'+name));
const r=read('transfer-receipt.json'),pin=JSON.parse(fs.readFileSync('hermes-desktop/upstream.json'));
if(r.version!==pin.version||!r.fullRemoteReadback||r.productionBindingProof?.key!=='desktop/1.3.9/BotGo-1.3.9-win-x64.exe'||r.productionBindingProof.size!==124223432||r.objectKey!==`hermes/${r.version}/${r.sha256}.exe`||r.size>1024**3)throw Error('Current production receipt required');
const hash=crypto.createHash('sha256');let size=0;
for await(const bytes of fs.createReadStream(r.file)){hash.update(bytes);size+=bytes.length;}
if(size!==r.size||hash.digest('hex')!==r.sha256)throw Error('Local candidate changed');
const installed=read('install-final-result.json'),acceptance=read('installed-acceptance.json');
if(!installed.passed||installed.sha256!==r.sha256||!acceptance.passed||acceptance.sha256!==r.sha256)throw Error('Installed acceptance required');
const planPath=directory+'/publication-plan.json',prior=fs.existsSync(planPath)?read('publication-plan.json'):null;
const id=prior?.version===r.version?prior.id:crypto.randomUUID();
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const notes='BotGo 界面更新与品牌统一。';
const audit=(event,status)=>`INSERT INTO security_audit(id,event,metadata) SELECT ${q(crypto.randomUUID())},${q(event)},${q(JSON.stringify({actor:'authorized-cli-release',engine:'hermes',releaseId:id,version:r.version,sha256:r.sha256,fullRemoteReadback:true}))} WHERE EXISTS(SELECT 1 FROM desktop_releases WHERE id=${q(id)} AND sha256=${q(r.sha256)} AND status=${q(status)});`;
const select=`SELECT id,version,platform,status,file_name,size_bytes,sha256 FROM desktop_releases WHERE id=${q(id)} OR (platform='win-x64' AND status='published');`;
fs.writeFileSync(directory+'/draft.sql',`INSERT INTO desktop_releases(id,version,platform,object_key,file_name,size_bytes,sha256,notes,status) SELECT ${q(id)},${q(r.version)},'win-x64-hermes',${q(r.objectKey)},${q('BotGo-'+r.version+'-win-x64.exe')},${r.size},${q(r.sha256)},${q(notes)},'draft' WHERE NOT EXISTS(SELECT 1 FROM desktop_releases WHERE platform='win-x64-hermes' AND version=${q(r.version)});\n${audit('desktop_release_created','draft')}\n${select}\n`);
fs.writeFileSync(directory+'/restage.sql',`UPDATE desktop_releases SET status='draft',updated_at=CURRENT_TIMESTAMP WHERE id=${q(id)} AND platform='win-x64-hermes' AND status='retired' AND sha256=${q(r.sha256)} AND size_bytes=${r.size} AND object_key=${q(r.objectKey)} AND NOT EXISTS(SELECT 1 FROM desktop_releases WHERE platform='win-x64-hermes' AND status='published');\n${audit('desktop_release_restaged','draft')}\n${select}\n`);
fs.writeFileSync(directory+'/publish.sql',`UPDATE desktop_releases SET status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=${q(id)} AND platform='win-x64-hermes' AND status='draft' AND sha256=${q(r.sha256)} AND size_bytes=${r.size} AND NOT EXISTS(SELECT 1 FROM desktop_releases WHERE platform='win-x64-hermes' AND status='published');\n${audit('desktop_release_published','published')}\n${select}\n`);
fs.writeFileSync(directory+'/retire.sql',`UPDATE desktop_releases SET status='retired',updated_at=CURRENT_TIMESTAMP WHERE id=${q(id)} AND platform='win-x64-hermes' AND sha256=${q(r.sha256)} AND status='published';\n${audit('desktop_release_retired','retired')}\n${select}\n`);
fs.writeFileSync(planPath,JSON.stringify({id,...r},null,2));
console.log('Prepared guarded release SQL');
