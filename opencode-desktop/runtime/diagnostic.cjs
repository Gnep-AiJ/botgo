// Allowlist-only diagnostics: never serialize errors, URLs, bodies or credentials.
function diagnostic(error,stage){
  const stages=['initialize','authorize-start','authorize-exchange','session','storage','ipc','prepare','request','headers','first-byte','stream','finished'];
  const codes=['EACCES','EPERM','ECONNREFUSED','ECONNRESET','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CANCELLED'];
  const status=Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?error.status:undefined;
  const raw=error?.code||error?.cause?.code;
  return {stage:stages.includes(stage)?stage:'unknown',status,
    code:codes.includes(raw)?raw:undefined,
    kind:error?.name==='TimeoutError'?'timeout':status?'http':'local'};
}
module.exports={diagnostic};
