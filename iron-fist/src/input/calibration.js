// キャリブレーション：両手を握っている間に集めた記録（samples）の平均から、手の基準位置を作る

import { handFrame, averageFrame, fingerPitch } from '../hand/ballStick.js';

const mean = (samples, fn) => samples.reduce((s, x) => s + fn(x), 0) / samples.length;

// samples：[{ left, right }]（InputManager.hands の記録）。input.setBase() に渡す値を返す
export function computeBase(samples) {
    const base = {};
    for (const side of ['left', 'right']) {
        base[side] = {
            x: mean(samples, (x) => x[side].x),
            y: mean(samples, (x) => x[side].y),
            size: mean(samples, (x) => x[side].size),
        };
    }
    base.right.frame = averageFrame(samples.map((x) => handFrame(x.right.world)));   // ボールスティックの基準の傾き
    base.left.pitch = mean(samples, (x) => fingerPitch(x.left.world));               // 左手の基準の指の向き
    return base;
}
