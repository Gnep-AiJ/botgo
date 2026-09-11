import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const platform = read("worker/src/platform-admin.js");
const admin = read("admin.html");
const workspace = read("workspace.html");
const desktop = JSON.parse(read("desktop/package.json"));

for (const file of ["worker/migrations/0008_upstream_profiles.sql", "worker/migrations/0009_billing.sql", "worker/migrations/0010_desktop_releases.sql", "worker/migrations/0011_upstream_routes.sql", "admin-platform.js", "workspace-billing.js"]) assert.ok(fs.existsSync(file), `${file} must exist`);
assert.match(platform, /AES-GCM/, "upstream credentials must use authenticated encryption");
assert.match(platform, /UPSTREAM_CONFIG_KEY/, "encryption must depend on a Worker Secret");
const publicProfile = platform.match(/function publicProfile[\s\S]*?\n\}/)?.[0] || "";
assert.doesNotMatch(publicProfile, /apiKey|ciphertext|api_key_iv/, "admin APIs must not return a full or encrypted upstream key");
assert.match(platform, /probe\?\.status !== "ok"/, "a channel/model capability probe must pass before routing");
assert.match(platform, /web_chat.*desktop_codex/, "web and desktop must use independent route channels");
assert.match(platform, /upstream_route_history/, "route switches must retain rollback history");
assert.match(platform, /import-fallback/, "the current Worker upstream must be importable without exposing its key");
assert.match(platform, /url\.protocol !== "https:"/, "upstream URLs must require HTTPS");
assert.match(platform, /paymentAvailable: false/, "checkout must remain disabled until payment callbacks are implemented");
assert.match(platform, /subscription_granted/, "manual Pro grants must be audited");
assert.match(platform, /DESKTOP_RELEASES\.get/, "desktop downloads must stream from private R2");
assert.match(admin, /id="upstream-form"/, "admin must expose upstream management");
assert.match(admin, /id="billing-form"/, "admin must expose plan management");
assert.match(admin, /id="release-form"/, "admin must expose release management");
assert.match(admin, /data-admin-view="upstreams"/, "admin must use dedicated operational views");
assert.doesNotMatch(read("admin-platform.js"), /\bprompt\(/, "admin editing must not use browser prompt dialogs");
assert.match(workspace, /data-subscription-expiry/, "subscription UI must show expiry");
assert.match(workspace, /id="desktop-download-link"/, "desktop dialog must expose the protected release download");
assert.equal(desktop.build.compression, "maximum", "desktop packaging must use maximum compression");
assert.ok(!desktop.build.files.includes("**/*"), "desktop packaging must use an explicit allowlist");

console.log("Platform management contract test passed");
