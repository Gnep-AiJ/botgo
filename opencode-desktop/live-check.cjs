// Explicit, metered release check. Secrets remain in process memory.
const { app, safeStorage, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createCredentialStore } = require('./runtime/credential-store.cjs');
const { createBridge } = require('./runtime/bridge.cjs');
const root = path.resolve(__dirname, '..');
if (!process.argv.includes('--live')) throw Error('Pass --live to authorize two metered requests');
const output = path.join(root, 'artifacts/verification/client-live', String(Date.now()));
fs.mkdirSync(output, { recursive: true });
// Windows safeStorage uses this app profile's protected encryption key.
app.setPath('userData', path.join(root, 'artifacts/verification/opencode-preview/profile'));
app.setPath('sessionData', path.join(root, 'artifacts/verification/opencode-preview/profile/chromium'));
app.whenReady().then(async () => {
  let bridge;
  let stage='storage';
  const result = { ok: false, checks: [] };
  try {
    const credential = createCredentialStore({ filePath: path.join(root, 'artifacts/verification/opencode-preview/profile/device.enc'), safeStorage }).load();
    if (!credential?.deviceToken) throw Error('DEVICE_LOGIN_REQUIRED');
    stage='session';
    bridge = await createBridge({ origin: 'https://botgo.win', deviceToken: credential.deviceToken, fetchImpl: net.fetch });
    const cfg = bridge.config(), provider = cfg.provider['botgo-responses'];
    if (!provider) throw Error('RESPONSES_ROUTE_REQUIRED');
    const model = Object.keys(provider.models).find(id => id === 'gpt-5.6-terra') || Object.keys(provider.models)[0];
    const task = 'release_' + require('node:crypto').randomUUID();
    const invoke = async body => {
      const response = await fetch(provider.options.baseURL + '/responses', {
        method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { authorization: `Bearer ${provider.options.apiKey}`, 'content-type': 'application/json', 'x-session-id': task },
        body: JSON.stringify({ model, stream: true, max_output_tokens: 128, ...body }),
      });
      if (!response.ok) { await response.body?.cancel(); throw Error('GATEWAY_HTTP_' + response.status); }
      const reader = response.body.getReader(); let text = '', size = 0;
      for (;;) { const {done,value} = await reader.read(); if(done)break; size+=value.length; if(size>1024*1024){await reader.cancel();throw Error('RESPONSE_LIMIT');}text+=new TextDecoder().decode(value); }
      const events = text.split(/\r?\n/).filter(line=>line.startsWith('data:') && line.slice(5).trim()!=='[DONE]').map(line=>JSON.parse(line.slice(5)));
      const terminal = events.find(event=>event.type==='response.completed')?.response;
      if (!terminal?.usage || !Number.isSafeInteger(terminal.usage.input_tokens) || !Number.isSafeInteger(terminal.usage.output_tokens)) throw Error('MISSING_TERMINAL_USAGE');
      result.checks.push({ status: response.status, inputTokens: terminal.usage.input_tokens, outputTokens: terminal.usage.output_tokens });
      return terminal;
    };
    const prompt = { role: 'user', content: 'Call botgo_release_check with value OK. After the tool result reply OK.' };
    const first = await invoke({ input: [prompt], tools: [{ type: 'function', name: 'botgo_release_check', description: 'Return release check result', parameters: {type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}, strict:true }], tool_choice: {type:'function',name:'botgo_release_check'} });
    const call = first.output?.find(item=>item.type==='function_call' && item.name==='botgo_release_check');
    if (!call?.call_id) throw Error('MISSING_TOOL_CALL');
    await invoke({ input: [prompt, ...first.output, {type:'function_call_output',call_id:call.call_id,output:'OK'}] });
    const ledger = await bridge.usage(task);
    if (ledger.requests?.length!==2 || ledger.requests.some(row=>row.state!=='completed') || !Number.isSafeInteger(ledger.chargedMicros)) throw Error('LEDGER_NOT_SETTLED');
    result.ok=true; result.model=model; result.taskId=task; result.chargedMicros=ledger.chargedMicros;
  } catch(error) { result.error = /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'LIVE_CHECK_FAILED'; result.diagnostic=require('./runtime/diagnostic.cjs').diagnostic(error,stage); }
  finally { await bridge?.close(); fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify({...result,output})); app.exit(result.ok?0:1); }
});
