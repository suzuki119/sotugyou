// 手認識の結果を、ゲームが使う抽象化された入力に変換する
//   ゲーム側は get() が返す input だけを見る（手認識ライブラリを直接触らない）

import { CONFIG } from '../config.js';
import { LandmarkProcessor } from '../hand/landmarkProcessor.js';
import { GestureDetector } from '../hand/gestureDetector.js';
import { measureTilt, TiltSmoother, fingerPitch } from '../hand/ballStick.js';
import { OneEuroFilter } from './oneEuroFilter.js';

const EMPTY = {
    aimX: 0, aimY: 0, fire: false, moveX: 0, moveY: 0,
    rightGrip: false, leftGrip: false, rightTracked: false, leftTracked: false,
    leftOpen: false, rightOpen: false,      // パー（モード切り替え）
    rightRoll: 0,                           // 右手首を左右にひねった量（-1〜1、右が +）：コックピットのハンドルの見た目
    leftThumb: false,                       // 左手の親指を倒している：コックピットの操縦桿のボタンの見た目
    handX: 0, handY: 0,                     // 右手の位置（基準からのずれ、-1〜1）：共闘モードの剣の位置
    swing: 0, swingX: 0, swingY: 0,         // 右手を振る速さ（画面の高さ／秒）と向き（右・上が +）
};

export class InputManager {
    constructor(keyboard) {
        this.keyboard = keyboard;          // 開発用（なければ null）
        this.processor = new LandmarkProcessor();
        this.gesture = new GestureDetector();
        this.hands = { left: null, right: null };
        this.metrics = { left: null, right: null };
        this.base = null;                  // キャリブレーションの基準値
        this.tiltSmoother = new TiltSmoother(0.2);   // 仕上げは One Euro Filter に任せるので弱めに
        this.aimFilter = { x: new OneEuroFilter(CONFIG.aim.filter), y: new OneEuroFilter(CONFIG.aim.filter) };
        this.moveFilter = { x: new OneEuroFilter(CONFIG.aim.filter), y: new OneEuroFilter(CONFIG.aim.filter) };
        this.swordFilter = { x: new OneEuroFilter(CONFIG.aim.filter), y: new OneEuroFilter(CONFIG.aim.filter) };
        this.prevRight = null;             // 右手を振る速さを出すための、前回の位置
        this.swing = { speed: 0, x: 0, y: 0 };
        this.tilt = null;                  // 右手ボールスティックの傾き（度）
        this.orient = { left: null, right: null };
        this.resetOrientAim();
        this.input = { ...EMPTY };
        this.lastSeen = performance.now();
    }

    // HandTracker の結果を受け取る（検出のたびに呼ばれる）
    onHands(rawHands, aspect, now) {
        this.hands = this.processor.process(rawHands, aspect);
        const r = this.gesture.update('right', this.hands.right, now);
        const l = this.gesture.update('left', this.hands.left, now);
        this.metrics = { right: r.metrics, left: l.metrics };
        this.orient = { right: r.orient, left: l.orient };
        if (this.hands.left || this.hands.right) this.lastSeen = now;

        const input = { ...EMPTY };
        input.rightTracked = !!this.hands.right;
        input.leftTracked = !!this.hands.left;
        input.rightGrip = r.grip;
        input.leftGrip = l.grip;
        input.fire = r.fire;
        input.leftOpen = l.open;
        input.leftThumb = !!l.thumb;
        input.rightOpen = r.open;
        this.updateSwing(input, aspect, now);

        // 基準位置がない（キャリブレーション前）か、グリップしていない手の入力は 0
        this.tilt = this.tiltSmoother.update(
            this.base?.right.frame && this.hands.right ? measureTilt(this.hands.right.world, this.base.right.frame) : null);

        if (this.base && r.grip) {
            const d = this.offset('right');
            if (this.tilt) input.rightRoll = Math.max(-1, Math.min(1, this.tilt.roll / CONFIG.ballStick.rollRange));
            if (CONFIG.aimAxis === 'horizontalAuto') {
                input.aimX = shape(d.x / CONFIG.aimRange.x);
                input.aimY = 0;   // 上下はゲーム側で自動
            } else if (CONFIG.aimAxis === 'orientationSwitch') {
                this.updateOrientAim(r.orient, this.hands.right.x, now);
                input.aimX = this.orientAim.x;
                input.aimY = this.orientAim.y;
            } else if (CONFIG.aimMode === 'ballstick') {
                const b = CONFIG.ballStick;
                input.aimX = b.xSource === 'roll'
                    ? shape((b.invertRoll ? -1 : 1) * this.tilt.roll / b.rollRange)
                    : shape(d.x / CONFIG.aimRange.x);
                input.aimY = shape((b.invertPitch ? -1 : 1) * this.tilt.pitch / b.pitchRange);  // 前に倒す＝下（操縦桿方式）
            } else {
                input.aimX = shape(d.x / CONFIG.aimRange.x);
                input.aimY = CONFIG.aimYMode === 'depth'
                    ? shape(-d.depth / CONFIG.aimRange.depth)   // 奥に押す（手が大きく見える）＝下
                    : shape(-d.y / CONFIG.aimRange.y);
            }
            input.aimX = this.aimFilter.x.filter(input.aimX, now / 1000);
            input.aimY = this.aimFilter.y.filter(input.aimY, now / 1000);
        } else {
            this.aimFilter.x.reset();
            this.aimFilter.y.reset();
            this.resetOrientAim();
        }
        if (this.base && l.grip) {
            const d = this.offset('left');
            input.moveX = shape(d.x / CONFIG.moveRange.x);
            const r = CONFIG.moveRange;
            if (CONFIG.moveYMode === 'tilt') {
                // 基準の構えより指が下を向く（tilt が -）＝前進、上を向く＝後退
                const t = this.leftTilt();
                input.moveY = shape(-t / (t < 0 ? CONFIG.moveTiltRange.forward : CONFIG.moveTiltRange.back));
            } else {
                input.moveY = CONFIG.moveYMode === 'depth'
                    ? shape(d.depth / (d.depth > 0 ? r.depthForward : r.depthBack))   // 奥に押す＝前進
                    : shape(-d.y / CONFIG.moveRange.y);          // 上に動かす＝前進
            }
            input.moveX = this.moveFilter.x.filter(input.moveX, now / 1000);
            input.moveY = this.moveFilter.y.filter(input.moveY, now / 1000);
        } else {
            this.moveFilter.x.reset();
            this.moveFilter.y.reset();
        }
        this.input = input;
    }

    // 右手を振る速さと向き（剣）。剣の位置は基準位置からのずれ
    updateSwing(input, aspect, now) {
        const h = this.hands.right;
        if (!h) {
            this.prevRight = null;
            this.swing = { speed: 0, x: 0, y: 0 };
            this.swordFilter.x.reset();
            this.swordFilter.y.reset();
            return;
        }
        if (this.prevRight) {
            const dt = Math.max(0.001, (now - this.prevRight.t) / 1000);
            const vx = ((h.x - this.prevRight.x) * aspect) / dt, vy = -(h.y - this.prevRight.y) / dt;
            const speed = Math.hypot(vx, vy);
            // 速さは少しだけ平滑化（1フレームの誤検出で斬らないように）
            this.swing.speed = this.swing.speed * 0.3 + speed * 0.7;
            if (speed > 0.2) this.swing.x = vx / speed, this.swing.y = vy / speed;
        }
        this.prevRight = { x: h.x, y: h.y, t: now };
        input.swing = this.swing.speed;
        input.swingX = this.swing.x;
        input.swingY = this.swing.y;
        if (this.base) {
            const d = this.offset('right'), range = CONFIG.sword.handRange;
            const clamp = (v) => Math.max(-1, Math.min(1, v));
            input.handX = this.swordFilter.x.filter(clamp(d.x / range), now / 1000);
            input.handY = this.swordFilter.y.filter(clamp(-d.y / range), now / 1000);
        }
    }

    // 手の向きで軸を切り替える照準：動かしていない方の軸は値を保つ
    //   切り替えた瞬間の手の位置を新しい基準にするので、照準は飛ばない
    updateOrientAim(orient, handX, now) {
        const axis = orient === 'vertical' ? 'x' : 'y';
        const sign = axis === 'y' && CONFIG.invertOrientY ? -1 : 1;
        const range = CONFIG.aimRange.x;
        if (axis !== this.orientAxis) {
            this.orientAxis = axis;
            this.switchedAt = now;
        }
        if (now - this.switchedAt < CONFIG.orientSwitchFreezeMs) {
            // 手を回している最中：今の照準の値を保ったまま基準を付け直す
            this.orientAnchor = handX - sign * this.orientAim[axis] * range;
            return;
        }
        const v = (sign * (handX - this.orientAnchor)) / range;
        this.orientAim[axis] = Math.max(-1, Math.min(1, v));
    }

    resetOrientAim() {
        this.orientAim = { x: 0, y: 0 };
        this.orientAxis = null;
        this.switchedAt = 0;
        this.orientAnchor = 0;
    }

    // 左手の指の向きが、基準の構えから上下に何度傾いているか（+ が上向き）
    leftTilt() {
        return fingerPitch(this.hands.left.world) - (this.base.left.pitch ?? 0);
    }

    offset(side) {
        const h = this.hands[side], b = this.base[side];
        // depth：カメラに近づいた距離の割合（+ が奥＝カメラ側）
        //   見た目の大きさは距離に反比例するので、大きさの比のままだと奥側ばかり大きく出る。距離に直して前後をそろえる
        return { x: h.x - b.x, y: h.y - b.y, depth: 1 - b.size / h.size };
    }

    setBase(base) {
        this.base = base;
    }

    // 両手を見失っている時間（ms）
    lostFor(now) {
        if (this.keyboard?.enabled) return 0;
        return this.hands.left || this.hands.right ? 0 : now - this.lastSeen;
    }

    get() {
        if (this.keyboard?.enabled) return this.keyboard.get();
        return this.input;
    }
}

// デッドゾーンと感度カーブ（-1〜1）
function shape(v) {
    const dz = CONFIG.deadzone;
    const a = Math.min(1, Math.abs(v));
    if (a < dz) return 0;
    const t = (a - dz) / (1 - dz);
    return Math.sign(v) * (0.4 * t + 0.6 * t * t);   // 中央付近は細かく、端は大きく動く
}
