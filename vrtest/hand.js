// 手の形の判定
// sample/sketch.js と同じ考え方・同じしきい値

const INDEX_BEND = 90;       // 人差し指の曲がりの許容（度）
const THUMB_BEND = 120;      // 親指の曲がりの許容（度）
const GUN_ANGLE = [30, 160]; // 構えとみなす、親指と人差し指の間の角度（度）
const THUMB_IN = 0.9;        // 親指を倒したとみなす距離（手のひらの長さに対する割合）

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const dist = (a, b) => len(sub(a, b));
const angle = (u, v) => Math.acos(Math.min(1, Math.max(-1,
    (u.x * v.x + u.y * v.y + u.z * v.z) / (len(u) * len(v) || 1)))) * 180 / Math.PI;

// p は worldLandmarks（メートル単位の3D座標）
export function judgePose(p) {
    const angleBetween = (a, b, c, d) => angle(sub(p[b], p[a]), sub(p[d], p[c]));
    const bend = (mcp, pip, tip) => angleBetween(mcp, pip, pip, tip);
    const isFolded = (pip, tip) => dist(p[tip], p[0]) < dist(p[pip], p[0]) * 1.15;

    const palm = dist(p[0], p[9]);
    const indexBend = bend(5, 6, 8);
    const indexUp = indexBend < INDEX_BEND && dist(p[8], p[0]) > dist(p[6], p[0]);
    const grip = indexUp && [isFolded(10, 12), isFolded(14, 16), isFolded(18, 20)].filter(Boolean).length >= 2;
    const thumbAngle = angleBetween(2, 4, 5, 8);
    const thumbToIndex = Math.min(dist(p[4], p[5]), dist(p[4], p[6]));
    const thumbOut = bend(2, 3, 4) < THUMB_BEND && thumbToIndex > palm * 0.4;
    const thumbIn = thumbToIndex < palm * THUMB_IN || thumbAngle < GUN_ANGLE[0];
    const gun = grip && thumbOut && thumbAngle > GUN_ANGLE[0] && thumbAngle < GUN_ANGLE[1];
    const hammer = indexUp && thumbIn && !gun;
    return { grip, gun, hammer, indexBend, thumbAngle };
}

// 人差し指が映像上でどれだけ縮んで見えるか（2D）。
// 「人差し指の長さ ÷ 手のひらの長さ」。指をカメラの奥に向けるほど小さくなる
export function foreshortening(lm) {
    const d2 = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
    return d2(5, 8) / (d2(0, 9) || 1);
}

// 判定結果を表示用の名前と色にする
export function poseLabel(pose) {
    if (pose.gun) return { text: '構え', color: '#FFD600' };
    if (pose.hammer) return { text: '発射', color: '#FF4040' };
    if (pose.grip) return { text: 'グリップ', color: '#4DD0FF' };
    return { text: '', color: '#FFFFFF' };
}
