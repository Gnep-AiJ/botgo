// Invoked by release-transfer.mjs with an ephemeral exact-object capability.
// Optional remote development preview is disposed in finally; no production route.
export default {async fetch(request,env){
  if(!env.TRANSFER_TOKEN)return new Response('Unavailable',{status:503});
  if(env.EXPIRES_AT&&Date.now()>Number(env.EXPIRES_AT))return new Response('Expired',{status:410});
  const url=new URL(request.url),actual=new TextEncoder().encode(request.headers.get('authorization')||''),expected=new TextEncoder().encode('Bearer '+env.TRANSFER_TOKEN);
  if((url.hostname!=='127.0.0.1'&&env.REMOTE_PREVIEW!=='1')||request.headers.has('origin')||actual.length!==expected.length||!crypto.subtle.timingSafeEqual(actual,expected))return new Response('Unauthorized',{status:401});
  if(!/^hermes\/2\.0\.0-preview\.\d+\/[a-f0-9]{64}\.exe$/.test(env.OBJECT_KEY))return new Response('Invalid release key',{status:400});
  if(url.pathname==='/production-proof'&&request.method==='GET'){
    if(env.PROOF_KEY!=='desktop/1.3.9/BotGo-1.3.9-win-x64.exe')return new Response('Invalid proof key',{status:400});
    const object=await env.RELEASES.head(env.PROOF_KEY);return Response.json(object?{key:object.key,size:object.size}:null);
  }
  if(url.pathname==='/head'&&request.method==='GET'){
    const object=await env.RELEASES.head(env.OBJECT_KEY);return Response.json(object?{size:object.size,sha256:object.customMetadata?.sha256}:null);
  }
  if(url.pathname==='/object'&&request.method==='GET'){
    const offset=Number(url.searchParams.get('offset')),length=Number(url.searchParams.get('length'));
    if(!url.searchParams.has('offset')||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>16*1024*1024||offset+length>1024**3)return new Response('Invalid range',{status:400});
    const object=await env.RELEASES.get(env.OBJECT_KEY,{range:{offset,length}});
    return object?new Response(object.body,{headers:{'content-length':String(Math.min(length,object.size-offset))}}):new Response('Not found',{status:404});
  }
  if(url.pathname==='/start'&&request.method==='POST'){
    if(await env.RELEASES.head(env.OBJECT_KEY))return new Response('Object exists',{status:409});
    const upload=await env.RELEASES.createMultipartUpload(env.OBJECT_KEY,{httpMetadata:{contentType:'application/vnd.microsoft.portable-executable'},customMetadata:{sha256:env.SHA256}});
    return Response.json({uploadId:upload.uploadId});
  }
  const id=url.searchParams.get('uploadId');if(!id)return new Response('Upload ID required',{status:400});
  const upload=env.RELEASES.resumeMultipartUpload(env.OBJECT_KEY,id);
  if(url.pathname==='/part'&&request.method==='PUT'){
    const part=Number(url.searchParams.get('part'));const size=Number(request.headers.get('content-length'));
    if(!Number.isInteger(part)||part<1||part>1000||!Number.isInteger(size)||size<1||size>16*1024*1024)return new Response('Invalid part',{status:400});
    return Response.json(await upload.uploadPart(part,request.body));
  }
  if(url.pathname==='/complete'&&request.method==='POST'){
    const parts=await request.json();if(!Array.isArray(parts)||!parts.length||parts.length>1000)return new Response('Invalid parts',{status:400});
    const object=await upload.complete(parts);return Response.json({size:object.size});
  }
  if(url.pathname==='/abort'&&request.method==='DELETE'){await upload.abort();return Response.json({aborted:true});}
  return new Response('Not found',{status:404});
}};
