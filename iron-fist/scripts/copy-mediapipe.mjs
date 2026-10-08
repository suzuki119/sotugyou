// MediaPipe の wasm を public/ にコピーする（展示会場でネットなしで動かすため）
//   npm run dev / npm run build の前に自動で実行される

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dest = path.join(root, 'public/mediapipe/wasm');

fs.mkdirSync(dest, { recursive: true });
for (const file of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
}
console.log('MediaPipe wasm をコピーしました →', path.relative(root, dest));
