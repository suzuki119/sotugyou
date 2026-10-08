// 敵の弾。遅めにして、左手の移動でよけられるようにする

import * as THREE from 'three';
import { segmentHitsSphere } from '../weapon.js';

const PLAYER_RADIUS = 3;
const geo = new THREE.SphereGeometry(0.6, 10, 8);
const mat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });

export class EnemyBullets {
    constructor(scene) {
        this.scene = scene;
        this.list = [];
    }

    fire(from, to, speed = 30, damage = 6) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(from);
        this.scene.add(mesh);
        this.list.push({ mesh, vel: to.clone().sub(from).setLength(speed), damage, life: 6 });
    }

    // プレイヤーに当たった弾のダメージ合計を返す
    update(dt, eye) {
        let damage = 0;
        const prev = new THREE.Vector3();
        for (const b of this.list) {
            prev.copy(b.mesh.position);
            b.mesh.position.addScaledVector(b.vel, dt);
            b.life -= dt;
            if (segmentHitsSphere(prev, b.mesh.position, eye, PLAYER_RADIUS)) {
                damage += b.damage;
                b.life = 0;
            }
        }
        this.list = this.list.filter((b) => {
            if (b.life > 0 && b.mesh.position.y > 0) return true;
            this.scene.remove(b.mesh);
            return false;
        });
        return damage;
    }

    clear() {
        for (const b of this.list) this.scene.remove(b.mesh);
        this.list = [];
    }
}
