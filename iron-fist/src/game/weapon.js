// 自機の武器：親指を閉じている間、左右の銃から交互に連射する
//   1発ごとにエネルギーを消費し、撃たずにいると自動で回復する（CONFIG.energy）

import * as THREE from 'three';
import { MUZZLES } from '../render/cockpit.js';
import { CONFIG } from '../config.js';
import { sound } from '../audio/sound.js';
import { createBullet } from '../render/bulletModel.js';

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
        this.coop = false;         // 降りている間は、エネルギーが速く回復する
        this.resetEnergy();
    }

    resetEnergy() {
        this.energy = CONFIG.energy.max;
        this.overheat = false;     // 撃ち切ったら、ある程度回復するまで撃てない
        this.sinceShot = Infinity; // 最後に撃ってからの秒数
    }

    // aim は照準の画面上の位置（-1〜1）
    // lock：エイムアシストで捉えている敵（いればその敵に向けて撃つ）
    update(dt, firing, aim, enemies, onHit, lock) {
        // 毎フレーム。firing＝撃つ入力、aim＝照準の画面位置、lock＝吸い付いた敵。
        //   ① 撃つ：cooldown が 0 以下・オーバーヒートでない・エネルギーがある → 1発出してエネルギーを減らす（0 でオーバーヒート）
        //   ② 回復：撃っていない（またはオーバーヒート中）で、最後に撃ってから delay 以上たったら回復。
        //      共闘中（this.coop）は delay が 0 で回復も coopRegenMul 倍
        //   ③ 弾の移動と当たり判定：前フレームの位置〜今の位置の線分と、敵の球で判定する（速い弾のすり抜け防止）
        const E = CONFIG.energy;
        this.cooldown -= dt;
        this.sinceShot += dt;
        if (firing && !this.overheat && this.cooldown <= 0 && this.energy > 0) {
            this.cooldown = 1 / FIRE_RATE;
            this.energy = Math.max(0, this.energy - E.costPerShot);
            this.sinceShot = 0;
            if (this.energy <= 0) { this.overheat = true; sound.play('outOfEnergy'); }
            this.spawn(aim, enemies, lock);
        }
        // 撃っていなければ回復（オーバーヒート中は親指を閉じたままでも回復する）
        const delay = this.coop ? E.coopRegenDelayMs : E.regenDelayMs;
        if ((!firing || this.overheat) && this.sinceShot * 1000 >= delay) {
            this.energy = Math.min(E.max, this.energy + E.regenPerSec * (this.coop ? E.coopRegenMul : 1) * dt);
        }
        if (this.overheat && this.energy >= E.resumeAt) this.overheat = false;

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
        // 弾を1発出す。狙う点 = lock がいればその敵の位置 / いなければ照準の線が敵の球に当たる点 / 何もなければ遠く(RANGE)。
        // 左右の銃口（MUZZLES）から交互に出し、コックピットの銃身を反動で動かし、音を少し音程を変えて鳴らす。
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
        const mesh = createBullet('player', () => new THREE.Mesh(geo, mat));
        mesh.position.copy(start);
        mesh.lookAt(start.clone().add(dir));
        this.scene.add(mesh);
        this.bullets.push({ mesh, dir, life: LIFE });

        this.cockpit.kick(this.side);
        sound.play('gun', { rate: 0.95 + Math.random() * 0.1 });   // 少し音程をばらして、連射が単調に聞こえないようにする
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
        this.resetEnergy();
    }
}

const segment = new THREE.Line3();
const nearest = new THREE.Vector3();

// 線分 a→b が球に触れるか（速い弾のすり抜け防止）
export function segmentHitsSphere(a, b, center, radius) {
    segment.set(a, b).closestPointToPoint(center, true, nearest);
    return nearest.distanceToSquared(center) < radius * radius;
}
