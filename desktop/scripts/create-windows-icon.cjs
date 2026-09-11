const fs = require("node:fs");
const path = require("node:path");

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const output = path.resolve(__dirname, "..", "assets", "botgo-desktop.ico");

const insideRoundedRect = (x, y, left, top, right, bottom, radius) => {
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
};

function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const set = (x, y, red, green, blue, alpha = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = ((size - 1 - y) * size + x) * 4;
    pixels[offset] = blue;
    pixels[offset + 1] = green;
    pixels[offset + 2] = red;
    pixels[offset + 3] = alpha;
  };
  const unit = (value) => Math.round(value * size);
  const tile = { left: unit(.06), top: unit(.06), right: unit(.94), bottom: unit(.94), radius: unit(.22) };
  const face = { left: unit(.23), top: unit(.35), right: unit(.77), bottom: unit(.74), radius: unit(.16) };

  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (insideRoundedRect(x, y, tile.left, tile.top, tile.right, tile.bottom, tile.radius)) {
      const shade = y / Math.max(1, size - 1);
      set(x, y, Math.round(24 - shade * 16), Math.round(157 - shade * 72), Math.round(255 - shade * 55));
    }
    if (insideRoundedRect(x, y, face.left, face.top, face.right, face.bottom, face.radius)) set(x, y, 242, 250, 255);
  }

  const center = unit(.5);
  const eyeRadius = Math.max(1, unit(.055));
  const dotRadius = Math.max(1, unit(.035));
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (x >= center - 1 && x <= center + 1 && y >= unit(.2) && y <= unit(.35)) set(x, y, 101, 218, 255);
    if ((x - center) ** 2 + (y - unit(.17)) ** 2 <= dotRadius ** 2) set(x, y, 101, 218, 255);
    for (const eye of [unit(.39), unit(.61)]) if ((x - eye) ** 2 + (y - unit(.53)) ** 2 <= eyeRadius ** 2) set(x, y, 8, 109, 255);
  }
  return pixels;
}

const images = sizes.map((size) => {
  const pixels = draw(size);
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(pixels.length, 20);
  return Buffer.concat([header, pixels, mask]);
});

const directory = Buffer.alloc(6 + images.length * 16);
directory.writeUInt16LE(0, 0);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(images.length, 4);
let offset = directory.length;
images.forEach((image, index) => {
  const size = sizes[index];
  const entry = 6 + index * 16;
  directory[entry] = size === 256 ? 0 : size;
  directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});

fs.writeFileSync(output, Buffer.concat([directory, ...images]));
