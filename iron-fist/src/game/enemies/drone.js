// 雑魚敵1：ドローン。空中を回り込みながら、ときどき1発撃つ

import * as THREE from 'three';
import { EnemyBase } from './enemyBase.js';

export class Drone extends EnemyBase {
    constructor() {
        super({ hp: 30, radius: 2.2, score: 100 });
        const body = new THREE.Mesh(new THREE.OctahedronGeometry(2), this.material(0xd9534f));
        this.object.add(body);
        this.body = body;
        this.height = 9 + Math.random() * 8;
        this.strafe = Math.random() < 0.5 ? -0.6 : 0.6;
        this.cooldown = 2 + Math.random() * 2;
    }

    behave(dt, { eye, bullets }) {
        this.keepDistance(dt, eye, 40, 14, this.strafe);
        this.position.y = this.height + Math.sin(this.age * 2) * 1.5;
        this.body.rotation.y += dt * 2;
        this.object.lookAt(eye);

        this.cooldown -= dt;
        if (this.cooldown <= 0) {
            this.cooldown = 2.5 + Math.random() * 1.5;
            bullets.fire(this.position, eye, 28, 6);
        }
    }
}
