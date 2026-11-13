// ジャンプ板：闘技場に置いてある。上に乗ると高く打ち上げられる（コンテナを飛び越える・落下攻撃を避けるのに使う）

import * as THREE from 'three';
import { CONFIG } from '../config.js';

const RADIUS = 4.5;
// 置く場所 [x, z]。スタート位置（0, -35）と門（z≈72）は避ける
const PLACES = [[-34, -8], [34, -8], [0, 24]];

const baseGeo = new THREE.CylinderGeometry(RADIUS, RADIUS + 0.4, 0.5, 36);
const ringGeo = new THREE.TorusGeometry(RADIUS - 0.9, 0.22, 8, 44);
const arrowGeo = new THREE.ConeGeometry(1.1, 1.6, 4);

export class JumpPads {
    constructor(scene) {
        this.pads = PLACES.map(([x, z]) => {
            const group = new THREE.Group();
            const glow = new THREE.MeshStandardMaterial({ color: 0x1b3a45, emissive: 0x2fd6ff, emissiveIntensity: 1.2, roughness: 0.4 });
            const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.6, metalness: 0.6 }));
            base.position.y = 0.25;
            const ring = new THREE.Mesh(ringGeo, glow);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.55;
            group.add(base, ring);
            // 上向きの矢印。下から上へ流れて、飛ぶ向きを示す
            const arrows = [0, 1, 2].map((i) => {
                const a = new THREE.Mesh(arrowGeo, glow);
                group.add(a);
                return { mesh: a, phase: i / 3 };
            });
            group.position.set(x, 0, z);
            scene.add(group);
            return { x, z, group, glow, arrows, t: Math.random() * 6 };
        });
    }

    // 地上にいるプレイヤーが乗ったら打ち上げる。打ち上げたら true
    update(dt, player) {
        let launched = false;
        for (const pad of this.pads) {
            pad.t += dt;
            pad.glow.emissiveIntensity = 1 + 0.5 * Math.sin(pad.t * 4);
            for (const a of pad.arrows) {
                const k = (pad.t * 0.9 + a.phase) % 1;
                a.mesh.position.y = 1 + k * 4;
                a.mesh.scale.setScalar(1 - k * 0.6);
            }
            const p = player.object.position;
            if (!player.airborne && Math.hypot(p.x - pad.x, p.z - pad.z) < RADIUS) {
                player.launch(CONFIG.jump.launch);
                launched = true;
            }
        }
        return launched;
    }
}
