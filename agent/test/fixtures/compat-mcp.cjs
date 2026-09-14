// Controlled local MCP: no external traffic or filesystem tool effects.
const readline = require('node:readline');
function answer(message) {
  if (message.id === undefined) return null;
  let result;
  if (message.method === 'initialize') result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'botgo-compat-fixture', version: '1.0.0' } };
  else if (message.method === 'tools/list') result = { tools: [{ name: 'compat_echo', description: 'Return a controlled local verification marker. No side effects.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] };
  else if (message.method === 'tools/call') result = { content: [{ type: 'text', text: `BOTGO_MCP_OK: ${message.params.arguments?.text || ''}` }], isError: message.params.arguments?.text === 'controlled-failure' };
  else if (message.method === 'resources/list') result = { resources: [] };
  else if (message.method === 'resources/templates/list') result = { resourceTemplates: [] };
  else if (message.method === 'ping') result = {};
  else return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not supported by test service' } };
  return { jsonrpc: '2.0', id: message.id, result };
}
if (require.main === module) readline.createInterface({ input: process.stdin }).on('line', line => {
  const result = answer(JSON.parse(line)); if (result) process.stdout.write(JSON.stringify(result) + '\n');
});
module.exports = { answer };
