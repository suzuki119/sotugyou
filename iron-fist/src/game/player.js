// 自機：HP・移動・旋回。カメラ（コックピット）を載せている

import * as THREE from 'three';
import { ARENA_RADIUS } from './stage.js';
import { CONFIG } from '../config.js';

export const MAX_HP = 100;
const MOVE_SPEED = 22;       // m/s
const TURN_SPEED = 1.4;      // rad/s
const TURN_START = 0.7;      // turnWith: 'aimEdge' のとき、照準をこれより端に寄せると旋回する
const EYE_HEIGHT = 7;

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
        this.yaw = 0;
        this.walk = 0;
        this.object.position.set(0, 0, 0);
        this.camera.position.set(0, EYE_HEIGHT, 0);
    }

    get eye() {
        return this.camera.getWorldPosition(new THREE.Vector3());
    }

    // crosshair：照準の画面上の位置（-1〜1）
    update(dt, input, crosshair) {
        let turn, strafe;
        if (CONFIG.turnWith === 'leftStick') {
            turn = input.moveX;
            strafe = 0;
        } else {
            turn = Math.sign(crosshair.x) * Math.max(0, Math.abs(crosshair.x) - TURN_START) / (1 - TURN_START);
            strafe = input.moveX;
        }
        this.yaw -= turn * TURN_SPEED * dt;
        this.object.rotation.y = this.yaw;

        const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const move = fwd.multiplyScalar(input.moveY).add(right.multiplyScalar(strafe));
        if (move.lengthSq() > 1) move.normalize();
        const p = this.object.position.addScaledVector(move, MOVE_SPEED * dt);
        if (p.length() > ARENA_RADIUS) p.setLength(ARENA_RADIUS);

        // 歩くと少し揺れる（重いロボットの感じ）
        const speed = move.length();
        this.walk += dt * speed * 6;
        this.camera.position.y = EYE_HEIGHT + Math.sin(this.walk) * 0.25 * speed;
    }

    damage(n) {
        this.hp = Math.max(0, this.hp - n);
    }
}
