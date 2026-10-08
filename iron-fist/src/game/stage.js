// ステージ（グレーボックス）：地面と建物。移動できる範囲もここで決める

import * as THREE from 'three';

export const ARENA_RADIUS = 180;

export class Stage {
    constructor(scene) {
        const ground = new THREE.Mesh(
            new THREE.CircleGeometry(ARENA_RADIUS + 120, 48),
            new THREE.MeshStandardMaterial({ color: 0x1c2228, roughness: 1 }),
        );
        ground.rotation.x = -Math.PI / 2;
        scene.add(ground);

        const grid = new THREE.GridHelper((ARENA_RADIUS + 120) * 2, 60, 0x2f4a5c, 0x24313b);
        grid.position.y = 0.02;
        scene.add(grid);

        // 建物：毎回同じ配置になるよう、決まった乱数で置く
        const mat = new THREE.MeshStandardMaterial({ color: 0x3a434c, roughness: 0.9 });
        let seed = 7;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 70; i++) {
            const a = rand() * Math.PI * 2;
            const r = 50 + rand() * (ARENA_RADIUS + 60);
            const w = 6 + rand() * 14, h = 8 + rand() * 40, d = 6 + rand() * 14;
            const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
            scene.add(b);
        }
    }
}
