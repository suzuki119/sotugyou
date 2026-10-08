// ボールスティック検証画面（開発用）：http://localhost:5173/ballstick.html
//   右手の傾き・位置・握りの値を見ながら、しきい値と方式を決めるためのページ
//   Space：今の構えを基準（ニュートラル）として登録

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { startCamera } from '../camera/cameraManager.js';
import { HandTracker } from '../hand/handTracker.js';
import { InputManager } from '../input/inputManager.js';
import { handFrame, averageFrame } from '../hand/ballStick.js';
import { drawHands, handStyles } from '../ui/handPreview.js';

const video = document.getElementById('video');
const canvas = document.getElementById('hands');
const info = document.getElementById('info');
const msg = document.getElementById('msg');

const input = new InputManager(null);
const tracker = new HandTracker();

// 右側：大きく表示したボールスティック
const renderer = new THREE.WebGLRenderer({ antialias: true });
const holder = document.getElementById('stick');
holder.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1218);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
camera.position.set(0, 2.2, 4);
camera.lookAt(0, 0.8, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));
scene.add(new THREE.GridHelper(4, 8, 0x2f4a5c, 0x24313b));
const stick = new THREE.Group();
const glass = (color) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.5, roughness: 0.2 });
const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 16), glass(0x9fdcff));
shaft.position.y = 0.6;
const ballMat = glass(0x4dd0ff);
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 24), ballMat);
ball.position.y = 1.35;
stick.add(shaft, ball);
scene.add(stick);

function resize() {
    const dpr = devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    renderer.setSize(holder.clientWidth, holder.clientHeight);
    camera.aspect = holder.clientWidth / holder.clientHeight;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 基準の登録：Space を押してから1秒間、握っている右手を記録して平均する
let recording = null;
addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || recording) return;
    recording = [];
    msg.textContent = '基準を記録中…そのまま動かさないでください';
    setTimeout(() => {
        const samples = recording;
        recording = null;
        if (samples.length < 5) {
            msg.textContent = '右手を握った状態で、もう一度 Space を押してください';
            return;
        }
        const avg = (k) => samples.reduce((s, h) => s + h[k], 0) / samples.length;
        input.setBase({
            right: { x: avg('x'), y: avg('y'), size: avg('size'), frame: averageFrame(samples.map((h) => handFrame(h.world))) },
            left: { x: 0.5, y: 0.5, size: 1 },
        });
        msg.textContent = '基準を登録しました（Space でやり直し）';
    }, 1000);
});

msg.textContent = 'カメラを起動中…';
await startCamera(video);
await tracker.init();
tracker.start(video, (hands, now) => {
    input.onHands(hands, video.videoWidth / video.videoHeight, now);
    const right = input.hands.right;
    if (recording && right && input.input.rightGrip) recording.push({ ...right });
});
msg.textContent = '右手でボールを上から握るように構えて、Space で基準を登録';

function frame() {
    const i = input.input;
    const m = input.metrics.right;
    const t = input.tilt;
    const d = input.base && input.hands.right ? input.offset('right') : null;
    const f = (v, n = 0) => (v === undefined || v === null ? '─' : v.toFixed(n));

    info.textContent = [
        `方式 aimMode=${CONFIG.aimMode} / 左右=${CONFIG.ballStick.xSource}`,
        `右手 ${i.rightTracked ? '認識中' : '見失い'}　握り ${i.rightGrip ? 'ON' : 'OFF'}　射撃 ${i.fire ? 'ON' : 'OFF'}`,
        `指の曲がり ${f(m?.curl)}°（35°以上で握り）　親指 ${f(m?.thumb, 2)}（0.45以下で射撃）`,
        '',
        `傾き　前後 pitch ${f(t?.pitch)}°　左右 roll ${f(t?.roll)}°`,
        `位置　左右 ${f(d && d.x * 100, 1)}%　上下 ${f(d && d.y * 100, 1)}%　大きさ ${f(d && d.depth * 100, 0)}%`,
        '',
        `→ aimX ${f(i.aimX, 2)}　aimY ${f(i.aimY, 2)}`,
    ].join('\n');

    stick.rotation.x += (-i.aimY * 0.5 - stick.rotation.x) * 0.5;
    stick.rotation.z += (-i.aimX * 0.5 - stick.rotation.z) * 0.5;
    ballMat.color.setHex(!i.rightTracked ? 0x888888 : i.fire ? 0xff4040 : i.rightGrip ? 0x4dd0ff : 0xffd600);

    const ctx = canvas.getContext('2d');
    drawHands(canvas, input.hands, handStyles(i, input.orient), input.base);
    ctx.strokeStyle = '#2f4a5c';
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
