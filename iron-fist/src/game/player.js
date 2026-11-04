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
        this.mode = 'ride';
        this.object.position.copy(PLAYER_START.position);
        this.object.rotation.y = this.yaw;
        this.camera.position.set(0, EYE_HEIGHT, 0);
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
        this.camera.position.y = this.eyeHeight;
    }

    get eye() {
        return this.camera.getWorldPosition(new THREE.Vector3());
    }

    // crosshair：照準の画面上の位置（-1〜1）
    update(dt, input, crosshair) {
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
        if (p.length() > ARENA_RADIUS) p.setLength(ARENA_RADIUS);

        // 歩くと少し揺れる（重いロボットの感じ）
        const speed = move.length();
        this.walk += dt * speed * (foot ? 9 : 6);
        this.camera.position.y = this.eyeHeight + Math.sin(this.walk) * (foot ? 0.05 : 0.25) * speed;
    }

    damage(n) {
        this.hp = Math.max(0, this.hp - n);
    }
}
