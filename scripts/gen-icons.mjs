#!/usr/bin/env node
// Generates PWA icons: a glowing teal orb on the Jarvis dark background.
import { PNG } from "pngjs";
import { createWriteStream, mkdirSync } from "node:fs";

function makeIcon(size, file) {
  const png = new PNG({ width: size, height: size });
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.32;
  // light source offset for the orb highlight
  const lx = cx - r * 0.35;
  const ly = cy - r * 0.4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const d = Math.hypot(x - cx, y - cy);

      // background
      let R = 7, G = 9, B = 13;

      // outer glow
      if (d < r * 2.2) {
        const glow = Math.max(0, 1 - d / (r * 2.2)) ** 2 * 0.35;
        R += 20 * glow;
        G += 184 * glow;
        B += 166 * glow;
      }

      // orb body with highlight
      if (d <= r) {
        const hl = Math.max(
          0,
          1 - Math.hypot(x - lx, y - ly) / (r * 1.6)
        );
        R = 15 + 140 * hl;
        G = 150 + 96 * hl;
        B = 138 + 90 * hl;
      }

      png.data[idx] = Math.min(255, Math.round(R));
      png.data[idx + 1] = Math.min(255, Math.round(G));
      png.data[idx + 2] = Math.min(255, Math.round(B));
      png.data[idx + 3] = 255;
    }
  }
  png.pack().pipe(createWriteStream(file));
  console.log("wrote", file);
}

mkdirSync(new URL("../public", import.meta.url).pathname, { recursive: true });
const pub = new URL("../public/", import.meta.url).pathname;
makeIcon(192, pub + "icon-192.png");
makeIcon(512, pub + "icon-512.png");
makeIcon(180, pub + "apple-touch-icon.png");
