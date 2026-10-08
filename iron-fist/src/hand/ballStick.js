// 右手の「見えないボールスティック」：握った手の傾きを、基準の構えからの角度で測る
//   worldLandmarks（3D）の向きだけを使うので、カメラからの距離（手の大きさ）に左右されない
//
//   pitch … 前後に倒す角度（指先が下がる / 上がる）
//   roll  … 左右に倒す角度（手首のひねり）
//   符号は環境で逆になることがあるので、config.js の invert で合わせる

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const DEG = 180 / Math.PI;

// 手の向き：forward＝手首→中指の付け根、side＝小指の付け根→人差し指の付け根
export function handFrame(p) {
    return { forward: norm(sub(p[9], p[0])), side: norm(sub(p[5], p[17])) };
}

// キャリブレーション中の複数フレームの向きを平均する
export function averageFrame(frames) {
    const sum = (key) => norm(frames.reduce((s, f) => ({ x: s.x + f[key].x, y: s.y + f[key].y, z: s.z + f[key].z }), { x: 0, y: 0, z: 0 }));
    return { forward: sum('forward'), side: sum('side') };
}

// 基準の向き base に対する、今の手の傾き（度）
export function measureTilt(p, base) {
    const f = handFrame(p);
    const up = norm(cross(base.forward, base.side));   // 基準の構えでの、手のひらに垂直な向き
    return {
        pitch: Math.atan2(dot(f.forward, up), dot(f.forward, base.forward)) * DEG,
        roll: Math.atan2(dot(f.side, up), dot(f.side, base.side)) * DEG,
    };
}

// 角度の平滑化（位置と同じ考え方）
export class TiltSmoother {
    constructor(k) {
        this.k = k;
        this.prev = null;
    }

    update(t) {
        if (!t) return (this.prev = null);
        const p = this.prev;
        this.prev = p ? { pitch: p.pitch * this.k + t.pitch * (1 - this.k), roll: p.roll * this.k + t.roll * (1 - this.k) } : t;
        return this.prev;
    }
}
