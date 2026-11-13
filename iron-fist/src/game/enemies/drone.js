// 雑魚敵1：ドローン（robot_teki2.glb）。空中を回り込みながら、ときどき1発撃つ

import * as THREE from 'three';
import { EnemyBase } from './enemyBase.js';
import { CONFIG } from '../../config.js';

const GRAVITY = 25;

export class Drone extends EnemyBase {
    constructor() {
        super({ hp: 30, radius: 2.4, score: 100 });
        if (!this.useModel('drone')) {
            // 仮の形
            this.radius = 2.2;
            this.body = new THREE.Mesh(new THREE.OctahedronGeometry(2), this.material(0xd9534f));
            this.object.add(this.body);
        }
        this.height = 9 + Math.random() * 8;
        this.strafe = Math.random() < 0.5 ? -0.6 : 0.6;
        this.cooldown = 2 + Math.random() * 2;
    }

    // drop：コンテナを投げられるなら { canDrop(), drop(位置) }
    behave(dt, { eye, bullets, canDrop, drop }) {
        this.keepDistance(dt, eye, 40, 14, this.strafe);
        this.position.y = this.height + Math.sin(this.age * 2) * 1.5;
        if (this.body) this.body.rotation.y += dt * 2;
        this.faceTarget(eye);

        this.cooldown -= dt;
        if (this.cooldown <= 0) {
            this.cooldown = 2.5 + Math.random() * 1.5;
            this.attack();
            if (canDrop?.() && Math.random() < CONFIG.container.chance) {
                drop(this.position);   // 撃つ代わりに、プレイヤーのいる場所へコンテナを投げ落とす
            } else {
                bullets.fire(this.position, eye, 28, 6);
            }
        }
    }

    // 倒れたら回りながら地面まで落ちる（Defeat のモーションはその場で再生）
    fallDown(dt) {
        const ground = this.rig ? this.rig.lift : 1;
        if (this.position.y <= ground) return;
        this.fall += GRAVITY * dt;
        this.position.y = Math.max(ground, this.position.y - this.fall * dt);
    }
}
