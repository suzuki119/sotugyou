// コンテナ：ドローンが投げ落とす。着地するとその場に残り、弾を遮る障害物になる
//   敵の弾・自機の弾・剣の斬撃のどれからも攻撃を受け、HP がなくなると壊れる
//   落ちている間は当たり判定がない（dead）。着地点には警告の輪を出す

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const SIZE = { x: 6, y: 4, z: 3 };
const CENTER_Y = SIZE.y / 2;
const RADIUS = 3.2;      // 弾・斬撃が当たる球の半径
const FOOT = 3.3;        // 自機が押し返される、水平方向の半径
const ARC = 8;           // 投げ上げの山の高さ（m）
const BODY_COLOR = 0xd06a3c;

const bodyGeo = new THREE.BoxGeometry(SIZE.x, SIZE.y, SIZE.z);
const ribGeo = new THREE.BoxGeometry(0.28, SIZE.y * 0.92, 0.2);
const ringGeo = new THREE.RingGeometry(CONFIG.container.splash - 0.7, CONFIG.container.splash, 40);

// 見た目：赤茶色の箱に、側面のひだ。弾を受けると光るため、マテリアルは1つずつ別にする
export function createContainerMesh() {
    const material = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.75, metalness: 0.05 });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(bodyGeo, material));
    for (const side of [-1, 1]) {
        for (let i = -2; i <= 2; i++) {
            const rib = new THREE.Mesh(ribGeo, material);
            rib.position.set(i * 1.1, 0, side * (SIZE.z / 2 + 0.05));
            group.add(rib);
        }
    }
    return { group, material };
}

export class Container {
    // from：投げ出す位置、to：着地させる位置（水平方向だけ使う）
    constructor(scene, from, to) {
        this.scene = scene;
        this.isContainer = true;
        this.hp = this.maxHp = CONFIG.container.hp;
        this.radius = RADIUS;
        this.footRadius = FOOT;
        this.height = SIZE.y;
        this.from = from.clone();
        this.to = new THREE.Vector3(to.x, CENTER_Y, to.z);
        this.t = 0;
        this.state = 'falling';
        this.flash = 0;
        this.yaw = Math.random() * Math.PI;

        const { group, material } = createContainerMesh();
        this.object = group;
        this.material = material;
        group.position.copy(from);
        scene.add(group);

        // 着地点の警告
        this.marker = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        this.marker.rotation.x = -Math.PI / 2;
        this.marker.position.set(to.x, 0.25, to.z);
        scene.add(this.marker);
    }

    get position() {
        return this.object.position;
    }

    // 落ちている間は攻撃できない・当たらない
    get dead() {
        return this.state !== 'landed';
    }

    // 弾などが当たったときに HP を減らす。壊れたら true
    hit(damage) {
        this.hp -= damage;
        this.flash = 0.08;
        this.material.color.setHex(BODY_COLOR).multiplyScalar(0.45 + 0.55 * Math.max(0, this.hp) / this.maxHp);   // 傷むほど暗くなる
        return this.hp <= 0;
    }

    // 着地したフレームだけ 'landed' を返す
    update(dt) {
        this.flash -= dt;
        this.material.emissive.setHex(this.flash > 0 ? 0x777777 : 0x000000);
        if (this.state !== 'falling') return null;

        this.t += dt;
        const u = Math.min(1, this.t / CONFIG.container.flight);
        const p = this.object.position;
        p.x = this.from.x + (this.to.x - this.from.x) * u;
        p.z = this.from.z + (this.to.z - this.from.z) * u;
        p.y = this.from.y + (this.to.y - this.from.y) * u * u + Math.sin(Math.PI * u) * ARC;
        this.object.rotation.set(0, this.yaw + (1 - u) * 3, (1 - u) * 0.6);
        // 警告の輪：近づくほど濃く、速く点滅する
        this.marker.material.opacity = (0.25 + 0.5 * u) * (0.6 + 0.4 * Math.sin(this.t * (8 + 14 * u)));

        if (u < 1) return null;
        this.state = 'landed';
        this.object.rotation.set(0, this.yaw, 0);
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
        return this.list.filter((c) => !c.dead);
    }

    drop(from, to) {
        const c = new Container(this.scene, from, to);
        this.list.push(c);
        return c;
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
