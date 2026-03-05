/**
 * Generates placeholder PWA icons as SVG-based PNGs.
 * Run once: node src/generateIcons.js
 */
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

function svgIcon(size) {
  const r = Math.round(size * 0.18);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#1e1b4b"/>
  <text x="50%" y="54%" font-size="${Math.round(size*0.52)}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif">🎧</text>
</svg>`;
}

// Write SVG icons (browsers will use these as fallback, proper PNG generation requires canvas/sharp)
[192, 512].forEach(size => {
  const svgPath = path.join(iconsDir, `icon-${size}.svg`);
  const pngPath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(svgPath, svgIcon(size));
  // Create a minimal valid 1x1 PNG as placeholder if PNG doesn't exist
  // (proper PNG generation requires the server to be running with canvas)
  if (!fs.existsSync(pngPath)) {
    // Copy SVG as PNG reference — nginx/browsers will handle SVG icons
    fs.copyFileSync(svgPath, pngPath);
  }
  console.log(`Created icon-${size}.svg`);
});

console.log('Icons generated in public/icons/');
