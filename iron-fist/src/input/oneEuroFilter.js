// One Euro Filter：ゆっくり動かすときは強くなめらかに（ブレを消す）、速く動かすときは弱く（遅れを減らす）
//   https://gery.casiez.net/1euro/

export class OneEuroFilter {
    constructor({ minCutoff, beta, dCutoff = 1 }) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.reset();
    }

    reset() {
        this.x = null;
        this.dx = 0;
        this.t = 0;
    }

    // t は秒
    filter(x, t) {
        if (this.x === null) {
            this.x = x;
            this.t = t;
            return x;
        }
        const dt = Math.max(1e-3, t - this.t);
        const alpha = (cutoff) => { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); };
        this.dx += alpha(this.dCutoff) * ((x - this.x) / dt - this.dx);
        const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
        this.x += alpha(cutoff) * (x - this.x);
        this.t = t;
        return this.x;
    }
}
