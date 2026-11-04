// ゲーム本体：自機・武器・敵・ウェーブ・勝敗。入力は InputManager の input だけを受け取る
//   モードは2つ。手をパーにして切り替える
//     ride（搭乗）：ロボットに乗って、コックピットから銃で撃つ
//     coop（共闘）：ロボットから降りて生身で剣を振る。ロボットは自分で歩いて戦う

import * as THREE from 'three';
import { Player, MAX_HP } from './player.js';
import { Weapon } from './weapon.js';
import { Stage } from './stage.js';
import { Drone } from './enemies/drone.js';
import { Walker } from './enemies/walker.js';
import { Boss } from './enemies/boss.js';
import { EnemyBullets } from './enemies/enemyBullets.js';
import { Cockpit } from '../render/cockpit.js';
import { Sword } from './sword.js';
import { Companion } from './companion.js';
import { Boarding } from './boarding.js';
import { CONFIG } from '../config.js';

const ZAKO_TO_BOSS = 12;    // この数を倒すとボス戦
const ZAKO_MAX_TIME = 120;  // 倒しきれなくてもこの秒数でボス戦
const MAX_ALIVE = 5;
const ROBOT_HIT = { radius: 4.5, scale: 0.5 };          // 共闘モードでロボットが受ける弾（大きくて当たりやすいが、ダメージは半分）
const PLAYER_AGGRO = 0.5;   // 共闘モード：プレイヤーまでの距離がロボットまでの距離のこの割合より近い敵だけ、プレイヤーを狙う

// 照準マーカーが動ける範囲（画面の端まで行かないよう少し狭める）
const AIM_LIMIT = { x: 0.85, y: 0.8 };
const clamp = (v, m) => Math.max(-m, Math.min(m, v));
const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class GameManager {
    // robot：RobotModel（演出と共用）
    constructor(sceneManager, robot, onEvent) {
        const { scene, camera } = sceneManager;
        this.scene = scene;
        this.onEvent = onEvent;
        this.stage = new Stage(scene, sceneManager.envMap);
        this.player = new Player(scene, camera);
        this.cockpit = new Cockpit(camera);
        this.weapon = new Weapon(scene, camera, this.cockpit);
        this.sword = new Sword(scene, camera);
        this.robot = robot;
        this.companion = new Companion(scene, robot);
        this.boarding = new Boarding(this.player, robot, this.cockpit);
        this.bullets = new EnemyBullets(scene);
        this.enemies = [];
        this.dying = [];     // 倒れるモーション中の敵（当たり判定はもうない）
        this.effects = [];
        this.reset();
    }

    reset() {
        for (const e of [...this.enemies, ...this.dying]) this.removeEnemy(e);
        for (const f of this.effects) this.scene.remove(f.mesh);
        this.enemies = [];
        this.dying = [];
        this.effects = [];
        this.weapon.clear();
        this.bullets.clear();
        this.boarding.cancel();
        this.player.reset();
        this.stage.closeGate(true);
        this.sword.reset();
        this.companion.reset(this.player.object.position, this.player.yaw);
        this.mode = 'ride';
        this.switchHold = 0;
        this.switchArmed = false;    // 一度パーをやめるまで切り替えない（開始直後の誤動作防止）
        this.syncView();
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
        const boarding = this.boarding.running;
        if (!boarding) this.updateModeSwitch(dt, input);
        const riding = this.mode === 'ride';
        const onHit = (e, dmg, at) => this.onHit(e, dmg, at);
        if (boarding) {
            // 乗り降りの演出中：操作はきかない。カメラとロボットは演出が動かす
            this.boarding.update(dt);
            this.weapon.update(dt, false, this.crosshair, this.enemies, onHit, null);
            this.sword.update(dt, {}, false, this.enemies, onHit);
        } else {
            this.updateCrosshair(dt, riding ? input : { ...input, aimX: 0, aimY: 0 });
            this.player.update(dt, input, riding ? this.rawAim : { x: 0, y: 0 });
            this.weapon.update(dt, riding && input.fire, this.crosshair, this.enemies, onHit, this.lock);
            this.sword.update(dt, input, !riding, this.enemies, onHit);
            if (riding) this.companion.follow(this.player);
            else this.companion.update(dt, { player: this.player, enemies: this.enemies, onHit });
        }
        this.companion.updateTracers(dt);
        this.cockpit.update(dt);
        this.cockpit.updateStick(input);
        this.updateEffects(dt);
        this.updateDying(dt);
        this.stage.update(dt);
        this.damageFlash = Math.max(0, this.damageFlash - dt);
        if (mode !== 'play') return;

        if (!this.boss) this.updateWave(dt);

        // 敵の狙い：搭乗モードはプレイヤー。共闘モードは基本的にロボットで、プレイヤーがずっと近いときだけプレイヤー
        const eye = this.player.eye;
        const targets = [{ position: eye, radius: this.player.radius, scale: 1 }];
        if (!riding) targets.push({ position: this.companion.chest, ...ROBOT_HIT });
        for (const e of this.enemies) {
            const near = targets.length > 1 && flatDist(e.position, targets[1].position) * PLAYER_AGGRO > flatDist(e.position, eye)
                ? targets[0] : targets.at(-1);
            e.update(dt, { eye: near.position, bullets: this.bullets });
        }
        const damage = this.bullets.update(dt, targets);
        if (damage > 0 && !this.boss?.dead && !this.boarding.running) {   // 乗り降りの演出中もダメージを受けない   // ボスを倒したあと（倒れている間）はダメージを受けない
            this.player.damage(Math.round(damage));
            this.damageFlash = 0.3;
        }

        if (this.player.hp <= 0) this.onEvent('gameover');
        else if (this.boss?.dead && !this.dying.includes(this.boss)) this.onEvent('clear');   // ボスが倒れきったらクリア
    }

    // 手をパーにして holdMs 待つと切り替える
    updateModeSwitch(dt, input) {
        const s = CONFIG.modeSwitch;
        const open = s.hands === 'both' ? input.leftOpen && input.rightOpen : input.leftOpen || input.rightOpen;
        if (!open) {
            this.switchArmed = true;
            this.switchHold = 0;
            return;
        }
        if (!this.switchArmed) return;
        this.switchHold += dt;
        if (this.switchHold >= s.holdMs / 1000) {
            this.switchArmed = false;
            this.switchHold = 0;
            this.setMode(this.mode === 'ride' ? 'coop' : 'ride');
        }
    }

    // 切り替えの進み具合（0〜1、HUD 用）
    get switchProgress() {
        return this.switchArmed ? Math.min(1, this.switchHold / (CONFIG.modeSwitch.holdMs / 1000)) : 0;
    }

    // 一人称の乗り降りの演出を見せてから切り替える
    setMode(mode) {
        const c = this.companion;
        this.sword.group.visible = false;
        if (mode === 'coop') {
            // 降りる：ロボットはその場に残り、プレイヤーはハッチから出て前に立つ
            c.reset(this.player.object.position, this.player.yaw);
            this.boarding.dismount(c.position, c.yaw, (position, yaw) => {
                this.player.setMode('coop', position, yaw);
                c.anim = 'Stand';   // 立ち上がるクリップは演出で再生済み
                this.finishMode('coop');
            });
        } else {
            // 乗る：ロボットの前まで歩いて、ハッチから乗り込む
            this.boarding.mount(c.position, c.yaw, () => {
                this.player.setMode('ride', c.position, c.yaw);
                this.finishMode('ride');
            });
        }
    }

    finishMode(mode) {
        this.mode = mode;
        this.rawAim = { x: 0, y: 0 };
        this.syncView();
        this.onEvent('mode', mode);
    }

    // モードに合わせて、コックピット・剣・ロボットの見え方をそろえる
    syncView() {
        if (this.boarding.running) return;   // 乗り降りの演出中は演出が決める
        const coop = this.mode === 'coop';
        this.cockpit.group.visible = !coop;
        this.sword.group.visible = coop;
        this.robot.object.visible = coop && this.robot.ready;
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
            this.boss = this.spawn(new Boss(), true);
            this.onEvent('boss');
            return;
        }
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && this.enemies.length < MAX_ALIVE) {
            this.spawnTimer = 2.5;
            this.spawn(Math.random() < 0.65 ? new Drone() : new Walker());
        }
    }

    // 闘技場の門の左右（ボスは門の正面）から出す。最初の1体で門が開く
    spawn(enemy, isBoss = false) {
        const at = this.stage.spawnPoint(isBoss);
        enemy.position.x = at.x;
        enemy.position.z = at.z;
        enemy.object.lookAt(this.player.eye.x, enemy.position.y, this.player.eye.z);
        this.stage.openGate();
        this.scene.add(enemy.object);
        this.enemies.push(enemy);
        return enemy;
    }

    onHit(enemy, damage, at) {
        if (enemy.dead) return;   // 同じフレームに2回当たったとき
        enemy.hit(damage);
        this.effect(at, 0xffe066, 1.2, 0.15);
        if (!enemy.dead) return;
        this.effect(enemy.position.clone(), 0xff8a3c, enemy.radius * 2, 0.5);
        // 倒れるモーションを見せてから消す
        this.enemies = this.enemies.filter((e) => e !== enemy);
        this.dying.push(enemy);
        this.score += enemy.score;
        if (enemy !== this.boss) this.kills += 1;
    }

    updateDying(dt) {
        this.dying = this.dying.filter((e) => {
            if (e.updateDying(dt)) return true;
            this.removeEnemy(e);
            return false;
        });
    }

    removeEnemy(e) {
        this.scene.remove(e.object);
        e.dispose();
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
