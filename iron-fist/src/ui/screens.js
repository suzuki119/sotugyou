// 画面（タイトル・カメラ許可・キャリブレーション・チュートリアル・一時停止・リザルト）
//   どれも #screen の中身を差し替えて表示する。ボタンは Enter キーでも押せる

import { CONFIG } from '../config.js';
import { formatTime } from './Hud.js';

export class Screens {
    constructor(root) {
        this.root = root;
        this.actions = {};
        addEventListener('keydown', (e) => {
            const action = this.actions[e.key === 'Enter' ? 'Enter' : e.key.toLowerCase()];
            if (action && !e.repeat) action();
        });
    }

    // html を表示し、[data-action] のボタンと keys のキーに処理を結びつける
    show(html, handlers = {}, keys = {}) {
        this.root.innerHTML = html;
        this.root.hidden = !html;
        this.actions = {};
        for (const btn of this.root.querySelectorAll('[data-action]')) {
            btn.addEventListener('click', () => handlers[btn.dataset.action]?.());
        }
        for (const [key, name] of Object.entries(keys)) this.actions[key] = () => handlers[name]?.();
    }

    hide() {
        this.show('');
    }

    $(selector) {
        return this.root.querySelector(selector);
    }

    loading(message = '読み込み中…') {
        this.show(`<div class="panel center"><p>${message}</p></div>`);
    }

    error(message) {
        this.show(`<div class="panel center error"><p>${message}</p></div>`);
    }

    start(onStart) {
        this.show(`
            <div class="title">
                <h1>IRON FIST</h1>
                <p class="subtitle">両手で操縦する、巨大ロボット・シューティング</p>
                <button data-action="start">スタート</button>
                ${CONFIG.debug ? '<p class="note">開発用：K キーでキーボード操作に切り替え</p>' : ''}
            </div>`, { start: onStart }, { Enter: 'start' });
    }

    cameraPermission(onAllow, error) {
        this.show(`
            <div class="panel">
                <h2>カメラを使います</h2>
                <p>このゲームは、カメラで<strong>あなたの両手の動き</strong>を読み取って操縦します。</p>
                <ul>
                    <li>映像はこのパソコンの中だけで処理します</li>
                    <li>映像を保存したり、インターネットに送ったりしません</li>
                    <li>ゲーム中、カメラの映像は表示されません</li>
                </ul>
                ${error ? `<p class="error">${error}</p>` : ''}
                <button data-action="allow">${error ? 'もう一度試す' : 'カメラを開始'}</button>
            </div>`, { allow: onAllow }, { Enter: 'allow' });
    }

    calibration(onSkip) {
        this.show(`
            <div class="panel calib">
                <h2>両手で操縦桿を握ってください</h2>
                <p>右手は<strong>ボールスティック</strong>を上から包むように、左手はグリップを握るように構えて、そのまま動かさずに待ってください</p>
                <canvas class="preview" width="480" height="270"></canvas>
                <div class="hands-check">
                    <span class="check left">左手</span>
                    <span class="check right">右手</span>
                </div>
                <div class="progress"><div class="bar-fill"></div></div>
                <p class="metrics note"></p>
            </div>`, { skip: onSkip }, CONFIG.debug ? { s: 'skip' } : {});
    }

    updateCalibration(input, progress, metrics) {
        for (const side of ['left', 'right']) {
            const el = this.$(`.check.${side}`);
            if (!el) return;
            const tracked = input[`${side}Tracked`], grip = input[`${side}Grip`];
            el.dataset.state = !tracked ? 'lost' : grip ? 'grip' : 'open';
        }
        this.$('.progress .bar-fill').style.width = `${progress * 100}%`;
        // しきい値調整用の値（開発時のみ）
        if (CONFIG.debug) {
            const f = (m) => (m ? `指 ${m.folded}/4・曲がり ${m.curl.toFixed(0)}°・親指 ${m.thumb.toFixed(2)}` : '─');
            this.$('.metrics').textContent = `左 ${f(metrics.left)}　右 ${f(metrics.right)}`;
        }
    }

    tutorial(step, steps, onSkip) {
        const s = steps[step];
        this.show(`
            <div class="tutorial">
                <div class="tutorial-step">STEP ${step + 1} / ${steps.length}</div>
                <h2>${s.title}</h2>
                <p>${s.text}</p>
                <div class="progress"><div class="bar-fill"></div></div>
            </div>`, { skip: onSkip }, { Enter: 'skip' });
    }

    updateTutorial(progress) {
        const bar = this.$('.progress .bar-fill');
        if (bar) bar.style.width = `${progress * 100}%`;
    }

    countdown(n) {
        this.show(`<div class="big">${n}</div>`);
    }

    banner(text, kind = '') {
        this.show(`<div class="big ${kind}">${text}</div>`);
    }

    handLost() {
        this.show(`
            <div class="panel center">
                <h2>一時停止中</h2>
                <p>両手をカメラに映して、グリップを握ると再開します</p>
            </div>`);
    }

    result(r, handlers) {
        this.show(`
            <div class="panel result">
                <h2 class="${r.cleared ? 'clear' : 'over'}">${r.cleared ? 'MISSION CLEAR' : 'GAME OVER'}</h2>
                <dl>
                    <dt>スコア</dt><dd class="score">${r.score}</dd>
                    <dt>タイム</dt><dd>${formatTime(r.time)}</dd>
                    <dt>撃破数</dt><dd>${r.kills}</dd>
                    <dt>残りHP</dt><dd>${r.hp} / ${r.maxHp}</dd>
                </dl>
                <p class="note">両手でグリップを握り続けるとリトライ</p>
                <div class="progress retry"><div class="bar-fill"></div></div>
                <div class="buttons">
                    <button data-action="retry">リトライ</button>
                    <button data-action="title" class="sub">タイトルへ</button>
                </div>
            </div>`, handlers, { Enter: 'retry', r: 'retry', t: 'title' });
    }

    updateRetry(progress) {
        const bar = this.$('.retry .bar-fill');
        if (bar) bar.style.width = `${progress * 100}%`;
    }
}
