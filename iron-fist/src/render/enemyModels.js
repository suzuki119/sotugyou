// 敵のモデル（Blender で作ったもの）の読み込みと、1体ずつの複製
//   クリップはどれも Stand / Run / Attack / Hit / Defeat（robot_enemy_hit_defeat.xlsx）
//   敵の object の原点＝当たり判定の中心。モデルはその中で、足元（ドローンは真ん中）が合うようにずらして置く

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

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

        const model = cloneSkinned(t.model);   // 骨も複製する（通常の clone だと骨が共有され、全員が同じ動きになる）
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

        this.model = model;
        this.scale = t.scale;
        this.outlines = null;
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

    // 輪郭：裏面だけを、法線方向に少しふくらませて塗った複製を重ねる（的など、目立たせたい敵用）
    //   width は世界での太さ（m）
    setOutline(on, { color = 0xffd600, width = 0.3 } = {}) {
        if (on && !this.outlines) {
            const local = width / this.scale;   // モデルの座標での太さ
            const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
            material.onBeforeCompile = (shader) => {
                shader.vertexShader = shader.vertexShader.replace(
                    '#include <skinning_vertex>',
                    `#include <skinning_vertex>\n transformed += normalize(normal) * ${local.toFixed(5)};`,
                );
            };
            this.outlineMaterial = material;
            this.outlines = [];
            const meshes = [];
            this.model.traverse((o) => { if (o.isMesh) meshes.push(o); });
            for (const m of meshes) {
                let hull;
                if (m.isSkinnedMesh) {
                    hull = new THREE.SkinnedMesh(m.geometry, material);
                    hull.bind(m.skeleton, m.bindMatrix);
                } else {
                    hull = new THREE.Mesh(m.geometry, material);
                }
                hull.position.copy(m.position);
                hull.quaternion.copy(m.quaternion);
                hull.scale.copy(m.scale);
                hull.frustumCulled = false;
                m.parent.add(hull);
                this.outlines.push(hull);
            }
        }
        for (const h of this.outlines ?? []) h.visible = on;
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
        this.outlineMaterial?.dispose();
    }
}
