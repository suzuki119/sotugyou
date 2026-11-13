// 爆発の代わり：広がって消える球

import * as THREE from 'three';

export class Effects {
    constructor(scene) {
        this.scene = scene;
        this.list = [];
    }

    add(position, color, size, life) {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 12, 8),
            new THREE.MeshBasicMaterial({ color, transparent: true }),
        );
        mesh.position.copy(position);
        this.scene.add(mesh);
        this.list.push({ mesh, size, life, max: life });
    }

    update(dt) {
        this.list = this.list.filter((f) => {
            f.life -= dt;
            const t = 1 - f.life / f.max;
            f.mesh.scale.setScalar(0.2 + t * f.size);
            f.mesh.material.opacity = 1 - t;
            if (f.life > 0) return true;
            this.dispose(f);
            return false;
        });
    }

    clear() {
        this.list.forEach((f) => this.dispose(f));
        this.list = [];
    }

    dispose(f) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
    }
}
