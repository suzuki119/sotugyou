// コックピット：カメラの子にして、常に画面手前に見えるようにする（搭乗モードだけ表示）
//   cockpit_view：枠（Screen_Frame）と内装（Cockpit_Interior）。目の位置にカメラが来るように置く
//   stick_controller：画面の左に置く操縦桿。右手（照準）で動かす（くぼみの中で水平に動く。ケーブルは骨に追従）
//   handle_controller：画面の右に置くハンドル。左手（移動）で動かす（握りの部分だけ X 軸で回る）
//   コントローラーのクリップは再生せず、time を直接決めて手の動きを反映する（value 0〜1 → time）
//   モデルが読み込めないときは仮の窓枠（グレーボックス）にする

import * as THREE from 'three';
import { createGLTFLoader } from './gltfLoader.js';

const deg = THREE.MathUtils.degToRad;

// ---- 調整用の値（位置・回転・大きさはここだけで変える） ----
export const COCKPIT = {
    view: {
        url: '/models/cockpit_view_draco.glb',
        eye: new THREE.Vector3(9.57, 11.15, 1.45),   // 一人称の目の位置（three の座標。Blender (9.57, -1.45, 11.15)）
        eyeOffset: new THREE.Vector3(0, 0, 0),       // 目の位置の微調整（カメラ座標：x 右 / y 上 / z 奥が -）
        fov: 70,                                     // 搭乗中のカメラの縦の視野角（度）。共闘モードでは元に戻す
        scaleX: 1.5,                                 // 枠と内装を横に広げる倍率（目の位置を中心に。1 でモデルのまま）
    },
    // 位置はカメラ座標（目からの距離 m）：x 右が + / y 上が + / z 奥が -。回転は度
    stick: {
        url: '/models/stick_controller_draco.glb',
        position: new THREE.Vector3(-0.45, -0.7, -0.65),   // 画面の左
        rotation: { x: 0, y: 0, z: 0 },
        scale: 1,
        // モデルの Stick_L_SlideX に高さ 0.11 が入っていて、スティックが台から浮くので下げる（モデルを直したら 0 に）
        slideYOffset: -0.11,
    },
    handle: {
        url: '/models/handle_controller_draco.glb',
        position: new THREE.Vector3(0.35, -0.6, -0.65),    // 画面の右
        rotation: { x: 0, y: 0, z: 0 },
        scale: 1,
    },
    showDeck: true,         // 操縦桿・ハンドルの台座（Deck_L_* / Deck_R_*）を出す
    buttonPress: 0.4,       // ボタンを押し込む深さ（クリップの何割まで）。1 だと赤ボタンが金色のベゼルより下に沈んで見えなくなる
    handleRange: deg(60),   // 前進・後退いっぱいのときのハンドルの回転角
    follow: 12,             // ローパスの強さ（大きいほど手に速く追いつく。小さいほどなめらか）
    showGuns: false,        // 仮の銃身（撃つと下がる円柱）を出す
    // 乗り降りの演出：前の枠（Screen_Frame）は上の辺を軸に、奥へ跳ね上がって開く
    openAngle: deg(110),
};

const CLIP_START = 1 / 24;   // Blender から書き出したクリップは 1 フレーム目（1/24 秒）から始まる

// 状態の色（グリップ中＝水色 / 撃っている＝赤 / 握っていない＝黄 / 手が見えない＝灰）
const stateColor = (tracked, grip, fire) => (!tracked ? 0x666666 : fire ? 0xff3030 : grip ? 0x4dd0ff : 0xffc000);

// 中立の値（手が見えないときはここに戻す）。handle だけ -1〜1、ほかは 0〜1
const NEUTRAL = { stickX: 0.5, stickY: 0.5, handle: 0, button: 0 };

export class Cockpit {
    constructor(camera) {
        this.camera = camera;
        this.baseFov = camera.fov;
        this.group = new THREE.Group();
        camera.add(this.group);
        this.value = { ...NEUTRAL };   // コントローラーの今の値（ローパス後）
        this.override = null;          // デバッグ用：値を直接決める（null なら手の入力）
        this.view = null;
        this.framePivot = null;        // 前の枠を開くときの軸（枠の上の辺）
        this.materials = [];           // フェード用（コックピットの材質すべて）
        this.stick = null;
        this.handle = null;

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

    // envMap：金属の映り込み用（なくてもよい。材質の色・明るさそのものは変えない）
    async load(envMap = null) {
        const loader = createGLTFLoader();
        const [view, stick, handle] = await Promise.all(
            [COCKPIT.view.url, COCKPIT.stick.url, COCKPIT.handle.url].map((url) => loader.loadAsync(url).catch((err) => {
                console.error(`コックピットのモデルを読み込めませんでした: ${url}`, err);
                return null;
            })),
        );
        const prepare = (root) => root.traverse((o) => {
            if (!o.isMesh) return;
            o.frustumCulled = false;
            for (const m of [o.material].flat()) {
                if (envMap && m.isMeshStandardMaterial && !m.envMap) m.envMap = envMap;
            }
        });

        if (view) {
            prepare(view.scene);
            this.view = this.setupView(view.scene);
            this.placeholder.visible = false;
        }
        if (stick) {
            prepare(stick.scene);
            this.stick = this.setupController(stick, COCKPIT.stick, {
                clips: { x: 'Stick_X', y: 'Stick_Y', button: 'Stick_Button', thumb: 'Stick_ThumbBtn' },
                deck: 'Deck_L_Root', lights: ['Stick_L_LightBand'],
            });
            // 本体から離れて浮いて見える部品（ケーブルの留め具の予備）は隠す。読み込むと名前の「.」は消える
            const stray = stick.scene.getObjectByName('Stick_L_Root001');
            if (stray) stray.visible = false;
        }
        if (handle) {
            prepare(handle.scene);
            this.handle = this.setupController(handle, COCKPIT.handle, {
                clips: { twist: 'Handle_Twist' }, deck: 'Deck_R_Root', lights: ['Handle_R_CyanRing'],
            });
        }
        this.setDeckVisible(COCKPIT.showDeck);
        this.applyLayout();
        const seen = new Set();
        this.group.traverse((o) => {
            if (o.isMesh) for (const m of [o.material].flat()) seen.add(m);
        });
        this.materials = [...seen];
    }

    // 枠と内装：中心を原点に移してから、目の位置がカメラ（原点）に来るように置く。視線は +Z なので 180° 回す
    setupView(model) {
        const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
        model.position.sub(center);
        const centered = new THREE.Group();   // 中心が原点
        centered.add(model);
        // 前の枠を、上の辺（の手前と奥の真ん中）を軸に回せるようにする
        let frame = null;
        model.traverse((o) => { if (!frame && o.name.startsWith('Screen_Frame')) frame = o; });
        if (frame) {
            centered.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(frame);
            const pivot = new THREE.Group();
            pivot.position.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
            centered.add(pivot);
            pivot.updateMatrixWorld(true);
            pivot.attach(frame);
            this.framePivot = pivot;
        }
        const holder = new THREE.Group();     // 目の位置が原点・正面が -Z（カメラの向き）
        holder.rotation.y = Math.PI;
        holder.add(centered);
        this.group.add(holder);
        return { holder, centered, center };
    }

    // コントローラーを置いて、クリップを「time を直接決める」ために止めておく
    setupController(gltf, cfg, { clips, deck, lights }) {
        const holder = new THREE.Group();
        holder.add(gltf.scene);
        this.group.add(holder);

        const mixer = new THREE.AnimationMixer(gltf.scene);
        const actions = {};
        Object.entries(clips).forEach(([key, name], i) => {
            const clip = gltf.animations.find((c) => c.name === name);
            if (!clip) { console.warn(`クリップがありません: ${name}`); return; }
            // 同じ骨（ケーブル）を複数のクリップが動かすと、普通に重ねると平均されて半分しか動かない。
            // 最初のクリップだけ普通に、残りは「静止の姿勢（最初のフレーム）からの差分」として足す
            const additive = i > 0;
            if (additive) THREE.AnimationUtils.makeClipAdditive(clip);
            const a = mixer.clipAction(clip);
            if (additive) a.blendMode = THREE.AdditiveAnimationBlendMode;
            a.play();
            a.paused = true;   // 再生はしない
            actions[key] = { a, duration: clip.duration };
        });
        // 状態の色を出す光る部品は、自分の材質を持たせる（ほかの部品の色は変えない）
        const lightMats = [];
        for (const name of lights) {
            gltf.scene.getObjectByName(name)?.traverse((o) => {
                if (!o.isMesh || !o.material.emissive) return;
                o.material = o.material.clone();
                lightMats.push(o.material);
            });
        }
        // 操縦桿の高さの補正：アニメーションで動く Stick_L_SlideY と親のあいだに、補正用のグループをはさむ
        //   （アニメーションで動くノードを直接ずらすと、値が変わらないフレームは書き戻されず、ずれがたまっていく）
        let lift = null;
        const slideY = gltf.scene.getObjectByName('Stick_L_SlideY');
        if (slideY?.parent) {
            lift = new THREE.Group();
            slideY.parent.add(lift);
            lift.add(slideY);
        }
        return { holder, cfg, mixer, actions, deck: gltf.scene.getObjectByName(deck), lightMats, lift };
    }

    // COCKPIT の位置・回転・大きさを反映する（デバッグで値を変えたときも呼ぶ）
    applyLayout() {
        if (this.view) {
            const { holder, centered, center } = this.view;
            // holder の中で、目の位置（中心からのずれ）が原点に来るように
            centered.position.copy(center).sub(COCKPIT.view.eye);
            holder.position.copy(COCKPIT.view.eyeOffset).negate();
            holder.scale.set(COCKPIT.view.scaleX, 1, 1);
        }
        for (const c of [this.stick, this.handle]) {
            if (!c) continue;
            c.holder.position.copy(c.cfg.position);
            c.holder.rotation.set(deg(c.cfg.rotation.x), deg(c.cfg.rotation.y), deg(c.cfg.rotation.z));
            c.holder.scale.setScalar(c.cfg.scale);
            if (c.lift) c.lift.position.y = c.cfg.slideYOffset ?? 0;
        }
        for (const g of this.guns) g.visible = COCKPIT.showGuns;
    }

    // 前の枠を開く・閉じる（0＝閉じている / 1＝開ききっている）。乗り降りの演出から毎フレーム呼ぶ
    setOpen(t) {
        if (!this.framePivot) return;
        // モデルの中では視線が +Z。下の辺が奥（+Z）へ、そして上へ跳ね上がる向きに回す
        this.framePivot.rotation.x = -THREE.MathUtils.clamp(t, 0, 1) * COCKPIT.openAngle;
    }

    // コックピット全体（内装・操縦桿・ハンドル）を薄くする（1＝そのまま / 0＝見えない）。乗り降りで急に消えないように
    setFade(a) {
        const fading = a < 1;
        for (const m of this.materials) {
            if (m.transparent !== fading) { m.transparent = fading; m.needsUpdate = true; }
            m.opacity = a;
        }
    }

    setDeckVisible(on) {
        COCKPIT.showDeck = on;
        for (const c of [this.stick, this.handle]) if (c?.deck) c.deck.visible = on;
    }

    // 手の入力 → コントローラーの目標値。握っていない・見えないときは中立
    target(input) {
        if (this.override) return this.override;
        const left = input.leftTracked && input.leftGrip;
        const right = input.rightTracked && input.rightGrip;
        return {
            // 右手：操縦桿（照準）。照準を下げる＝奥へ（操縦桿方式）
            stickX: right ? (input.aimX + 1) / 2 : NEUTRAL.stickX,      // 照準を右へ＝右へ
            stickY: right ? (1 - input.aimY) / 2 : NEUTRAL.stickY,      // 照準を下へ＝奥へ
            button: right && input.fire ? 1 : NEUTRAL.button,           // 撃っている（右手の親指）＝2つのボタンを押し込む
            // 左手：ハンドル（移動）。前進＝握りの上側が奥へ（アクセルを回す向き）
            handle: left ? -input.moveY : NEUTRAL.handle,
        };
    }

    // 入力に合わせてコントローラーを動かす（毎フレーム）
    updateStick(input, dt = 1 / 60) {
        const k = 1 - Math.exp(-COCKPIT.follow * dt);
        const t = this.target(input);
        const v = this.value;
        for (const key of Object.keys(v)) v[key] += (t[key] - v[key]) * k;

        // value 0〜1 → クリップの時刻（1/24 秒〜終わり）
        const seek = (c, value) => {
            if (!c) return;
            c.a.time = CLIP_START + THREE.MathUtils.clamp(value, 0, 1) * (c.duration - CLIP_START);
        };
        if (this.stick) {
            const a = this.stick.actions;
            seek(a.x, v.stickX);
            seek(a.y, v.stickY);
            seek(a.button, v.button * COCKPIT.buttonPress);
            seek(a.thumb, v.button * COCKPIT.buttonPress);
            this.stick.mixer.update(0);
            this.setLights(this.stick, stateColor(input.rightTracked, input.rightGrip, input.fire));
        }
        if (this.handle) {
            // Handle_Twist は 1 周（0→2π）。0 が中立なので、角度を 0〜1 に折り返す（マイナスは 1 周の終わり側）
            const angle = v.handle * COCKPIT.handleRange;
            seek(this.handle.actions.twist, THREE.MathUtils.euclideanModulo(angle / (Math.PI * 2), 1));
            this.handle.mixer.update(0);
            this.setLights(this.handle, stateColor(input.leftTracked, input.leftGrip, false));
        }
    }

    setLights(c, hex) {
        for (const m of c.lightMats) m.emissive.setHex(hex);
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
        // 搭乗中（コックピットが見えている）だけ視野角を変える
        const fov = this.group.visible ? COCKPIT.view.fov : this.baseFov;
        if (this.camera.fov !== fov) {
            this.camera.fov = fov;
            this.camera.updateProjectionMatrix();
        }
    }
}

// 銃口の位置（カメラ座標）
export const MUZZLES = [new THREE.Vector3(-0.9, -0.7, -2.8), new THREE.Vector3(0.9, -0.7, -2.8)];
