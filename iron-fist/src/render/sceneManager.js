// Three.js のシーン・カメラ・ライト

import * as THREE from 'three';

export class SceneManager {
    constructor(container) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0d1218);
        this.scene.fog = new THREE.Fog(0x0d1218, 80, 300);

        this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);

        this.scene.add(new THREE.HemisphereLight(0xb8d4ff, 0x30281e, 1.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(60, 120, 40);
        this.scene.add(sun);

        this.resize();
        addEventListener('resize', () => this.resize());
    }

    resize() {
        this.renderer.setSize(innerWidth, innerHeight);
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}
