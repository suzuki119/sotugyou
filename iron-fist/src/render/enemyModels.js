// 敵のモデル（Blender で作ったもの）の読み込みと、1体ずつの複製
//   クリップはどれも Stand / Run / Attack / Hit / Defeat（robot_enemy_hit_defeat.xlsx）
//   敵の object の原点＝当たり判定の中心。モデルはその中で、足元（ドローンは真ん中）が合うようにずらして置く

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// size：大きさ（m）。height＝高さをそろえる / width＝横幅をそろえる
// center：当たり判定の中心の高さ（モデルの高さに対する割合）
const DEFS = {
    walker: { url: '/models/robot_teki.glb', height: 5.5, center: 0.5 },    // 雑魚1：6本脚
    drone: { url: '/models/robot_teki2.glb', width: 4.5, center: 0.5 },     // 雑魚2：ドローン
    boss: { url: '/models/robot_boss.glb', height: 16, center: 0.45 },      // ボス
};

const templates = {};   // kind → { model, clips, scale, offset, height }

// すべて読み込む。読み込めなかった種類は、敵の側で仮の形（箱など）を使う
export async function loadEnemyModels() {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(DEFS).map(async ([kind, def]) => {
        try {
            const gltf = await loader.loadAsync(def.url);
            const model = gltf.scene;
            model.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const scale = def.height ? def.height / size.y : def.width / Math.max(size.x, size.z);
            const height = size.y * scale;
            templates[kind] = {
                model,
                clips: Object.fromEntries(gltf.animations.map((c) => [c.name, c])),
                scale,
                // モデルの足元の中心を原点に → 当たり判定の中心の分だけ下げる
                inner: new THREE.Vector3(-center.x, -box.min.y, -center.z),
                lift: height * def.center,
                height,
            };
        } catch (err) {
            console.error(`敵のモデルを読み込めませんでした（${def.url}）`, err);
        }
    }));
}

export function hasEnemyModel(kind) {
    return !!templates[kind];
}

// 1体分のモデル：アニメーションと被弾時の点滅
export class EnemyRig {
    constructor(kind) {
        const t = templates[kind];
        this.clips = t.clips;
        this.height = t.height;
        this.lift = t.lift;

        const model = t.model.clone(true);
        model.position.copy(t.inner);
        this.object = new THREE.Group();
        this.object.scale.setScalar(t.scale);
        this.object.position.y = -t.lift;
        this.object.add(model);

        // 点滅させるため、マテリアルは1体ずつ別にする（元の発光の色を覚えておく）
        this.materials = [];
        model.traverse((o) => {
            if (!o.isMesh) return;
            o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
            for (const m of [o.material].flat()) {
                if (m.emissive) this.materials.push({ m, color: m.emissive.clone(), intensity: m.emissiveIntensity });
            }
        });

        this.mixer = new THREE.AnimationMixer(model);
        this.current = null;
        this.flashing = false;
    }

    duration(name) {
        return this.clips[name]?.duration ?? 0;
    }

    // once：1回だけ再生して最後のポーズで止める
    play(name, { once = false, fade = 0.2 } = {}) {
        const clip = this.clips[name];
        if (!clip) return;
        const next = this.mixer.clipAction(clip);
        next.reset();
        next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        next.clampWhenFinished = once;
        if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
        next.play();
        this.current = next;
    }

    flash(on) {
        if (on === this.flashing) return;
        this.flashing = on;
        for (const e of this.materials) {
            if (on) {
                e.m.emissive.setRGB(1, 1, 1);
                e.m.emissiveIntensity = 0.8;
            } else {
                e.m.emissive.copy(e.color);
                e.m.emissiveIntensity = e.intensity;
            }
        }
    }

    update(dt) {
        this.mixer.update(dt);
    }

    dispose() {
        this.mixer.stopAllAction();
        for (const e of this.materials) e.m.dispose();
    }
}
