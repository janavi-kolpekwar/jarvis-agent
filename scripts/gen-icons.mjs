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

      // background: warm cream
      let R = 255, G = 244, B = 228;

      // dark ring (neo-brutalist outline)
      if (d <= r * 1.08 && d > r * 0.96) {
        R = 26; G = 26; B = 46;
      } else if (d <= r * 0.96) {
        // orb body: lemon → coral gradient by highlight distance
        const hl = Math.max(
          0,
          1 - Math.hypot(x - lx, y - ly) / (r * 1.7)
        );
        R = 255;
        G = 107 + (217 - 107) * hl;
        B = 61 + (107 - 61) * (1 - hl) * 0.5 + 46 * hl * 0;
        G = Math.round(G);
        B = Math.round(107 - 46 * hl);
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
