// チュートリアルの目的地：正面やや先の、黄色く光るゾーン

import * as THREE from 'three';
import { ARENA_RADIUS } from './stage.js';

const ZONE_RADIUS = 7;

export class TutorialZone {
    constructor(scene) {
        this.scene = scene;
        this.zone = null;
    }

    // player の正面に出す
    show(player) {
        this.hide();
        const p = player.object.position, y = player.yaw;
        const at = new THREE.Vector3(p.x - Math.sin(y) * 34, 0, p.z - Math.cos(y) * 34);
        if (at.length() > ARENA_RADIUS * 0.8) at.setLength(ARENA_RADIUS * 0.8);
        const mat = () => new THREE.MeshBasicMaterial({ color: 0xffd600, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        const flat = (geometry, height) => {
            const mesh = new THREE.Mesh(geometry, mat());
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = height;
            return mesh;
        };
        const group = new THREE.Group();
        const disc = flat(new THREE.CircleGeometry(ZONE_RADIUS, 40), 0.15);
        const ring = flat(new THREE.RingGeometry(ZONE_RADIUS - 0.5, ZONE_RADIUS, 40), 0.2);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(ZONE_RADIUS, ZONE_RADIUS, 40, 40, 1, true), mat());
        beam.position.y = 20;
        group.add(disc, ring, beam);
        group.position.copy(at);
        this.scene.add(group);
        this.zone = { group, disc, beam, at, t: 0 };
    }

    hide() {
        if (!this.zone) return;
        this.scene.remove(this.zone.group);
        this.zone.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
        this.zone = null;
    }

    // position（水平方向）がゾーンの中にあるか
    contains(position) {
        const z = this.zone;
        return !!z && Math.hypot(position.x - z.at.x, position.z - z.at.z) < ZONE_RADIUS;
    }

    update(dt) {
        const z = this.zone;
        if (!z) return;
        z.t += dt;
        const k = 0.5 + 0.5 * Math.sin(z.t * 4);
        z.disc.material.opacity = 0.2 + 0.2 * k;
        z.beam.material.opacity = 0.08 + 0.1 * k;
    }
}
