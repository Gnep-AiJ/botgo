import fs from "fs";
import path from "path";
import crypto from "crypto";
import { applyContactOverrides, hideContactQr, CONTACT_QR_ASSET, assertNoPlaceholders } from "./deploy-overrides.mjs";

const { copyFile, mkdir, readFile, rm, stat, writeFile } = fs.promises;
const root = process.cwd();
const dist = path.join(root, "dist");
const faviconSource = "opencode-desktop/overlay/botgo-desktop.ico";
const brandAssets = ["brand.css", "assets/botgo-header-logo.png"];
const files = [
  'admin-metering.js', 'product-account.css', 'product-account.js',
  "index.html",
  "404.html",
  "styles.css",
  ...brandAssets,
  "app.js",
  "download.js", "client-preview.js",
  "workspace.html",
  "workspace-redirect.js",
  "workspace-billing.js",
  "chat.html", "chat.css", "chat.js", "chat-attachments.js", "ui-kit.js", "ui-kit.css",
  "shop.html", "shop.css", "shop.js", "assets/shop-chatgpt-logo.png",
  "assets/botgo-chat-light-preview.png", "assets/botgo-chat-dark-preview.png",
  "desktop-authorize.html",
  "desktop-authorize.css",
  "desktop-authorize.js",
  "admin.html",
  "admin.css",
  "admin-layout.css",
  "admin.js",
  "admin-platform.js",
  "_headers",
  "robots.txt",
  "assets/botgo-city-clean-mobile.webp",
  "assets/botgo-city-clean-v2.webp",
  "assets/botgo-account-skyline-user.webp",
  "assets/botgo-balance-wave-user.webp",
  "assets/botgo-rocket.svg",
  "assets/botgo-robot-dynamic-mobile.webp",
  "assets/botgo-robot-dynamic-v2.webp",
  "assets/botgo-client-workspace.png",
  "assets/botgo-client-wechat.png",
  "assets/botgo-client-account.png"
];

async function assertSourceFiles() {
  await Promise.all([...files, faviconSource].map((file) => stat(path.join(root, file))));
  const [home, homeScript, workspace, desktopAuthorize, shop] = await Promise.all([
    readFile(path.join(root, "index.html"), "utf8"),
    readFile(path.join(root, "app.js"), "utf8"),
    readFile(path.join(root, "workspace.html"), "utf8"),
    readFile(path.join(root, "desktop-authorize.html"), "utf8"),
    readFile(path.join(root, "shop.html"), "utf8")
  ]);
  const referenced = [home, homeScript, workspace, desktopAuthorize, shop]
    .flatMap((source) => [...source.matchAll(/(?:src|srcset|href)="\.\/([^"?#]+)/g)].map((match) => match[1]));
  const missing = [];
  for (const file of new Set(referenced)) {
    if (file === CONTACT_QR_ASSET) continue;
    try { await stat(path.join(root, file)); }
    catch { missing.push(file); }
  }
  if (missing.length) throw new Error(`Missing referenced assets: ${missing.join(", ")}`);
}

function createProductionHome(html, css, script) {
  const styleTag = html.match(/<link rel="stylesheet" href="\.\/styles\.css\?v=[^"]+"\s*\/>/)?.[0];
  const scriptTag = html.match(/<script src="\.\/app\.js\?v=[^"]+"><\/script>/)?.[0];
  if (!html.includes(styleTag) || !html.includes(scriptTag)) {
    throw new Error("Production home entry tags were not found");
  }
  return html
    .replace(styleTag, `<style>${css}</style>`)
    .replace(scriptTag, `<script>${script}</script>`);
}

function withBuildVersion(script, buildVersion) {
  const pattern = /var buildVersion = "[^"]+";/;
  if (!pattern.test(script)) throw new Error("Homepage build version marker was not found");
  return script.replace(pattern, `var buildVersion = "${buildVersion}";`);
}

function createProductionHeaders(headers, script) {
  const scriptHash = crypto.createHash("sha256").update(script.replace(/\r\n?/g, "\n")).digest("base64");
  const source = "script-src 'self';";
  if (!headers.includes(source)) throw new Error("CSP script-src directive was not found");
  return headers.replace(source, `script-src 'self' 'sha256-${scriptHash}';`);
}

function withContentVersion(html, asset, content) {
  const version = crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
  const pattern = new RegExp(`(\\./${asset.replace(".", "\\.")})(?:\\?v=[^"]+)?`, "g");
  return html.replace(pattern, `$1?v=${version}`);
}

function renderContactDetails(html, qrContent) {
  let result = applyContactOverrides(html);
  result = qrContent ? withContentVersion(result, CONTACT_QR_ASSET, qrContent) : hideContactQr(result);
  if (process.env.BOTGO_REQUIRE_DEPLOY_CONFIG === '1') assertNoPlaceholders(result);
  return result;
}

async function createBuildVersion() {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(path.join(root, file)));
  }
  return hash.digest("hex").slice(0, 12);
}

async function main() {
  await assertSourceFiles();
  if (process.argv.includes("--check")) {
    console.log("Production source check passed");
    return;
  }

  const buildVersion = await createBuildVersion();

  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  for (const file of files) {
    const target = path.join(dist, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, file), target);
  }
  await copyFile(path.join(root, faviconSource), path.join(dist, "favicon.ico"));

  // The contact QR is personal data and stays out of the repository. Prefer the
  // Cloudflare build secret, otherwise use a local copy that git ignores.
  const qrTarget = path.join(dist, CONTACT_QR_ASSET);
  const qrBase64 = (process.env.BOTGO_CONTACT_QR_BASE64 || '').trim();
  let hasContactQr = false;
  if (qrBase64) {
    const bytes = Buffer.from(qrBase64, "base64");
    if (bytes.length < 100) throw new Error("BOTGO_CONTACT_QR_BASE64 does not decode to an image");
    await mkdir(path.dirname(qrTarget), { recursive: true });
    await writeFile(qrTarget, bytes);
    hasContactQr = true;
  } else {
    try {
      await stat(path.join(root, CONTACT_QR_ASSET));
      await copyFile(path.join(root, CONTACT_QR_ASSET), qrTarget);
      hasContactQr = true;
    } catch {
      hasContactQr = false;
    }
  }

  const [html, css, script, headers, workspaceHtml, adminHtml] = await Promise.all([
    readFile(path.join(root, "index.html"), "utf8"),
    readFile(path.join(root, "styles.css"), "utf8"),
    readFile(path.join(root, "app.js"), "utf8"),
    readFile(path.join(root, "_headers"), "utf8"),
    readFile(path.join(root, "workspace.html"), "utf8"),
    readFile(path.join(root, "admin.html"), "utf8")
  ]);
  const versionedScript = withBuildVersion(script, buildVersion);
  let homeVersioned = createProductionHome(html, css, versionedScript);
  for (const asset of [...brandAssets, 'product-account.css', 'product-account.js', 'workspace-billing.js', 'download.js', 'client-preview.js']) homeVersioned = withContentVersion(homeVersioned, asset, await readFile(path.join(root, asset)));
  for (const asset of ['assets/botgo-chat-light-preview.png', 'assets/botgo-chat-dark-preview.png', 'assets/botgo-client-workspace.png', 'assets/botgo-client-wechat.png', 'assets/botgo-client-account.png']) homeVersioned = withContentVersion(homeVersioned, asset, await readFile(path.join(root, asset)));
  const qrContent = hasContactQr ? await readFile(qrTarget) : null;
  const productionHome = renderContactDetails(homeVersioned, qrContent);
  await writeFile(path.join(dist, "index.html"), productionHome);
  await writeFile(path.join(dist, "workspace.html"), withContentVersion(workspaceHtml, "workspace-redirect.js", await readFile(path.join(root, "workspace-redirect.js"), "utf8")));
  let adminVersioned=adminHtml;
  for(const asset of ['admin.css','admin-layout.css','admin.js','admin-platform.js','admin-metering.js'])adminVersioned=withContentVersion(adminVersioned,asset,await readFile(path.join(root,asset),'utf8'));
  await writeFile(path.join(dist,"admin.html"),adminVersioned);
  let chatVersioned=await readFile(path.join(root,'chat.html'),'utf8');
  for(const asset of [...brandAssets,'chat.css','chat.js','ui-kit.js','ui-kit.css'])chatVersioned=withContentVersion(chatVersioned,asset,await readFile(path.join(root,asset)));
  await writeFile(path.join(dist,'chat.html'),chatVersioned);
  let shopVersioned = await readFile(path.join(root, 'shop.html'), 'utf8');
  for (const asset of [...brandAssets, 'styles.css', 'shop.css', 'shop.js']) shopVersioned = withContentVersion(shopVersioned, asset, await readFile(path.join(root, asset)));
  await writeFile(path.join(dist, 'shop.html'), renderContactDetails(shopVersioned, qrContent));
  await writeFile(path.join(dist, "_headers"), createProductionHeaders(headers, versionedScript));
  console.log(`Built ${files.length} production files in dist/`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
