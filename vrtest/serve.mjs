// iPhone から開くための HTTPS サーバー（追加のインストール不要）
//   使い方: node serve.mjs
//
// iPhone の Safari は、HTTPS でないとカメラを使わせてくれない。
// そこで自己署名の証明書をその場で作り、同じ Wi-Fi の iPhone から開けるようにする。
// 初回は「この接続ではプライバシーが保護されません」と出るので、
// 「詳細を表示」→「このWebサイトを閲覧」で進む。

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.join(dir, '.cert');
const keyFile = path.join(certDir, 'key.pem');
const certFile = path.join(certDir, 'cert.pem');
const PORT = 8443;

if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(certDir, { recursive: true });
    execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
        '-keyout', keyFile, '-out', certFile, '-subj', '/CN=vrtest',
    ], { stdio: 'ignore' });
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };

https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'https://x').pathname);
    let file = path.join(dir, urlPath);
    if (!file.startsWith(dir) || file.startsWith(certDir)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
}).listen(PORT, () => {
    console.log('iPhone の Safari で次のどれかを開いてください（Mac と同じ Wi-Fi に接続）:');
    for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list) if (a.family === 'IPv4' && !a.internal) console.log(`  https://${a.address}:${PORT}/`);
    }
    console.log('止めるときは Ctrl+C');
});
