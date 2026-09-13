import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = 'artifacts/archive/2026-09-13-directory-cleanup';
const record = path.join(root, 'docs/evidence/2026-09-13-directory-cleanup');
const protectedNames = new Set(['.tmp-wrangler-config', '.tmp-electron-builder-cache']);
const probes = new Set(['.tmp-cli022-existing.json', '.tmp-cli022-existing.zip', '.tmp-preview3-existing.exe', '.tmp-preview3-existing.json']);
function scoped(relative) {
  const full = path.resolve(root, relative);
  if (!full.startsWith(root + path.sep)) throw Error('Outside workspace');
  for (let p = full; p !== root; p = path.dirname(p)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw Error('Linked path refused: ' + relative);
  }
  return full;
}
function snapshot(target) {
  const rows = [];
  function visit(file, relative) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error('Linked archive entry refused');
    if (stat.isDirectory()) {
      rows.push({ path: relative, directory: true });
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), relative + '/' + name);
    } else {
      const hash = crypto.createHash('sha256');
      const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024);
      try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); }
      finally { fs.closeSync(fd); }
      rows.push({ path: relative, bytes: stat.size, sha256: hash.digest('hex') });
    }
  }
  visit(target, '');
  return rows;
}
const read = name => JSON.parse(fs.readFileSync(path.join(record, name), 'utf8').replace(/^\uFEFF/, ''));
const write = (name, value) => fs.writeFileSync(path.join(record, name), JSON.stringify(value, null, 2) + '\n');
const resume = process.argv.includes('--resume');
let plan = fs.readdirSync(root).filter(name => name.startsWith('.tmp-')).sort().map(source => {
  const stat = fs.lstatSync(scoped(source));
  const action = protectedNames.has(source) ? 'keep' : probes.has(source) && stat.isFile() && stat.size === 0 ? 'delete-empty-probe' : 'archive';
  return { source, destination: action === 'archive' ? archive + '/' + source : null, action,
    reason: action === 'keep' ? 'Operational tool cache' : action === 'archive' ? 'Preserve evidence and uncertain temporary files outside source root' : 'Zero-byte release probe superseded by release evidence' };
});
if (!process.argv.includes('--execute')) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
scoped(archive); scoped(path.relative(root, record));
if (fs.existsSync(path.join(record, 'plan.json')) && !resume) throw Error('Existing record; review and use --resume only for unfinished entries');
fs.mkdirSync(scoped(archive), { recursive: true }); fs.mkdirSync(record, { recursive: true });
let results = [];
const rootEntriesBefore = fs.existsSync(path.join(record, 'summary.json')) ? read('summary.json').rootEntriesBefore : fs.readdirSync(root).length;
if (resume) { plan = read('plan.json'); results = read('results.json'); }
else write('plan.json', plan);
for (const item of plan) {
  const previous = results.find(row => row.source === item.source);
  if (previous && previous.status !== 'needs-review') continue;
  if (path.basename(item.source) !== item.source || !item.source.startsWith('.tmp-')) throw Error('Invalid source in plan');
  if (item.destination !== null && item.destination !== archive + '/' + item.source) throw Error('Invalid destination in plan');
  const row = { ...item, status: 'kept', files: 0, bytes: 0 };
  try {
    const source = scoped(item.source);
    if (protectedNames.has(item.source)) { if (item.action !== 'keep') throw Error('Protected target'); }
    else if (item.action === 'delete-empty-probe') {
      if (!probes.has(item.source) || !fs.lstatSync(source).isFile() || fs.statSync(source).size !== 0) throw Error('Probe changed');
      fs.unlinkSync(source); row.status = 'deleted';
    } else if (item.action === 'archive') {
      const destination = scoped(item.destination);
      // Recover an atomic rename whose post-move check failed in Windows PowerShell.
      if (resume && !fs.existsSync(source) && fs.existsSync(destination)) fs.renameSync(destination, source);
      if (fs.existsSync(destination)) throw Error('Destination exists; refusing overwrite');
      const before = snapshot(source);
      const manifests = scoped('artifacts/verification/directory-cleanup/manifests');
      fs.mkdirSync(manifests, { recursive: true });
      fs.writeFileSync(path.join(manifests, item.source + '.manifest.json'), JSON.stringify(before, null, 2));
      fs.renameSync(source, destination);
      if (JSON.stringify(before) !== JSON.stringify(snapshot(destination))) throw Error('Archive contents changed; preserve for review');
      row.status = 'archived-verified'; row.files = before.filter(x => !x.directory).length;
      row.bytes = before.reduce((sum, x) => sum + (x.bytes || 0), 0);
    }
  } catch (error) { row.status = 'needs-review'; row.error = error.message; }
  results = results.filter(r => r.source !== item.source); results.push(row);
  write('results.json', results); console.log(item.source + ': ' + row.status);
}
write('summary.json', { rootEntriesBefore, rootEntriesAfter: fs.readdirSync(root).length, deletedBytes: 0, results });
if (results.some(r => r.status === 'needs-review')) process.exitCode = 1;
