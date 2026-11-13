// ゲーム本体：自機・武器・敵・ウェーブ・勝敗。入力は InputManager の input だけを受け取る
//   モードは2つ。手をパーにして切り替える
//     ride（搭乗）：ロボットに乗って、コックピットから銃で撃つ
//     coop（共闘）：ロボットから降りて生身で剣を振る。ロボットは自分で歩いて戦う

import { Player, MAX_HP } from './player.js';
import { Weapon } from './weapon.js';
import * as THREE from 'three';
import { Stage } from './stage.js';
import { Drone } from './enemies/drone.js';
import { Walker } from './enemies/walker.js';
import { Boss } from './enemies/boss.js';
import { EnemyBullets } from './enemies/enemyBullets.js';
import { Cockpit } from '../render/cockpit.js';
import { Sword } from './sword.js';
import { Companion } from './companion.js';
import { Boarding } from './boarding.js';
import { Aim } from './aim.js';
import { Effects } from './effects.js';
import { TutorialZone } from './tutorialZone.js';
import { JumpPads } from './jumpPad.js';
import { Pickups, createPickupMesh } from './pickups.js';
import { Containers, createContainerMesh } from './container.js';
import { CONFIG } from '../config.js';
import { sound } from '../audio/sound.js';
import { createBullet } from '../render/bulletModel.js';

const ZAKO_TO_BOSS = 12;    // この数を倒すとボス戦
const ZAKO_MAX_TIME = 120;  // 倒しきれなくてもこの秒数でボス戦
const MAX_ALIVE = 5;
const ROBOT_HIT = { radius: 4.5, scale: 0.5 };          // 共闘モードでロボットが受ける弾（大きくて当たりやすいが、ダメージは半分）
const PLAYER_AGGRO = 0.5;   // 共闘モード：プレイヤーまでの距離がロボットまでの距離のこの割合より近い敵だけ、プレイヤーを狙う

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
        this.aim = new Aim();
        this.effects = new Effects(scene);
        this.zone = new TutorialZone(scene);
        this.jumpPads = new JumpPads(scene);
        this.pickups = new Pickups(scene);
        this.containers = new Containers(scene);
        this.enemies = [];
        this.dying = [];     // 倒れるモーション中の敵（当たり判定はもうない）
        this.reset();
    }

    // 初めて敵・弾・爆発が出たときのカクつき（シェーダーのコンパイルと GPU への転送）を防ぐため、
    // 先に一度だけ小さな描画先へ描いておく。画面には出ない
    warmUp(renderer) {
        const enemies = [new Drone(), new Walker(), new Boss()];
        enemies.forEach((e, i) => { e.position.set((i - 1) * 22, 0, 50); this.scene.add(e.object); });
        enemies[0].setOutline(true);   // チュートリアルの的の輪郭
        const bullets = ['player', 'enemy'].map((kind, i) => {
            const b = createBullet(kind, () => new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshBasicMaterial()));
            b.position.set(i * 4 - 2, 6, 40);
            this.scene.add(b);
            return b;
        });
        this.effects.add(new THREE.Vector3(0, 8, 45), 0xffe066, 1, 1);
        const props = [createContainerMesh(), createPickupMesh()].map(({ group }, i) => {
            group.position.set(i * 10 - 5, 3, 35);
            this.scene.add(group);
            return group;
        });

        const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 600);
        camera.position.set(0, 10, 0);
        camera.lookAt(0, 5, 50);
        const target = new THREE.WebGLRenderTarget(64, 64);
        renderer.setRenderTarget(target);
        renderer.render(this.scene, camera);
        renderer.setRenderTarget(null);
        target.dispose();

        this.effects.clear();
        for (const b of bullets) this.scene.remove(b);
        for (const g of props) this.scene.remove(g);
        enemies.forEach((e) => this.removeEnemy(e));
    }

    reset() {
        for (const e of [...this.enemies, ...this.dying]) this.removeEnemy(e);
        this.enemies = [];
        this.dying = [];
        this.effects.clear();
        this.hideZone();
        this.pickups.clear();
        this.containers.clear();
        this.weapon.clear();
        this.bullets.clear();
        this.boarding.cancel();
        this.player.reset();
        this.sword.reset();
        this.companion.reset(this.player.object.position, this.player.yaw);
        this.mode = 'ride';
        this.playing = false;   // 敵が出ている本番か（チュートリアルでは回復アイテムを落とさない）
        this.switchHold = 0;
        this.switchArmed = false;    // 一度パーをやめるまで切り替えない（開始直後の誤動作防止）
        this.syncView();
        this.time = 0;
        this.kills = 0;
        this.score = 0;
        this.spawnTimer = 1.5;
        this.boss = null;
        this.damageFlash = 0;
        this.aim.reset();
    }

    // HUD から読む：エイムアシスト後の照準の位置と、吸い付いている敵
    get crosshair() { return this.aim.crosshair; }
    get lock() { return this.aim.lock; }

    // mode: 'play'（敵あり）/ 'practice'（チュートリアル：敵なし）
    update(dt, input, mode) {
        this.time += dt;
        const boarding = this.boarding.running;
        this.playing = mode === 'play';
        if (!boarding && !this.player.airborne) this.updateModeSwitch(dt, input);   // 空中では乗り降りしない
        const riding = this.mode === 'ride';
        const onHit = (e, dmg, at) => this.onHit(e, dmg, at);
        const blockers = this.containers.landed;   // 弾・斬撃を受けるコンテナ
        const hittables = blockers.length ? [...this.enemies, ...blockers] : this.enemies;
        if (boarding) {
            // 乗り降りの演出中：操作はきかない。カメラとロボットは演出が動かす
            this.boarding.update(dt);
            sound.loop('steam');
            this.weapon.update(dt, false, this.crosshair, hittables, onHit, null);
            this.sword.update(dt, {}, false, this.enemies, onHit, blockers);
        } else {
            this.aim.update(dt, riding ? input : { ...input, aimX: 0, aimY: 0 }, this.player.camera, this.enemies);
            this.player.update(dt, input, riding ? this.aim.rawAim : { x: 0, y: 0 }, blockers);
            this.jumpPads.update(dt, this.player);
            // 足音：移動の入力の大きさで音量を変える。生身は軽く速く
            const step = Math.min(1, Math.hypot(input.moveY, riding && CONFIG.turnWith !== 'leftStick' ? input.moveX : 0));
            if (step > 0.1) sound.loop('footstep', step, riding ? 1 : 1.4);
            this.weapon.update(dt, riding && input.fire, this.crosshair, hittables, onHit, this.lock);
            this.sword.update(dt, input, !riding, this.enemies, onHit, blockers);
            if (riding) this.companion.follow(this.player);
            else this.companion.update(dt, { player: this.player, enemies: this.enemies, onHit });
        }
        this.companion.updateTracers(dt);
        this.cockpit.update(dt);
        this.cockpit.updateStick(input, dt);
        this.effects.update(dt);
        this.updateDying(dt);
        this.zone.update(dt);
        this.pickups.update(dt, this.player, (at) => this.effects.add(at, 0x39ff6a, 3, 0.35));
        this.containers.update(dt, (c) => this.onContainerLand(c));
        this.damageFlash = Math.max(0, this.damageFlash - dt);
        if (mode !== 'play') {
            // チュートリアル：敵は動かず撃ってこない。アニメーションと被弾の点滅だけ進める
            for (const e of this.enemies) { e.flash -= dt; e.applyFlash(); e.rig?.update(dt); }
            return;
        }

        if (!this.boss) this.updateWave(dt);

        // 敵の狙い：搭乗モードはプレイヤー。共闘モードは基本的にロボットで、プレイヤーがずっと近いときだけプレイヤー
        const eye = this.player.eye;
        // ドローンがコンテナを投げるとき：着地させるのはプレイヤーのいる場所
        const dropper = {
            canDrop: () => this.containers.count < CONFIG.container.max,
            drop: (from) => this.containers.drop(from, this.player.object.position),
        };
        const targets = [{ position: eye, radius: this.player.radius, scale: 1 }];
        if (!riding) targets.push({ position: this.companion.chest, ...ROBOT_HIT });
        for (const e of this.enemies) {
            const near = targets.length > 1 && flatDist(e.position, targets[1].position) * PLAYER_AGGRO > flatDist(e.position, eye)
                ? targets[0] : targets.at(-1);
            e.update(dt, { eye: near.position, bullets: this.bullets, ...dropper });
        }
        const damage = this.bullets.update(dt, targets, this.containers.landed, (c, dmg, at) => this.hitContainer(c, dmg, at));
        if (damage > 0 && !this.boss?.dead && !this.boarding.running) {   // 乗り降りの演出中もダメージを受けない   // ボスを倒したあと（倒れている間）はダメージを受けない
            this.player.damage(Math.round(damage));
            this.damageFlash = 0.3;
        }

        if (this.player.hp <= 0) this.onEvent('gameover');
        else if (this.boss?.dead && !this.dying.includes(this.boss)) this.onEvent('clear');   // ボスが倒れきったらクリア
    }

    // ---- チュートリアル用 ----
    // 的：正面の遠くに浮かぶドローン（動かない・撃たない）
    spawnTutorialTarget() {
        const t = this.spawn(new Drone());
        const p = this.player.object.position, y = this.player.yaw;
        t.position.set(p.x - Math.sin(y) * 55, 10, p.z - Math.cos(y) * 55);
        t.object.lookAt(p.x, 10, p.z);
        t.setOutline(true);   // 輪郭を出して、どこにいるか分かりやすくする
        return t;
    }

    // 目的地：正面やや先の、黄色く光るゾーン
    showZone() { this.zone.show(this.player); }
    hideZone() { this.zone.hide(); }
    get inZone() { return this.zone.contains(this.player.object.position); }

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
        this.aim.recenter();
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
        this.scene.add(enemy.object);
        this.enemies.push(enemy);
        return enemy;
    }

    // コンテナが着地した：真下にいたらダメージ。ジャンプで避けられる
    onContainerLand(c) {
        this.effects.add(new THREE.Vector3(c.position.x, 0.6, c.position.z), 0xcfa86a, CONFIG.container.splash * 1.4, 0.4);
        const p = this.player.object.position;
        const near = Math.hypot(p.x - c.to.x, p.z - c.to.z) < CONFIG.container.splash && p.y < 3;
        if (near && !this.boss?.dead && !this.boarding.running) {
            this.player.damage(CONFIG.container.damage);
            this.damageFlash = 0.3;
        }
    }

    // コンテナが攻撃を受けた（自機の弾・斬撃・敵の弾）。壊れたら消える
    hitContainer(c, damage, at) {
        if (c.dead) return;
        this.effects.add(at, 0xffe066, 1.2, 0.15);
        if (!c.hit(damage)) return;
        this.effects.add(c.position.clone(), 0xff8a3c, 9, 0.5);
        this.containers.remove(c);
    }

    onHit(enemy, damage, at) {
        if (enemy.isContainer) return this.hitContainer(enemy, damage, at);
        if (enemy.dead) return;   // 同じフレームに2回当たったとき
        enemy.hit(damage);
        this.effects.add(at, 0xffe066, 1.2, 0.15);
        if (!enemy.dead) return;
        this.effects.add(enemy.position.clone(), 0xff8a3c, enemy.radius * 2, 0.5);
        // 倒れるモーションを見せてから消す
        this.enemies = this.enemies.filter((e) => e !== enemy);
        this.dying.push(enemy);
        this.score += enemy.score;
        if (enemy !== this.boss) {
            this.kills += 1;
            this.dropPickup(enemy);
        }
    }

    // 雑魚が倒れたとき、確率で回復アイテムを落とす（HP が減っているほど出やすい）
    dropPickup(enemy) {
        if (!this.playing) return;
        const P = CONFIG.pickup;
        const chance = P.chance + (1 - this.player.hp / MAX_HP) * P.lowHpBonus;
        if (Math.random() < chance) this.pickups.drop(enemy.position);
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
