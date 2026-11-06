// glb の読み込み（Draco 圧縮のモデルも読めるようにする）
//   デコーダーは three の examples/jsm/libs/draco/gltf/ を public/draco/ にコピーしたもの

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const draco = new DRACOLoader().setDecoderPath(`${import.meta.env?.BASE_URL ?? '/'}draco/`);

export function createGLTFLoader() {
    return new GLTFLoader().setDRACOLoader(draco);
}
