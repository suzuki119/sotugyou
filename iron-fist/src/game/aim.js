// 照準：入力で決まる位置（rawAim）に、上下の自動照準とエイムアシストをかけて、画面に出す・撃つ位置（crosshair）を決める

import { CONFIG } from '../config.js';

// 照準マーカーが動ける範囲（画面の端まで行かないよう少し狭める）
const AIM_LIMIT = { x: 0.85, y: 0.8 };
const clamp = (v, m) => Math.max(-m, Math.min(m, v));

export class Aim {
    constructor() {
        this.reset();
    }

    reset() {
        this.rawAim = { x: 0, y: 0 };      // 入力だけで決まる照準の位置
        this.crosshair = { x: 0, y: 0 };   // エイムアシスト後の照準の位置（画面に出す・撃つ）
        this.lock = null;                  // 吸い付いている敵
        this.autoY = 0;
    }

    // 照準を中心に戻す（モード切り替え時）
    recenter() {
        this.rawAim = { x: 0, y: 0 };
    }

    update(dt, input, camera, enemies) {
        const a = CONFIG.aim;
        if (a.control === 'rate') {
            // 倒している間だけ照準が動き、スティックを戻すとその場に止まる
            this.rawAim.x = clamp(this.rawAim.x + input.aimX * a.rateSpeed * dt, AIM_LIMIT.x);
            this.rawAim.y = clamp(this.rawAim.y + input.aimY * a.rateSpeed * dt, AIM_LIMIT.y);
        } else {
            this.rawAim = { x: input.aimX * AIM_LIMIT.x, y: input.aimY * AIM_LIMIT.y };
        }

        // 敵の画面上の位置（後ろにいる敵は除く）
        camera.updateMatrixWorld();
        const aspect = camera.aspect;
        const onScreen = enemies
            .filter((e) => !e.dead)
            .map((e) => ({ e, p: e.position.clone().project(camera) }))
            .filter(({ p }) => p.z <= 1);

        // 上下の自動照準：照準の縦の線に一番近い敵の高さへ、なめらかに合わせる
        if (CONFIG.aimAxis === 'horizontalAuto') {
            let targetY = 0, bestDx = CONFIG.autoVerticalWidth;
            for (const { p } of onScreen) {
                const dx = Math.abs(p.x - this.rawAim.x) * aspect;
                if (dx < bestDx) { bestDx = dx; targetY = clamp(p.y, AIM_LIMIT.y); }
            }
            this.autoY += (targetY - this.autoY) * Math.min(1, dt * 8);
            this.rawAim.y = this.autoY;
        }

        // エイムアシスト：照準の近くにいる一番近い敵に吸い付く
        let best = null, bestD = a.assistRadius;
        for (const o of onScreen) {
            const d = Math.hypot((o.p.x - this.rawAim.x) * aspect, o.p.y - this.rawAim.y);
            if (d < bestD) { best = o; bestD = d; }
        }
        this.lock = best?.e ?? null;
        if (best) {
            const pull = a.assistStrength * (1 - bestD / a.assistRadius * 0.5);
            this.crosshair = {
                x: this.rawAim.x + (best.p.x - this.rawAim.x) * pull,
                y: this.rawAim.y + (best.p.y - this.rawAim.y) * pull,
            };
        } else {
            this.crosshair = { ...this.rawAim };
        }
    }
}
