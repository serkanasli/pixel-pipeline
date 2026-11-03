// Draws a synthetic test image for this example: a ring of stones with two crossed logs on a flat
// light background, at 4 source px per art pixel. Run from this folder: node make-test-image.mjs
import sharp from 'sharp';

const S = 4; // source px per art pixel
const px = (v) => v * S;
const stones = [[14, 30, 9, 6], [30, 34, 10, 6], [50, 35, 10, 6], [70, 35, 10, 6], [90, 34, 10, 6], [106, 30, 9, 6], [26, 24, 8, 5], [94, 24, 8, 5]];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px(160)}" height="${px(70)}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="#e9e5dc"/>
  <g transform="translate(${px(20)} ${px(10)})">
    <rect x="${px(28)}" y="${px(18)}" width="${px(64)}" height="${px(8)}" rx="${px(3)}" fill="#6b3f22" stroke="#1e130c" stroke-width="${px(1)}" transform="rotate(-12 ${px(60)} ${px(22)})"/>
    <rect x="${px(28)}" y="${px(18)}" width="${px(64)}" height="${px(8)}" rx="${px(3)}" fill="#7d4a28" stroke="#1e130c" stroke-width="${px(1)}" transform="rotate(12 ${px(60)} ${px(22)})"/>
    ${stones.map(([x, y, rx, ry], i) => `<ellipse cx="${px(x)}" cy="${px(y)}" rx="${px(rx)}" ry="${px(ry)}" fill="${['#77808c', '#8a929c', '#646c78'][i % 3]}" stroke="#1b1f26" stroke-width="${px(1)}"/>`).join('\n    ')}
  </g>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile('base.png');
console.log('base.png written');
