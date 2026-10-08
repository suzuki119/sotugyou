// コックピット（グレーボックス）。カメラの子にして、常に画面手前に見えるようにする
//   Blender のモデルができたら差し替える

import * as THREE from 'three';

export class Cockpit {
    constructor(camera) {
        this.group = new THREE.Group();
        camera.add(this.group);

        const frame = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.8 });
        const box = (w, h, d, x, y, z, rz = 0) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frame);
            m.position.set(x, y, z);
            m.rotation.z = rz;
            this.group.add(m);
            return m;
        };
        // 窓枠と計器盤
        box(0.12, 3, 0.1, -1.75, 0, -1.2, -0.25);
        box(0.12, 3, 0.1, 1.75, 0, -1.2, 0.25);
        box(4, 0.12, 0.1, 0, 1.05, -1.2);
        box(4, 0.5, 0.6, 0, -1.05, -1.1);

        // 左右の銃身（撃つと少し下がる）
        const gunMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, metalness: 0.5, roughness: 0.5 });
        this.guns = [-1, 1].map((s) => {
            const g = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.2, 10), gunMat);
            g.rotation.x = Math.PI / 2;
            g.position.set(s * 0.9, -0.7, -2.2);
            this.group.add(g);
            return g;
        });
        this.recoil = [0, 0];

        // 右手のボールスティック（半透明）。照準の入力に合わせて傾く
        const glass = (color) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.35, roughness: 0.2, depthWrite: false });
        this.stick = new THREE.Group();
        this.stick.position.set(0.55, -0.95, -1.15);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 12), glass(0x9fdcff));
        shaft.position.y = 0.11;
        this.ballMat = glass(0x4dd0ff);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), this.ballMat);
        ball.position.y = 0.24;
        this.stick.add(shaft, ball);
        this.group.add(this.stick);
    }

    // input に合わせてスティックを傾ける（前に倒す＝照準が下）
    updateStick(input) {
        const tx = -input.aimY * 0.45, tz = -input.aimX * 0.45;
        this.stick.rotation.x += (tx - this.stick.rotation.x) * 0.5;
        this.stick.rotation.z += (tz - this.stick.rotation.z) * 0.5;
        const color = !input.rightTracked ? 0x888888 : input.fire ? 0xff4040 : input.rightGrip ? 0x4dd0ff : 0xffd600;
        this.ballMat.color.setHex(color);
        this.ballMat.opacity = input.rightGrip ? 0.55 : 0.25;
    }

    // 左右交互に撃つ
    kick(index) {
        this.recoil[index] = 0.18;
    }

    update(dt) {
        this.guns.forEach((g, i) => {
            this.recoil[i] = Math.max(0, this.recoil[i] - dt * 1.5);
            g.position.z = -2.2 + this.recoil[i];
        });
    }
}

// 銃口の位置（カメラ座標）
export const MUZZLES = [new THREE.Vector3(-0.9, -0.7, -2.8), new THREE.Vector3(0.9, -0.7, -2.8)];
