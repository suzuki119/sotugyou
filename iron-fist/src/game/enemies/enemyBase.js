// 敵の共通部分：HP・当たり判定の半径・被弾時の点滅・アニメーション・倒れるまで
//   モデル（models/ の glb）が読み込めていればそれを使い、なければ各敵の仮の形（箱など）を使う
//   object の原点＝当たり判定の中心

import * as THREE from 'three';
import { EnemyRig, hasEnemyModel } from '../../render/enemyModels.js';
import { ENEMY_RADIUS } from '../stage.js';

const HIT_REACT_GAP = 0.6;   // のけぞり（Hit）を続けて再生しない間隔（秒）。連射で動けなくならないように
const DEFEAT_LINGER = 0.6;   // 倒れるモーションが終わってから消えるまで（秒）

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
        this.rig = null;
        this.busy = 0;          // Attack / Hit を再生中の残り時間（その間は Stand / Run に戻さない）
        this.loco = null;       // 今の Stand / Run
        this.lastHitReact = -Infinity;
        this.prev = new THREE.Vector3();
    }

    get position() {
        return this.object.position;
    }

    // モデルを使う。読み込めていなければ false（仮の形を作る）
    useModel(kind) {
        if (!hasEnemyModel(kind)) return false;
        this.rig = new EnemyRig(kind);
        this.object.add(this.rig.object);
        this.setLoco('Stand');
        return true;
    }

    // 点滅させたいマテリアルはここで作る（仮の形用）
    material(color) {
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
        this.materials.push(m);
        return m;
    }

    hit(damage) {
        if (this.dead) return;
        this.hp -= damage;
        this.flash = 0.06;
        if (this.hp <= 0) this.die();
        else if (this.age - this.lastHitReact > HIT_REACT_GAP && this.busy <= 0) this.react('Hit');
    }

    // 攻撃のモーション（弾を撃つ側で呼ぶ）
    attack() {
        if (this.busy <= 0) this.react('Attack');
    }

    react(name) {
        if (!this.rig) return;
        if (name === 'Hit') this.lastHitReact = this.age;
        this.rig.play(name, { once: true, fade: 0.1 });
        this.busy = this.rig.duration(name);
        this.loco = null;
    }

    setLoco(name) {
        if (!this.rig || this.loco === name) return;
        this.loco = name;
        this.rig.play(name, { fade: 0.25 });
    }

    die() {
        this.dead = true;
        this.dying = 0;
        this.fall = 0;
        this.flash = 0;
        if (this.rig) this.rig.play('Defeat', { once: true, fade: 0.1 });
    }

    // 倒れている途中。消してよくなったら false を返す
    updateDying(dt) {
        this.dying += dt;
        this.applyFlash();
        this.rig?.update(dt);
        this.fallDown(dt);
        const length = this.rig ? this.rig.duration('Defeat') + DEFEAT_LINGER : 0;
        return this.dying < length;
    }

    // 空中の敵は倒れたら地面まで落ちる（ドローンで上書き）
    fallDown() {}

    // ctx: { eye, bullets, dt }
    update(dt, ctx) {
        this.age += dt;
        this.flash -= dt;
        this.busy -= dt;
        this.applyFlash();
        this.prev.copy(this.position);
        this.behave(dt, ctx);
        // 闘技場の壁の外へ出ない
        const r = Math.hypot(this.position.x, this.position.z);
        if (r > ENEMY_RADIUS) {
            this.position.x *= ENEMY_RADIUS / r;
            this.position.z *= ENEMY_RADIUS / r;
        }
        if (this.rig) {
            // 動いている速さで Stand / Run を切り替える（Attack / Hit の再生中はそのまま）
            const speed = Math.hypot(this.position.x - this.prev.x, this.position.z - this.prev.z) / Math.max(dt, 1e-4);
            if (this.busy <= 0) this.setLoco(speed > 1.5 ? 'Run' : 'Stand');
            this.rig.update(dt);
        }
    }

    applyFlash() {
        const on = this.flash > 0;
        if (this.rig) this.rig.flash(on);
        for (const m of this.materials) m.emissive.setHex(on ? 0xffffff : 0x000000);
    }

    dispose() {
        this.rig?.dispose();
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
