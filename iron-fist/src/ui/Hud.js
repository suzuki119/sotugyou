// HUD：カメラ映像を出さない代わりに、手の状態・照準・HP を計器として見せる

import { MAX_HP } from '../game/player.js';
import { CONFIG } from '../config.js';

export class Hud {
    constructor(root) {
        root.innerHTML = `
            <div class="crosshair"></div>
            <div class="bones">
                <canvas width="384" height="216"></canvas>
                <button class="recalibrate">手の基準位置を取り直す</button>
                <div class="bones-info"></div>
            </div>
            <div class="hud-top">
                <div class="hud-label"></div>
                <div class="boss-bar"><div class="bar-fill"></div><span>BOSS</span></div>
            </div>
            <div class="hud-score"></div>
            <div class="mode-badge">
                <div class="mode-name"></div>
                <div class="mode-hint">両手パーで切り替え</div>
                <div class="progress"><div class="bar-fill"></div></div>
            </div>
            <div class="mode-flash"></div>
            <div class="hand-panel left">
                <div class="hand-name"></div>
                <div class="hand-state"></div>
                <div class="stick"><div class="stick-dot"></div></div>
            </div>
            <div class="hand-panel right">
                <div class="hand-name"></div>
                <div class="hand-state"></div>
                <div class="fire-lamp">FIRE</div>
            </div>
            <div class="energy-bar"><span>EN</span><div class="bar-fill"></div><em>OVERHEAT</em></div>
            <div class="hp-bar"><span>HP</span><div class="bar-fill"></div></div>
            <div class="damage-flash"></div>
        `;
        this.root = root;
        const $ = (s) => root.querySelector(s);
        this.el = {
            crosshair: $('.crosshair'),
            label: $('.hud-label'),
            score: $('.hud-score'),
            bossBar: $('.boss-bar'),
            bossFill: $('.boss-bar .bar-fill'),
            hpFill: $('.hp-bar .bar-fill'),
            energyBar: $('.energy-bar'),
            energyFill: $('.energy-bar .bar-fill'),
            left: $('.hand-panel.left'),
            right: $('.hand-panel.right'),
            leftState: $('.hand-panel.left .hand-state'),
            rightState: $('.hand-panel.right .hand-state'),
            stickDot: $('.stick-dot'),
            fire: $('.fire-lamp'),
            flash: $('.damage-flash'),
            bones: $('.bones'),
            bonesCanvas: $('.bones canvas'),
            bonesInfo: $('.bones-info'),
            recalibrate: $('.bones .recalibrate'),
            modeName: $('.mode-name'),
            modeFill: $('.mode-badge .bar-fill'),
            modeFlash: $('.mode-flash'),
            leftName: $('.hand-panel.left .hand-name'),
            rightName: $('.hand-panel.right .hand-name'),
        };
        this.mode = null;
    }

    show(visible) {
        this.root.hidden = !visible;
    }

    // モードが切り替わった瞬間に、画面中央に大きく出す
    modeChanged(mode) {
        const f = this.el.modeFlash;
        this.root.dataset.mode = mode;
        f.textContent = MODES[mode].flash;
        f.classList.remove('show');
        void f.offsetWidth;   // アニメーションを最初から再生し直す
        f.classList.add('show');
    }

    update(input, game, label) {
        const el = this.el;
        const coop = game.mode === 'coop';
        if (this.mode !== game.mode) {
            this.mode = game.mode;
            const m = MODES[game.mode];
            el.modeName.textContent = m.name;
            el.leftName.textContent = m.left;
            el.rightName.textContent = m.right;
            el.fire.textContent = m.fire;
            this.root.dataset.mode = game.mode;
        }
        el.modeFill.style.width = `${game.switchProgress * 100}%`;
        el.crosshair.hidden = coop || game.boarding.running;   // 乗り降りの演出中は照準を出さない
        const a = game.crosshair;
        el.crosshair.style.left = `${(a.x + 1) * 50}%`;
        el.crosshair.style.top = `${(1 - a.y) * 50}%`;
        el.crosshair.classList.toggle('firing', input.fire && !game.weapon.overheat);
        el.crosshair.classList.toggle('locked', !!game.lock);

        handState(el.left, el.leftState, input.leftTracked, input.leftGrip);
        handState(el.right, el.rightState, input.rightTracked, input.rightGrip);
        el.stickDot.style.transform = `translate(${input.moveX * 28}px, ${-input.moveY * 28}px)`;
        const w = game.weapon;
        const shooting = input.fire && !w.overheat;
        el.fire.classList.toggle('on', coop ? game.sword.swingT < 1 : shooting);
        el.energyBar.hidden = coop;
        el.energyFill.style.width = `${(w.energy / CONFIG.energy.max) * 100}%`;
        el.energyBar.classList.toggle('overheat', w.overheat);

        el.label.textContent = label;
        el.score.textContent = `SCORE ${game.score}　TIME ${formatTime(game.time)}`;
        el.hpFill.style.width = `${(game.player.hp / MAX_HP) * 100}%`;
        el.hpFill.classList.toggle('low', game.player.hp < MAX_HP * 0.3);
        el.bossBar.hidden = !game.boss;
        if (game.boss) el.bossFill.style.width = `${(Math.max(0, game.boss.hp) / game.boss.maxHp) * 100}%`;
        el.flash.style.opacity = game.damageFlash > 0 ? game.damageFlash * 2 : 0;
    }
}

const MODES = {
    ride: { name: '搭乗モード', flash: 'RIDE', left: '左手 ─ 移動', right: '右手 ─ 照準・射撃', fire: 'FIRE' },
    coop: { name: '共闘モード', flash: 'CO-OP', left: '左手 ─ 旋回・移動', right: '右手 ─ 剣', fire: 'SLASH' },
};

function handState(panel, text, tracked, grip) {
    panel.dataset.state = !tracked ? 'lost' : grip ? 'grip' : 'open';
    text.textContent = !tracked ? '見失い' : grip ? 'グリップ中' : '手を握って';
}

export function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}
