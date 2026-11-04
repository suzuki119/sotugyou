// Three.js のシーン・カメラ・ライト

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class SceneManager {
    constructor(container) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        // 青空：地平線付近は白っぽく、上に行くほど濃い青になるグラデーションの空ドーム
        const horizon = new THREE.Color(0xcfe6f7);
        this.scene.background = horizon;
        this.scene.fog = new THREE.Fog(horizon, 120, 450);
        this.sky = new THREE.Mesh(
            new THREE.SphereGeometry(500, 32, 16),
            new THREE.ShaderMaterial({
                side: THREE.BackSide,
                depthWrite: false,
                fog: false,
                uniforms: {
                    topColor: { value: new THREE.Color(0x2f7fd8) },
                    horizonColor: { value: horizon },
                },
                vertexShader: `
                    varying vec3 vDir;
                    void main() {
                        vDir = normalize(position);
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }`,
                fragmentShader: `
                    uniform vec3 topColor;
                    uniform vec3 horizonColor;
                    varying vec3 vDir;
                    void main() {
                        float t = pow(max(vDir.y, 0.0), 0.6);
                        gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
                    }`,
            }),
        );
        this.sky.renderOrder = -1;
        this.sky.frustumCulled = false;
        this.scene.add(this.sky);

        this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
        this.overrideCamera = null;   // 演出中だけ別のカメラで映す（null ならコックピットのカメラ）
        this.onResize = [];

        this.scene.add(new THREE.HemisphereLight(0xb8d4ff, 0x30281e, 1.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(60, 120, 40);
        this.scene.add(sun);

        // 金属っぽい素材が真っ黒にならないよう、映り込み用の環境マップ（フィールドに使う）
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();

        this.resize();
        addEventListener('resize', () => this.resize());
    }

    resize() {
        this.renderer.setSize(innerWidth, innerHeight);
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
        for (const fn of this.onResize) fn(innerWidth / innerHeight);
    }

    render() {
        const cam = this.overrideCamera ?? this.camera;
        cam.getWorldPosition(this.sky.position);   // 空はカメラに追従させて常に遠景に見せる
        this.renderer.render(this.scene, cam);
    }
}
