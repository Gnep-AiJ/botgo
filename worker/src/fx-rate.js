const ECB_URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

export async function refreshExchangeRate(env,fetcher=fetch){
  const settings=await env.DB.prepare('SELECT fx_auto FROM metering_settings WHERE id=1').first();
  if(!settings?.fx_auto)return {updated:false,reason:'manual'};
  const response=await fetcher(ECB_URL,{redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return {updated:false,reason:`HTTP_${response.status}`};
  const xml=await response.text();if(xml.length>100000)return {updated:false,reason:'OVERSIZE'};
  const date=/\btime=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const usd=Number(/\bcurrency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/.exec(xml)?.[1]);
  const cny=Number(/\bcurrency=['"]CNY['"]\s+rate=['"]([0-9.]+)['"]/.exec(xml)?.[1]);
  const ppm=Math.round(cny/usd*1e6);
  if(!date||!Number.isSafeInteger(ppm)||ppm<1000000||ppm>20000000)return {updated:false,reason:'INVALID_RATE'};
  await env.DB.prepare("UPDATE metering_settings SET usd_cny_ppm=?,fx_updated_at=?,fx_source='ECB',revision=revision+1 WHERE id=1 AND fx_auto=1 AND (fx_updated_at IS NULL OR fx_updated_at<>?)").bind(ppm,date,date).run();
  return {updated:true,date,usdCnyPpm:ppm};
}
