// 乗り降りの演出（一人称）：プレイヤーの目線のまま、ハッチの開いたロボットに乗り込む・降りる
//   乗る：ロボットの前まで歩く（ロボットは片膝をつく）→ ハッチが開く → よじ登って中で振り返る → ハッチが閉まる → 立ち上がる
//   降りる：ロボットが片膝をつく → ハッチが開く → 外へ出て振り返る → ハッチが閉まる → ロボットが立ち上がる
//   カメラは Player の object（位置・向き）とカメラ（高さ・上下の向き）を直接動かす

import * as THREE from 'three';
import { ARENA_RADIUS } from './stage.js';

const FOOT_EYE = 1.7;        // 生身の目の高さ
const RIDE_EYE = 7;          // コックピットの目の高さ（立っているとき）
const FRONT = 10;            // ロボットの前の、乗り降りするときに立つ場所（足元から前へ 10m）
const WALK_SPEED = 8;        // 乗りに行くときに歩く速さ（m/s）
const KEEP_OUT = 6;          // 歩くときにロボットの中心からこれ以上は近づかない（m）
const KNEEL = 2.0;           // Mount クリップ（片膝をつく）の長さ
const HATCH = 1.04;          // HatchOpen / HatchClose の長さ

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a, b, t) => a + wrap(b - a) * t;
const yawOf = (v) => Math.atan2(-v.x, -v.z);              // yaw 0 で -Z を向く（自機と同じ決まり）
const pitchTo = (from, to) => Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));

export class Boarding {
    constructor(player, robot, cockpit) {
        this.player = player;
        this.robot = robot;
        this.cockpit = cockpit;
        this.active = null;   // 演出中は { kind, steps, i, t, ... }
    }

    get running() {
        return !!this.active;
    }

    // 乗る。robotPos / robotYaw：ロボットのいる場所と向き。done：終わったら呼ぶ
    mount(robotPos, robotYaw, done) {
        const p = this.player;
        const start = p.object.position.clone().setY(p.camera.position.y);
        const front = this.frontOf(robotPos, robotYaw);
        // ロボットの体をすり抜けないよう、ロボットの周りを回り込んで正面へ歩く（中心からの角度と距離で補間）
        const rel = (v) => ({ a: Math.atan2(v.x - robotPos.x, v.z - robotPos.z), d: Math.hypot(v.x - robotPos.x, v.z - robotPos.z) });
        const from = rel(start), to = rel(front);
        const path = (k) => {
            const a = lerpAngle(from.a, to.a, k);
            // 近すぎるところから歩き出したときは、まず離れてから回り込む
            const away = THREE.MathUtils.lerp(Math.min(from.d, KEEP_OUT), KEEP_OUT, Math.min(1, k * 3));
            const d = Math.max(THREE.MathUtils.lerp(from.d, to.d, k), away);
            return new THREE.Vector3(robotPos.x + Math.sin(a) * d, THREE.MathUtils.lerp(start.y, FOOT_EYE, k), robotPos.z + Math.cos(a) * d);
        };
        const length = Math.abs(wrap(to.a - from.a)) * Math.max(from.d, to.d) + Math.abs(from.d - to.d);
        const walk = THREE.MathUtils.clamp(length / WALK_SPEED, 1.2, 4);
        const r = this.robot;
        const s = { yaw: p.yaw, pitch: 0 };

        r.place(robotPos, robotYaw);
        r.object.visible = r.ready;
        r.resetHatch();
        r.play('Mount', { once: true, fade: 0.3, then: () => r.hatch(true) });
        this.cockpit.group.visible = false;

        this.start('mount', done, [
            // ロボットの前まで歩きながら、ロボット（コックピット）の方を見上げる
            {
                time: Math.max(walk, KNEEL + HATCH * 0.8), run: (t, dt, sec) => {
                    const k = smooth(clamp01(sec / walk));
                    const at = path(k);
                    const look = this.seat();
                    const turn = smooth(clamp01(sec / 0.6));
                    this.view(at, lerpAngle(s.yaw, yawOf(look.clone().sub(at)), turn), pitchTo(at, look) * turn);
                },
            },
            // ハッチによじ登り、中に入りながら振り返って座る
            {
                time: 1.8, run: (t) => {
                    const k = smooth(t);
                    const seat = this.seat();
                    const at = front.clone().lerp(seat, k);
                    at.y += Math.sin(k * Math.PI) * 1.2;   // 少し持ち上がって乗り越える感じ
                    const faceIn = yawOf(seat.clone().sub(front));
                    const turn = smooth(clamp01((t - 0.55) / 0.45));
                    const pitch = THREE.MathUtils.lerp(pitchTo(at, seat.clone().add(new THREE.Vector3(0, 0.5, 0))), 0, turn);
                    this.view(at, lerpAngle(faceIn, robotYaw, turn), pitch);
                },
            },
            // 中からハッチが閉まるのを見る
            { time: HATCH + 0.3, enter: () => r.hatch(false), run: () => this.view(this.seat(), robotYaw, 0) },
            // 立ち上がる：コックピットの表示に切り替え、目線が上がる
            {
                time: 1.2,
                enter: () => {
                    s.from = this.seat();
                    r.object.visible = false;
                    this.cockpit.group.visible = true;
                    r.play('Stand', { fade: 1.0 });
                },
                run: (t) => {
                    const to = robotPos.clone().setY(RIDE_EYE);
                    this.view(s.from.clone().lerp(to, smooth(t)), robotYaw, 0);
                },
            },
        ]);
    }

    // 降りる。終わったらプレイヤーの立つ場所と向きを done(position, yaw) に渡す
    dismount(robotPos, robotYaw, done) {
        const r = this.robot;
        const front = this.frontOf(robotPos, robotYaw);
        const s = {};

        r.place(robotPos, robotYaw);
        r.object.visible = false;
        r.animateHidden = true;   // 見えないうちから片膝をつかせる（コックピットの位置を合わせるため）
        r.resetHatch();
        r.play('Mount', { once: true, fade: 0.3 });
        this.cockpit.group.visible = true;

        this.start('dismount', () => done(front.clone().setY(0), robotYaw), [
            // ロボットが片膝をつく：コックピットの目線が下がる
            {
                time: KNEEL, run: (t) => {
                    const from = robotPos.clone().setY(RIDE_EYE);
                    this.view(from.lerp(this.seat(), smooth(t)), robotYaw, 0);
                },
            },
            // ハッチが開く（外から見たロボットの表示に切り替える）
            {
                time: HATCH + 0.2,
                enter: () => {
                    r.object.visible = r.ready;
                    r.animateHidden = false;
                    this.cockpit.group.visible = false;
                    r.hatch(true);
                },
                run: () => this.view(this.seat(), robotYaw, 0),
            },
            // 外へ出て、地面に降りながら振り返る
            {
                time: 1.8,
                enter: () => { s.from = this.seat(); },
                run: (t) => {
                    const k = smooth(t);
                    const at = s.from.clone().lerp(front, k);
                    at.y += Math.sin(k * Math.PI) * 0.8;
                    const turn = smooth(clamp01((t - 0.4) / 0.6));
                    const look = this.seat();
                    this.view(at, lerpAngle(robotYaw, yawOf(look.clone().sub(at)), turn), pitchTo(at, look) * turn);
                },
            },
            // ハッチが閉まり、ロボットが立ち上がるのを見上げる
            {
                time: HATCH + 1.4,
                enter: () => r.hatch(false),
                run: (t, dt, elapsed) => {
                    if (elapsed >= HATCH && !s.stood) {
                        s.stood = true;
                        r.play('Stand', { fade: 1.2 });
                    }
                    const look = this.seat();
                    this.view(front, yawOf(look.clone().sub(front)), pitchTo(front, look));
                },
            },
            // ロボットと同じ方を向く
            {
                time: 0.8,
                enter: () => { s.yaw = this.player.yaw; s.pitch = this.player.camera.rotation.x; },
                run: (t) => {
                    const k = smooth(t);
                    this.view(front, lerpAngle(s.yaw, robotYaw, k), s.pitch * (1 - k));
                },
            },
        ]);
    }

    start(kind, done, steps) {
        this.active = { kind, done, steps, i: -1, t: 0 };
        this.next();
    }

    next() {
        const a = this.active;
        a.i += 1;
        a.t = 0;
        a.steps[a.i]?.enter?.();
    }

    update(dt) {
        const a = this.active;
        if (!a) return;
        a.t += dt;
        const step = a.steps[a.i];
        step.run(clamp01(a.t / step.time), dt, a.t);
        if (a.t < step.time) return;
        if (a.i + 1 < a.steps.length) return this.next();
        this.active = null;
        this.player.camera.rotation.x = 0;
        a.done();
    }

    // 途中でやめる（リセットなど）
    cancel() {
        this.active = null;
        this.robot.animateHidden = false;
        this.player.camera.rotation.x = 0;
    }

    // ロボットの前の、乗り降りするときに立つ場所（目の高さ）
    frontOf(robotPos, robotYaw) {
        const at = robotPos.clone().add(new THREE.Vector3(-Math.sin(robotYaw), 0, -Math.cos(robotYaw)).multiplyScalar(FRONT));
        if (at.length() > ARENA_RADIUS) at.setLength(ARENA_RADIUS);
        return at.setY(FOOT_EYE);
    }

    // 座席（目の位置）。ロボットの今のポーズでのコックピットの位置
    seat() {
        return this.robot.seatPosition();
    }

    // 目の位置 at（ワールド座標）から、yaw の向き・pitch の上下の向きで見る
    view(at, yaw, pitch) {
        const p = this.player;
        p.object.position.set(at.x, 0, at.z);
        p.yaw = yaw;
        p.object.rotation.y = yaw;
        p.camera.position.set(0, at.y, 0);
        p.camera.rotation.x = pitch;
    }
}
