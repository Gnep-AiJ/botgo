const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const upstream = JSON.parse(fs.readFileSync(path.join(__dirname, 'upstream.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(upstream.version) || !/^[a-f0-9]{40}$/.test(upstream.commit)) throw Error('Invalid upstream pin');
function artifact(value) {
  const target = path.resolve(root, value);
  if (!target.startsWith(path.join(root, 'artifacts') + path.sep)) throw Error('Upstream path must remain in artifacts');
  return target;
}
module.exports = { root, upstream, source: artifact(upstream.source), original: artifact(upstream.original), models: artifact(upstream.models) };
