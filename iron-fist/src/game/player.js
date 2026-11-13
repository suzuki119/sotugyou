// プレイヤー：HP・移動・旋回。カメラを載せている
//   搭乗モード＝ロボットのコックピット（目の高さ 7m） / 共闘モード＝生身（目の高さ 1.7m・剣）

import * as THREE from 'three';
import { ARENA_RADIUS, PLAYER_START } from './stage.js';
import { CONFIG } from '../config.js';

export const MAX_HP = 100;
const MOVE_SPEED = 22;       // m/s
const TURN_SPEED = 1.4;      // rad/s
const TURN_START = 0.7;      // turnWith: 'aimEdge' のとき、照準をこれより端に寄せると旋回する
const EYE_HEIGHT = 7;
// 共闘モード（生身）：左手の左右で旋回、前後で前進・後退
const FOOT = { eye: 1.7, speed: 11, turn: 1.8, radius: 1.2 };
const RIDE_RADIUS = 3;       // 敵の弾の当たり判定の半径

export class Player {
    constructor(scene, camera) {
        this.object = new THREE.Object3D();
        scene.add(this.object);
        this.object.add(camera);
        this.camera = camera;
        this.reset();
    }

    reset() {
        this.hp = MAX_HP;
        this.yaw = PLAYER_START.yaw;
        this.walk = 0;
        this.vy = 0;   // 上向きの速さ（ジャンプ板で打ち上げられたとき）
        this.sway = { amount: 0, lean: 0, shake: 0, t: 0 };   // 搭乗中の揺れ：歩き具合・旋回の傾き・被弾の衝撃・経過時間
        this.mode = 'ride';
        this.object.position.copy(PLAYER_START.position);
        this.object.rotation.y = this.yaw;
        this.camera.position.set(0, EYE_HEIGHT, 0);
        this.camera.rotation.set(0, 0, 0);
    }

    // 地面から離れている（ジャンプ中）
    get airborne() {
        return this.object.position.y > 0.05 || this.vy > 0;
    }

    // 上向きに打ち上げる（ジャンプ板）
    launch(speed) {
        this.vy = speed;
        this.object.position.y = 0.1;
    }

    heal(n) {
        this.hp = Math.min(MAX_HP, this.hp + n);
    }

    get eyeHeight() {
        return this.mode === 'ride' ? EYE_HEIGHT : FOOT.eye;
    }

    get radius() {
        return this.mode === 'ride' ? RIDE_RADIUS : FOOT.radius;
    }

    // 搭乗 ⇄ 生身。position / yaw は切り替えた先の場所と向き
    setMode(mode, position, yaw) {
        this.mode = mode;
        this.object.position.copy(position);
        this.yaw = yaw;
        this.object.rotation.y = yaw;
        this.vy = 0;
        this.camera.position.set(0, this.eyeHeight, 0);
        this.camera.rotation.set(0, 0, 0);
    }

    get eye() {
        return this.camera.getWorldPosition(new THREE.Vector3());
    }

    // crosshair：照準の画面上の位置（-1〜1）
    // obstacles：押し返される障害物（コンテナ）。{ position, footRadius, height }
    update(dt, input, crosshair, obstacles = []) {
        let turn, strafe;
        const foot = this.mode === 'coop';
        if (foot) {
            turn = input.moveX;
            strafe = 0;
        } else if (CONFIG.turnWith === 'leftStick') {
            turn = input.moveX;
            strafe = 0;
        } else {
            turn = Math.sign(crosshair.x) * Math.max(0, Math.abs(crosshair.x) - TURN_START) / (1 - TURN_START);
            strafe = input.moveX;
        }
        this.yaw -= turn * (foot ? FOOT.turn : TURN_SPEED) * dt;
        this.object.rotation.y = this.yaw;

        const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const move = fwd.multiplyScalar(input.moveY).add(right.multiplyScalar(strafe));
        if (move.lengthSq() > 1) move.normalize();
        const p = this.object.position.addScaledVector(move, (foot ? FOOT.speed : MOVE_SPEED) * dt);
        // 障害物の中には入れない（背の高さより高く跳んでいれば、上を越えられる）
        for (const o of obstacles) {
            const dx = p.x - o.position.x, dz = p.z - o.position.z;
            const d = Math.hypot(dx, dz), min = o.footRadius + this.radius * 0.5;
            if (d < min && p.y < o.height) {
                const k = d > 1e-4 ? min / d : 0;
                p.x = d > 1e-4 ? o.position.x + dx * k : o.position.x + min;
                p.z = d > 1e-4 ? o.position.z + dz * k : o.position.z;
            }
        }
        const flat = Math.hypot(p.x, p.z);
        if (flat > ARENA_RADIUS) { p.x *= ARENA_RADIUS / flat; p.z *= ARENA_RADIUS / flat; }

        // ジャンプ：打ち上げられたあとは重力で落ちる。着地すると少し揺れる
        if (this.vy !== 0 || p.y > 0) {
            this.vy -= CONFIG.jump.gravity * dt;
            p.y += this.vy * dt;
            if (p.y <= 0) {
                if (this.vy < -8) this.sway.shake = Math.max(this.sway.shake, 0.4);
                p.y = 0;
                this.vy = 0;
            }
        }

        const speed = move.length();
        if (foot) {
            // 生身：歩くと少し揺れる
            this.walk += dt * speed * 9;
            this.camera.position.y = FOOT.eye + Math.sin(this.walk) * 0.05 * speed;
        } else {
            this.rideSway(dt, speed, turn);
        }
    }

    // 搭乗中の揺れ：重いロボットの一歩ごとの上下・左右・傾きと、停止中の微かな振動、被弾の衝撃
    //   カメラにコックピットが付いているので、画面全体が機体といっしょに揺れる
    rideSway(dt, speed, turn) {
        const c = CONFIG.sway, s = this.sway;
        if (!c.enabled) {
            // 酔い止めモード：揺れなし
            this.camera.position.set(0, EYE_HEIGHT, 0);
            this.camera.rotation.set(0, 0, 0);
            s.shake = 0;
            return;
        }
        const k = Math.min(1, dt * c.follow);
        s.t += dt;
        s.amount += (speed - s.amount) * k;   // 動き出し・止まりをなめらかに
        s.lean += (-turn - s.lean) * k;
        s.shake = Math.max(0, s.shake - dt / 0.3);
        this.walk += dt * (2 + speed * 4);    // 歩くほど歩幅の周期が速くなる

        const w = this.walk, a = s.amount;
        const hit = s.shake * s.shake * c.hit;
        const idle = c.idle * (1 - a);
        const cam = this.camera;
        cam.position.set(
            Math.sin(w) * c.side * a + Math.sin(s.t * 31) * idle + Math.sin(s.t * 53) * hit,
            EYE_HEIGHT - Math.abs(Math.cos(w)) * c.bob * a + Math.sin(s.t * 23) * idle - Math.abs(Math.sin(s.t * 47)) * hit,
            0,
        );
        cam.rotation.x = Math.sin(w * 2 + 1) * c.nod * a - s.shake * s.shake * 0.02;
        cam.rotation.z = Math.sin(w) * c.roll * a + s.lean * c.turnLean + Math.sin(s.t * 41) * s.shake * 0.01;
    }

    damage(n) {
        this.hp = Math.max(0, this.hp - n);
        this.sway.shake = 1;
    }
}
