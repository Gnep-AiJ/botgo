const fs = require("node:fs");
const path = require("node:path");

const sourceDirectory = path.resolve(__dirname, "..", "..", "assets");
const targetDirectory = path.resolve(__dirname, "..", "assets");
const artwork = [
  "botgo-city-clean-v2.webp",
  "botgo-city-clean-mobile.webp",
  "botgo-robot-dynamic-v2.webp",
  "botgo-robot-dynamic-mobile.webp"
];

fs.mkdirSync(targetDirectory, { recursive: true });
for (const filename of artwork) {
  const source = path.join(sourceDirectory, filename);
  if (!fs.existsSync(source)) throw new Error(`Missing BotGo artwork: ${filename}`);
  fs.copyFileSync(source, path.join(targetDirectory, filename));
}
