const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const secretDir = path.resolve(__dirname, "..", ".secrets");
const privatePath = path.join(secretDir, "alipay_app_private_key.pem");
const publicPath = path.join(secretDir, "alipay_app_public_key.pem");
if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) throw new Error("Alipay key files already exist; refusing to overwrite them.");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicExponent: 0x10001,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});
fs.mkdirSync(secretDir, { recursive: true });
fs.writeFileSync(privatePath, privateKey, { encoding: "utf8", mode: 0o600, flag: "wx" });
fs.writeFileSync(publicPath, publicKey, { encoding: "utf8", mode: 0o644, flag: "wx" });
const alipayPublicKey = publicKey.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
process.stdout.write(`ALIPAY_APP_PUBLIC_KEY=${alipayPublicKey}\n`);
