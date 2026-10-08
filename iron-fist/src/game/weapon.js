// 自機の武器：親指を閉じている間、左右の銃から交互に連射する

import * as THREE from 'three';
import { MUZZLES } from '../render/cockpit.js';

const FIRE_RATE = 10;       // 発/秒
const SPEED = 220;          // m/s
const DAMAGE = 10;
const LIFE = 1.5;           // 秒
const RANGE = 300;

const geo = new THREE.BoxGeometry(0.15, 0.15, 2.4);
const mat = new THREE.MeshBasicMaterial({ color: 0xffe066 });

export class Weapon {
    constructor(scene, camera, cockpit) {
        this.scene = scene;
        this.camera = camera;
        this.cockpit = cockpit;
        this.bullets = [];
        this.cooldown = 0;
        this.side = 0;
        this.raycaster = new THREE.Raycaster();
    }

    // aim は照準の画面上の位置（-1〜1）
    // lock：エイムアシストで捉えている敵（いればその敵に向けて撃つ）
    update(dt, firing, aim, enemies, onHit, lock) {
        this.cooldown -= dt;
        if (firing && this.cooldown <= 0) {
            this.cooldown = 1 / FIRE_RATE;
            this.spawn(aim, enemies, lock);
        }

        const prev = new THREE.Vector3();
        for (const b of this.bullets) {
            prev.copy(b.mesh.position);
            b.mesh.position.addScaledVector(b.dir, SPEED * dt);
            b.life -= dt;
            // 1フレームで進んだ線分と敵の球で当たり判定（速い弾のすり抜け防止）
            for (const e of enemies) {
                if (!e.dead && segmentHitsSphere(prev, b.mesh.position, e.position, e.radius)) {
                    b.life = 0;
                    onHit(e, DAMAGE, b.mesh.position.clone());
                    break;
                }
            }
        }
        this.removeWhere((b) => b.life <= 0 || b.mesh.position.y < 0);
    }

    spawn(aim, enemies, lock) {
        // 照準の先にある点を狙う（敵に当たればその敵、なければ遠く）
        this.raycaster.setFromCamera(new THREE.Vector2(aim.x, aim.y), this.camera);
        const ray = this.raycaster.ray;
        let t = RANGE;
        for (const e of enemies) {
            if (e.dead) continue;
            const hit = ray.intersectSphere(new THREE.Sphere(e.position, e.radius), new THREE.Vector3());
            if (hit) t = Math.min(t, hit.distanceTo(ray.origin));
        }
        const target = lock && !lock.dead ? lock.position.clone() : ray.at(t, new THREE.Vector3());

        const start = this.camera.localToWorld(MUZZLES[this.side].clone());
        const dir = target.sub(start).normalize();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(start);
        mesh.lookAt(start.clone().add(dir));
        this.scene.add(mesh);
        this.bullets.push({ mesh, dir, life: LIFE });

        this.cockpit.kick(this.side);
        this.side = 1 - this.side;
    }

    removeWhere(fn) {
        this.bullets = this.bullets.filter((b) => {
            if (!fn(b)) return true;
            this.scene.remove(b.mesh);
            return false;
        });
    }

    clear() {
        this.removeWhere(() => true);
    }
}

export function segmentHitsSphere(a, b, center, radius) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(center, a).dot(ab) / (ab.lengthSq() || 1), 0, 1);
    return a.clone().addScaledVector(ab, t).distanceToSquared(center) < radius * radius;
}
