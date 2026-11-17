// Render a deployable Worker config from the committed template.
// Cloudflare Workers Builds runs this before `wrangler deploy` so the public
// repository keeps placeholders while the deployment receives real values.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderWorkerConfig } from "./deploy-overrides.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "worker/wrangler.jsonc");
const targetPath = path.join(root, "worker/wrangler.deploy.jsonc");

const rendered = renderWorkerConfig(readFileSync(sourcePath, "utf8"), process.env);
writeFileSync(targetPath, rendered);
console.log(`Rendered worker/wrangler.deploy.jsonc for ${process.env.BOTGO_PUBLIC_ORIGIN}`);
