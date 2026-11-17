// PDF is an attachment format, not a separate vision modality in vendor catalogs.
// Preserve the catalog's actual capabilities; only supported vision providers gain PDF transport.
export const NATIVE_REQUEST_MAX_BYTES=16*1024*1024;
export function nativeCapabilities(model,supported=['text','image','audio','video','pdf']) {
  if(!model?.modalities)return {};
  const input=[...model.modalities.input],output=[...model.modalities.output];
  if(input.includes('image')&&['OpenAI','Anthropic'].includes(model.provider)&&!input.includes('pdf'))input.push('pdf');
  const allowed=new Set(supported),supportedInput=input.filter(kind=>allowed.has(kind));
  return {modalities:{input:supportedInput,output:output.filter(kind=>allowed.has(kind))},attachment:supportedInput.some(kind=>kind!=='text')};
}
