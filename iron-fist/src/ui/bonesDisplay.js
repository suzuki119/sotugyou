// 手の骨格の表示（仮）：認識のされ方を見ながら遊べるように。H キーで出し入れ

import { CONFIG } from '../config.js';
import { drawHands, handStyles } from './handPreview.js';

export function createBonesDisplay({ hud, input, game, isKeyboard }) {
    let showBones = CONFIG.showBones;
    addEventListener('keydown', (e) => { if (e.code === 'KeyH') showBones = !showBones; });

    return function update(i) {
        const { bones, bonesCanvas, bonesInfo } = hud.el;
        bones.hidden = !showBones || isKeyboard();
        if (bones.hidden) return;
        drawHands(bonesCanvas, input.hands, handStyles(i, input.orient), input.base);
        const m = input.metrics.right;
        const axis = {
            horizontalAuto: '照準：左右のみ（上下は自動）',
            orientationSwitch: `照準：${input.orient.right === 'vertical' ? '縦 → 左右を操作' : '横 → 上下を操作'}`,
            free: '照準：上下左右',
        }[CONFIG.aimAxis];
        const depth = !(input.base && input.hands.left) ? ''
            : CONFIG.moveYMode === 'tilt'
                ? `　左手の指の向き ${input.leftTilt().toFixed(0)}°（前後 ${i.moveY.toFixed(2)}）`
                : `　左手の奥行き ${(input.offset('left').depth * 100).toFixed(0)}%（前後 ${i.moveY.toFixed(2)}）`;
        const swing = game.mode === 'coop' ? `　振り ${i.swing.toFixed(1)}` : '';
        bonesInfo.textContent = `${axis}${m ? `　指 ${m.curl.toFixed(0)}°　親指 ${m.thumb.toFixed(2)}` : ''}${depth}${swing}\n`
            + `パー判定　${openInfo('左', input.metrics.left, i.leftOpen)}　${openInfo('右', input.metrics.right, i.rightOpen)}`;
    };
}

// パーの判定に使う値（伸びている指の数・曲がり・親指の開き）。条件を満たしていない値に × を付ける
function openInfo(name, m, open) {
    if (!m) return `${name}：─`;
    const o = CONFIG.modeSwitch;
    const mark = (ok) => (ok ? '' : '×');
    return `${name}${open ? '◎パー' : ''}：伸 ${4 - m.folded}/4${mark(m.folded === 0)}`
        + ` 曲 ${m.curl.toFixed(0)}°${mark(m.curl <= o.maxCurl)} 親 ${m.thumb.toFixed(2)}${mark(m.thumb >= o.minThumb)}`;
}
