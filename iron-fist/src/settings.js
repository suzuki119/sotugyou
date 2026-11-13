// プレイヤーが変えられる設定（このブラウザに覚えておく）。音量は audio/sound.js が持っている
//   酔い止めモード：搭乗中の機体の揺れ（CONFIG.sway）をすべて止める

import { CONFIG } from './config.js';

const STORAGE_KEY = 'iron-fist:comfort';

export const isComfortMode = () => !CONFIG.sway.enabled;

export function setComfortMode(on) {
    CONFIG.sway.enabled = !on;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(!!on));
    } catch { /* 保存できなくても、この回のプレイ中は効く */ }
}

try {
    if (JSON.parse(localStorage.getItem(STORAGE_KEY)) === true) CONFIG.sway.enabled = false;
} catch { /* 保存がなければ config.js の値のまま */ }
