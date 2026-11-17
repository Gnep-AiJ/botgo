// Assert native feature implementations still match the pinned archive.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import paths from './paths.cjs';
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const native=[
  'packages/app/src/components/dialog-connect-provider.tsx',
  'packages/app/src/components/dialog-custom-provider.tsx',
  'packages/app/src/components/dialog-select-server.tsx',
  'packages/app/src/components/settings-providers.tsx',
  'packages/app/src/components/settings-models.tsx',
  'packages/app/src/components/settings-servers.tsx',
  'packages/app/src/components/prompt-input.tsx',
  'packages/app/src/components/prompt-input-v2.tsx',
  'packages/app/src/pages/session.tsx',
  'packages/opencode/src/provider/transform.ts',
  'packages/opencode/src/session/message-v2.ts',
  'packages/opencode/src/session/processor.ts',
  'packages/opencode/src/session/prompt.ts',
  'packages/opencode/src/tool/read.ts',
  'packages/core/src/tool/bash.ts',
  'packages/core/src/permission.ts',
  'packages/core/src/skill.ts',
  'packages/opencode/src/tool/task.ts',
  'packages/opencode/src/tool/skill.ts',
  'packages/opencode/src/mcp/index.ts',
];
for(const file of native)assert.equal(hash(path.join(paths.source,file)),hash(path.join(paths.original,file)),`Native implementation changed: ${file}`);
const config=fs.readFileSync(path.join(paths.source,'packages/opencode/src/config/config.ts'),'utf8');
assert.ok(config.includes('provider: { ...result.provider,'));
assert.ok(config.includes('enabled_providers: JSON.parse(process.env.BOTGO_MANAGED_CONFIG).enabled_providers'));
assert.ok(!config.includes('...JSON.parse(process.env.BOTGO_MANAGED_CONFIG),'));
const manifest=JSON.parse(fs.readFileSync(path.join(paths.source,'botgo-overlay.json'),'utf8'));
for(const [file,expected] of Object.entries(manifest))assert.equal(hash(path.join(paths.source,file)),expected,`Generated overlay changed: ${file}`);
console.log(JSON.stringify({ok:true,upstream:paths.upstream.version,commit:paths.upstream.commit,nativeFiles:native,overlayFiles:Object.keys(manifest).length},null,2));
