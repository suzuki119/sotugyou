// ゲーム本体：自機・武器・敵・ウェーブ・勝敗。入力は InputManager の input だけを受け取る
//   モードは2つ。手をパーにして切り替える
//     ride（搭乗）：ロボットに乗って、コックピットから銃で撃つ
//     coop（共闘）：ロボットから降りて生身で剣を振る。ロボットは自分で歩いて戦う
//   モードをまたぐ仕組み：
//     ・共闘の間は銃のエネルギーが速く回復する（weapon.coop）。銃が止まったら降りて回復、が基本のリズム
//     ・共闘で剣を当てると sync（シンクロゲージ）が溜まり、満タンで乗り込むと startBurst()（ロボットの必殺技）
//     ・コンテナはドローンが持って出現し、頭上から落とす（container.js / enemies/drone.js）

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

// ---- ゲーム進行の定数 ----
// ボス戦に入る条件：雑魚を ZAKO_TO_BOSS 体倒す、または開始から ZAKO_MAX_TIME 秒たつ（どちらか早い方）。
// MAX_ALIVE は同時に場にいられる敵の上限。上限に達している間は、次の敵は出現を待つ。
const ZAKO_TO_BOSS = 12;    // この数を倒すとボス戦
const ZAKO_MAX_TIME = 120;  // 倒しきれなくてもこの秒数でボス戦
const MAX_ALIVE = 5;
// 共闘モードの「敵の狙い」に使う2つの値
//   ROBOT_HIT：ロボットを撃つ弾の当たり判定。大きい（radius 4.5）ので当たりやすいが、ダメージは半分（scale 0.5）
//   PLAYER_AGGRO：敵は「ロボットより、プレイヤーが半分以下の距離にいる」ときだけプレイヤーを狙う。
//                 それ以外は基本的にロボットを狙うので、生身のプレイヤーは敵の注意をそらせる
const ROBOT_HIT = { radius: 4.5, scale: 0.5 };          // 共闘モードでロボットが受ける弾（大きくて当たりやすいが、ダメージは半分）
const PLAYER_AGGRO = 0.5;   // 共闘モード：プレイヤーまでの距離がロボットまでの距離のこの割合より近い敵だけ、プレイヤーを狙う

// バースト（シンクロ満タンで乗り込んだ直後の必殺技）の台本。時刻は startBurst() からの経過秒
//   0.0 ロボットが現れて Shoot の構え → 0.6 / 1.0 / 1.4 に全ての敵へ3連射 → 2.4 で終了
const BURST_VOLLEYS = [0.6, 1.0, 1.4];   // バーストで撃つ時刻（秒）
const BURST_TIME = 2.4;                  // バーストの長さ（秒）

const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ゲームの司令塔。ルールそのもの（誰が誰に当たるか・いつ出現するか・勝敗）はここにあり、
// 見た目や動きは各部品に任せる。持っている部品と、その役割：
//   stage       闘技場（地形・出現位置）           player      自機（HP・移動・ジャンプ・カメラの親）
//   cockpit     搭乗中の枠・操縦桿                weapon      搭乗中の銃（エネルギー制）
//   sword       共闘中の剣と斬撃                  companion   相棒ロボ（共闘中は自走）
//   boarding    乗り降りの演出                    aim         照準・エイムアシスト
//   enemies     場にいる敵                        dying       倒れるモーション中の敵（当たり判定なし）
//   bullets     敵の弾                            containers  コンテナ（持たれている・落下中・着地済み）
//   pickups     回復アイテム                      jumpPads    ジャンプ板
//   effects     爆発などの短い演出                zone        チュートリアルの黄色い目的地
// ゲームの出来事（ボス出現・クリア・ゲームオーバー・モード切替）は onEvent(名前, 値) で main.js へ知らせる。
export class GameManager {
    // robot：RobotModel（演出と共用）
    constructor(sceneManager, robot, onEvent) {
        // sceneManager：シーンとカメラを持つ。バーストでカメラを差し替えるために覚えておく
        // robot：RobotModel。タイトル・クリアの演出と、共闘中の見た目で共用する（同じモデルを使い回す）
        // onEvent：出来事の通知先（main.js が受け取って画面や状態を切り替える）
        const { scene, camera } = sceneManager;
        this.scene = scene;
        this.sceneManager = sceneManager;
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
        // 新しいプレイを始める状態に戻す（READY・TUTORIAL・CALIBRATION などに入るたびに呼ばれる）
        // 敵・弾・アイテム・コンテナ・演出を全部消し、HP・位置・シンクロ・モードを初期値へ。
        // バースト中に呼ばれたら、カメラが差し替わったままにならないよう endBurst() で戻す。
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
        if (this.burst) this.endBurst();
        this.sync = 0;               // シンクロゲージ（0〜1）
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
        // 毎フレームの本体。dt は秒、input は InputManager の出力、mode は 'play'（敵あり）か 'practice'（敵なし）。
        //
        // 流れ（上から順に実行される）：
        //   0. バースト中なら updateBurst() だけして終わる（時間・敵・弾が止まる＝被弾しない）
        //   1. モード切替の判定（手をパーにし続けたか）。空中・乗り降り中は切り替えない
        //   2. 乗り降り演出中は演出だけ動かし、操作は受け付けない
        //      そうでなければ「照準 → 自機の移動 → ジャンプ板 → 銃/剣 → 相棒ロボ」の順
        //   3. 見た目だけの更新（コックピット・爆発・倒れ中の敵・回復アイテム・コンテナ）
        //   4. 'practice' ならここで終了（敵は動かず撃たない）
        //   5. 'play' なら：ウェーブ出現 → 敵の行動 → 敵の弾の当たり → ダメージ → 勝敗判定
        // ※ 当たり判定は物理エンジンを使わず、敵・コンテナを「球」、弾を「線分」として自作している。
        if (this.burst) return this.updateBurst(dt);   // バースト中は時間も敵も止めて、ロボットだけ見せる
        this.time += dt;
        const boarding = this.boarding.running;
        this.playing = mode === 'play';
        if (!boarding && !this.player.airborne) this.updateModeSwitch(dt, input);   // 空中では乗り降りしない
        // riding＝搭乗中。以降の「搭乗か共闘か」の分岐はすべてこの値で決める
        const riding = this.mode === 'ride';
        const onHit = (e, dmg, at) => this.onHit(e, dmg, at);
        const swordHit = (e, dmg, at) => this.onHit(e, dmg, at, 'sword');
        // 降りている間は銃のエネルギーが速く回復する（weapon.js の update が coop を見る）
        this.weapon.coop = !riding;
        // 共闘で本番中なら、いるだけでもシンクロが少しずつ溜まる（乗り降り演出中は溜めない）
        if (!riding && !boarding && this.playing) this.addSync(CONFIG.sync.perSec * dt);
        // blockers：着地済みのコンテナ。弾や斬撃を受け止め、自機を押し返す障害物
        const blockers = this.containers.landed;   // 弾・斬撃を受けるコンテナ
        // hittables：自機の弾が当たる対象 ＝ 敵 ＋ 着地済みコンテナ（落下中・持たれている間は含まれない）
        const hittables = blockers.length ? [...this.enemies, ...blockers] : this.enemies;
        if (boarding) {
            // 乗り降りの演出中：操作はきかない。カメラとロボットは演出が動かす
            this.boarding.update(dt);
            sound.loop('steam');
            this.weapon.update(dt, false, this.crosshair, hittables, onHit, null);
            this.sword.update(dt, {}, false, this.enemies, swordHit, blockers);
        } else {
            // 照準：搭乗中だけ手の入力を使う。共闘中は 0 を渡して、照準を動かさない（剣は右手の位置で動く）
            this.aim.update(dt, riding ? input : { ...input, aimX: 0, aimY: 0 }, this.player.camera, this.enemies);
            // 自機の移動。搭乗中は照準の位置（rawAim）で旋回が決まり、共闘中は左手の左右で旋回する
            this.player.update(dt, input, riding ? this.aim.rawAim : { x: 0, y: 0 }, blockers);
            // ジャンプ板：地上で乗ると打ち上げる。コンテナを飛び越えたり、落下を避けたりするのに使う
            this.jumpPads.update(dt, this.player);
            // 足音：移動の入力の大きさで音量を変える。生身は軽く速く
            // 足音：移動入力の大きさで音量を変える。生身（共闘）は軽く速いので再生速度を 1.4 倍にする
            const step = Math.min(1, Math.hypot(input.moveY, riding && CONFIG.turnWith !== 'leftStick' ? input.moveX : 0));
            if (step > 0.1) sound.loop('footstep', step, riding ? 1 : 1.4);
            // 銃：搭乗中だけ撃てる。lock＝エイムアシストで吸い付いた敵（いればその敵へ向けて撃つ）
            this.weapon.update(dt, riding && input.fire, this.crosshair, hittables, onHit, this.lock);
            // 剣：共闘中だけ振れる。搭乗中は、すでに飛んでいる斬撃を動かし続けるだけ。当たると 'sword' 由来としてシンクロが溜まる
            this.sword.update(dt, input, !riding, this.enemies, swordHit, blockers);
            // 相棒ロボ：搭乗中は自機と同じ位置（見えない）。共闘中は自分で歩いて敵を撃つ・殴る
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
        // 'practice'（チュートリアル・カウントダウン）：敵は動かず撃たない。アニメと点滅だけ進めて終了
        if (mode !== 'play') {
            // チュートリアル：敵は動かず撃ってこない。アニメーションと被弾の点滅だけ進める
            for (const e of this.enemies) { e.flash -= dt; e.applyFlash(); e.rig?.update(dt); }
            return;
        }

        // ウェーブ：ボスが出るまでは、一定間隔で雑魚を出す。ボスが出たら以降は追加しない
        if (!this.boss) this.updateWave(dt);

        // 敵の狙い：搭乗モードはプレイヤー。共闘モードは基本的にロボットで、プレイヤーがずっと近いときだけプレイヤー
        // eye：プレイヤーの目の位置（ワールド座標）。敵が狙う点・距離を測る基準になる
        const eye = this.player.eye;
        // targets：敵の弾が当たる相手。[0]＝プレイヤー。共闘中は [1]＝ロボット（ROBOT_HIT）も追加される
        const targets = [{ position: eye, radius: this.player.radius, scale: 1 }];
        if (!riding) targets.push({ position: this.companion.chest, ...ROBOT_HIT });
        for (const e of this.enemies) {
            // 敵ごとの狙い：共闘中は基本的にロボット。ただしプレイヤーが（ロボットまでの距離 × PLAYER_AGGRO）より近ければプレイヤーを狙う
            const near = targets.length > 1 && flatDist(e.position, targets[1].position) * PLAYER_AGGRO > flatDist(e.position, eye)
                ? targets[0] : targets.at(-1);
            e.update(dt, { eye: near.position, bullets: this.bullets });
        }
        // 敵（ドローン）が動いたあとに、持たれているコンテナを追従させる。先にやると出現フレームに原点へ映ってしまう
        this.containers.syncHeld();   // ドローンが動いたあとで、持たれているコンテナを追従させる
        // 敵の弾の更新。戻り値＝今フレームにプレイヤー側へ当たった弾のダメージ合計（ロボットに当たった分は ROBOT_HIT.scale 倍）。
        // 着地済みコンテナに当たった弾は止まり、hitContainer() でコンテナの HP を削る
        const damage = this.bullets.update(dt, targets, this.containers.landed, (c, dmg, at) => this.hitContainer(c, dmg, at));
        // ダメージを受けない場面：ボスが倒れた後の余韻と、乗り降りの演出中
        if (damage > 0 && !this.boss?.dead && !this.boarding.running) {   // 乗り降りの演出中もダメージを受けない   // ボスを倒したあと（倒れている間）はダメージを受けない
            this.player.damage(Math.round(damage));
            this.damageFlash = 0.3;
        }

        // 勝敗：HP 0 でゲームオーバー。ボスが倒れきった（倒れるモーション終了）らクリア
        if (this.player.hp <= 0) this.onEvent('gameover');
        else if (this.boss?.dead && !this.dying.includes(this.boss)) this.onEvent('clear');   // ボスが倒れきったらクリア
    }

    // ---- チュートリアル用 ----
    // 的：正面の遠くに浮かぶドローン（動かない・撃たない）
    spawnTutorialTarget() {
        // チュートリアルの的：正面55m・高さ10mに浮かぶドローン。動かず撃たず、輪郭を黄色く光らせて見つけやすくする
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
        // 両手（config の modeSwitch.hands で変更可）をパーにし続けた時間 switchHold を数え、holdMs に達したら切り替える。
        // switchArmed：「一度パーをやめてから」でないと切り替えない（切り替えた直後のパーのままで、すぐ戻ってしまうのを防ぐ）。
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
        // 乗り降りの演出を始め、演出が終わったときに実際のモード切替（player.setMode と finishMode）を行う。
        //   'coop'：companion.reset で今の場所にロボットを置き、boarding.dismount（ジャンプで飛び出す）
        //   'ride'：boarding.mount（走って飛び込む）。終わったときシンクロが満タンならバースト
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
                if (this.playing && this.sync >= 1) this.startBurst();   // ゲージが満タンなら、乗り込んだ直後にバースト
            });
        }
    }

    finishMode(mode) {
        // 切替の完了処理：モードを記録し、照準を中央に戻し、見た目をそろえ、main.js（HUD）へ通知する
        this.mode = mode;
        this.aim.recenter();
        this.syncView();
        this.onEvent('mode', mode);
    }

    // モードに合わせて、コックピット・剣・ロボットの見え方をそろえる
    syncView() {
        // モードに合わせて見た目をそろえる：搭乗＝コックピットだけ見える / 共闘＝剣とロボットが見える。
        // 乗り降り・バーストの演出中はそれぞれの演出が見た目を決めるので、ここでは何もしない。
        if (this.boarding.running || this.burst) return;   // 乗り降り・バーストの演出中は演出が決める
        const coop = this.mode === 'coop';
        this.cockpit.group.visible = !coop;
        this.sword.group.visible = coop;
        this.robot.object.visible = coop && this.robot.ready;
    }

    updateWave(dt) {
        // 条件を満たせばボスを出して 'boss' を通知。そうでなければ spawnTimer が 0 になるたびに雑魚を1体出す（間隔 2.5 秒）。
        // 雑魚の内訳：65% ドローン / 35% ウォーカー。ドローンは確率 container.chance でコンテナを持って出現する。
        if (this.kills >= ZAKO_TO_BOSS || this.time > ZAKO_MAX_TIME) {
            this.boss = this.spawn(new Boss(), true);
            this.onEvent('boss');
            return;
        }
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && this.enemies.length < MAX_ALIVE) {
            this.spawnTimer = 2.5;
            if (Math.random() < 0.65) {
                const drone = new Drone();
                // コンテナ持ちは、出現した瞬間から持っている（見た目で分かる）
                if (this.containers.count < CONFIG.container.max && Math.random() < CONFIG.container.chance) drone.carry(this.containers.hold(drone));
                this.spawn(drone);
            } else {
                this.spawn(new Walker());
            }
        }
    }

    // 闘技場の門の左右（ボスは門の正面）から出す。最初の1体で門が開く
    spawn(enemy, isBoss = false) {
        // 敵を闘技場の門の左右（ボスは正面）に置き、プレイヤーの方を向かせて、管理リスト enemies に加える。
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
        // コンテナが着地した瞬間に1回だけ呼ばれる：土煙の演出と、真下にいたプレイヤーへのダメージ。
        // ダメージの条件：着地点から splash 以内、かつ高さ 3m 未満（ジャンプしていれば当たらない）。演出中・ボス撃破後は無効。
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
        // コンテナが攻撃を受けた（自機の弾・剣・敵の弾）。HP が尽きたら爆発して消える。
        // 呼び出し側が 9999 を渡せば一撃。自機側の攻撃は onHit() が 9999 にして渡す。
        if (c.dead) return;
        this.effects.add(at, 0xffe066, 1.2, 0.15);
        if (!c.hit(damage)) return;
        this.effects.add(c.position.clone(), 0xff8a3c, 9, 0.5);
        this.containers.remove(c);
    }

    addSync(v) {
        // シンクロゲージを増やす（上限 1）。
        this.sync = Math.min(1, this.sync + v);
    }

    // バースト：ロボットが全身を映されながら、場の全ての敵に3連射する
    startBurst() {
        // バースト開始：ゲージを 0 に戻し、コックピットと剣を隠し、ロボットを「斜め後ろから全身が映る」カメラで出す。
        // ロボットのモデルが読み込めていない場合は、映像なしで（this.burst.shown=false）ダメージだけ与える。
        const c = this.companion, r = this.robot;
        this.sync = 0;
        this.burst = { t: 0, next: 0, shown: false };
        this.cockpit.group.visible = false;
        this.sword.group.visible = false;
        if (r.show('burst', c.position, c.yaw)) {
            this.burst.shown = true;
            r.resetHatch();
            r.play('Shoot', { once: true, fade: 0.1 });
            this.sceneManager.overrideCamera = r.camera;
        }
    }

    updateBurst(dt) {
        // 台本どおりに進める。BURST_VOLLEYS の時刻になるたび、場にいる全ての敵に弾道（tracer）・爆発・ダメージを与える。
        // 敵や弾の更新は呼ばれない＝バースト中は誰も動かず、プレイヤーも被弾しない。
        const b = this.burst;
        b.t += dt;
        while (b.next < BURST_VOLLEYS.length && b.t >= BURST_VOLLEYS[b.next]) {
            b.next += 1;
            for (const e of [...this.enemies]) {
                if (e.dead) continue;
                this.companion.tracer(this.robot.muzzle(), e.position);
                this.effects.add(e.position.clone(), 0xffc94d, e.radius * 2.5, 0.4);
                this.onHit(e, CONFIG.sync.burstDamage, e.position.clone(), 'burst');
            }
            sound.play('gun', { rate: 0.7 });
        }
        this.companion.updateTracers(dt);
        this.effects.update(dt);
        this.updateDying(dt);
        if (b.t >= BURST_TIME) this.endBurst();
    }

    endBurst() {
        // バースト終了：カメラを戻し、ロボットを隠して Stand に戻し、搭乗モードの見た目に戻す。reset() からも呼ばれる。
        this.burst = null;
        this.sceneManager.overrideCamera = null;
        this.robot.hide();
        this.robot.play('Stand');
        this.companion.anim = 'Stand';
        this.syncView();
    }

    onHit(enemy, damage, at, source) {
        // 敵・コンテナに攻撃が当たったときの共通の入口。source は攻撃の種類（'sword' / 'burst' / 未指定＝銃・ロボ）。
        //   ・'sword' ならシンクロゲージを増やす（本番中のみ）
        //   ・コンテナなら一撃で壊す（hitContainer へ 9999）
        //   ・敵なら HP を減らして点滅・爆発。倒れたらスコア加算・回復アイテムのドロップ・持っていたコンテナの落下
        //   倒れた敵は enemies から dying へ移す（倒れるモーションを見せる間は当たり判定なし）。
        if (source === 'sword' && this.playing) this.addSync(enemy.isContainer ? CONFIG.sync.perContainer : CONFIG.sync.perHit);
        if (enemy.isContainer) return this.hitContainer(enemy, 9999, at);   // 自機の弾・剣・共闘ロボの攻撃は一撃で壊せる
        if (enemy.dead) return;   // 同じフレームに2回当たったとき
        enemy.hit(damage);
        this.effects.add(at, 0xffe066, 1.2, 0.15);
        if (!enemy.dead) return;
        this.effects.add(enemy.position.clone(), 0xff8a3c, enemy.radius * 2, 0.5);
        if (enemy.container) { enemy.container.release(); enemy.container = null; }   // 持っていたコンテナはその場から落ちる
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
        // 倒した雑魚が回復アイテムを落とすか抽選。確率 = pickup.chance + (HPが減っている割合) × lowHpBonus。本番中のみ。
        if (!this.playing) return;
        const P = CONFIG.pickup;
        const chance = P.chance + (1 - this.player.hp / MAX_HP) * P.lowHpBonus;
        if (Math.random() < chance) this.pickups.drop(enemy.position);
    }

    updateDying(dt) {
        // 倒れるモーション中の敵を進め、終わったものをシーンから取り除く。
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
        // リザルト画面用の成績。スコア = 撃破点 +（クリア時のみ）残り HP×20 + 早さボーナス（300秒から短縮した秒×10）。
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
