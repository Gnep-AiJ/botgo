// Standard text-token prices in USD per 1M tokens, verified 2026-09-20.
// Only exact public model IDs are eligible for automatic billing.
const rates={
  'gpt-6-astra':['GPT-6 Astra',10,1,12.5,50],
  'gpt-5.6-sol':['GPT-5.6 Sol',4,.4,5,20],
  'gpt-5.6-terra':['GPT-5.6 Terra',2,.2,2.5,12],
  'gpt-5.6-luna':['GPT-5.6 Luna',.2,.02,.25,1.2],
  'gpt-5.5':['GPT-5.5',5,.5,5,30]
};

export function officialModel(id){
  const rate=rates[id];if(!rate)return null;
  const [name,input,cached,write,output]=rate;
  return {id,name,price:{tier:'default',input,cached,write,output,longThreshold:272000,longInput:2,longOutput:1.5,source:'https://developers.openai.com/api/docs/pricing',date:'2026-09-20'}};
}

export const officialModelIds=Object.keys(rates);
