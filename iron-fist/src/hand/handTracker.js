// 手認識ライブラリはこのファイルの中だけで扱う（ml5.js などへの差し替えはここだけを書き換える）
//   出力：[{ side: 'left' | 'right', score, landmarks, world }]
//     landmarks … 映像上の座標（0〜1、左右反転前）
//     world     … 手の中心を原点にした3D座標（メートル）

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// モデルと wasm はローカルに同梱する（CDN に依存しない）
const BASE = import.meta.env.BASE_URL;

export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS.map(c => [c.start, c.end]);

export class HandTracker {
    async init() {
        const vision = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
        this.landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `${BASE}models/hand_landmarker.task`,
                delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
        });
    }

    // 新しい映像フレームが来たときだけ検出する
    start(video, onResult) {
        let lastVideoTime = -1;
        const loop = () => {
            if (video.currentTime !== lastVideoTime) {
                lastVideoTime = video.currentTime;
                const t0 = performance.now();
                const r = this.landmarker.detectForVideo(video, t0);
                this.detectMs = performance.now() - t0;
                onResult(toHands(r), t0);
            }
            video.requestVideoFrameCallback(loop);
        };
        video.requestVideoFrameCallback(loop);
    }
}

function toHands(r) {
    const hands = r.landmarks.map((landmarks, i) => {
        const cat = r.handedness[i]?.[0];
        return {
            // 試作（desktoptest）で確認した対応：MediaPipe の Left が本人の右手
            side: cat?.categoryName === 'Left' ? 'right' : 'left',
            score: cat?.score ?? 0,
            landmarks,
            world: r.worldLandmarks[i],
        };
    });
    // 左右が同じと判定されたときは、映像上の位置で振り分ける（左右反転前なので x が小さい方が本人の右手）
    if (hands.length === 2 && hands[0].side === hands[1].side) {
        hands.sort((a, b) => a.landmarks[0].x - b.landmarks[0].x);
        hands[0].side = 'right';
        hands[1].side = 'left';
    }
    return hands;
}
