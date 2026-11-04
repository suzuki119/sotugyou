// 相棒ロボット：共闘モードでは自分で歩き、敵を撃つ・殴る。搭乗モードでは自機そのもの（見えない）
//   見た目とアニメーションは RobotModel。モデルが読み込めなくても、動きと攻撃だけは行う

import * as THREE from 'three';
import { ARENA_RADIUS } from './stage.js';
import { HEIGHT } from '../render/robotModel.js';

const FOLLOW = new THREE.Vector3(9, 0, 3);   // プレイヤーから見た立ち位置（右へ 9m、後ろへ 3m）
const MAX_SPEED = 16;        // m/s
const RUN_SPEED = 9;         // これより速いと Run、遅いと Walk
const TURN_SPEED = 3;        // rad/s
const SIGHT = 90;            // この距離以内の敵を狙う
const ATTACK_COOLDOWN = 1.2; // 攻撃が終わってから次の攻撃までの時間
const PUNCH_REACH = 13;      // 水平方向でこの距離以内・地上の敵は殴る

// 攻撃：再生するクリップ、長さ、何秒目に当てるか、ダメージ
const ATTACKS = {
    shoot: { clip: 'Shoot', duration: 1.67, hits: [0.45, 0.85, 1.25], damage: 15 },
    punch: { clip: 'Punch', duration: 1.08, hits: [0.5], damage: 45 },
};

const tracerGeo = new THREE.BoxGeometry(0.35, 0.35, 1);
tracerGeo.translate(0, 0, 0.5);   // 根元を原点にして、z 方向に伸ばす
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true });

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const yawOf = (v) => Math.atan2(-v.x, -v.z);   // 自機と同じ決まり：yaw 0 で -Z を向く

export class Companion {
    constructor(scene, robot) {
        this.scene = scene;
        this.robot = robot;
        this.position = new THREE.Vector3();
        this.yaw = 0;
        this.tracers = [];
    }

    get chest() {
        return this.position.clone().add(new THREE.Vector3(0, HEIGHT * 0.6, 0));
    }

    reset(position, yaw) {
        this.position.copy(position);
        this.yaw = yaw;
        this.action = null;
        this.cooldown = 1;
        this.anim = null;
        for (const t of this.tracers) this.scene.remove(t.mesh);
        this.tracers = [];
        this.robot.resetHatch();
        this.setAnim('Stand');
        this.robot.place(this.position, this.yaw);
    }

    // 搭乗モード：自機と同じ場所・向きにいる
    follow(player) {
        this.position.copy(player.object.position);
        this.yaw = player.yaw;
        this.action = null;
        this.setAnim('Stand');
        this.robot.place(this.position, this.yaw);
    }

    setAnim(name) {
        if (this.anim === name) return;
        this.anim = name;
        this.robot.play(name, { fade: 0.25 });
    }

    // 共闘モード
    update(dt, { player, enemies, onHit }) {
        this.cooldown -= dt;
        const target = this.findTarget(enemies);

        if (this.action) {
            this.updateAction(dt, onHit);
        } else if (target && this.cooldown <= 0) {
            this.startAction(target);
        } else {
            this.move(dt, player, target);
        }
        if (this.position.length() > ARENA_RADIUS) this.position.setLength(ARENA_RADIUS);
        this.robot.place(this.position, this.yaw);
    }

    findTarget(enemies) {
        let best = null, bestD = SIGHT;
        for (const e of enemies) {
            if (e.dead) continue;
            const d = Math.hypot(e.position.x - this.position.x, e.position.z - this.position.z);
            if (d < bestD) { best = e; bestD = d; }
        }
        return best;
    }

    // プレイヤーの斜め後ろについて歩く。敵がいれば敵の方を向く
    move(dt, player, target) {
        const p = player.object.position;
        const offset = FOLLOW.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
        const to = p.clone().add(offset).sub(this.position).setY(0);
        const dist = to.length();
        const speed = THREE.MathUtils.clamp((dist - 1.5) * 1.2, 0, MAX_SPEED);
        if (speed > 0.3) this.position.addScaledVector(to.normalize(), speed * dt);

        const face = target && speed < RUN_SPEED ? target.position.clone().sub(this.position) : speed > 0.3 ? to : null;
        if (face) this.turnTo(yawOf(face), dt);
        this.setAnim(speed > RUN_SPEED ? 'Run' : speed > 0.8 ? 'Walk' : 'Stand');
    }

    turnTo(yaw, dt) {
        const diff = wrap(yaw - this.yaw);
        this.yaw += THREE.MathUtils.clamp(diff, -TURN_SPEED * dt, TURN_SPEED * dt);
    }

    startAction(target) {
        const flat = Math.hypot(target.position.x - this.position.x, target.position.z - this.position.z);
        const kind = flat < PUNCH_REACH && target.position.y < HEIGHT ? 'punch' : 'shoot';
        this.action = { ...ATTACKS[kind], kind, target, t: 0, next: 0 };
        this.anim = ATTACKS[kind].clip;
        this.robot.play(this.anim, { once: true, fade: 0.15 });
    }

    updateAction(dt, onHit) {
        const a = this.action;
        a.t += dt;
        const alive = !a.target.dead;
        if (alive) this.turnTo(yawOf(a.target.position.clone().sub(this.position)), dt);

        while (a.next < a.hits.length && a.t >= a.hits[a.next]) {
            a.next += 1;
            if (!alive) continue;
            if (a.kind === 'shoot') {
                this.tracer(this.robot.muzzle(), a.target.position);
                onHit(a.target, a.damage, a.target.position.clone());
            } else {
                const flat = Math.hypot(a.target.position.x - this.position.x, a.target.position.z - this.position.z);
                if (flat < PUNCH_REACH + a.target.radius) onHit(a.target, a.damage, a.target.position.clone());
            }
        }
        if (a.t >= a.duration) {
            this.action = null;
            this.anim = null;   // 次のフレームで歩き・待機のクリップに戻す
            this.cooldown = ATTACK_COOLDOWN;
        }
    }

    // 弾の軌跡（一瞬だけ見える線）
    tracer(from, to) {
        const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
        mesh.position.copy(from);
        mesh.scale.z = from.distanceTo(to);
        mesh.lookAt(to);
        this.scene.add(mesh);
        this.tracers.push({ mesh, life: 0.12 });
    }

    // 弾の軌跡を消していく（どちらのモードでも毎フレーム呼ぶ）
    updateTracers(dt) {
        this.tracers = this.tracers.filter((t) => {
            t.life -= dt;
            t.mesh.material.opacity = Math.max(0, t.life / 0.12);
            if (t.life > 0) return true;
            this.scene.remove(t.mesh);
            t.mesh.material.dispose();
            return false;
        });
    }
}
