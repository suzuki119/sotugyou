// 弾のモデル（barrett.glb）。自機の弾と敵の弾で色を変える
//   読み込めなければ、これまでの仮の形（箱・球）で遊べる

import * as THREE from 'three';
import { createGLTFLoader } from './gltfLoader.js';

const URL = '/models/barrett.glb';

// 種類ごとの色と大きさ（scale：モデルのままの長さ 3.5 に掛ける倍率）
const KINDS = {
    player: { color: 0x4dd0ff, scale: 0.3 },   // 自機：水色
    enemy: { color: 0xff3b2f, scale: 0.45 },   // 敵：赤
};

let template = null;   // 弾の向き（先端が +Z）と中心をそろえたモデル
const materials = {};

export async function loadBulletModel() {
    try {
        const gltf = await createGLTFLoader().loadAsync(URL);
        const model = gltf.scene;
        // モデルは Y 軸方向に伸びている（先端が +Y）。lookAt で先端が進行方向を向くよう +Z に回す
        const inner = new THREE.Group();
        inner.add(model);
        inner.rotation.x = Math.PI / 2;
        const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
        model.position.sub(center);
        template = new THREE.Group();
        template.add(inner);
        template.traverse((o) => { o.frustumCulled = false; });
    } catch (err) {
        console.error(`弾のモデルを読み込めませんでした: ${URL}`, err);
    }
}

function material(kind) {
    return (materials[kind] ??= new THREE.MeshStandardMaterial({
        color: KINDS[kind].color, emissive: KINDS[kind].color, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.2,
    }));
}

// fallback：モデルがないときに使う形
export function createBullet(kind, fallback) {
    if (!template) return fallback();
    const bullet = template.clone();
    bullet.scale.setScalar(KINDS[kind].scale);
    bullet.traverse((o) => { if (o.isMesh) o.material = material(kind); });
    return bullet;
}
