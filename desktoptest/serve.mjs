// デスクトップ版を開くためのサーバー（追加のインストール不要）
//   使い方: node serve.mjs
//
// 同じパソコンの localhost から開く場合、ブラウザは HTTP でもカメラを使わせてくれる。
// そのため iPhone 版（vrtest/serve.mjs）と違って、証明書は要らない。
// ※ index.html をダブルクリックで開くと、hand.js の読み込みがブラウザに止められて動かない

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8000;

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };

http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(dir, urlPath);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
}).listen(PORT, '127.0.0.1', () => {
    console.log(`ブラウザで http://localhost:${PORT}/ を開いてください`);
    console.log('止めるときは Ctrl+C');
});
