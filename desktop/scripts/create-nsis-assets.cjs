const fs = require("node:fs");
const path = require("node:path");

const outputDirectory = path.resolve(__dirname, "..", "build");

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
const mix = (from, to, amount) => from.map((value, index) => clamp(value + (to[index] - value) * amount));
const withShade = (color, amount) => color.map((value) => clamp(value * amount));

function makeCanvas(width, height, top, bottom) {
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, () => mix(top, bottom, y / Math.max(1, height - 1))));
}

function paintSkyline(canvas, { dark = false } = {}) {
  const height = canvas.length;
  const width = canvas[0].length;
  const skyline = dark ? [8, 58, 119] : [10, 79, 156];
  const glow = dark ? [31, 112, 194] : [37, 147, 242];
  const baseY = Math.floor(height * 0.82);

  for (let x = 0; x < width; x += 1) {
    const wave = Math.abs(Math.sin(x * 0.19)) * height * 0.17;
    const tower = (x % 29 < 10 ? height * 0.24 : 0) + (x % 47 < 6 ? height * 0.34 : 0);
    const roof = Math.max(Math.floor(height * 0.26), Math.floor(baseY - wave - tower));
    for (let y = roof; y < height; y += 1) canvas[y][x] = skyline;
    if (x % 9 === 2) {
      for (let y = roof + 5; y < height - 2; y += 11) canvas[y][x] = glow;
    }
  }

  for (let x = 0; x < width; x += 1) {
    const y = Math.floor(height * 0.68 + x * 0.14);
    if (y >= 0 && y < height) canvas[y][x] = glow;
  }
}

function write24BitBmp(file, canvas) {
  const height = canvas.length;
  const width = canvas[0].length;
  const rowBytes = width * 3;
  const stride = (rowBytes + 3) & ~3;
  const pixels = stride * height;
  const output = Buffer.alloc(54 + pixels);
  output.write("BM", 0, 2, "ascii");
  output.writeUInt32LE(output.length, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(pixels, 34);

  for (let destinationY = 0; destinationY < height; destinationY += 1) {
    const sourceY = height - 1 - destinationY;
    const offset = 54 + destinationY * stride;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = canvas[sourceY][x];
      const pixelOffset = offset + x * 3;
      output[pixelOffset] = blue;
      output[pixelOffset + 1] = green;
      output[pixelOffset + 2] = red;
    }
  }

  fs.writeFileSync(file, output);
}

function createAsset(name, width, height, options) {
  const canvas = makeCanvas(width, height, options.top, options.bottom);
  paintSkyline(canvas, options);
  write24BitBmp(path.join(outputDirectory, name), canvas);
}

fs.mkdirSync(outputDirectory, { recursive: true });
createAsset("installerHeader.bmp", 150, 57, { top: [219, 244, 255], bottom: [51, 144, 224] });
createAsset("installerSidebar.bmp", 164, 314, { top: [220, 244, 255], bottom: [8, 68, 143] });
createAsset("uninstallerSidebar.bmp", 164, 314, { top: [182, 226, 255], bottom: [6, 49, 109], dark: true });
