// 手の骨格（ボーン）の表示。カメラ映像そのものは描かない
//   styles: { left: { color, label }, right: { color, label } }
//   base:   キャリブレーションの基準位置（あれば + で描く）

import { HAND_CONNECTIONS } from '../hand/handTracker.js';

export function drawHands(canvas, hands, styles, base = null) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const scale = W / 480;   // 小さい画面でも線や文字の太さをそろえる
    ctx.clearRect(0, 0, W, H);

    for (const side of ['left', 'right']) {
        const style = styles[side];
        // 基準位置
        if (base?.[side]) {
            const bx = base[side].x * W, by = base[side].y * H, r = 10 * scale;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 2 * scale;
            ctx.beginPath();
            ctx.moveTo(bx - r, by); ctx.lineTo(bx + r, by);
            ctx.moveTo(bx, by - r); ctx.lineTo(bx, by + r);
            ctx.stroke();
        }

        const h = hands[side];
        if (!h) continue;
        const pts = h.landmarks.map((p) => ({ x: p.x * W, y: p.y * H }));   // すでに左右反転済み
        ctx.strokeStyle = style.color;
        ctx.fillStyle = style.color;
        ctx.lineWidth = 3 * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
            ctx.moveTo(pts[a].x, pts[a].y);
            ctx.lineTo(pts[b].x, pts[b].y);
        }
        ctx.stroke();
        for (const p of pts) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5 * scale, 0, Math.PI * 2);
            ctx.fill();
        }
        // 手の中心（入力に使っている位置）
        ctx.beginPath();
        ctx.arc(h.x * W, h.y * H, 6 * scale, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = `bold ${16 * scale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4 * scale;
        ctx.strokeStyle = '#000';
        ctx.strokeText(style.label, pts[0].x, pts[0].y + 24 * scale);
        ctx.fillText(style.label, pts[0].x, pts[0].y + 24 * scale);
    }
}

// 手の状態から色とラベルを決める（ゲーム中・キャリブレーション共通）
export function handStyles(input, orient) {
    const o = (side) => (orient?.[side] ? (orient[side] === 'vertical' ? '・縦' : '・横') : '');
    return {
        left: {
            color: input.leftGrip ? '#4DD0FF' : '#FFD600',
            label: `左手 ${input.leftGrip ? '握り' : '開き'}${o('left')}`,
        },
        right: {
            color: input.fire ? '#FF4040' : input.rightGrip ? '#4DD0FF' : '#FFD600',
            label: `右手 ${input.fire ? '射撃' : input.rightGrip ? '握り' : '開き'}${o('right')}`,
        },
    };
}
