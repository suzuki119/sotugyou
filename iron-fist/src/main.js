// 全体の流れ（仕様書 11. ゲーム状態）をつなぐ

import './style.css';
import { CONFIG } from './config.js';
import { startCamera, CameraError } from './camera/cameraManager.js';
import { HandTracker } from './hand/handTracker.js';
import { InputManager } from './input/inputManager.js';
import { DebugKeyboardInput } from './input/debugKeyboardInput.js';
import { GameState, STATE } from './game/gameState.js';
import { GameManager } from './game/gameManager.js';
import { SceneManager } from './render/sceneManager.js';
import { Hud } from './ui/Hud.js';
import { Screens } from './ui/screens.js';
import { drawHands, handStyles } from './ui/handPreview.js';
import { handFrame, averageFrame } from './hand/ballStick.js';

const video = document.getElementById('video');
const keyboard = CONFIG.debug ? new DebugKeyboardInput() : null;
const input = new InputManager(keyboard);
const tracker = new HandTracker();
const state = new GameState();
const sceneManager = new SceneManager(document.getElementById('scene'));
const hud = new Hud(document.getElementById('hud'));
const screens = new Screens(document.getElementById('screen'));
const debugEl = document.getElementById('debug');

let cameraStarted = false;
let calibrated = false;
let resumeTo = null;                 // HAND_LOST から戻る状態
let timer = 0;                       // 各状態で使う経過時間
let samples = [];                    // キャリブレーションの記録
let retryArmed = false;              // リザルトで一度手を離してから、握り続けるとリトライ
let tutorialStep = 0, tutorialProgress = 0;
let result = null;

const game = new GameManager(sceneManager, (event) => {
    if (event === 'boss') setState(STATE.BOSS);
    if (event === 'clear') setState(STATE.CLEAR);
    if (event === 'gameover') setState(STATE.GAME_OVER);
});

// チュートリアルの各ステップ：done(input) が true の間だけ進む
const TUTORIAL = [
    { title: '右手で照準', text: {
        horizontalAuto: '右手を握ったまま左右に動かして、照準を動かそう。上下は自動で敵に合わせてくれる',
        orientationSwitch: '右手を縦にして左右に動かすと照準が左右に、横に寝かせて左右に動かすと上下に動く',
        free: '右手のボールスティックを前後・左右に倒して、照準を動かそう',
    }[CONFIG.aimAxis], done: (i) => Math.hypot(i.aimX, i.aimY) > 0.4 },
    { title: '親指で射撃', text: 'ボールを握ったまま親指を閉じている間、連射できる。親指を離すと止まる', done: (i) => i.fire },
    { title: '左手で移動', text: '左手をグリップしたまま、前後に動かすと前進・後退、左右に動かすと旋回', done: (i) => Math.hypot(i.moveX, i.moveY) > 0.4 },
];

// -----------------------------------------------------------------
//  状態の切り替え
// -----------------------------------------------------------------
function setState(next) {
    state.set(next);
}

const usingKeyboard = () => keyboard?.enabled;

state.onChange((next) => {
    timer = 0;
    hud.show([STATE.TUTORIAL, STATE.READY, STATE.PLAYING, STATE.BOSS, STATE.HAND_LOST].includes(next));

    switch (next) {
        case STATE.START:
            screens.start(() => {
                if (usingKeyboard()) setState(STATE.READY);
                else if (!cameraStarted) setState(STATE.CAMERA_PERMISSION);
                else setState(calibrated ? STATE.READY : STATE.CALIBRATION);
            });
            break;
        case STATE.CAMERA_PERMISSION:
            screens.cameraPermission(requestCamera);
            break;
        case STATE.CALIBRATION:
            samples = [];
            screens.calibration(() => setState(STATE.TUTORIAL));
            break;
        case STATE.TUTORIAL:
            game.reset();
            tutorialStep = 0;
            tutorialProgress = 0;
            showTutorialStep();
            break;
        case STATE.READY:
            game.reset();
            screens.countdown(3);
            break;
        case STATE.PLAYING:
            screens.banner('GO!');
            break;
        case STATE.BOSS:
            screens.banner('WARNING', 'warning');
            break;
        case STATE.HAND_LOST:
            screens.handLost();
            break;
        case STATE.CLEAR:
            result = game.result(true);
            screens.banner('MISSION CLEAR', 'clear');
            break;
        case STATE.GAME_OVER:
            result = game.result(false);
            screens.banner('GAME OVER', 'over');
            break;
        case STATE.RESULT:
            retryArmed = false;
            screens.result(result, {
                retry: () => setState(STATE.READY),            // 同じ人が続けて遊ぶのでキャリブレーションは省略
                title: () => setState(STATE.START),
            });
            break;
    }
});

function showTutorialStep() {
    screens.tutorial(tutorialStep, TUTORIAL, () => setState(STATE.READY));
}

async function requestCamera() {
    screens.loading('カメラを起動中…');
    try {
        await startCamera(video);
    } catch (err) {
        screens.cameraPermission(requestCamera, err instanceof CameraError ? err.message : String(err));
        return;
    }
    cameraStarted = true;
    tracker.start(video, (hands, now) => {
        input.onHands(hands, video.videoWidth / video.videoHeight, now);
    });
    setState(STATE.CALIBRATION);
}

// -----------------------------------------------------------------
//  毎フレームの処理
// -----------------------------------------------------------------
let last = performance.now();
let frames = [];

function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    timer += dt;
    const i = input.get();

    switch (state.current) {
        case STATE.CALIBRATION: updateCalibration(i); break;
        case STATE.TUTORIAL: updateTutorial(i, dt); break;
        case STATE.READY:
            game.update(dt, i, 'practice');
            if (Math.ceil(3 - timer) !== Math.ceil(3 - timer + dt) && timer < 3) screens.countdown(Math.ceil(3 - timer));
            if (timer >= 3) setState(STATE.PLAYING);
            break;
        case STATE.PLAYING:
        case STATE.BOSS:
            if (!screens.root.hidden && timer > (state.is(STATE.BOSS) ? 2 : 0.6)) screens.hide();
            if (input.lostFor(now) > CONFIG.handLostPauseMs) {
                resumeTo = state.current;
                setState(STATE.HAND_LOST);
                break;
            }
            game.update(dt, i, 'play');
            break;
        case STATE.HAND_LOST:
            if (i.leftTracked && i.rightTracked && i.leftGrip && i.rightGrip) setState(resumeTo);
            break;
        case STATE.CLEAR:
        case STATE.GAME_OVER:
            if (timer > 2.5) setState(STATE.RESULT);
            break;
        case STATE.RESULT:
            updateRetryGesture(i);
            break;
    }

    if (!hud.root.hidden) {
        hud.update(i, game, hudLabel());
        updateBones(i);
    }
    sceneManager.render();
    if (CONFIG.debug) updateDebug(now);
    requestAnimationFrame(frame);
}

function updateCalibration(i) {
    if (usingKeyboard()) return setState(STATE.TUTORIAL);
    const { left, right } = input.hands;
    if (i.leftGrip && i.rightGrip) {
        samples.push({ left: { ...left }, right: { ...right } });
    } else {
        samples = [];   // 途中で崩れたらやり直し
        timer = 0;
    }
    const progress = Math.min(1, (timer * 1000) / CONFIG.calibrationMs);

    screens.updateCalibration(i, progress, input.metrics);
    const canvas = screens.$('.preview');
    if (canvas) drawHands(canvas, input.hands, handStyles(i, input.orient));

    if (progress >= 1) {
        const avg = (side, key) => samples.reduce((s, x) => s + x[side][key], 0) / samples.length;
        const base = {};
        for (const side of ['left', 'right']) base[side] = { x: avg(side, 'x'), y: avg(side, 'y'), size: avg(side, 'size') };
        base.right.frame = averageFrame(samples.map((x) => handFrame(x.right.world)));   // ボールスティックの基準の傾き
        input.setBase(base);
        calibrated = true;
        setState(STATE.TUTORIAL);
    }
}

function updateTutorial(i, dt) {
    game.update(dt, i, 'practice');
    if (TUTORIAL[tutorialStep].done(i)) tutorialProgress += dt / 1.2;
    screens.updateTutorial(Math.min(1, tutorialProgress));
    if (tutorialProgress >= 1) {
        tutorialStep += 1;
        tutorialProgress = 0;
        if (tutorialStep >= TUTORIAL.length) setState(STATE.READY);
        else showTutorialStep();
    }
}

// リザルトで両手をグリップし続けるとリトライ（マウスに触らず次の人へ回せるように）
function updateRetryGesture(i) {
    if (usingKeyboard()) return;
    if (!(i.leftGrip && i.rightGrip)) {
        retryArmed = true;
        timer = 0;
    }
    if (!retryArmed) return;
    const progress = Math.min(1, timer / 2);
    screens.updateRetry(progress);
    if (progress >= 1) setState(STATE.READY);
}

// 手の骨格の表示（仮）：認識のされ方を見ながら遊べるように
let showBones = CONFIG.showBones;
addEventListener('keydown', (e) => { if (e.code === 'KeyH') showBones = !showBones; });

function updateBones(i) {
    const { bones, bonesCanvas, bonesInfo } = hud.el;
    bones.hidden = !showBones || usingKeyboard();
    if (bones.hidden) return;
    drawHands(bonesCanvas, input.hands, handStyles(i, input.orient), input.base);
    const m = input.metrics.right;
    const axis = {
        horizontalAuto: '照準：左右のみ（上下は自動）',
        orientationSwitch: `照準：${input.orient.right === 'vertical' ? '縦 → 左右を操作' : '横 → 上下を操作'}`,
        free: '照準：上下左右',
    }[CONFIG.aimAxis];
    bonesInfo.textContent = `${axis}${m ? `　指 ${m.curl.toFixed(0)}°　親指 ${m.thumb.toFixed(2)}　向き ${m.upright.toFixed(0)}°` : ''}`;
}

function hudLabel() {
    if (state.is(STATE.TUTORIAL)) return 'TUTORIAL';
    if (state.is(STATE.READY)) return 'READY';
    if (game.boss) return 'BOSS BATTLE';
    return `ENEMY ${game.kills} DOWN`;
}

function updateDebug(now) {
    frames.push(now);
    frames = frames.filter((t) => now - t < 1000);
    debugEl.textContent = [
        `描画 ${frames.length} fps`,
        tracker.detectMs !== undefined ? `検出 ${tracker.detectMs.toFixed(0)} ms` : '',
        usingKeyboard() ? '[キーボード操作中]' : '',
        state.current,
    ].filter(Boolean).join('　');
}

// -----------------------------------------------------------------
//  起動
// -----------------------------------------------------------------
screens.loading();
requestAnimationFrame(frame);
try {
    await tracker.init();
    setState(STATE.START);
} catch (err) {
    console.error(err);
    screens.error('読み込みに失敗しました。ページを再読み込みしてください。');
}
