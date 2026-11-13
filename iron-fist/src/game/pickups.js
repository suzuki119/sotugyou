// 回復アイテム：雑魚敵が倒れた場所に落ちる。近づくと拾えて、HP が回復する
//   近くまで来ると、プレイヤーのほうへ吸い寄せられる

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const COLLECT = 4;      // 拾える距離（水平・m）
const MAGNET = 11;      // 吸い寄せが始まる距離（m）
const MAGNET_SPEED = 16;
const HOVER = 1.6;      // 浮かぶ高さ

const barGeo = new THREE.BoxGeometry(1.8, 0.55, 0.55);
const ringGeo = new THREE.TorusGeometry(1.5, 0.08, 6, 28);

// 緑の十字に、まわりの輪
export function createPickupMesh() {
    const material = new THREE.MeshStandardMaterial({ color: 0x39ff6a, emissive: 0x39ff6a, emissiveIntensity: 1.4, roughness: 0.4 });
    const group = new THREE.Group();
    const a = new THREE.Mesh(barGeo, material);
    const b = new THREE.Mesh(barGeo, material);
    b.rotation.z = Math.PI / 2;
    const ring = new THREE.Mesh(ringGeo, material);
    group.add(a, b, ring);
    return { group, material };
}

export class Pickups {
    constructor(scene) {
        this.scene = scene;
        this.list = [];
    }

    // position の真下の地面に落とす
    drop(position) {
        const { group, material } = createPickupMesh();
        group.position.set(position.x, HOVER, position.z);
        this.scene.add(group);
        this.list.push({ group, material, age: 0, life: CONFIG.pickup.life });
    }

    // player：Player。拾ったら onCollect(位置) を呼ぶ
    update(dt, player, onCollect) {
        const me = player.object.position;
        this.list = this.list.filter((p) => {
            p.age += dt;
            const pos = p.group.position;
            const dx = me.x - pos.x, dz = me.z - pos.z;
            const d = Math.hypot(dx, dz);
            if (d < MAGNET) {
                pos.x += (dx / d) * MAGNET_SPEED * dt;
                pos.z += (dz / d) * MAGNET_SPEED * dt;
            }
            pos.y = HOVER + Math.sin(p.age * 3) * 0.3;
            p.group.rotation.y += dt * 2.5;
            // 消える直前は点滅する
            p.group.visible = p.life - p.age > 5 || Math.sin(p.age * 18) > 0;

            if (d < COLLECT && me.y < 6) {
                player.heal(CONFIG.pickup.heal);
                onCollect(pos.clone());
                this.dispose(p);
                return false;
            }
            if (p.age < p.life) return true;
            this.dispose(p);
            return false;
        });
    }

    dispose(p) {
        this.scene.remove(p.group);
        p.material.dispose();
    }

    clear() {
        this.list.forEach((p) => this.dispose(p));
        this.list = [];
    }
}
