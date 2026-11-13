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
import { RobotModel } from './render/robotModel.js';
import { loadEnemyModels } from './render/enemyModels.js';
import { loadBulletModel } from './render/bulletModel.js';
import { CockpitDebug } from './render/cockpitDebug.js';
import { Hud } from './ui/Hud.js';
import { Screens } from './ui/screens.js';
import { drawHands, handStyles } from './ui/handPreview.js';
import { TUTORIAL } from './game/tutorialSteps.js';
import { computeBase } from './input/calibration.js';
import { createShowcase } from './render/showcase.js';
import { createBonesDisplay } from './ui/bonesDisplay.js';
import { sound } from './audio/sound.js';

const video = document.getElementById('video');
const keyboard = CONFIG.debug ? new DebugKeyboardInput() : null;
const input = new InputManager(keyboard);
const tracker = new HandTracker();
const state = new GameState();
const sceneManager = new SceneManager(document.getElementById('scene'));
const robot = new RobotModel(sceneManager.scene);
robot.resize(innerWidth / innerHeight);
sceneManager.onResize.push((aspect) => robot.resize(aspect));
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
let resumeGame = false;                  // 一時停止中の取り直し：戦闘の進行を残したまま基準だけ取り直す
let afterCalibration = STATE.TUTORIAL;   // キャリブレーションが終わったら進む先（取り直しは元の状態に戻る）
const IDLE = { aimX: 0, aimY: 0, fire: false, moveX: 0, moveY: 0, leftOpen: false, rightOpen: false, swing: 0, swingX: 0, swingY: 0, handX: 0, handY: 0 };   // 基準を取る前は、操作を受け付けない
let result = null;

// 手の基準位置の取り直し（チュートリアル中・開始前のカウントダウン中・戦闘の一時停止中）。終わったら元の状態に戻る
hud.el.recalibrate.addEventListener('click', () => {
    if (!state.is(STATE.TUTORIAL, STATE.READY, STATE.HAND_LOST)) return;
    resumeGame = state.is(STATE.HAND_LOST);
    afterCalibration = resumeGame ? resumeTo : state.current;
    setState(STATE.CALIBRATION);
});

const game = new GameManager(sceneManager, robot, (event, data) => {
    if (event === 'mode') hud.modeChanged(data);
    if (event === 'boss') setState(STATE.BOSS);
    if (event === 'clear') setState(STATE.CLEAR);
    if (event === 'gameover') setState(STATE.GAME_OVER);
});
if (CONFIG.debug) window.game = game;   // 開発時だけ、ブラウザのコンソールから game を直接触れるようにする
if (CONFIG.debug) new CockpitDebug(game.cockpit);   // C キーでコックピットの値を直接動かす


// -----------------------------------------------------------------
//  状態の切り替え
// -----------------------------------------------------------------
function setState(next) {
    state.set(next);
}

const usingKeyboard = () => keyboard?.enabled;
const updateShowcase = createShowcase({ robot, sceneManager, game });
const updateBones = createBonesDisplay({ hud, input, game, isKeyboard: usingKeyboard });

// 状態ごとの BGM（null は無音）。ここにない状態（HAND_LOST）は今の曲を小さくして続ける
const BGM = {
    [STATE.START]: 'tutorial', [STATE.CAMERA_PERMISSION]: 'tutorial', [STATE.CALIBRATION]: 'tutorial', [STATE.TUTORIAL]: 'tutorial',
    [STATE.READY]: 'battle', [STATE.PLAYING]: 'battle', [STATE.BOSS]: 'boss',
    [STATE.CLEAR]: null, [STATE.GAME_OVER]: null, [STATE.RESULT]: null,
};

state.onChange((next) => {
    timer = 0;
    if (next in BGM) sound.playBgm(BGM[next]);
    sound.duckBgm(next === STATE.HAND_LOST ? 0.35 : 1);
    hud.show([STATE.TUTORIAL, STATE.READY, STATE.PLAYING, STATE.BOSS, STATE.HAND_LOST].includes(next));
    updateShowcase(next);

    switch (next) {
        case STATE.START:
            afterCalibration = STATE.TUTORIAL;
            resumeGame = false;
            screens.start(() => {
                if (usingKeyboard()) setState(STATE.READY);
                else if (!cameraStarted) setState(STATE.CAMERA_PERMISSION);
                else setState(calibrated ? STATE.READY : STATE.CALIBRATION);
            });
            break;
        case STATE.CAMERA_PERMISSION:
            game.reset();   // 戦闘画面（コックピット）の中で案内する
            screens.cameraPermission(requestCamera);
            break;
        case STATE.CALIBRATION:
            if (!resumeGame) game.reset();
            samples = [];
            screens.calibration(() => setState(afterCalibration));
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
                tutorial: () => setState(STATE.TUTORIAL),   // ゲームオーバー時のみ表示。キャリブレーションは省略
                title: () => setState(STATE.START),
            });
            break;
    }
});

function showTutorialStep() {
    TUTORIAL[tutorialStep].enter?.(game);
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
        case STATE.CAMERA_PERMISSION: game.update(dt, IDLE, 'practice'); break;
        case STATE.CALIBRATION:
            if (!resumeGame) game.update(dt, IDLE, 'practice');
            updateCalibration(i);
            break;
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
        hud.el.recalibrate.hidden = !state.is(STATE.TUTORIAL, STATE.READY, STATE.HAND_LOST);
        updateBones(i);
    }
    if (!state.is(STATE.HAND_LOST)) robot.update(dt);
    sceneManager.render();
    sound.update();   // このフレームで鳴らさなかったループ音（足音・蒸気）を止める
    if (CONFIG.debug) updateDebug(now);
    requestAnimationFrame(frame);
}

function updateCalibration(i) {
    if (usingKeyboard()) return setState(afterCalibration);
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
        input.setBase(computeBase(samples));
        calibrated = true;
        resumeGame = false;
        setState(afterCalibration);
    }
}

function updateTutorial(i, dt) {
    game.update(dt, i, 'practice');
    if (TUTORIAL[tutorialStep].done(i, game)) tutorialProgress += dt / 1.2;
    screens.updateTutorial(Math.min(1, tutorialProgress));
    if (tutorialProgress >= 1) {
        TUTORIAL[tutorialStep].leave?.(game);
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

function hudLabel() {
    if (state.is(STATE.TUTORIAL)) return 'TUTORIAL';
    if (state.is(STATE.READY)) return 'READY';
    if (game.boss) return 'BOSS BATTLE';
    return `ENEMY ${game.kills} DOWN`;
}

function updateDebug(now) {
    frames.push(now);
    frames = frames.filter((t) => now - t < 1000);
    // 直近1秒でいちばん間が空いたフレーム（カクつきの目安。16ms 付近なら安定、50ms 以上は目に見えるカクつき）
    let worst = 0;
    for (let i = 1; i < frames.length; i++) worst = Math.max(worst, frames[i] - frames[i - 1]);
    const info = sceneManager.renderer.info.render;
    debugEl.textContent = [
        `描画 ${frames.length} fps（最大間隔 ${worst.toFixed(0)} ms）`,
        `${info.calls} 呼び出し・${(info.triangles / 1000).toFixed(0)}k 三角形`,
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
    // ロボットのモデルは読み込めなくてもゲームは遊べる（演出が出ないだけ）
    const robotLoad = robot.load(sceneManager.renderer).catch((err) => console.error('ロボットのモデルを読み込めませんでした', err));
    await Promise.all([tracker.init(), robotLoad, loadEnemyModels(), loadBulletModel(), game.stage.load(), game.cockpit.load(sceneManager.envMap)]);   // 敵のモデルも、読み込めなければ仮の形で遊べる
    game.warmUp(sceneManager.renderer);
    setState(STATE.START);
} catch (err) {
    console.error(err);
    screens.error('読み込みに失敗しました。ページを再読み込みしてください。');
}
