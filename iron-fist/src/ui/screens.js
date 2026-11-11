// 画面（タイトル・カメラ許可・キャリブレーション・チュートリアル・一時停止・リザルト）
//   どれも #screen の中身を差し替えて表示する。ボタンは Enter キーでも押せる

import { CONFIG } from '../config.js';
import { formatTime } from './Hud.js';
import { sound } from '../audio/sound.js';

export class Screens {
    constructor(root) {
        this.root = root;
        this.actions = {};
        addEventListener('keydown', (e) => {
            const action = this.actions[e.key === 'Enter' ? 'Enter' : e.key.toLowerCase()];
            if (action && !e.repeat) action();
        });
    }

    // オペレーター（human）のモニター。カメラ許可・キャリブレーション・チュートリアルはここで案内する
    monitor({ label, face = 'normal', title, text, body = '', skip = false }) {
        return `
            <div class="monitor tutorial">
                <div class="monitor-bar"><i></i>OPERATOR LINK<span>${label}</span></div>
                <div class="monitor-body">
                    <div class="monitor-face"><img src="/human/human_${face}.png" alt=""></div>
                    <div class="monitor-talk">
                        <h2>${title}</h2>
                        <p>${text}</p>
                    </div>
                </div>
                ${body}
                ${skip ? '<button class="monitor-skip" data-action="skip">スキップ <kbd>Enter</kbd></button>' : ''}
            </div>`;
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
                <div class="volume">
                    ${volumeSlider('bgm', 'BGM', CONFIG.sound.bgmVolume)}
                    ${volumeSlider('se', '効果音', CONFIG.sound.seVolume)}
                </div>
                ${CONFIG.debug ? '<p class="note">開発用：K キーでキーボード操作に切り替え</p>' : ''}
            </div>`, { start: onStart }, { Enter: 'start' });
        for (const input of this.root.querySelectorAll('.volume input')) {
            const out = input.parentElement.querySelector('output');
            input.addEventListener('input', () => {
                const v = input.value / 100;
                out.textContent = input.value;
                sound.setVolume(input.dataset.kind, v);
            });
            // 効果音は、つまみを離したときに試しに鳴らして大きさを確かめられるようにする
            if (input.dataset.kind === 'se') input.addEventListener('change', () => sound.play('gun'));
        }
    }

    cameraPermission(onAllow, error) {
        this.show(this.monitor({
            label: 'CAMERA',
            face: error ? 'angly' : 'normal',
            title: error ? 'カメラが使えません…' : 'カメラを使いますね！',
            text: error
                ? error
                : 'IRON-FISTにようこそ！私がオペレーターとして、今回貴方をサポートします！この機体はカメラで<strong>あなたの両手の動き</strong>を読み取って操縦します。映像はこのパソコンの中だけで処理し、保存も送信もせず。ゲーム中、映像は表示されないのでご安心ください。',
            body: `<button class="monitor-main" data-action="allow">${error ? 'もう一度試す' : 'カメラを開始'}</button>`,
        }), { allow: onAllow }, { Enter: 'allow' });
    }

    calibration(onSkip) {
        this.show(this.monitor({
            label: 'CALIBRATION',
            title: '両手で操縦桿を握ってください！',
            text: 'それでは、まず右手は<strong>バイクのハンドル</strong>を上握るように、左手は横から<strong>グリップ</strong>を握るように構えて、動かさずに待ちましょう。左は👍️、右は👊です！',
            body: `
                <canvas class="preview" width="480" height="270"></canvas>
                <div class="hands-check">
                    <span class="check left">左手</span>
                    <span class="check right">右手</span>
                </div>
                <div class="progress"><div class="bar-fill"></div></div>
                <p class="metrics note"></p>`,
        }), { skip: onSkip }, CONFIG.debug ? { s: 'skip' } : {});
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

    // チュートリアル：搭乗モードの表示と同じ右上の、オペレーター画面で説明する
    tutorial(step, steps, onSkip) {
        const s = steps[step];
        this.show(this.monitor({
            label: `STEP ${step + 1} / ${steps.length}`,
            title: s.title,
            text: s.text,
            body: '<div class="progress"><div class="bar-fill"></div></div>',
            skip: true,
        }), { skip: onSkip }, { Enter: 'skip' });
    }

    updateTutorial(progress) {
        const bar = this.$('.progress .bar-fill');
        if (bar) bar.style.width = `${progress * 100}%`;
        const img = this.$('.monitor-face img');
        if (img) img.src = progress > 0 ? '/human/human_good.png' : '/human/human_normal.png';
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
                    ${r.cleared ? '' : '<button data-action="tutorial" class="sub">チュートリアルをもう一度</button>'}
                    <button data-action="title" class="sub">タイトルへ</button>
                </div>
            </div>`, handlers, { Enter: 'retry', r: 'retry', t: 'title', ...(r.cleared ? {} : { c: 'tutorial' }) });
    }

    updateRetry(progress) {
        const bar = this.$('.retry .bar-fill');
        if (bar) bar.style.width = `${progress * 100}%`;
    }
}

// スタート画面の音量スライダー（0〜100）
function volumeSlider(kind, label, value) {
    const v = Math.round(value * 100);
    return `<label class="volume-row"><span>${label}</span>
        <input type="range" min="0" max="100" step="1" value="${v}" data-kind="${kind}">
        <output>${v}</output></label>`;
}
