// コンテナ：ドローンが持ってきて、プレイヤーの頭上から垂直に落とす（ロボットと同じ大きさ）
//   持たれている間・落ちている間は当たり判定がない（dead）。落とした瞬間に着地点へ警告の輪を出す
//   着地するとその場に残り、弾を遮る障害物になる。自機の弾・剣は一撃で壊せる（敵の弾は HP を削る）
//   持っているドローンが倒されたら、その場から落ちる

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const SIZE = { x: 10, y: 12, z: 6 };   // ロボット（高さ 12m）と同じ大きさ
const CENTER_Y = SIZE.y / 2;
const RADIUS = 6.5;      // 弾・斬撃が当たる球の半径
const FOOT = 5.6;        // 自機が押し返される、水平方向の半径
const GRAVITY = 22;      // 落ちる加速（m/s²）
const HANG = SIZE.y / 2 + 3.5;   // 持たれているとき、ドローンの何 m 下に中心が来るか
const BODY_COLOR = 0xd06a3c;

// 形状はコンテナの全インスタンスで共有する（ジオメトリは使い回し、マテリアルだけ個別）
const bodyGeo = new THREE.BoxGeometry(SIZE.x, SIZE.y, SIZE.z);
const ribGeo = new THREE.BoxGeometry(0.5, SIZE.y * 0.92, 0.3);
const ringGeo = new THREE.RingGeometry(CONFIG.container.splash - 0.7, CONFIG.container.splash, 40);

// 見た目：赤茶色の箱に、側面のひだ。弾を受けると光るため、マテリアルは1つずつ別にする
// 見た目だけを作る（赤茶色の箱と側面のひだ）。warmUp でシェーダーを先にコンパイルするためにも使う。
export function createContainerMesh() {
    const material = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.75, metalness: 0.05 });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(bodyGeo, material));
    for (const side of [-1, 1]) {
        for (let i = -2; i <= 2; i++) {
            const rib = new THREE.Mesh(ribGeo, material);
            rib.position.set(i * 1.8, 0, side * (SIZE.z / 2 + 0.1));
            group.add(rib);
        }
    }
    return { group, material };
}

export class Container {
    // owner：持っているドローン（position を持つもの）
    constructor(scene, owner) {
        this.scene = scene;
        this.owner = owner;
        this.isContainer = true;
        this.hp = this.maxHp = CONFIG.container.hp;
        this.radius = RADIUS;
        this.footRadius = FOOT;
        this.height = SIZE.y;
        this.to = new THREE.Vector3();
        this.state = 'held';   // held（持たれている）→ falling（落下）→ landed（着地）
        this.flash = 0;
        this.yaw = Math.random() * Math.PI;

        const { group, material } = createContainerMesh();
        this.object = group;
        this.material = material;
        group.rotation.y = this.yaw;
        this.sync();
        scene.add(group);
    }

    get position() {
        return this.object.position;
    }

    // 持たれている間は、ドローンの真下に吊るされる
    sync() {
        // held の間、持ち主のドローンの HANG(9.5m) 真下に追従する。落下中・着地後は何もしない。
        if (this.state === 'held' && this.owner) {
            this.object.position.copy(this.owner.position);
            this.object.position.y -= HANG;
        }
    }

    // 手放す：今の真下に落ちる。着地点に警告の輪を出す
    release() {
        // 手放す：今の位置の真下へ落とす。ここで初めて警告の輪（marker）を作り、着地予定点 to を決める。
        // fallFrom＝落ち始めの高さ（警告の輪の濃さを「どれくらい近づいたか」で変えるために使う）。
        if (this.state !== 'held') return;
        this.state = 'falling';
        this.owner = null;
        this.vy = 0;
        const p = this.object.position;
        this.to.set(p.x, CENTER_Y, p.z);
        this.fallFrom = Math.max(1, p.y - CENTER_Y);
        this.t = 0;
        this.marker = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        this.marker.rotation.x = -Math.PI / 2;
        this.marker.position.set(p.x, 0.25, p.z);
        this.scene.add(this.marker);
    }

    // 持たれている間・落ちている間は攻撃できない・当たらない
    get dead() {
        return this.state !== 'landed';
    }

    // 弾などが当たったときに HP を減らす。壊れたら true
    hit(damage) {
        // 攻撃を受けて HP を減らす。傷むほど色が暗くなる。壊れたら true（呼び出し側が containers.remove する）。
        this.hp -= damage;
        this.flash = 0.08;
        this.material.color.setHex(BODY_COLOR).multiplyScalar(0.45 + 0.55 * Math.max(0, this.hp) / this.maxHp);   // 傷むほど暗くなる
        return this.hp <= 0;
    }

    // 着地したフレームだけ 'landed' を返す
    update(dt) {
        // 状態ごとの動き。held＝追従 / falling＝重力で加速して落ちる / landed＝何もしない。
        // 落下：vy += GRAVITY×dt、y -= vy×dt。中心が CENTER_Y（地面にぴったり接する高さ）に達したら 'landed' を返す（そのフレームだけ）。
        this.flash -= dt;
        this.material.emissive.setHex(this.flash > 0 ? 0x777777 : 0x000000);
        if (this.state === 'held') return this.sync();
        if (this.state !== 'falling') return null;

        this.t += dt;
        this.vy += GRAVITY * dt;
        const p = this.object.position;
        p.y = Math.max(CENTER_Y, p.y - this.vy * dt);
        // 警告の輪：近づくほど濃く、速く点滅する
        const u = 1 - (p.y - CENTER_Y) / this.fallFrom;
        this.marker.material.opacity = (0.25 + 0.5 * u) * (0.6 + 0.4 * Math.sin(this.t * (8 + 14 * u)));

        if (p.y > CENTER_Y) return null;
        this.state = 'landed';
        this.scene.remove(this.marker);
        this.marker.material.dispose();
        return 'landed';
    }

    dispose() {
        this.scene.remove(this.object);
        this.material.dispose();
        if (this.state === 'falling') {
            this.scene.remove(this.marker);
            this.marker.material.dispose();
        }
    }
}

export class Containers {
    constructor(scene) {
        this.scene = scene;
        this.list = [];
    }

    // 落下中も含めた数
    get count() {
        return this.list.length;
    }

    // 着地済み（攻撃を受ける・弾を遮る・自機が押し返される）
    get landed() {
        // 着地済み（＝攻撃を受け、弾を遮り、プレイヤーを押し返す）のコンテナだけ。持たれている・落下中のものは含まない。
        return this.list.filter((c) => !c.dead);
    }

    // owner（ドローン）に持たせる
    hold(owner) {
        // ドローン owner に持たせるコンテナを作り、管理リストに入れる。
        const c = new Container(this.scene, owner);
        this.list.push(c);
        return c;
    }

    // ドローンが動いたあとに呼ぶ：持たれているコンテナを追従させる
    syncHeld() {
        // 持たれているコンテナ全部を、持ち主の今の位置に合わせる。敵の更新が終わってから呼ぶ。
        for (const c of this.list) c.sync();
    }

    update(dt, onLand) {
        for (const c of this.list) {
            if (c.update(dt) === 'landed') onLand(c);
        }
    }

    remove(c) {
        c.dispose();
        this.list = this.list.filter((x) => x !== c);
    }

    clear() {
        this.list.forEach((c) => c.dispose());
        this.list = [];
    }
}
