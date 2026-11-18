// 雑魚敵1：ドローン（robot_teki2.glb）。空中を回り込みながら、ときどき1発撃つ
//   コンテナを持って出現するドローンは、撃たずにプレイヤーの頭上へ飛んできて、垂直に落とす（落としたあとは普通のドローン）

import * as THREE from 'three';
import { EnemyBase } from './enemyBase.js';

const GRAVITY = 25;
const CARRY_HEIGHT = 34;   // コンテナを持っているときの高さ（コンテナが地面に着かないように高く飛ぶ）
const CARRY_SPEED = 14;    // 頭上へ向かう速さ（m/s）
const ALIGN = 4;           // プレイヤーとの水平距離がこれ以内で「頭上」
const ALIGN_TIME = 0.6;    // 頭上にこの時間いたら落とす
const CARRY_MAX = 9;       // 持ち続ける最長時間（秒）。頭上に着けなくても落とす

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
        this.container = null;   // 持っているコンテナ
    }

    carry(container) {
        this.container = container;
        this.height = CARRY_HEIGHT;
        this.aligned = 0;
        this.carryT = 0;
    }

    // 頭上へ飛んで、落とす
    carryBehave(dt, eye) {
        const to = new THREE.Vector3(eye.x - this.position.x, 0, eye.z - this.position.z);
        const d = to.length();
        if (d > 0.5) this.position.addScaledVector(to.normalize(), Math.min(CARRY_SPEED, d * 1.5) * dt);
        this.position.y = this.height + Math.sin(this.age * 2) * 0.8;
        this.faceTarget(eye);
        this.aligned = d < ALIGN ? this.aligned + dt : Math.max(0, this.aligned - dt);
        this.carryT += dt;
        if (this.aligned > ALIGN_TIME || this.carryT > CARRY_MAX) {
            this.container.release();
            this.container = null;
            this.height = 9 + Math.random() * 8;
            this.cooldown = 3;
        }
    }

    behave(dt, { eye, bullets }) {
        if (this.container) return this.carryBehave(dt, eye);
        this.keepDistance(dt, eye, 40, 14, this.strafe);
        const y = this.height + Math.sin(this.age * 2) * 1.5;
        this.position.y = this.age < 0.1 ? y : this.position.y + (y - this.position.y) * Math.min(1, dt * 3);   // 落としたあとは、なめらかに普通の高さへ降りる
        if (this.body) this.body.rotation.y += dt * 2;
        this.faceTarget(eye);

        this.cooldown -= dt;
        if (this.cooldown <= 0) {
            this.cooldown = 2.5 + Math.random() * 1.5;
            this.attack();
            bullets.fire(this.position, eye, 28, 6);
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
