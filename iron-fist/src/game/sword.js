// 共闘モードの剣：右手を素早く振ると斬る。斬ると前方へ斬撃（三日月形の波）が飛ぶ
//   斬撃は前方の円錐の中にいる一番近い敵へ向かう（巨大な敵や空中の敵にも届くように）
//   剣はカメラの子にして、右手の位置に合わせて画面の右下で動かす

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { segmentHitsSphere } from './weapon.js';

const SWING_TIME = 0.22;     // 振り抜くのにかかる時間（秒）
const WAVE_SPEED = 80;       // m/s
const WAVE_LIFE = 0.9;       // 秒（届く距離 ≒ 72m）
const WAVE_RADIUS = 1.8;     // 斬撃の当たりの太さ
const DAMAGE = 35;
const AIM_CONE = Math.cos(THREE.MathUtils.degToRad(35));   // この角度以内の敵を狙う

const waveGeo = new THREE.TorusGeometry(2.2, 0.18, 6, 28, Math.PI);
const waveMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

export class Sword {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        // 見た目：柄と刃。pivot（手元）を回して振る
        this.group = new THREE.Group();
        this.group.visible = false;
        camera.add(this.group);
        this.pivot = new THREE.Group();
        this.pivot.scale.setScalar(0.7);
        this.group.add(this.pivot);
        const metal = new THREE.MeshStandardMaterial({ color: 0xcfe6f5, metalness: 0.9, roughness: 0.25, emissive: 0x15394a });
        const grip = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8 });
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.012), metal);
        blade.position.y = 0.55;
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.05), grip);
        guard.position.y = 0.09;
        const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 8), grip);
        this.pivot.add(blade, guard, hilt);

        this.waves = [];
        this.reset();
    }

    reset() {
        this.cooldown = 0;
        this.swingT = 1;          // 1＝振っていない
        this.swingDir = 1;
        this.prevFire = false;
        this.slashes = 0;         // 斬った回数（チュートリアル用）
        for (const w of this.waves) this.scene.remove(w.mesh);
        this.waves = [];
    }

    // active：共闘モードのとき true（搭乗モードでは飛んでいる斬撃だけ動かす）
    // blockers：斬撃が当たる敵以外のもの（コンテナ）。狙いには使わない
    update(dt, input, active, enemies, onHit, blockers = []) {
        this.cooldown -= dt;
        if (active) {
            const swung = input.rightTracked && input.swing > CONFIG.sword.swingSpeed;
            const clicked = input.fire && !this.prevFire;   // 親指 / キーボードでも斬れる
            if ((swung || clicked) && this.cooldown <= 0) this.slash(input, enemies);
            this.prevFire = input.fire;
            this.pose(dt, input);
        }
        this.updateWaves(dt, blockers.length ? [...enemies, ...blockers] : enemies, onHit);
    }

    slash(input, enemies) {
        this.cooldown = CONFIG.sword.cooldownMs / 1000;
        this.swingT = 0;
        // 刃は手を振った向きに動かす（キーボードで斬ったときは左右交互）
        this.swingDir = input.swing > 0 && Math.abs(input.swingX) > 0.2 ? Math.sign(input.swingX) : -this.swingDir;
        this.slashes += 1;

        const start = this.camera.getWorldPosition(new THREE.Vector3());
        const forward = this.camera.getWorldDirection(new THREE.Vector3());
        // 前方の円錐の中で一番近い敵を狙う
        let dir = forward.clone(), best = Infinity;
        for (const e of enemies) {
            if (e.dead) continue;
            const to = e.position.clone().sub(start);
            const d = to.length();
            if (d < best && to.normalize().dot(forward) > AIM_CONE) {
                best = d;
                dir = to;
            }
        }
        const mesh = new THREE.Mesh(waveGeo, waveMat.clone());
        mesh.position.copy(start).addScaledVector(dir, 1.5);
        mesh.lookAt(mesh.position.clone().add(dir));
        // 三日月の傾き：横に振ったら横、縦に振ったら縦
        const roll = input.swing > 0 ? Math.atan2(input.swingY, input.swingX) : 0;
        mesh.rotateZ(roll + Math.PI / 2);
        this.scene.add(mesh);
        this.waves.push({ mesh, dir, life: WAVE_LIFE, hit: new Set() });
    }

    // 剣の見た目：右手の位置に合わせて動き、斬ったときは振り抜く
    pose(dt, input) {
        this.group.position.set(0.34 + input.handX * 0.22, -0.46 + input.handY * 0.14, -0.8);
        this.swingT = Math.min(1, this.swingT + dt / SWING_TIME);
        const t = this.swingT, ease = 1 - (1 - t) ** 3;
        const swinging = t < 1;
        this.pivot.rotation.set(
            -0.35 - (swinging ? Math.sin(Math.PI * t) * 0.9 : 0),              // 振るときは前に倒す
            0,
            swinging ? this.swingDir * (1.4 - ease * 2.8) : 0.35 - input.handX * 0.3,   // 振り抜く／構え
        );
    }

    updateWaves(dt, enemies, onHit) {
        const prev = new THREE.Vector3();
        for (const w of this.waves) {
            prev.copy(w.mesh.position);
            w.mesh.position.addScaledVector(w.dir, WAVE_SPEED * dt);
            w.life -= dt;
            const t = 1 - w.life / WAVE_LIFE;
            w.mesh.scale.setScalar(1 + t * 1.5);
            w.mesh.material.opacity = 1 - t * t;
            // 斬撃は敵を貫通する（同じ敵には1回だけ当たる）
            for (const e of enemies) {
                if (e.dead || w.hit.has(e)) continue;
                if (segmentHitsSphere(prev, w.mesh.position, e.position, e.radius + WAVE_RADIUS)) {
                    w.hit.add(e);
                    onHit(e, DAMAGE, w.mesh.position.clone());
                }
            }
        }
        this.waves = this.waves.filter((w) => {
            if (w.life > 0) return true;
            this.scene.remove(w.mesh);
            w.mesh.material.dispose();
            return false;
        });
    }
}
