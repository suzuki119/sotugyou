// ロボットのアニメーション確認画面（開発用）：http://localhost:5173/robot.html
//   ゲームと同じ RobotModel で読み込むので、大きさ・向き・ライトの当たり方はゲーム内と同じ
//   カメラを「ゲーム内：〇〇」にすると、演出で使うカメラ（robotModel.js の SHOTS）で映す

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RobotModel } from '../render/robotModel.js';

const FPS = 24;   // Blender 側のフレームレート（robot_motion_list.xlsx）
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '^'];
const HATCH_CLIPS = ['HatchOpen', 'HatchClose'];   // ハッチは体のクリップと別に動かす

const $ = (id) => document.getElementById(id);
const ui = {
    clips: $('clips'), loop: $('loop'), speed: $('speed'), speedText: $('speedText'),
    shot: $('shot'), play: $('play'), seek: $('seek'), time: $('time'),
};

// ---------- シーン（ゲームの sceneManager.js と同じライト） ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1218);
scene.add(new THREE.HemisphereLight(0xb8d4ff, 0x30281e, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(60, 120, 40);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x1c2228, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new THREE.GridHelper(120, 60, 0x2f4a5c, 0x24313b);   // 1マス＝2m
grid.position.y = 0.02;
scene.add(grid);

const freeCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
freeCamera.position.set(14, 9, -22);   // ロボットの正面（-Z 側）から
const controls = new OrbitControls(freeCamera, renderer.domElement);
controls.target.set(0, 6, 0);
controls.enableDamping = true;

const robot = new RobotModel(scene);

function resize() {
    renderer.setSize(innerWidth, innerHeight);
    freeCamera.aspect = innerWidth / innerHeight;
    freeCamera.updateProjectionMatrix();
    robot.resize(innerWidth / innerHeight);
}
addEventListener('resize', resize);
resize();

// ---------- 再生の状態 ----------
let current = null;
let playing = true;

function select(name) {
    current = name;
    robot.play(name, { once: !ui.loop.checked, fade: 0 });
    setPlaying(true);
    for (const b of ui.clips.querySelectorAll('button')) b.classList.toggle('active', b.dataset.clip === name);
}

function setPlaying(on) {
    playing = on;
    ui.play.textContent = on ? '⏸' : '▶';
}

function togglePlay() {
    if (!current) return;
    // 1回再生で最後まで行っていたら、頭から再生し直す
    const a = robot.body;
    if (!playing && !ui.loop.checked && a.time >= a.getClip().duration - 1e-3) robot.seek(0);
    setPlaying(!playing);
}

function step(frames) {
    if (!current) return;
    setPlaying(false);
    robot.seek(robot.body.time + frames / FPS);
}

function setShot(name) {
    if (name !== 'free') robot.show(name);
}

// ---------- UI ----------
ui.play.addEventListener('click', togglePlay);
ui.seek.addEventListener('input', () => {
    if (!current) return;
    setPlaying(false);
    robot.seek(Number(ui.seek.value) * robot.body.getClip().duration);
});
ui.loop.addEventListener('change', () => current && select(current));
ui.speed.addEventListener('input', () => (ui.speedText.textContent = `${Number(ui.speed.value).toFixed(1)}×`));
ui.shot.addEventListener('change', () => { setShot(ui.shot.value); ui.shot.blur(); });
$('hatchOpen').addEventListener('click', () => robot.hatch(true));
$('hatchClose').addEventListener('click', () => robot.hatch(false));

addEventListener('keydown', (e) => {
    if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    const i = KEYS.indexOf(e.key);
    const names = bodyClips();
    if (i >= 0 && names[i]) select(names[i]);
    else if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowLeft') step(-1);
    else if (e.code === 'ArrowRight') step(1);
    else if (e.code === 'KeyO') robot.hatch(true);
    else if (e.code === 'KeyC') robot.hatch(false);
    else if (e.code === 'KeyL') { ui.loop.checked = !ui.loop.checked; current && select(current); }
});

const bodyClips = () => robot.clipNames.filter((n) => !HATCH_CLIPS.includes(n));

// ---------- 毎フレーム ----------
let last = performance.now();
function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    robot.update(playing ? dt * Number(ui.speed.value) : 0);

    const useFree = ui.shot.value === 'free';
    controls.enabled = useFree;
    if (useFree) controls.update();
    renderer.render(scene, useFree ? freeCamera : robot.camera);

    if (current) {
        const a = robot.body, d = a.getClip().duration;
        if (playing) ui.seek.value = a.time / d;
        // 再生が最後まで行ったら（1回再生のとき）ボタンを ▶ に戻す
        if (playing && !ui.loop.checked && a.time >= d - 1e-3) setPlaying(false);
        const f = Math.round(a.time * FPS) + 1;   // xlsx と同じく 1 から数える
        ui.time.textContent = `${a.time.toFixed(2)} / ${d.toFixed(2)} 秒　F ${f} / ${Math.round(d * FPS) + 1}`;
    }
    requestAnimationFrame(frame);
}

// ---------- 起動 ----------
try {
    await robot.load(renderer);
    robot.show('title');   // 表示する（カメラは「自由」のまま）
    ui.clips.innerHTML = bodyClips()
        .map((n, i) => `<button data-clip="${n}">${n}<kbd>${KEYS[i] ?? ''}</kbd></button>`)
        .join('');
    for (const b of ui.clips.querySelectorAll('button')) b.addEventListener('click', () => select(b.dataset.clip));
    select(bodyClips().includes('Stand') ? 'Stand' : bodyClips()[0]);
} catch (err) {
    console.error(err);
    ui.clips.textContent = 'モデルを読み込めませんでした';
}
requestAnimationFrame(frame);
