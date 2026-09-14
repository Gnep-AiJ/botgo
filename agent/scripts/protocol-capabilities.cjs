const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { nativeCommand } = require('../lib/native.cjs');
const root = path.resolve(__dirname, '../..');
const directory = path.join(root, 'artifacts/verification/native-compat/schema');
const command = nativeCommand(path.join(root, 'agent'));
execFileSync(command, ['app-server', 'generate-json-schema', '--experimental', '--out', directory], { windowsHide: true, stdio: 'pipe' });
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name + '.json'), 'utf8'));
const methods = name => read(name).oneOf.map(item => item.properties.method.enum[0]);
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidence = {
  nativeVersion: execFileSync(command, ['--version'], { windowsHide: true, encoding: 'utf8' }).trim(),
  binarySha256: sha256(command), experimental: true,
  protocolSha256: sha256(path.join(directory, 'codex_app_server_protocol.schemas.json')),
  requests: methods('ClientRequest').filter(method => /^(thread\/|turn\/|review\/|mcpServer|config\/|skills\/|plugin\/)/.test(method)),
  serverRequests: methods('ServerRequest'),
  notifications: methods('ServerNotification').filter(method => /review|guardian|approval|mcp|plan|diff/i.test(method)),
  approvalReviewers: read('v2/ThreadStartParams').definitions.ApprovalsReviewer.enum,
  turnInputs: read('v2/TurnStartParams').definitions.UserInput.oneOf.map(item => item.properties.type.enum[0]),
  limitation: 'Protocol availability is not model-route or release acceptance.'
};
const output = path.join(root, 'docs/evidence/2026-09-13-native-compat/protocol.json');
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(`${evidence.nativeVersion}; protocol evidence: ${output}`);
