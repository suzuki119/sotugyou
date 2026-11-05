// コックピット：カメラの子にして、常に画面手前に見えるようにする（搭乗モードだけ表示）
//   flame.glb：窓枠 / stick_controller.glb：左手の移動スティック / handle_controller.glb：右手の照準ハンドル
//   コントローラーは手の動きに合わせて動かす
//     左スティック：手の左右（moveX）で左右にスライドして傾く、指の傾き（moveY）で前後にスライドして傾く
//     右ハンドル：照準の左右（aimX。右手を左右に動かす）に合わせてハンドルをひねり、左右に振る
//   モデルが読み込めないときは仮の窓枠（グレーボックス）にする

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FRAME_URL = '/models/flame.glb';
const STICK_URL = '/models/stick_controller.glb';
const HANDLE_URL = '/models/handle_controller.glb';

const FRAME_DIST = 1.0;       // 窓枠を置く距離（カメラの前へ）
const FRAME_OVERSCAN = 1.8;   // 窓枠の大きさ（画面にちょうど収まる大きさに対する倍率。大きいほど枠が外に広がる）
// コントローラーの置き場所（カメラ座標。台の中心をここに合わせる）と大きさ
const CONTROLLER = { x: 0.42, y: -0.8, z: -1.05, scale: 1.0, tiltX: 0.35 };
const TWIST_MAX = THREE.MathUtils.degToRad(100);   // ハンドルをひねる最大の角度
const STICK_TILT = { x: THREE.MathUtils.degToRad(15), y: THREE.MathUtils.degToRad(12) };   // スティックを倒す最大の角度（左右・前後）
const SWING_MAX = THREE.MathUtils.degToRad(25);    // ハンドルを左右に振る最大の角度（ひねりだけだと見えにくいので）
const UP = new THREE.Vector3(0, 1, 0);
const swingQ = new THREE.Quaternion();
const FOLLOW = 12;                // コントローラーが手に追いつく速さ（大きいほど速い）

// 状態の色（グリップ中＝水色 / 撃っている＝赤 / 握っていない＝黄 / 手が見えない＝灰）
const stateColor = (tracked, grip, fire) => (!tracked ? 0x666666 : fire ? 0xff3030 : grip ? 0x4dd0ff : 0xffc000);

export class Cockpit {
    constructor(camera) {
        this.camera = camera;
        this.group = new THREE.Group();
        camera.add(this.group);
        this.input = { moveX: 0, moveY: 0, twist: 0 };   // なめらかにした入力
        this.stick = null;
        this.handle = null;
        this.frame = null;

        this.placeholder = this.makePlaceholder();
        this.group.add(this.placeholder);

        // 左右の銃身（撃つと少し下がる）
        const gunMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, metalness: 0.5, roughness: 0.5 });
        this.guns = [-1, 1].map((s) => {
            const g = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.2, 10), gunMat);
            g.rotation.x = Math.PI / 2;
            g.position.set(s * 0.9, -0.7, -2.2);
            this.group.add(g);
            return g;
        });
        this.recoil = [0, 0];
    }

    // 仮の窓枠と計器盤（モデルが読み込めないとき）
    makePlaceholder() {
        const g = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.8 });
        const box = (w, h, d, x, y, z, rz = 0) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            m.position.set(x, y, z);
            m.rotation.z = rz;
            g.add(m);
        };
        box(0.12, 3, 0.1, -1.75, 0, -1.2, -0.25);
        box(0.12, 3, 0.1, 1.75, 0, -1.2, 0.25);
        box(4, 0.12, 0.1, 0, 1.05, -1.2);
        box(4, 0.5, 0.6, 0, -1.05, -1.1);
        return g;
    }

    // envMap：金属の映り込み用（なくてもよい）
    async load(envMap = null) {
        const loader = new GLTFLoader();
        const [frame, stick, handle] = await Promise.all(
            [FRAME_URL, STICK_URL, HANDLE_URL].map((url) => loader.loadAsync(url).catch((err) => {
                console.error(`コックピットのモデルを読み込めませんでした: ${url}`, err);
                return null;
            })),
        );
        const prepare = (root) => root.traverse((o) => {
            if (!o.isMesh) return;
            o.frustumCulled = false;
            for (const m of [o.material].flat()) {
                if (envMap && m.isMeshStandardMaterial) { m.envMap = envMap; m.envMapIntensity = 0.8; }
            }
        });

        if (frame) {
            this.frame = frame.scene;
            prepare(this.frame);
            this.frameSize = new THREE.Box3().setFromObject(this.frame).getSize(new THREE.Vector3());
            this.group.add(this.frame);
            this.placeholder.visible = false;
        }
        if (stick) this.stick = this.setupController(stick, -1, {
            x: 'Stick_X', y: 'Stick_Y', light: ['Stick_L_LightBand', 'Deck_L_Light'],
        });
        if (handle) this.handle = this.setupController(handle, 1, {
            twist: 'Handle_Twist', light: ['Handle_R_CyanRing'],
        });
    }

    // コントローラーを置いて、クリップを「時刻で位置を決める」ために止めておく
    setupController(gltf, side, { x, y, twist, light }) {
        const root = gltf.scene;
        const holder = new THREE.Group();
        // 台の中心を原点に合わせる
        const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
        root.position.sub(new THREE.Vector3(center.x, 0, center.z));
        holder.add(root);
        holder.scale.setScalar(CONTROLLER.scale);
        holder.position.set(side * CONTROLLER.x, CONTROLLER.y, CONTROLLER.z);
        holder.rotation.x = CONTROLLER.tiltX;   // 少し手前に傾けて、上から見下ろす感じに
        this.group.add(holder);

        root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
        const mixer = new THREE.AnimationMixer(root);
        const action = (name) => {
            const clip = gltf.animations.find((c) => c.name === name);
            if (!clip) return null;
            const a = mixer.clipAction(clip);
            a.play();
            a.paused = true;   // 再生はしない。time を直接決める
            return { a, duration: clip.duration };
        };
        // 光る部品は、状態の色を出せるように自分の材質を持たせる
        const lights = [];
        for (const name of light) {
            root.getObjectByName(name)?.traverse((o) => {
                if (!o.isMesh || !o.material.emissive) return;
                o.material = o.material.clone();
                lights.push(o.material);
            });
        }
        const lever = root.getObjectByName('Stick_L_SlideY');   // スティックの握る部分（根元を中心に倒す）
        const grip = root.getObjectByName('Handle_R_Twist');    // ハンドルの握る部分
        // スティックの横に浮いて見える部品（ケーブルの留め具の予備）は隠す
        const stray = root.getObjectByName('Stick_L_Root001');   // 読み込むと名前の「.」は消える
        if (stray) stray.visible = false;
        return { mixer, x: x && action(x), y: y && action(y), twist: twist && action(twist), lights, lever, grip };
    }

    // 入力に合わせてコントローラーを動かす
    updateStick(input, dt = 1 / 60) {
        const k = 1 - Math.exp(-FOLLOW * dt);
        const s = this.input;
        s.moveX += ((input.moveX ?? 0) - s.moveX) * k;
        s.moveY += ((input.moveY ?? 0) - s.moveY) * k;
        s.twist += ((input.aimX ?? 0) - s.twist) * k;

        // クリップの時刻：真ん中が中立。左右（前後）いっぱいで端の時刻
        const seek = (c, v) => {
            if (!c) return;
            c.a.time = (THREE.MathUtils.clamp(v, -1, 1) * 0.5 + 0.5) * c.duration;
        };
        if (this.stick) {
            seek(this.stick.x, s.moveX);
            seek(this.stick.y, s.moveY);   // 前に倒す（前進）＝奥へ
            this.stick.mixer.update(0);
            // スライドだけだと動きが小さく見えにくいので、スティック自体も倒す（右へ＝右に、前進＝奥に）
            if (this.stick.lever) this.stick.lever.rotation.set(-s.moveY * STICK_TILT.y, 0, -s.moveX * STICK_TILT.x);
            this.setLights(this.stick, stateColor(input.leftTracked, input.leftGrip, false));
        }
        if (this.handle) {
            // Handle_Twist は 1 周（0〜duration）。真ん中ではなく 0 が中立なので、角度から時刻を出す
            const c = this.handle.twist;
            if (c) {
                const angle = -s.twist * TWIST_MAX;   // 右へ＝ハンドルの上側が奥へ
                c.a.time = THREE.MathUtils.euclideanModulo(angle / (Math.PI * 2), 1) * c.duration;
            }
            this.handle.mixer.update(0);
            // 握りの先を左右に振る（右へ＝先が奥へ）。クリップで決めたひねりに重ねる
            this.handle.grip?.quaternion.premultiply(swingQ.setFromAxisAngle(UP, s.twist * SWING_MAX));
            this.setLights(this.handle, stateColor(input.rightTracked, input.rightGrip, input.fire));
        }
    }

    setLights(c, hex) {
        for (const m of c.lights) m.emissive.setHex(hex);
    }

    // 左右交互に撃つ
    kick(index) {
        this.recoil[index] = 0.18;
    }

    update(dt) {
        this.guns.forEach((g, i) => {
            this.recoil[i] = Math.max(0, this.recoil[i] - dt * 1.5);
            g.position.z = -2.2 + this.recoil[i];
        });
        this.fitFrame();
    }

    // 窓枠を画面いっぱいに合わせる（画面の縦横比が変わっても枠の外側が見切れるように）
    fitFrame() {
        if (!this.frame) return;
        const cam = this.camera;
        const h = 2 * FRAME_DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
        const w = h * cam.aspect;
        const s = Math.max(h / this.frameSize.y, w / this.frameSize.x) * FRAME_OVERSCAN;
        this.frame.scale.setScalar(s);
        this.frame.position.set(0, 0, -FRAME_DIST - (this.frameSize.z * s) / 2);
    }
}

// 銃口の位置（カメラ座標）
export const MUZZLES = [new THREE.Vector3(-0.9, -0.7, -2.8), new THREE.Vector3(0.9, -0.7, -2.8)];
