// ボス：HP が半分を切ると攻撃が激しくなる

import * as THREE from 'three';
import { EnemyBase } from './enemyBase.js';

export class Boss extends EnemyBase {
    constructor() {
        super({ hp: 800, radius: 8, score: 3000 });
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(6, 1), this.material(0x8e44ad));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.8, 8, 32), this.material(0x34495e));
        this.object.add(core, ring);
        this.core = core;
        this.ring = ring;
        this.cooldown = 2;
        this.stream = 0;
        this.strafe = 1;
    }

    get angry() {
        return this.hp < this.maxHp / 2;
    }

    behave(dt, { eye, bullets }) {
        if (Math.random() < dt * 0.3) this.strafe *= -1;
        this.keepDistance(dt, eye, 60, this.angry ? 16 : 10, this.strafe);
        this.position.y = 16 + Math.sin(this.age) * 3;
        this.core.rotation.y += dt;
        this.ring.rotation.x += dt * (this.angry ? 3 : 1);

        // 攻撃A：扇形に5発
        this.cooldown -= dt;
        if (this.cooldown <= 0) {
            this.cooldown = this.angry ? 1.6 : 2.4;
            const to = eye.clone().sub(this.position);
            for (let i = -2; i <= 2; i++) {
                const dir = to.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.12);
                bullets.fire(this.position, this.position.clone().add(dir), 32, 8);
            }
        }
        // 攻撃B（怒り時）：狙い撃ちの連射
        if (this.angry) {
            this.stream -= dt;
            if (this.stream <= 0) {
                this.stream = 0.35;
                bullets.fire(this.position, eye, 40, 5);
            }
        }
    }
}
