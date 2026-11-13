// Three.js のシーン・カメラ・ライト

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// 空の画像：横方向に何度ぶんを貼るか（大きいほど雲が小さく・たくさん見える）
//   below：画像の下からこの割合を地平線より下に隠す（0＝地平線に画像の下端が来る。下端の白い雲の帯を隠したいときは 0.3 くらい）
const SKY = { spanH: 160, below: 0 };

export class SceneManager {
    constructor(container) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, CONFIG.render.maxPixelRatio));
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        // 空：public/sky.png をドームに貼る。カメラの向きに合わせて動く（読み込めるまでは青のグラデーション）
        //   画像は横長のパノラマ（下が地平線）。横は SKY.spanH 度ぶんで、左右は鏡写しに繰り返す。
        //   折り返しの折れ目は、半分ずらした鏡写しとなめらかに混ぜて消す。
        //   縦は画像の縦横比に合わせた角度までで、それより上は画像の一番上の青、地平線より下は一番下の色が伸びる
        const horizon = new THREE.Color(0xb0e0f8);   // sky.png の地平線の色（遠くの霧もこの色に溶かす）
        this.scene.background = horizon;
        this.scene.fog = new THREE.Fog(horizon, 120, 450);
        const skyMap = new THREE.TextureLoader().load(`${import.meta.env?.BASE_URL ?? '/'}sky.png`, (tex) => {
            skyUniforms.mapMix.value = 1;
            skyUniforms.spanV.value = THREE.MathUtils.degToRad(SKY.spanH) * tex.image.height / tex.image.width;
        });
        skyMap.colorSpace = THREE.SRGBColorSpace;
        // 空は画面より引き伸ばして貼るので、ミップマップは使わない（atan の境の細い線を防ぐ）
        skyMap.generateMipmaps = false;
        skyMap.minFilter = THREE.LinearFilter;
        const skyUniforms = {
            map: { value: skyMap },
            mapMix: { value: 0 },
            spanH: { value: THREE.MathUtils.degToRad(SKY.spanH) },
            spanV: { value: THREE.MathUtils.degToRad(SKY.spanH) * 0.372 },
            below: { value: SKY.below },
            topColor: { value: new THREE.Color(0x2f7fd8) },
            horizonColor: { value: horizon },
        };
        this.sky = new THREE.Mesh(
            new THREE.SphereGeometry(500, 48, 24),
            new THREE.ShaderMaterial({
                side: THREE.BackSide,
                depthWrite: false,
                fog: false,
                uniforms: skyUniforms,
                vertexShader: `
                    varying vec3 vDir;
                    void main() {
                        vDir = normalize(position);
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }`,
                fragmentShader: `
                    uniform sampler2D map;
                    uniform float mapMix;
                    uniform float spanH;
                    uniform float spanV;
                    uniform float below;
                    uniform vec3 topColor;
                    uniform vec3 horizonColor;
                    varying vec3 vDir;
                    void main() {
                        float t = pow(max(vDir.y, 0.0), 0.6);
                        vec3 gradient = mix(horizonColor, topColor, t);
                        float az = atan(vDir.x, vDir.z);                 // +Z（自機の最初の向き）が画像の真ん中
                        float el = asin(clamp(vDir.y, -1.0, 1.0));
                        float u = az / spanH + 0.5;
                        float v = clamp(below + el / spanV, 0.0, 1.0);
                        // 鏡写しの繰り返し。折れ目（u が整数）では a の重みが 0、半分ずらした b の真ん中になる
                        float wa = pow(sin(3.14159265 * u), 2.0);
                        vec3 a = texture2D(map, vec2(1.0 - abs(1.0 - mod(u, 2.0)), v)).rgb;
                        vec3 b = texture2D(map, vec2(1.0 - abs(1.0 - mod(u + 0.5, 2.0)), v)).rgb;
                        vec3 sky = mix(b, a, wa);
                        gl_FragColor = vec4(mix(gradient, sky, mapMix), 1.0);
                        #include <colorspace_fragment>
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
