// 手の形の判定：グリップ（4本指を握る）と親指（立てる / 閉じる）
//   計算は desktoptest/hand.js と同じく worldLandmarks（3D・メートル）で行う
//   しきい値はすべて仮。デバッグ表示の値を見ながら調整する

import { CONFIG } from '../config.js';

const GRIP_ON = 3;          // 4本指のうち何本曲がっていたら「握った」とするか
const GRIP_OFF = 2;         // これを下回ったら「離した」
const THUMB_UP = 0.65;      // 親指の先〜人差し指までの距離（手のひらの長さに対する割合）がこれ以上で「立てた」
const THUMB_DOWN = 0.45;    // これ以下で「閉じた」
const BALL_ON = 35;         // ボールを握ったとみなす、4本指の平均の曲がり（度）
const BALL_OFF = 25;
const UPRIGHT_ON = 55;      // 手の向き：指の付け根の並びが水平からこの角度（度）以上で「縦」
const UPRIGHT_OFF = 35;     // これ以下で「横」

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dist = (a, b) => { const v = sub(a, b); return Math.hypot(v.x, v.y, v.z); };
const angle = (u, v) => Math.acos(Math.min(1, Math.max(-1,
    (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z) || 1)))) * 180 / Math.PI;

export function measure(p) {
    const palm = dist(p[0], p[9]) || 1;
    const isFolded = (pip, tip) => dist(p[tip], p[0]) < dist(p[pip], p[0]) * 1.15;
    const folded = [isFolded(6, 8), isFolded(10, 12), isFolded(14, 16), isFolded(18, 20)].filter(Boolean).length;
    // 親指を閉じると、先が人差し指・中指の関節の近くに来る
    const thumb = Math.min(dist(p[4], p[5]), dist(p[4], p[6]), dist(p[4], p[10])) / palm;
    // ボールを包むように握ると、指は半分だけ曲がる：付け根と第2関節の曲がりの平均
    const bend = (a, b, c) => angle(sub(p[b], p[a]), sub(p[c], p[b]));
    const curl = [[0, 5, 6, 7], [0, 9, 10, 11], [0, 13, 14, 15], [0, 17, 18, 19]]
        .map(([w, m, pip, dip]) => (bend(w, m, pip) + bend(m, pip, dip)) / 2)
        .reduce((s, v) => s + v, 0) / 4;
    // 手の向き：人差し指〜小指の付け根を結ぶ線が、水平からどれだけ立っているか（握手の形＝縦、手の甲が上＝横）
    const s = sub(p[5], p[17]);
    const upright = Math.atan2(Math.abs(s.y), Math.hypot(s.x, s.z)) * 180 / Math.PI;
    return { folded, thumb, curl, upright };
}

export class GestureDetector {
    constructor() {
        this.reset();
    }

    reset() {
        this.grip = { left: false, right: false };
        this.thumbClosed = false;
        this.fire = false;
        this.thumbUpSince = 0;
        this.orient = { left: 'horizontal', right: 'horizontal' };
    }

    // hand は LandmarkProcessor の出力（見失ったら null）
    update(side, hand, now) {
        if (!hand) {
            this.grip[side] = false;
            if (side === 'right') { this.fire = false; this.thumbClosed = false; }
            return { grip: false, fire: false, orient: null, metrics: null };
        }
        const m = measure(hand.world);
        if (m.upright >= UPRIGHT_ON) this.orient[side] = 'vertical';
        else if (m.upright <= UPRIGHT_OFF) this.orient[side] = 'horizontal';
        const orient = this.orient[side];

        // ヒステリシス：ON と OFF の境界を分けて、状態が細かく切り替わらないようにする
        if (side === 'right' && CONFIG.aimMode === 'ballstick') {
            if (m.curl >= BALL_ON) this.grip.right = true;
            else if (m.curl < BALL_OFF) this.grip.right = false;
        } else if (m.folded >= GRIP_ON) this.grip[side] = true;
        else if (m.folded < GRIP_OFF) this.grip[side] = false;

        if (side === 'left') return { grip: this.grip.left, fire: false, orient, metrics: m };

        if (m.thumb <= THUMB_DOWN) this.thumbClosed = true;
        else if (m.thumb >= THUMB_UP) this.thumbClosed = false;

        // 猶予時間：親指が立ってからしばらくは撃ち続ける（一瞬の誤判定で止めない）
        if (!this.grip.right) {
            this.fire = false;
        } else if (this.thumbClosed) {
            this.fire = true;
            this.thumbUpSince = 0;
        } else if (this.fire) {
            this.thumbUpSince ||= now;
            if (now - this.thumbUpSince > CONFIG.thumbGraceMs) this.fire = false;
        }
        return { grip: this.grip.right, fire: this.fire, orient, metrics: m };
    }
}
