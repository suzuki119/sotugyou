// ゲーム本体：自機・武器・敵・ウェーブ・勝敗。入力は InputManager の input だけを受け取る

import * as THREE from 'three';
import { Player, MAX_HP } from './player.js';
import { Weapon } from './weapon.js';
import { Stage } from './stage.js';
import { Drone } from './enemies/drone.js';
import { Walker } from './enemies/walker.js';
import { Boss } from './enemies/boss.js';
import { EnemyBullets } from './enemies/enemyBullets.js';
import { Cockpit } from '../render/cockpit.js';
import { CONFIG } from '../config.js';

const ZAKO_TO_BOSS = 12;    // この数を倒すとボス戦
const ZAKO_MAX_TIME = 120;  // 倒しきれなくてもこの秒数でボス戦
const MAX_ALIVE = 5;

// 照準マーカーが動ける範囲（画面の端まで行かないよう少し狭める）
const AIM_LIMIT = { x: 0.85, y: 0.8 };
const clamp = (v, m) => Math.max(-m, Math.min(m, v));

export class GameManager {
    constructor(sceneManager, onEvent) {
        const { scene, camera } = sceneManager;
        this.scene = scene;
        this.onEvent = onEvent;
        this.stage = new Stage(scene);
        this.player = new Player(scene, camera);
        this.cockpit = new Cockpit(camera);
        this.weapon = new Weapon(scene, camera, this.cockpit);
        this.bullets = new EnemyBullets(scene);
        this.enemies = [];
        this.effects = [];
        this.reset();
    }

    reset() {
        for (const e of this.enemies) this.scene.remove(e.object);
        for (const f of this.effects) this.scene.remove(f.mesh);
        this.enemies = [];
        this.effects = [];
        this.weapon.clear();
        this.bullets.clear();
        this.player.reset();
        this.time = 0;
        this.kills = 0;
        this.score = 0;
        this.spawnTimer = 1.5;
        this.boss = null;
        this.damageFlash = 0;
        this.rawAim = { x: 0, y: 0 };      // 入力だけで決まる照準の位置
        this.crosshair = { x: 0, y: 0 };   // エイムアシスト後の照準の位置（画面に出す・撃つ）
        this.lock = null;
        this.autoY = 0;
    }

    // mode: 'play'（敵あり）/ 'practice'（チュートリアル：敵なし）
    update(dt, input, mode) {
        this.time += dt;
        this.updateCrosshair(dt, input);
        this.player.update(dt, input, this.crosshair);
        this.weapon.update(dt, input.fire, this.crosshair, this.enemies, (e, dmg, at) => this.onHit(e, dmg, at), this.lock);
        this.cockpit.update(dt);
        this.cockpit.updateStick(input);
        this.updateEffects(dt);
        this.damageFlash = Math.max(0, this.damageFlash - dt);
        if (mode !== 'play') return;

        if (!this.boss) this.updateWave(dt);

        const eye = this.player.eye;
        for (const e of this.enemies) e.update(dt, { eye, bullets: this.bullets });
        const damage = this.bullets.update(dt, eye);
        if (damage > 0) {
            this.player.damage(damage);
            this.damageFlash = 0.3;
        }

        if (this.player.hp <= 0) this.onEvent('gameover');
        else if (this.boss?.dead) this.onEvent('clear');
    }

    updateCrosshair(dt, input) {
        const a = CONFIG.aim;
        if (a.control === 'rate') {
            // 倒している間だけ照準が動き、スティックを戻すとその場に止まる
            this.rawAim.x = clamp(this.rawAim.x + input.aimX * a.rateSpeed * dt, AIM_LIMIT.x);
            this.rawAim.y = clamp(this.rawAim.y + input.aimY * a.rateSpeed * dt, AIM_LIMIT.y);
        } else {
            this.rawAim = { x: input.aimX * AIM_LIMIT.x, y: input.aimY * AIM_LIMIT.y };
        }

        // 敵の画面上の位置（後ろにいる敵は除く）
        const camera = this.player.camera;
        camera.updateMatrixWorld();
        const aspect = camera.aspect;
        const onScreen = this.enemies
            .filter((e) => !e.dead)
            .map((e) => ({ e, p: e.position.clone().project(camera) }))
            .filter(({ p }) => p.z <= 1);

        // 上下の自動照準：照準の縦の線に一番近い敵の高さへ、なめらかに合わせる
        if (CONFIG.aimAxis === 'horizontalAuto') {
            let targetY = 0, bestDx = CONFIG.autoVerticalWidth;
            for (const { p } of onScreen) {
                const dx = Math.abs(p.x - this.rawAim.x) * aspect;
                if (dx < bestDx) { bestDx = dx; targetY = clamp(p.y, AIM_LIMIT.y); }
            }
            this.autoY += (targetY - this.autoY) * Math.min(1, dt * 8);
            this.rawAim.y = this.autoY;
        }

        // エイムアシスト：照準の近くにいる一番近い敵に吸い付く
        let best = null, bestD = a.assistRadius;
        for (const o of onScreen) {
            const d = Math.hypot((o.p.x - this.rawAim.x) * aspect, o.p.y - this.rawAim.y);
            if (d < bestD) { best = o; bestD = d; }
        }
        this.lock = best?.e ?? null;
        if (best) {
            const pull = a.assistStrength * (1 - bestD / a.assistRadius * 0.5);
            this.crosshair = {
                x: this.rawAim.x + (best.p.x - this.rawAim.x) * pull,
                y: this.rawAim.y + (best.p.y - this.rawAim.y) * pull,
            };
        } else {
            this.crosshair = { ...this.rawAim };
        }
    }

    updateWave(dt) {
        if (this.kills >= ZAKO_TO_BOSS || this.time > ZAKO_MAX_TIME) {
            this.boss = this.spawn(new Boss(), 90);
            this.onEvent('boss');
            return;
        }
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && this.enemies.length < MAX_ALIVE) {
            this.spawnTimer = 2.5;
            this.spawn(Math.random() < 0.65 ? new Drone() : new Walker(), 70 + Math.random() * 30);
        }
    }

    // プレイヤーの正面（左右に少しばらけて）に出す
    spawn(enemy, distance) {
        const a = this.player.yaw + (Math.random() - 0.5) * 1.6;
        const p = this.player.object.position;
        enemy.position.x = p.x - Math.sin(a) * distance;
        enemy.position.z = p.z - Math.cos(a) * distance;
        this.scene.add(enemy.object);
        this.enemies.push(enemy);
        return enemy;
    }

    onHit(enemy, damage, at) {
        enemy.hit(damage);
        this.effect(at, 0xffe066, 1.2, 0.15);
        if (!enemy.dead) return;
        this.effect(enemy.position.clone(), 0xff8a3c, enemy.radius * 2, 0.5);
        this.scene.remove(enemy.object);
        this.enemies = this.enemies.filter((e) => e !== enemy);
        this.score += enemy.score;
        if (enemy !== this.boss) this.kills += 1;
    }

    // 爆発の代わり：広がって消える球
    effect(position, color, size, life) {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 12, 8),
            new THREE.MeshBasicMaterial({ color, transparent: true }),
        );
        mesh.position.copy(position);
        this.scene.add(mesh);
        this.effects.push({ mesh, size, life, max: life });
    }

    updateEffects(dt) {
        this.effects = this.effects.filter((f) => {
            f.life -= dt;
            const t = 1 - f.life / f.max;
            f.mesh.scale.setScalar(0.2 + t * f.size);
            f.mesh.material.opacity = 1 - t;
            if (f.life > 0) return true;
            this.scene.remove(f.mesh);
            f.mesh.geometry.dispose();
            f.mesh.material.dispose();
            return false;
        });
    }

    // スコア：撃破 + 残りHP + 早くクリアしたボーナス（計算方法は Phase 4 で調整）
    result(cleared) {
        const hpBonus = cleared ? this.player.hp * 20 : 0;
        const timeBonus = cleared ? Math.max(0, Math.round((300 - this.time) * 10)) : 0;
        return {
            cleared,
            time: this.time,
            kills: this.kills,
            hp: this.player.hp,
            maxHp: MAX_HP,
            score: this.score + hpBonus + timeBonus,
        };
    }
}
