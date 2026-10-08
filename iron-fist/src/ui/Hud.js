// HUD：カメラ映像を出さない代わりに、手の状態・照準・HP を計器として見せる

import { MAX_HP } from '../game/player.js';

export class Hud {
    constructor(root) {
        root.innerHTML = `
            <div class="crosshair"></div>
            <div class="bones">
                <canvas width="384" height="216"></canvas>
                <div class="bones-info"></div>
            </div>
            <div class="hud-top">
                <div class="hud-label"></div>
                <div class="boss-bar"><div class="bar-fill"></div><span>BOSS</span></div>
            </div>
            <div class="hud-score"></div>
            <div class="hand-panel left">
                <div class="hand-name">左手 ─ 移動</div>
                <div class="hand-state"></div>
                <div class="stick"><div class="stick-dot"></div></div>
            </div>
            <div class="hand-panel right">
                <div class="hand-name">右手 ─ 照準・射撃</div>
                <div class="hand-state"></div>
                <div class="fire-lamp">FIRE</div>
            </div>
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
        };
    }

    show(visible) {
        this.root.hidden = !visible;
    }

    update(input, game, label) {
        const el = this.el;
        const a = game.crosshair;
        el.crosshair.style.left = `${(a.x + 1) * 50}%`;
        el.crosshair.style.top = `${(1 - a.y) * 50}%`;
        el.crosshair.classList.toggle('firing', input.fire);
        el.crosshair.classList.toggle('locked', !!game.lock);

        handState(el.left, el.leftState, input.leftTracked, input.leftGrip);
        handState(el.right, el.rightState, input.rightTracked, input.rightGrip);
        el.stickDot.style.transform = `translate(${input.moveX * 28}px, ${-input.moveY * 28}px)`;
        el.fire.classList.toggle('on', input.fire);

        el.label.textContent = label;
        el.score.textContent = `SCORE ${game.score}　TIME ${formatTime(game.time)}`;
        el.hpFill.style.width = `${(game.player.hp / MAX_HP) * 100}%`;
        el.hpFill.classList.toggle('low', game.player.hp < MAX_HP * 0.3);
        el.bossBar.hidden = !game.boss;
        if (game.boss) el.bossFill.style.width = `${(Math.max(0, game.boss.hp) / game.boss.maxHp) * 100}%`;
        el.flash.style.opacity = game.damageFlash > 0 ? game.damageFlash * 2 : 0;
    }
}

function handState(panel, text, tracked, grip) {
    panel.dataset.state = !tracked ? 'lost' : grip ? 'grip' : 'open';
    text.textContent = !tracked ? '見失い' : grip ? 'グリップ中' : '手を握って';
}

export function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}
