// 自機ロボット（Blender で作ったモデル）と、それを外から映す演出用カメラ
//   プレイ中はコックピット視点なので出さない。タイトル・搭乗・クリア・ゲームオーバーで使う
//   クリップ：Stand / Walk / Run / Dash / Jump / Punch / Shoot / Mount / Defeat / Victory / HatchOpen / HatchClose

import * as THREE from 'three';
import { createGLTFLoader } from './gltfLoader.js';
import { eachMesh, measure, footOffset, playClip } from './modelUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL_URL = '/models/robot_kansei_coop_anim.glb';
export const HEIGHT = 12;   // 立ったときの高さ（m）。プレイヤーの目の高さ（7m）が胸のあたりになるように

// カメラの置き方：ロボットの正面から見た角度・距離・高さ・注視点の高さ（すべて高さに対する割合）
//   side：注視点を左右にずらす（画面上でロボットを中央からずらし、文字と重ならないようにする）
//   pitch：あれば height の代わりに、この俯角（度）で見下ろす位置にカメラを置く
const SHOTS = {
    title: { angle: 0, dist: 2.1, pitch: 15, look: 0.5, side: 0, orbit: 0 },
    mount: { angle: 0.35, dist: 2.0, height: 0.6, look: 0.4, side: 0, orbit: 0.03 },
    victory: { angle: -0.3, dist: 2.4, height: 0.2, look: 0.65, side: 0, orbit: 0.1 },
    defeat: { angle: 0.7, dist: 2.2, height: 0.55, look: 0.35, side: 0, orbit: 0.05 },
};

const seatBox = new THREE.Box3();

export class RobotModel {
    constructor(scene) {
        this.object = new THREE.Group();   // 位置・向き・大きさはこちらで決める（モデルの正面は +Z）
        this.object.visible = false;
        scene.add(this.object);
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
        this.ready = false;
        this.mixer = null;
        this.clips = {};
        this.shot = SHOTS.title;
        this.orbit = 0;
        this.animateHidden = false;   // true なら見えないときもアニメーションを進める（乗り降りの演出用）
    }

    // コックピットの中の目の位置（ワールド座標）。モデルがなければ胸のあたり
    seatPosition() {
        if (this.cockpitMesh) {
            this.cockpitMesh.updateWorldMatrix(true, true);
            return seatBox.setFromObject(this.cockpitMesh).getCenter(new THREE.Vector3());
        }
        return this.object.position.clone().add(new THREE.Vector3(0, HEIGHT * 0.55, 0));
    }

    // renderer：金属の映り込み用の環境マップを作るのに使う（ステージ全体には影響させない）
    async load(renderer) {
        const gltf = await createGLTFLoader().loadAsync(MODEL_URL);
        const model = gltf.scene;

        // Blender 上の位置がずれているので、足元の中心を原点に合わせて大きさをそろえる
        const m = measure(model);
        model.position.copy(footOffset(m));
        this.object.scale.setScalar(HEIGHT / m.size.y);
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
        eachMesh(model, (o, mats) => {
            o.frustumCulled = false;   // アニメーションで境界の外に出ても消えないように
            for (const m of mats) {
                m.envMap = envMap;
                m.envMapIntensity = 0.8;
            }
        });
        this.object.add(model);

        // コックピット：乗り降りの演出で目線を置く場所（箱の真ん中）
        this.cockpitMesh = model.getObjectByName('M_CO_Cockpit_Root');
        // ハッチは中から閉まるところも見えるように両面にする
        const hatch = model.getObjectByName('M_CO_Cockpit_Hatch');
        if (hatch) {
            eachMesh(hatch, (o, mats) => {
                const doubled = mats.map((m) => Object.assign(m.clone(), { side: THREE.DoubleSide }));
                o.material = doubled.length === 1 ? doubled[0] : doubled;
            });
        }

        this.weapon = model.getObjectByName('Weapon_Root');   // 左腕の銃（共闘モードで弾を出す位置）
        this.mixer = new THREE.AnimationMixer(model);
        for (const clip of gltf.animations) this.clips[clip.name] = clip;
        this.ready = true;
    }

    // 体のクリップ（Stand など）を切り替える。once：1回だけ再生して最後のポーズで止める
    play(name, { once = false, fade = 0.3, then } = {}) {
        if (!this.ready) return;
        const next = playClip(this.mixer, this.clips[name], this.body, { once, fade });
        this.body = next;

        this.mixer.removeEventListener('finished', this.onFinished);
        this.onFinished = (e) => {
            if (e.action === next && then) then();
        };
        if (then) this.mixer.addEventListener('finished', this.onFinished);
    }

    // 再生中の体のクリップを、指定した時刻（秒）のポーズにする（確認画面のシークバー用）
    seek(time) {
        if (!this.body) return;
        this.body.enabled = true;
        this.body.paused = false;
        this.body.time = THREE.MathUtils.clamp(time, 0, this.body.getClip().duration);
        this.mixer.update(0);
    }

    get clipNames() {
        return Object.keys(this.clips);
    }

    // ハッチだけ別に動かす（体のクリップと同時に使える）
    hatch(open) {
        if (!this.ready) return;
        const [show, hide] = open ? ['HatchOpen', 'HatchClose'] : ['HatchClose', 'HatchOpen'];
        this.mixer.clipAction(this.clips[hide]).stop();
        const a = this.mixer.clipAction(this.clips[show]);
        a.reset();
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        a.play();
    }

    // ハッチを閉じた状態に戻す（HatchOpen/Close の効果を消す）
    resetHatch() {
        if (!this.ready) return;
        this.mixer.clipAction(this.clips.HatchOpen).stop();
        this.mixer.clipAction(this.clips.HatchClose).stop();
    }

    // position の場所に、forwardYaw の向き（自機の yaw。-Z が正面）で立たせて、shot のカメラで映す
    show(shotName, position = new THREE.Vector3(), forwardYaw = 0) {
        if (!this.ready) return false;
        this.object.position.copy(position);
        this.object.rotation.y = forwardYaw + Math.PI;   // モデルの正面（+Z）を自機の正面（-Z）に合わせる
        this.object.visible = true;
        this.shot = SHOTS[shotName];
        this.shotName = shotName;
        this.orbit = 0;
        return true;
    }

    // ゲーム中（共闘モード）に置く：position の場所に、yaw（自機と同じ決まり。-Z が正面）の向きで
    place(position, yaw) {
        this.object.position.copy(position);
        this.object.rotation.y = yaw + Math.PI;
    }

    // 銃口の位置（ワールド座標）。モデルがなければ胸のあたり
    muzzle() {
        if (this.weapon) return this.weapon.getWorldPosition(new THREE.Vector3());
        return this.object.position.clone().add(new THREE.Vector3(0, HEIGHT * 0.6, 0));
    }

    hide() {
        this.object.visible = false;
    }

    get visible() {
        return this.object.visible;
    }

    resize(aspect) {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }

    update(dt) {
        if (!this.ready || !(this.object.visible || this.animateHidden)) return;
        this.mixer.update(dt);

        // カメラ：ロボットの正面からゆっくり回り込む
        const s = this.shot;
        this.orbit += dt * s.orbit;
        const a = this.object.rotation.y + s.angle + this.orbit;
        const p = this.object.position;
        const lookY = p.y + HEIGHT * s.look;
        const eyeY = s.pitch === undefined
            ? p.y + HEIGHT * s.height
            : lookY + HEIGHT * s.dist * Math.tan(THREE.MathUtils.degToRad(s.pitch));
        this.camera.position.set(
            p.x + Math.sin(a) * HEIGHT * s.dist,
            eyeY,
            p.z + Math.cos(a) * HEIGHT * s.dist,
        );
        const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
        this.camera.lookAt(p.x + right.x * HEIGHT * s.side, lookY, p.z + right.z * HEIGHT * s.side);
    }
}
