const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

function managedConfig(previous, gateway) {
  const providers = {};
  for (const protocol of ['chat', 'responses']) {
    const models = gateway.catalog.filter(model => model.protocol === protocol);
    if (!models.length) continue;
    providers['botgo-' + protocol] = {
      name: protocol === 'chat' ? 'BotGo' : 'BotGo Responses', api: gateway.baseURL.replace('/v1', '/' + protocol + '/v1'),
      key_env: 'BOTGO_HERMES_API_KEY', transport: protocol === 'chat' ? 'chat_completions' : 'codex_responses',
      session_affinity_header: 'x-session-id', discover_models: false,
      models: Object.fromEntries(models.map(model => [model.id, {
        name: model.name, context_length: model.limit.context, max_output_tokens: model.limit.output,
        supports_vision: model.modalities?.input?.includes('image') || false,
        supports_reasoning: model.reasoning,
      }])),
    };
  }
  const chosen = gateway.catalog.find(m => m.id === previous?.model?.default) || gateway.catalog.find(m => m.id === gateway.defaultModel);
  if (!chosen) throw Error('No available BotGo model');
  // Only inference/account policy is managed. Tools, memory, skills, messaging,
  // bots, MCP, approvals, projects and all other native settings survive.
  return { ...previous, providers, custom_providers: [], telemetry:{...previous?.telemetry,shared_metrics:{...previous?.telemetry?.shared_metrics,enabled:false,send:false}},
    tts: { ...previous?.tts, provider: (!previous?.tts?.provider || previous.tts.provider === 'edge') ? 'botgo-windows' : previous.tts.provider },
    image_gen: { ...previous?.image_gen, provider: 'botgo', botgo: {
      base_url: gateway.baseURL, models: gateway.imageModels || [],
    } },
    model: { ...previous?.model, default: chosen.id, provider: 'botgo-' + chosen.protocol,
      base_url: gateway.baseURL.replace('/v1', '/' + chosen.protocol + '/v1'), api_key: null, api_mode: chosen.protocol === 'chat' ? 'chat_completions' : 'codex_responses' },
    auxiliary: Object.fromEntries(Object.entries(previous?.auxiliary || {}).map(([name, value]) => [name, { ...value, provider: 'main' }])),
  };
}
function writeManagedConfig(home, gateway) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, 'config.yaml');
  const previous = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8')) || {} : {};
  const config = managedConfig(previous, gateway);
  fs.writeFileSync(file + '.next', YAML.stringify(config)); fs.renameSync(file + '.next', file);
  return config;
}
function setPlatformEnabled(home,id,enabled) {
  const file=path.join(home,'config.yaml');
  const config=fs.existsSync(file)?YAML.parse(fs.readFileSync(file,'utf8'))||{}:{};
  config.platforms={...config.platforms,[id]:{...config.platforms?.[id],enabled}};
  fs.writeFileSync(file+'.next',YAML.stringify(config));fs.renameSync(file+'.next',file);
}
module.exports = { managedConfig, writeManagedConfig, setPlatformEnabled };
