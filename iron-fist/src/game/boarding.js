// 乗り降りの演出（一人称・テンポ重視版。元の遅い版は boarding.classic.js）：プレイヤーの目線のまま、ハッチの開いたロボットに乗り込む・降りる
//   乗る：ロボットへ走る（片膝をつくと同時にハッチが開く）→ 体を回転させながらジャンプで飛び込む → ハッチが閉まる → 立ち上がる（約3秒）
//   降りる：片膝をつくと同時にハッチが開く → ジャンプで飛び出して着地・振り返る → ロボットが立ち上がる（約2.4秒）
//   カメラは Player の object（位置・向き）とカメラ（高さ・上下の向き）を直接動かす

import * as THREE from 'three';
import { ARENA_RADIUS } from './stage.js';

const FOOT_EYE = 1.7;        // 生身の目の高さ
const RIDE_EYE = 7;          // コックピットの目の高さ（立っているとき）
const FRONT = 10;            // ロボットの前の、乗り降りするときに立つ場所（足元から前へ 10m）
const WALK_SPEED = 14;       // 乗りに行くときに走る速さ（m/s）
const KEEP_OUT = 6;          // 歩くときにロボットの中心からこれ以上は近づかない（m）
const SPEED = 2.5;           // 乗り降りの間、ロボットのアニメーションを速くする倍率（片膝・ハッチが 1/2.5 の時間になる）
const KNEEL = 2.0 / SPEED;   // Mount クリップ（片膝をつく）の長さ
const HATCH = 1.04 / SPEED;  // HatchOpen / HatchClose の長さ
const FADE = 0.2;            // コックピットの内装が現れる・消える時間

// 補助関数
//   smooth：0〜1 の進み具合をなめらかにする（始めと終わりがゆっくり）。演出の動きはほぼこれを通す
//   lerpAngle：角度の補間。wrap で -π〜π に折り返すので、常に「近い方の回り」で回る
//   yawOf / pitchTo：ある点を見るための yaw（左右）・pitch（上下）の角度を求める
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a, b, t) => a + wrap(b - a) * t;
const yawOf = (v) => Math.atan2(-v.x, -v.z);              // yaw 0 で -Z を向く（自機と同じ決まり）
const pitchTo = (from, to) => Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));

// 乗り降りの演出。ゲームの座標系の約束：yaw 0 で -Z を向く／Player.object が位置と yaw、カメラが目の高さと pitch。
// 演出は別カメラではなく、プレイヤー自身の位置・向き・目の高さを直接動かして作る（一人称のまま）。
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

    // ロボットのアニメーションの速さ（演出中だけ速くする）
    speed(x) {
        // 演出中だけロボットのアニメ全体（片膝・ハッチ）を速くする。1 が通常。終了・中断時に必ず 1 へ戻す。
        if (this.robot.mixer) this.robot.mixer.timeScale = x;
    }

    // 乗る。robotPos / robotYaw：ロボットのいる場所と向き。done：終わったら呼ぶ
    mount(robotPos, robotYaw, done) {
        // 搭乗の演出（約3秒）。ステップ：①走る ②飛び込む ③ハッチが閉まる ④立ち上がる
        // ①ではロボットが片膝をつきハッチが開くのを、走りながら同時に進める（待たない）。
        // 走る経路 path(k) は「ロボットの中心からの角度と距離」で補間する：まっすぐ走るとロボットの体をすり抜けるので、
        //   周りを回り込むように角度を補間し、近すぎるところから始めたら先に KEEP_OUT まで離れる。
        const p = this.player;
        const start = p.object.position.clone().setY(p.camera.position.y);
        const front = this.frontOf(robotPos, robotYaw);
        // ロボットの体をすり抜けないよう、ロボットの周りを回り込んで正面へ走る（中心からの角度と距離で補間）
        const rel = (v) => ({ a: Math.atan2(v.x - robotPos.x, v.z - robotPos.z), d: Math.hypot(v.x - robotPos.x, v.z - robotPos.z) });
        const from = rel(start), to = rel(front);
        const path = (k) => {
            const a = lerpAngle(from.a, to.a, k);
            // 近すぎるところから走り出したときは、まず離れてから回り込む
            const away = THREE.MathUtils.lerp(Math.min(from.d, KEEP_OUT), KEEP_OUT, Math.min(1, k * 3));
            const d = Math.max(THREE.MathUtils.lerp(from.d, to.d, k), away);
            return new THREE.Vector3(robotPos.x + Math.sin(a) * d, THREE.MathUtils.lerp(start.y, FOOT_EYE, k), robotPos.z + Math.cos(a) * d);
        };
        const length = Math.abs(wrap(to.a - from.a)) * Math.max(from.d, to.d) + Math.abs(from.d - to.d);
        const run = THREE.MathUtils.clamp(length / WALK_SPEED, 0.6, 1.4);
        const r = this.robot;
        const s = { yaw: p.yaw, pitch: 0 };

        r.place(robotPos, robotYaw);
        r.object.visible = r.ready;
        r.resetHatch();
        this.speed(SPEED);
        r.play('Mount', { once: true, fade: 0.15 });
        r.hatch(true);   // 片膝をつくのを待たず、すぐ開く
        this.cockpit.group.visible = false;

        this.start('mount', done, [
            // ロボットへ走りながら、コックピットの方を見上げる（片膝とハッチの動きが終わるまで待つ）
            {
                time: Math.max(run, KNEEL), run: (t, dt, sec) => {
                    const k = smooth(clamp01(sec / run));
                    const at = path(k);
                    const look = this.seat();
                    const turn = smooth(clamp01(sec / 0.3));
                    this.view(at, lerpAngle(s.yaw, yawOf(look.clone().sub(at)), turn), pitchTo(at, look) * turn);
                },
            },
            // 飛び込む：体を回転させて、ロボットに背を向けて座る向きになりながら跳ぶ
            {
                time: 0.7, run: (t) => {
                    const k = smooth(t);
                    const seat = this.seat();
                    const at = front.clone().lerp(seat, k);
                    at.y += Math.sin(k * Math.PI) * 2.2;   // 弧を描いて跳ぶ
                    const faceIn = yawOf(seat.clone().sub(front));
                    const turn = smooth(clamp01((t - 0.15) / 0.75));
                    const pitch = THREE.MathUtils.lerp(pitchTo(at, seat.clone().add(new THREE.Vector3(0, 0.5, 0))), 0, turn);
                    this.view(at, lerpAngle(faceIn, robotYaw, turn), pitch, Math.sin(turn * Math.PI) * 0.18);
                },
            },
            // 中からハッチが閉まる。コックピットの枠も上から下りてきて閉まる
            {
                time: HATCH + 0.05,
                enter: () => {
                    r.hatch(false);
                    this.cockpit.setOpen(1);
                    this.cockpit.setFade(0);
                    this.cockpit.group.visible = true;
                },
                run: (t, dt, sec) => {
                    this.cockpit.setFade(clamp01(sec / FADE));
                    this.cockpit.setOpen(1 - smooth(clamp01(sec / HATCH)));
                    this.view(this.seat(), robotYaw, 0);
                },
            },
            // 立ち上がる：外のロボットは消して、コックピットの中だけにする。目線が上がる
            {
                time: 0.6,
                enter: () => {
                    s.from = this.seat();
                    r.object.visible = false;
                    this.cockpit.setOpen(0);
                    this.cockpit.setFade(1);
                    this.speed(1);
                    r.play('Stand', { fade: 0.5 });
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
        // 降車の演出（約2秒）。ステップ：①片膝＋ハッチ開き ②ジャンプで飛び出す ③着地して立ち上がりを待つ
        // 振り返りはしない（ずっとロボットと同じ向き）。終わると done(降りた位置, 向き) を呼び、プレイヤーを生身に切り替える。
        // ロボットは最初は非表示のまま片膝をつかせ（animateHidden）、コックピットの目の位置（seat）を正しく合わせる。
        const r = this.robot;
        const front = this.frontOf(robotPos, robotYaw);
        const s = {};

        r.place(robotPos, robotYaw);
        r.object.visible = false;
        r.animateHidden = true;   // 見えないうちから片膝をつかせる（コックピットの位置を合わせるため）
        r.resetHatch();
        this.speed(SPEED);
        r.play('Mount', { once: true, fade: 0.15 });
        this.cockpit.group.visible = true;

        this.start('dismount', () => done(front.clone().setY(0), robotYaw), [
            // 片膝をつきながら、すぐハッチが開く。コックピットの枠も一緒に跳ね上がる
            {
                time: KNEEL + 0.1,
                enter: () => { r.hatch(true); },
                run: (t, dt, sec) => {
                    if (sec > 0.15 && !r.object.visible) {
                        r.object.visible = r.ready;
                        r.animateHidden = false;
                    }
                    this.cockpit.setOpen(smooth(clamp01(sec / HATCH)));
                    const from = robotPos.clone().setY(RIDE_EYE);
                    this.view(from.lerp(this.seat(), smooth(t)), robotYaw, 0);
                },
            },
            // ジャンプで飛び出し、弧を描いて地面に降りる（振り返らない）
            {
                time: 0.75,
                enter: () => { s.from = this.seat(); },
                run: (t, dt, sec) => {
                    if (this.cockpit.group.visible) {
                        const a = 1 - clamp01(sec / FADE);
                        this.cockpit.setFade(a);
                        if (a <= 0) {
                            this.cockpit.group.visible = false;
                            this.cockpit.setOpen(0);
                            this.cockpit.setFade(1);
                        }
                    }
                    const k = smooth(t);
                    const at = s.from.clone().lerp(front, k);
                    at.y += Math.sin(k * Math.PI) * 2.8;
                    this.view(at, robotYaw, 0);   // 振り返らず、そのまま前を向いて飛び出す
                },
            },
            // 着地（少し沈む）。そのまま前を向いたまま、ハッチが閉まりロボットが立ち上がる
            {
                time: 0.55,
                enter: () => { r.hatch(false); r.play('Stand', { fade: 0.8 }); },
                run: (t) => {
                    const at = front.clone();
                    at.y -= Math.sin(Math.PI * clamp01(t / 0.45)) * 0.3;
                    this.view(at, robotYaw, 0);
                },
            },
        ]);
    }

    start(kind, done, steps) {
        // 演出を開始する。steps は { time(秒), enter?(入った瞬間に1回), run(t:0〜1, dt, 経過秒) } の配列。
        this.active = { kind, done, steps, i: -1, t: 0 };
        this.next();
    }

    next() {
        // 次のステップへ進み、その enter を呼ぶ。
        const a = this.active;
        a.i += 1;
        a.t = 0;
        a.steps[a.i]?.enter?.();
    }

    update(dt) {
        // 毎フレーム呼ばれる。今のステップの run を実行し、time を超えたら次へ。最後のステップが終わったら speed を戻して done()。
        const a = this.active;
        if (!a) return;
        a.t += dt;
        const step = a.steps[a.i];
        step.run(clamp01(a.t / step.time), dt, a.t);
        if (a.t < step.time) return;
        if (a.i + 1 < a.steps.length) return this.next();
        this.active = null;
        this.speed(1);
        this.player.camera.rotation.x = 0;
        a.done();
    }

    // 途中でやめる（リセットなど）
    cancel() {
        // 演出を途中でやめる（ゲームのリセットなど）。ロボットの速度・コックピットの開閉を元に戻す。
        this.active = null;
        this.speed(1);
        this.cockpit.setOpen(0);
        this.robot.animateHidden = false;
        this.player.camera.rotation.x = 0;
    }

    // ロボットの前の、乗り降りするときに立つ場所（目の高さ）
    frontOf(robotPos, robotYaw) {
        // ロボットの正面 FRONT(10m) 先の、乗り降りのときに立つ場所。闘技場の外へ出ないよう ARENA_RADIUS で制限する。
        const at = robotPos.clone().add(new THREE.Vector3(-Math.sin(robotYaw), 0, -Math.cos(robotYaw)).multiplyScalar(FRONT));
        if (at.length() > ARENA_RADIUS) at.setLength(ARENA_RADIUS);
        return at.setY(FOOT_EYE);
    }

    // 座席（目の位置）。ロボットの今のポーズでのコックピットの位置
    seat() {
        // 目の位置（座席）。ロボットが片膝をつくと座席も下がるので、毎回その時のポーズから取り直す。
        return this.robot.seatPosition();
    }

    // 目の位置 at（ワールド座標）から、yaw の向き・pitch の上下の向きで見る
    view(at, yaw, pitch, roll = 0) {
        // 目の位置 at（ワールド座標）から、yaw/pitch/roll の向きで見る。
        //   Player.object は地面（y=0）の x,z と yaw を持ち、目の高さ at.y は子のカメラの y に入れる、という分担。
        //   roll は視点の傾き（ジャンプ中に少し傾ける演出用）。
        const p = this.player;
        p.object.position.set(at.x, 0, at.z);
        p.yaw = yaw;
        p.object.rotation.y = yaw;
        p.camera.position.set(0, at.y, 0);
        p.camera.rotation.x = pitch;
        p.camera.rotation.z = roll;   // 搭乗中の揺れの傾きは残さない（ジャンプ中だけ少し傾ける）
    }
}
