// 敵の弾。遅めにして、左手の移動でよけられるようにする

import * as THREE from 'three';
import { segmentHitsSphere } from '../weapon.js';
import { sound } from '../../audio/sound.js';
import { createBullet } from '../../render/bulletModel.js';

const geo = new THREE.SphereGeometry(0.6, 10, 8);
const mat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });

export class EnemyBullets {
    constructor(scene) {
        this.scene = scene;
        this.list = [];
    }

    fire(from, to, speed = 30, damage = 6) {
        sound.play('enemyShot', { minInterval: 0.08 });   // ボスの弾幕で音が重なりすぎないようにする
        const mesh = createBullet('enemy', () => new THREE.Mesh(geo, mat));
        mesh.position.copy(from);
        mesh.lookAt(to);
        this.scene.add(mesh);
        this.list.push({ mesh, vel: to.clone().sub(from).setLength(speed), damage, life: 6 });
    }

    // targets：[{ position, radius, scale }]（プレイヤー、共闘モードではロボットも）
    // 当たった弾のダメージ合計（scale を掛けたもの）を返す
    // blockers：弾を遮る障害物（着地したコンテナ）。当たったら onBlock(障害物, ダメージ, 位置) を呼んで弾は消える
    update(dt, targets, blockers = [], onBlock = () => {}) {
        let damage = 0;
        const prev = new THREE.Vector3();
        for (const b of this.list) {
            prev.copy(b.mesh.position);
            b.mesh.position.addScaledVector(b.vel, dt);
            b.life -= dt;
            const blocker = blockers.find((c) => !c.dead && segmentHitsSphere(prev, b.mesh.position, c.position, c.radius));
            if (blocker) {
                onBlock(blocker, b.damage, b.mesh.position.clone());
                b.life = 0;
                continue;
            }
            for (const t of targets) {
                if (segmentHitsSphere(prev, b.mesh.position, t.position, t.radius)) {
                    damage += b.damage * t.scale;
                    b.life = 0;
                    break;
                }
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
