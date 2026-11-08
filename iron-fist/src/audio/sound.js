// 効果音と BGM（Web Audio）
//   ファイルは public/music/sound（効果音）と public/music/bgm（BGM）
//   ブラウザは操作があるまで音を出せないので、最初のクリック・キー入力で鳴らし始める
//   音量はすべて CONFIG.sound

import { CONFIG } from '../config.js';

const BASE = `${import.meta.env.BASE_URL}music/`;
const FILES = {
    gun: 'sound/gun.mp3',                     // 自機の銃（1発ごと）
    outOfEnergy: 'sound/out_of_energy.mp3',   // エネルギー切れ（オーバーヒート）
    enemyShot: 'sound/enemy_shot.mp3',        // 敵が撃った
    footstep: 'sound/footstep.mp3',           // 歩いている間（ループ）
    steam: 'sound/steam.mp3',                 // 乗り降りの演出中（ハッチの蒸気）
    tutorial: 'bgm/tutorial.mp3',
    battle: 'bgm/battle.mp3',
    boss: 'bgm/boss.mp3',
};
const BGM_FADE = 1.2;    // BGM を切り替えるときのクロスフェード（秒）
const LOOP_FADE = 0.15;  // ループ音を止めるときのフェード（秒）
const STORAGE_KEY = 'iron-fist:volume';   // スタート画面で変えた音量を、このブラウザに覚えておく

class Sound {
    constructor() {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.buffers = {};
        this.lastPlay = {};
        this.loops = {};     // name → { src, gain, touched }
        this.bgm = null;     // { name, src, gain }
        this.bgmName = null;
        this.bgmDuck = 1;
        this.restoreVolume();
        this.load();
        const unlock = () => { if (this.ctx.state !== 'running') this.ctx.resume(); };
        addEventListener('pointerdown', unlock);
        addEventListener('keydown', unlock);
    }

    async load() {
        await Promise.all(Object.entries(FILES).map(async ([name, path]) => {
            try {
                const res = await fetch(BASE + path);
                this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
            } catch (e) {
                console.warn(`[sound] ${path} を読み込めない`, e);
            }
        }));
        // 読み込みより先に BGM が指定されていたら、ここで鳴らす
        if (this.bgmName && !this.bgm) { const n = this.bgmName; this.bgmName = null; this.playBgm(n); }
    }

    source(name, gainValue, loop = false) {
        const buffer = this.buffers[name];
        if (!buffer) return null;
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = loop;
        const gain = this.ctx.createGain();
        gain.gain.value = gainValue;
        src.connect(gain).connect(this.master);
        return { src, gain };
    }

    // 1回鳴らす。minInterval（秒）：連続で鳴りすぎないよう、前回からこの時間は鳴らさない
    play(name, { volume = 1, rate = 1, minInterval = 0 } = {}) {
        const now = this.ctx.currentTime;
        if (now - (this.lastPlay[name] ?? -Infinity) < minInterval) return;
        const s = this.source(name, volume * (CONFIG.sound.se[name] ?? 1) * CONFIG.sound.seVolume);
        if (!s) return;
        this.lastPlay[name] = now;
        s.src.playbackRate.value = rate;
        s.src.start();
    }

    // ループ音：鳴らしたい間は毎フレーム呼ぶ。呼ばれなくなると update() がフェードアウトして止める
    loop(name, volume = 1, rate = 1) {
        let l = this.loops[name];
        if (!l) {
            const s = this.source(name, 0, true);
            if (!s) return;
            s.src.start();
            l = this.loops[name] = s;
        }
        const v = volume * (CONFIG.sound.se[name] ?? 1) * CONFIG.sound.seVolume;
        l.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
        l.src.playbackRate.value = rate;
        l.touched = true;
    }

    // 毎フレーム呼ぶ：このフレームで loop() されなかったループ音を止める
    update() {
        const now = this.ctx.currentTime;
        for (const [name, l] of Object.entries(this.loops)) {
            if (l.touched) { l.touched = false; continue; }
            l.gain.gain.setTargetAtTime(0, now, LOOP_FADE / 3);
            l.src.stop(now + LOOP_FADE);
            delete this.loops[name];
        }
    }

    // BGM を切り替える（null で止める）。同じ曲なら何もしない
    playBgm(name) {
        if (name === this.bgmName) return;
        this.bgmName = name;
        const now = this.ctx.currentTime;
        if (this.bgm) {
            const old = this.bgm;
            old.gain.gain.cancelScheduledValues(now);
            old.gain.gain.setValueAtTime(old.gain.gain.value, now);
            old.gain.gain.linearRampToValueAtTime(0, now + BGM_FADE);
            old.src.stop(now + BGM_FADE);
            this.bgm = null;
        }
        if (!name) return;
        const s = this.source(name, 0, true);
        if (!s) return;   // まだ読み込み中：load() の最後で鳴らす
        s.gain.gain.setValueAtTime(0, now);
        s.gain.gain.linearRampToValueAtTime(this.bgmVolume, now + BGM_FADE);
        s.src.start();
        this.bgm = { name, ...s };
    }

    // BGM を一時的に小さくする（手を見失って一時停止中など）。1 で元に戻す
    duckBgm(amount) {
        this.bgmDuck = amount;
        if (this.bgm) this.bgm.gain.gain.setTargetAtTime(this.bgmVolume, this.ctx.currentTime, 0.2);
    }

    // kind：'bgm' / 'se'、value：0〜1
    setVolume(kind, value) {
        CONFIG.sound[kind === 'bgm' ? 'bgmVolume' : 'seVolume'] = value;
        if (kind === 'bgm') this.duckBgm(this.bgmDuck);   // 鳴っている BGM にすぐ反映する
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ bgm: CONFIG.sound.bgmVolume, se: CONFIG.sound.seVolume }));
        } catch { /* 保存できなくても、この回のプレイ中は効く */ }
    }

    restoreVolume() {
        try {
            const v = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (typeof v?.bgm === 'number') CONFIG.sound.bgmVolume = v.bgm;
            if (typeof v?.se === 'number') CONFIG.sound.seVolume = v.se;
        } catch { /* 保存がなければ config.js の値のまま */ }
    }

    get bgmVolume() {
        return CONFIG.sound.bgmVolume * this.bgmDuck;
    }
}

export const sound = new Sound();
