// ステージ：闘技場（robot_field.glb）。移動できる範囲・プレイヤーの開始位置・敵の出てくる場所もここで決める
//   円形の闘技場で、内側の壁は中心から約 71m。+Z 側に門があり、門の左右（Spawn_Enemy_L / R）から敵が出てくる
//   モデルが読み込めなかったときは、仮の地面と建物（グレーボックス）にする

import * as THREE from 'three';
import { createGLTFLoader } from '../render/gltfLoader.js';
import { eachMesh } from '../render/modelUtils.js';

const FIELD_URL = '/models/robot_field.glb';
const FIELD_Y = -0.35;        // 床の高さがタイルごとに 0〜0.65m ばらつくので、真ん中あたりを 0 に合わせる

export const ARENA_RADIUS = 64;          // プレイヤー・ロボットが動ける範囲（壁の内側）
export const ENEMY_RADIUS = 66;          // 敵が動ける範囲
// プレイヤーの開始位置：門と反対側から、門の方（+Z）を向く（yaw は自機の決まり。0 で -Z を向く）
// タイトル画面でロボットを立たせる場所：門（z≈72）の少し手前。ロボットは -Z（画面手前）を向く
export const TITLE_ROBOT_SPOT = new THREE.Vector3(0, 0, 50);
export const PLAYER_START = { position: new THREE.Vector3(0, 0, -35), yaw: Math.PI };

// 敵の出てくる場所（モデルに Spawn_Enemy_L / R があればその位置を使う）
const DEFAULT_SPAWNS = [new THREE.Vector3(-27.9, 0, 59.8), new THREE.Vector3(27.9, 0, 59.8)];
const BOSS_SPAWN = new THREE.Vector3(0, 0, 58);   // ボスは門の正面から
const SPAWN_JITTER = 5;
// フィールドの明るさ：環境マップの映り込みの強さ（上げすぎると白い部分が飛ぶ）
const FIELD_ENV_INTENSITY = 0.8;

export class Stage {
    constructor(scene, envMap = null) {
        this.scene = scene;
        this.envMap = envMap;
        this.spawns = DEFAULT_SPAWNS.map((v) => v.clone());
    }

    // フィールドの素材を明るくする（環境マップを当てて、金属部分が黒く沈まないようにする）
    brighten(field) {
        if (!this.envMap) return;
        eachMesh(field, (o, mats) => {
            for (const m of mats) {
                if (!m.isMeshStandardMaterial) continue;
                m.envMap = this.envMap;
                m.envMapIntensity = FIELD_ENV_INTENSITY;
            }
        });
    }

    async load() {
        try {
            const gltf = await createGLTFLoader().loadAsync(FIELD_URL);
            const field = gltf.scene;
            field.position.y = FIELD_Y;
            this.brighten(field);
            this.scene.add(field);
            field.updateMatrixWorld(true);

            const found = ['Spawn_Enemy_L', 'Spawn_Enemy_R'].map((n) => field.getObjectByName(n)).filter(Boolean);
            if (found.length) this.spawns = found.map((o) => o.getWorldPosition(new THREE.Vector3()).setY(0));

            // 門は最初から閉じたまま：GateClose の最後のポーズを一度だけ当てる（以降は動かさない）
            const close = gltf.animations.find((c) => c.name === 'GateClose');
            if (close) {
                const mixer = new THREE.AnimationMixer(field);
                const action = mixer.clipAction(close);
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;   // 繰り返しだと終端で先頭（開いた形）に戻ってしまう
                action.play();
                mixer.update(close.duration);
            }
        } catch (err) {
            console.error('フィールドのモデルを読み込めませんでした', err);
            this.buildGreybox();
        }
    }

    // 敵の出てくる場所（少しばらつかせる）
    spawnPoint(isBoss = false) {
        const base = isBoss ? BOSS_SPAWN : this.spawns[Math.floor(Math.random() * this.spawns.length)];
        const a = Math.random() * Math.PI * 2, r = isBoss ? 0 : Math.random() * SPAWN_JITTER;
        return base.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }

    // 仮のステージ：地面と建物（動ける範囲の外側に置く）
    buildGreybox() {
        const size = ARENA_RADIUS + 200;
        const ground = new THREE.Mesh(
            new THREE.CircleGeometry(size, 48),
            new THREE.MeshStandardMaterial({ color: 0x1c2228, roughness: 1 }),
        );
        ground.rotation.x = -Math.PI / 2;
        this.scene.add(ground);

        const grid = new THREE.GridHelper(size * 2, 60, 0x2f4a5c, 0x24313b);
        grid.position.y = 0.02;
        this.scene.add(grid);

        // 毎回同じ配置になるよう、決まった乱数で置く
        const mat = new THREE.MeshStandardMaterial({ color: 0x3a434c, roughness: 0.9 });
        let seed = 7;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 70; i++) {
            const a = rand() * Math.PI * 2;
            const r = ARENA_RADIUS + 20 + rand() * 150;
            const w = 6 + rand() * 14, h = 8 + rand() * 40, d = 6 + rand() * 14;
            const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
            this.scene.add(b);
        }
    }
}
