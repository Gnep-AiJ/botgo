const RSA_ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256"
};

const RSA_ENCRYPTION_OID = Uint8Array.from([
  0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01
]);

const textEncoder = new TextEncoder();

function subtleCrypto() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is unavailable");
  return subtle;
}

function concatBytes(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// Secrets are commonly pasted into Cloudflare as PEM text, one-line Base64,
// or a quoted value containing literal "\\n" sequences. Normalize those
// transport variations before parsing; this does not change the key material.
function normalizeKeyMaterial(value) {
  let text = String(value ?? "").replace(/^\uFEFF/, "").trim();
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/\\r\\n|\\n|\\r/g, "\n");
  const assignment = /^(?:ALIPAY|AIPAY)_[A-Z0-9_]+\s*=\s*([\s\S]+)$/.exec(text);
  const candidate = (assignment ? assignment[1] : text).trim();
  if ((candidate.startsWith("\"") && candidate.endsWith("\"")) || (candidate.startsWith("'") && candidate.endsWith("'"))) {
    return candidate.slice(1, -1).trim();
  }
  return candidate;
}

function derLength(length) {
  if (!Number.isInteger(length) || length < 0) throw new Error("Invalid DER length");
  if (length < 0x80) return Uint8Array.of(length);
  const bytes = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>>= 8;
  }
  return Uint8Array.from([0x80 | bytes.length, ...bytes]);
}

function derWrap(tag, content) {
  return concatBytes(Uint8Array.of(tag), derLength(content.length), content);
}

function readDerElement(bytes, offset = 0) {
  if (!(bytes instanceof Uint8Array) || offset < 0 || offset >= bytes.length) throw new Error("Invalid DER element");
  const tag = bytes[offset];
  const lengthByte = bytes[offset + 1];
  if (lengthByte === undefined) throw new Error("Invalid DER length");
  let headerLength = 2;
  let length;
  if ((lengthByte & 0x80) === 0) {
    length = lengthByte;
  } else {
    const count = lengthByte & 0x7f;
    if (!count || count > 4 || offset + 2 + count > bytes.length) throw new Error("Invalid DER length");
    length = 0;
    for (let index = 0; index < count; index += 1) {
      length = (length << 8) | bytes[offset + 2 + index];
    }
    headerLength += count;
  }
  const contentStart = offset + headerLength;
  const contentEnd = contentStart + length;
  if (contentEnd > bytes.length) throw new Error("Invalid DER bounds");
  return { tag, start: offset, contentStart, contentEnd, end: contentEnd };
}

function childElements(bytes, element) {
  const children = [];
  let offset = element.contentStart;
  while (offset < element.contentEnd) {
    const child = readDerElement(bytes, offset);
    if (child.end > element.contentEnd) throw new Error("Invalid DER child");
    children.push(child);
    offset = child.end;
  }
  if (offset !== element.contentEnd) throw new Error("Invalid DER sequence");
  return children;
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function base64ToBytes(value) {
  const text = normalizeKeyMaterial(value)
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!text || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1) throw new Error("Invalid base64 key material");
  const binary = globalThis.atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function cryptoErrorCode(error) {
  const message = `${error?.name || ""} ${error?.message || error || ""}`.toLowerCase();
  if (message.includes("base64")) return "invalid_base64";
  if (message.includes("der") || message.includes("rsa private key") || message.includes("rsa public key")) return "invalid_der";
  if (message.includes("crypto") || message.includes("subtle") || message.includes("operationerror") || message.includes("dataerror")) return "crypto_import_failed";
  return "crypto_unavailable";
}

function isRsaAlgorithmIdentifier(bytes, element) {
  if (element?.tag !== 0x30) return false;
  const children = childElements(bytes, element);
  return children.some((child) => child.tag === 0x06 && equalBytes(bytes.slice(child.contentStart, child.contentEnd), RSA_ENCRYPTION_OID));
}

function wrapPkcs1PrivateKey(pkcs1) {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const algorithm = Uint8Array.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7,
    0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
  ]);
  return derWrap(0x30, concatBytes(version, algorithm, derWrap(0x04, pkcs1)));
}

function toPkcs8(privateKeyMaterial) {
  const der = base64ToBytes(privateKeyMaterial);
  const root = readDerElement(der);
  if (root.tag !== 0x30 || root.end !== der.length) throw new Error("Invalid RSA private key");
  const children = childElements(der, root);
  if (children[0]?.tag !== 0x02) throw new Error("Invalid RSA private key");
  // A Java/PKCS#8 key already has an AlgorithmIdentifier as its second child.
  if (children[1]?.tag === 0x30) return der;
  // A non-Java/PKCS#1 key has the RSA integers as its remaining children.
  if (children.length !== 9 || children[1]?.tag !== 0x02) throw new Error("Invalid RSA PKCS#1 private key");
  return wrapPkcs1PrivateKey(der);
}

function wrapPkcs1PublicKey(pkcs1) {
  const algorithm = Uint8Array.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7,
    0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
  ]);
  const bitString = derWrap(0x03, concatBytes(Uint8Array.of(0x00), pkcs1));
  return derWrap(0x30, concatBytes(algorithm, bitString));
}

function findSubjectPublicKeyInfo(bytes, element = readDerElement(bytes)) {
  if (element.tag !== 0x30) return null;
  const children = childElements(bytes, element);
  if (children.length >= 2 && children[0].tag === 0x30 && children[1].tag === 0x03 && isRsaAlgorithmIdentifier(bytes, children[0])) {
    return bytes.slice(element.start, element.end);
  }
  for (const child of children) {
    if (child.tag === 0x30) {
      const found = findSubjectPublicKeyInfo(bytes, child);
      if (found) return found;
    }
  }
  return null;
}

function toSpki(publicKeyMaterial, certificateMaterial = "") {
  let der;
  try {
    der = base64ToBytes(publicKeyMaterial);
  } catch (error) {
    if (!certificateMaterial) throw error;
    der = base64ToBytes(certificateMaterial);
  }
  const root = readDerElement(der);
  if (root.tag !== 0x30 || root.end !== der.length) throw new Error("Invalid RSA public key");
  const children = childElements(der, root);
  if (children[0]?.tag === 0x30 && children[1]?.tag === 0x03 && isRsaAlgorithmIdentifier(der, children[0])) return der;
  if (children[0]?.tag === 0x02 && children[1]?.tag === 0x02) return wrapPkcs1PublicKey(der);
  const found = findSubjectPublicKeyInfo(der, root);
  if (found) return found;
  if (certificateMaterial && publicKeyMaterial) return toSpki("", certificateMaterial);
  throw new Error("RSA public key or certificate is invalid");
}

function keyMaterialShape(value) {
  let der;
  try {
    der = base64ToBytes(value);
  } catch {
    return "invalid_base64";
  }
  try {
    const root = readDerElement(der);
    if (root.tag !== 0x30 || root.end !== der.length) return "invalid_der";
    const children = childElements(der, root);
    if (children[0]?.tag === 0x02 && children[1]?.tag === 0x30) return "private_pkcs8";
    if (children.length === 9 && children[0]?.tag === 0x02 && children[1]?.tag === 0x02) return "private_pkcs1";
    if (children[0]?.tag === 0x30 && children[1]?.tag === 0x03 && isRsaAlgorithmIdentifier(der, children[0])) return "public_spki";
    if (children[0]?.tag === 0x02 && children[1]?.tag === 0x02) return "public_pkcs1";
    if (children[0]?.tag === 0x30 && children[1]?.tag === 0x04) return "encrypted_private";
    return "invalid_der";
  } catch {
    return "invalid_der";
  }
}

async function importPrivateKey(privateKeyMaterial) {
  return subtleCrypto().importKey("pkcs8", toPkcs8(privateKeyMaterial), RSA_ALGORITHM, false, ["sign"]);
}

async function importPublicKey(publicKeyMaterial, certificateMaterial = "") {
  return subtleCrypto().importKey("spki", toSpki(publicKeyMaterial, certificateMaterial), RSA_ALGORITHM, false, ["verify"]);
}

export async function diagnoseAlipayKeyMaterial({ privateKey = "", publicKey = "", publicCertificate = "" } = {}) {
  const result = { privateKey: privateKey ? "unknown" : "missing", publicKey: publicKey || publicCertificate ? "unknown" : "missing", keyPair: "not_checked" };
  let importedPrivateKey = null;
  let importedPublicKey = null;
  if (privateKey) {
    const shape = keyMaterialShape(privateKey);
    if (shape === "public_spki" || shape === "public_pkcs1") {
      result.privateKey = "public_key_material";
    } else if (shape === "encrypted_private") {
      result.privateKey = "encrypted_private";
    } else if (shape === "invalid_base64" || shape === "invalid_der") {
      result.privateKey = shape;
    } else {
      try {
        importedPrivateKey = await importPrivateKey(privateKey);
        result.privateKey = "valid";
      } catch (error) {
        result.privateKey = cryptoErrorCode(error);
      }
    }
  }
  if (publicKey || publicCertificate) {
    try {
      importedPublicKey = await importPublicKey(publicKey, publicCertificate);
      result.publicKey = "valid";
    } catch (error) {
      result.publicKey = cryptoErrorCode(error);
    }
  }
  if (importedPrivateKey && importedPublicKey) {
    try {
      const challenge = textEncoder.encode("botgo-alipay-key-pair-diagnostic-v1");
      const signature = await subtleCrypto().sign(RSA_ALGORITHM, importedPrivateKey, challenge);
      result.keyPair = await subtleCrypto().verify(RSA_ALGORITHM, importedPublicKey, signature, challenge) ? "matches" : "does_not_match";
    } catch {
      result.keyPair = "not_checked";
    }
  }
  return result;
}

export function canonicalAlipayParams(params = {}, { includeSignType = true } = {}) {
  return Object.keys(params)
    .filter((key) => key && key !== "sign" && (includeSignType || key !== "sign_type"))
    .sort()
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .map((key) => {
      const value = typeof params[key] === "string" ? params[key] : JSON.stringify(params[key]);
      return `${key}=${value}`;
    })
    .join("&");
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

export async function signAlipayParams(privateKeyMaterial, params) {
  const key = await importPrivateKey(privateKeyMaterial);
  const signature = await subtleCrypto().sign(RSA_ALGORITHM, key, textEncoder.encode(canonicalAlipayParams(params)));
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyAlipayParams(publicKeyMaterial, params, certificateMaterial = "") {
  const signatureText = typeof params?.sign === "string" ? params.sign : "";
  if (!signatureText) return false;
  let signature;
  try {
    signature = base64ToBytes(signatureText);
  } catch {
    return false;
  }
  try {
    const key = await importPublicKey(publicKeyMaterial, certificateMaterial);
    const subtle = subtleCrypto();
    const withSignType = await subtle.verify(RSA_ALGORITHM, key, signature, textEncoder.encode(canonicalAlipayParams(params, { includeSignType: true })));
    if (withSignType) return true;
    return subtle.verify(RSA_ALGORITHM, key, signature, textEncoder.encode(canonicalAlipayParams(params, { includeSignType: false })));
  } catch {
    return false;
  }
}

export async function verifyAlipayText(publicKeyMaterial, text, signatureText, certificateMaterial = "") {
  if (!signatureText) return false;
  try {
    const signature = base64ToBytes(signatureText);
    const key = await importPublicKey(publicKeyMaterial, certificateMaterial);
    return subtleCrypto().verify(RSA_ALGORITHM, key, signature, textEncoder.encode(String(text)));
  } catch {
    return false;
  }
}
