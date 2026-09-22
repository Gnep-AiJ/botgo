// Standard text-token prices in USD per 1M tokens, verified 2026-09-21.
// Only exact public model IDs are eligible for automatic billing.
const OPENAI_SOURCE='https://developers.openai.com/api/docs/pricing';
const ANTHROPIC_SOURCE='https://platform.claude.com/docs/en/about-claude/pricing';
const XAI_SOURCE='https://docs.x.ai/developers/pricing';
const noLongPremium=10000000;
const visualInput={input:['text','image'],output:['text']};
const imageOnly={input:['text','image'],output:['image']};
const capabilities={
  'gpt-6-astra':{reasoning:true,context:1050000,output:128000,modalities:visualInput},
  'gpt-5.6-sol':{reasoning:true,context:1050000,output:128000,modalities:visualInput},
  'gpt-5.6-terra':{reasoning:true,context:1050000,output:128000,modalities:visualInput},
  'gpt-5.6-luna':{reasoning:true,context:1050000,output:128000,modalities:visualInput},
  'gpt-5.5':{reasoning:true,context:1050000,output:128000,modalities:visualInput},
  'claude-fable-5-1':{reasoning:true,context:1000000,output:128000,modalities:visualInput},
  'claude-fable-5':{reasoning:true,context:1000000,output:128000,modalities:visualInput},
  'claude-mythos-5-1':{reasoning:true,context:1000000,output:128000,modalities:visualInput},
  'claude-mythos-5':{reasoning:true,context:1000000,output:128000,modalities:visualInput},
  'claude-opus-5':{reasoning:true,context:1000000,output:128000,modalities:visualInput},
  'claude-opus-4-8':{reasoning:true,context:1000000,output:128000,modalities:visualInput},
  'claude-opus-4-7':{reasoning:true,context:1000000,output:128000,modalities:visualInput},
  'claude-opus-4-6':{reasoning:true,context:1000000,output:128000,modalities:visualInput},
  'claude-opus-4-5-20251101':{reasoning:true,context:200000,output:64000,modalities:visualInput},
  'claude-sonnet-5':{reasoning:true,context:1000000,output:128000,modalities:visualInput},
  'claude-sonnet-4-6':{reasoning:true,context:1000000,output:128000,modalities:visualInput},
  'claude-sonnet-4-5-20250929':{reasoning:true,context:200000,output:64000,modalities:visualInput},
  'claude-haiku-4-5-20251001':{reasoning:true,context:200000,output:64000,modalities:visualInput},
  'grok-4.6':{reasoning:true,context:500000,output:500000,modalities:visualInput},
  'grok-build-0.1':{reasoning:true,context:256000,output:256000,modalities:visualInput},
  'grok-4.5':{reasoning:true,context:500000,output:500000,modalities:visualInput},
  'grok-4.3':{reasoning:true,context:1000000,output:1000000,modalities:visualInput},
  'grok-4.20-multi-agent-0309':{reasoning:true,context:1000000,output:1000000,modalities:visualInput},
  'grok-4.20-0309-reasoning':{reasoning:true,context:1000000,output:1000000,modalities:visualInput},
  'grok-4.20-0309-non-reasoning':{reasoning:false,context:1000000,output:1000000,modalities:visualInput}
};

// name, provider, input, cached input, cache write, output, long threshold,
// long input multiplier, long output multiplier, official source
const rates={
  'gpt-6-astra':['GPT-6 Astra','OpenAI',10,1,12.5,50,272000,2,1.5,OPENAI_SOURCE],
  'gpt-5.6-sol':['GPT-5.6 Sol','OpenAI',4,.4,5,20,272000,2,1.5,OPENAI_SOURCE],
  'gpt-5.6-terra':['GPT-5.6 Terra','OpenAI',2,.2,2.5,12,272000,2,1.5,OPENAI_SOURCE],
  'gpt-5.6-luna':['GPT-5.6 Luna','OpenAI',.2,.02,.25,1.2,272000,2,1.5,OPENAI_SOURCE],
  'gpt-5.5':['GPT-5.5','OpenAI',5,.5,5,30,272000,2,1.5,OPENAI_SOURCE],
  'claude-fable-5-1':['Claude Fable 5.1','Anthropic',10,.25,12.5,50,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-fable-5':['Claude Fable 5','Anthropic',10,1,12.5,50,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-mythos-5-1':['Claude Mythos 5.1','Anthropic',10,1,12.5,50,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-mythos-5':['Claude Mythos 5','Anthropic',10,1,12.5,50,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-opus-5':['Claude Opus 5','Anthropic',5,.5,6.25,25,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-opus-4-8':['Claude Opus 4.8','Anthropic',5,.5,6.25,25,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-opus-4-7':['Claude Opus 4.7','Anthropic',5,.5,6.25,25,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-opus-4-6':['Claude Opus 4.6','Anthropic',5,.5,6.25,25,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-opus-4-5-20251101':['Claude Opus 4.5','Anthropic',5,.5,6.25,25,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-sonnet-5':['Claude Sonnet 5','Anthropic',2,.2,2.5,10,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-sonnet-4-6':['Claude Sonnet 4.6','Anthropic',3,.3,3.75,15,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-sonnet-4-5-20250929':['Claude Sonnet 4.5','Anthropic',3,.3,3.75,15,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'claude-haiku-4-5-20251001':['Claude Haiku 4.5','Anthropic',1,.1,1.25,5,noLongPremium,1,1,ANTHROPIC_SOURCE],
  'grok-4.6':['Grok 4.6','xAI',2,.5,0,6,200000,2,2,XAI_SOURCE],
  'grok-build-0.1':['Grok Build 0.1','xAI',1,.2,0,2,200000,2,2,XAI_SOURCE],
  'grok-4.5':['Grok 4.5','xAI',2,.3,0,6,200000,2,2,XAI_SOURCE],
  'grok-4.3':['Grok 4.3','xAI',1.25,.2,0,2.5,200000,2,2,XAI_SOURCE],
  'grok-4.20-multi-agent-0309':['Grok 4.20 Multi Agent','xAI',1.25,.2,0,2.5,200000,2,2,XAI_SOURCE],
  'grok-4.20-0309-reasoning':['Grok 4.20 Reasoning','xAI',1.25,.2,0,2.5,200000,2,2,XAI_SOURCE],
  'grok-4.20-0309-non-reasoning':['Grok 4.20 Non Reasoning','xAI',1.25,.2,0,2.5,200000,2,2,XAI_SOURCE]
};

export function officialModel(id){
  const rate=rates[id];if(!rate)return null;
  const [name,provider,input,cached,write,output,longThreshold,longInput,longOutput,source]=rate;
  const capability=capabilities[id]||{};
  return {id,name,provider,agent:true,reasoning:capability.reasoning===true,modalities:capability.modalities,
    limit:capability.context?{context:capability.context,output:capability.output}:undefined,
    price:{tier:'default',input,cached,write,output,longThreshold,longInput,longOutput,source,date:'2026-09-21'}};
}

const imageRates={
  'gpt-image-2':['GPT Image 2',5,1.25,8,2,30],
  'gpt-image-2.5-flare':['GPT Image 2.5 Flare',5,1.25,8,2,30],
  'gpt-image-2.5-sunburst':['GPT Image 2.5 Sunburst',5,1.25,8,2,30]
};

export function officialImageModel(id){
  const rate=imageRates[id];if(!rate)return null;
  const [name,textInput,textCached,imageInput,imageCached,imageOutput]=rate;
  return {id,name,provider:'OpenAI',agent:false,modalities:imageOnly,imagePrice:{textInput,textCached,imageInput,imageCached,imageOutput,source:OPENAI_SOURCE,date:'2026-09-22',tier:'default'}};
}

export function officialCatalogModel(id){return officialModel(id)||officialImageModel(id);}
export const officialModelIds=[...Object.keys(rates),...Object.keys(imageRates)];
