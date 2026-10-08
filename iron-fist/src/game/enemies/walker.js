// 雑魚敵2：歩行型。地上を近づいてきて、3連射する。硬め

import * as THREE from 'three';
import { EnemyBase } from './enemyBase.js';

export class Walker extends EnemyBase {
    constructor() {
        super({ hp: 70, radius: 3.2, score: 200 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), this.material(0xc98a2b));
        const legMat = this.material(0x5a4a3a);
        this.legs = [-1, 1].map((s) => {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3, 0.8), legMat);
            leg.position.set(s * 1.4, -2.5, 0);
            this.object.add(leg);
            return leg;
        });
        this.object.add(body);
        this.object.position.y = 4;   // 当たり判定の中心＝胴体
        this.cooldown = 3 + Math.random() * 2;
        this.burst = 0;
    }

    behave(dt, { eye, bullets }) {
        this.keepDistance(dt, eye, 28, 8, 0.3);
        this.object.lookAt(eye.x, this.position.y, eye.z);
        this.legs.forEach((l, i) => (l.rotation.x = Math.sin(this.age * 5 + i * Math.PI) * 0.5));

        this.cooldown -= dt;
        if (this.cooldown <= 0) {
            this.burst += 1;
            bullets.fire(this.position, eye, 34, 5);
            this.cooldown = this.burst % 3 === 0 ? 3.5 : 0.25;
        }
    }
}
