const {setTimeout: sleep}=require('node:timers/promises');

// Only these failures prove that an HTTP request was not sent.
const beforeSendCodes=new Set(['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT']);
function beforeSend(error){return beforeSendCodes.has(error?.code||error?.cause?.code);}
function abortable(promise,signal){
  if(!signal)return promise;
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
async function fetchRead(fetchImpl,url,init={}, {session=false,signal,delays=[500,1500]}={}){
  for(let attempt=0;;attempt++){
    signal?.throwIfAborted();
    try{
      const response=await fetchImpl(url,{...init,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      // Session creation rotates credentials: never retry an ambiguous HTTP response.
      if(session||![408,429,500,502,503,504].includes(response.status)||attempt>=delays.length)return response;
      await response.body?.cancel();
    }catch(error){
      if(signal?.aborted||attempt>=delays.length||(session&&!beforeSend(error)))throw error;
      if(!session&&!beforeSend(error)&&!['TimeoutError','TypeError'].includes(error?.name))throw error;
    }
    await sleep(delays[attempt],undefined,{signal});
  }
}
module.exports={beforeSend,abortable,fetchRead};
