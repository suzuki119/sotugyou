// 敵の共通部分：HP・当たり判定の半径・被弾時の点滅

import * as THREE from 'three';

export class EnemyBase {
    constructor({ hp, radius, score }) {
        this.hp = this.maxHp = hp;
        this.radius = radius;
        this.score = score;
        this.dead = false;
        this.flash = 0;
        this.age = 0;
        this.object = new THREE.Group();
        this.materials = [];
    }

    get position() {
        return this.object.position;
    }

    // 点滅させたいマテリアルはここで作る
    material(color) {
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
        this.materials.push(m);
        return m;
    }

    hit(damage) {
        this.hp -= damage;
        this.flash = 0.06;
        if (this.hp <= 0) this.dead = true;
    }

    // ctx: { eye, bullets, dt }
    update(dt, ctx) {
        this.age += dt;
        this.flash -= dt;
        const e = this.flash > 0 ? 0xffffff : 0x000000;
        for (const m of this.materials) m.emissive.setHex(e);
        this.behave(dt, ctx);
    }

    behave() {}

    // 水平方向でプレイヤーとの距離を保ちながら回り込む
    keepDistance(dt, eye, dist, speed, strafe) {
        const to = new THREE.Vector3(eye.x - this.position.x, 0, eye.z - this.position.z);
        const d = to.length();
        to.normalize();
        const side = new THREE.Vector3(-to.z, 0, to.x);
        const v = to.multiplyScalar(THREE.MathUtils.clamp((d - dist) / 10, -1, 1)).addScaledVector(side, strafe);
        this.position.addScaledVector(v, speed * dt);
    }
}
