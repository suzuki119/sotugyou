// glb モデルを扱うときの共通処理（読み込み後の位置合わせ・マテリアルの巡回・クリップ再生）

import * as THREE from 'three';

// モデルの全メッシュに fn(mesh, materials[]) を呼ぶ（material が配列でも1つでも同じに扱える）
export function eachMesh(root, fn) {
    root.traverse((o) => {
        if (o.isMesh) fn(o, [o.material].flat());
    });
}

// 足元の中心を原点に合わせる（Blender 上の位置ずれを消す）。測った箱・中心・大きさを返す
export function measure(model) {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    return {
        box,
        center: box.getCenter(new THREE.Vector3()),
        size: box.getSize(new THREE.Vector3()),
    };
}

// モデルの足元の中心が原点に来るようにずらす量
export function footOffset({ box, center }) {
    return new THREE.Vector3(-center.x, -box.min.y, -center.z);
}

// mixer でクリップを再生し、再生中だった action からクロスフェードする。新しい action を返す
//   once：1回だけ再生して最後のポーズで止める
export function playClip(mixer, clip, current, { once = false, fade = 0.2 } = {}) {
    const next = mixer.clipAction(clip);
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    if (current && current !== next) {
        if (fade > 0) next.crossFadeFrom(current, fade, false);
        else current.stop();
    }
    next.play();
    return next;
}
