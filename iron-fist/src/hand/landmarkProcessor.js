// ランドマークを、ゲームで使う「手の位置・大きさ」に変換する（左右反転・平滑化）

import { CONFIG } from '../config.js';

const PALM = [0, 5, 9, 13, 17];

export class LandmarkProcessor {
    constructor() {
        this.state = { left: null, right: null };
    }

    // aspect＝映像の幅÷高さ（手の大きさを縦横同じ尺度で測るため）
    process(hands, aspect) {
        const out = { left: null, right: null };
        for (const h of hands) {
            if (h.score < CONFIG.minHandScore || out[h.side]) continue;
            const lm = h.landmarks.map(p => ({ x: 1 - p.x, y: p.y, z: p.z }));   // 鏡のように左右反転
            const x = avg(PALM.map(i => lm[i].x));
            const y = avg(PALM.map(i => lm[i].y));
            // 手のひらの大きさ（画面の高さに対する割合）。カメラに近いほど大きい
            //   手首〜中指の付け根だけだと手の傾きで変わりやすいので、手のひらの4辺の平均にする
            const d2 = (a, b) => Math.hypot((lm[a].x - lm[b].x) * aspect, lm[a].y - lm[b].y);
            const size = (d2(0, 9) + d2(5, 17) + d2(0, 5) + d2(0, 17)) / 4;

            const prev = this.state[h.side];
            const k = prev ? CONFIG.smoothing : 0;
            out[h.side] = {
                x: lerp(x, prev?.x, k),
                y: lerp(y, prev?.y, k),
                size: lerp(size, prev?.size, k),
                landmarks: lm,
                world: h.world,
            };
        }
        this.state = out;   // 見失った手は平滑化をリセット
        return out;
    }
}

const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const lerp = (v, prev, k) => (prev === undefined ? v : prev * k + v * (1 - k));
