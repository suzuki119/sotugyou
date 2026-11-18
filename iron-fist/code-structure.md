# IRON FIST コード構成ガイド

コードの構成と、**ライブラリ（three.js / MediaPipe など）の機能をどこで使っているか**をまとめた調査用の資料です。
行数・行番号は作成時点（`src/` 計 約6,500行）のものです。ズレたらファイル名で探してください。

- ゲームの流れ（画面遷移）は `flow.md`、仕様は `spec.md`、チュートリアルは `tutorial.md` を参照
- **「何がどう動くか」の解説は `code-guide.md`**（このファイルは「どこに何があるか」の地図）
- 調整用の数値はすべて `src/config.js`

---

## 1. 全体像

```
カメラ映像 ──▶ 手認識(MediaPipe) ──▶ 入力の抽象化 ──▶ ゲーム本体 ──▶ 描画(three.js) ──▶ 画面
 camera/       hand/                  input/           game/          render/
                                                          │
                                                          ├─▶ audio/ (Web Audio)
                                                          └─▶ ui/ (HUD・各画面。HTML/CSS)
```

**設計上の約束事**

| 約束 | 内容 |
|---|---|
| ゲーム側は手認識を直接触らない | `game/` は `InputManager` が作る `input`（`aimX, fire, moveX, leftOpen …`）だけを見る |
| 手認識ライブラリは1ファイルに閉じ込める | MediaPipe を import しているのは `hand/handTracker.js` だけ（差し替えはここだけ） |
| glb の読み込みは1ファイルに集約 | `GLTFLoader`/`DRACOLoader` を触るのは `render/gltfLoader.js` だけ。各所は `createGLTFLoader()` を呼ぶ |
| 数値は `config.js` | 確率・HP・速度・しきい値など |
| モデルが無くても遊べる | glb が読めなければ、箱・球などの仮の形で代替する |

---

## 2. ディレクトリ構成

```
iron-fist/
├─ index.html            ゲーム本体のページ（<video> と #scene #hud #screen だけ）
├─ robot.html            開発用：ロボットのアニメ確認  → src/tools/robotViewer.js
├─ ballstick.html        開発用：右手の傾き検証        → src/tools/ballstickTest.js
├─ scripts/copy-mediapipe.mjs   dev/build 前に MediaPipe の wasm を public/ へコピー
├─ public/               そのまま配信される素材（下記「素材」参照）
└─ src/
   ├─ main.js            起動・状態遷移・毎フレームのループ（接着剤）
   ├─ config.js          調整値
   ├─ settings.js        酔い止めモードの保存（localStorage）
   ├─ style.css
   ├─ camera/            カメラ起動
   ├─ hand/              手認識〜手の形の判定
   ├─ input/             手の結果 → ゲーム用の入力
   ├─ game/              ゲームのルール（自機・敵・武器・ステージ…）
   │   └─ enemies/       敵（ドローン・ウォーカー・ボス）と敵の弾
   ├─ render/            three.js のシーン・モデル読み込み・コックピット
   ├─ ui/                HUD・各画面・手の骨格表示（HTML/Canvas）
   ├─ audio/             効果音・BGM
   └─ tools/             開発用ページのスクリプト（本番では使わない）
```

---

## 3. 1フレームの流れ（まず読むならここ）

`src/main.js` の `frame()`（約117行〜）が `requestAnimationFrame` で毎フレーム回ります。

```
frame(now)
 ├─ input.get()                         手/キーボード → input
 ├─ 状態(state)ごとの処理 switch(state.current)
 │    START / CAMERA_PERMISSION / CALIBRATION / TUTORIAL / READY /
 │    PLAYING / BOSS / HAND_LOST / CLEAR / GAME_OVER / RESULT
 │    └─ PLAYING・BOSS → game.update(dt, input, 'play')
 ├─ hud.update(...)                     HUD 更新
 ├─ robot.update(dt)                    演出用ロボットのアニメ
 ├─ sceneManager.render()               ← three.js で描画（ここが唯一の render 呼び出し）
 └─ sound.update()
```

手認識は **別のタイミング**で動きます（`handTracker.start()` が `video.requestVideoFrameCallback` で、新しい映像フレームごとに検出 → `InputManager` に結果を渡す）。

### `GameManager.update()` の中身（`src/game/gameManager.js`）

```
乗り降り判定 → 照準(aim) → プレイヤー移動(player) → ジャンプ板(jumpPads)
→ 武器(weapon)/剣(sword) → 相棒ロボ(companion) → コックピット(cockpit)
→ エフェクト → 回復アイテム(pickups) → コンテナ(containers)
→ （play のときだけ）ウェーブ出現 → 各敵の update → 敵の弾(bullets) → ダメージ・勝敗
```

### 状態遷移（`game/gameState.js`）

`START → CAMERA_PERMISSION → CALIBRATION → TUTORIAL → READY → PLAYING → BOSS → CLEAR/GAME_OVER → RESULT`
（手を見失うと `HAND_LOST` で一時停止）。詳細は `flow.md`。

---

## 4. ファイル別の役割

### 4.1 入口・共通
| ファイル | 行 | 役割 |
|---|---|---|
| `main.js` | 314 | 起動処理、状態遷移 `setState()`、毎フレームの `frame()`、デバッグ表示 |
| `config.js` | 127 | 全調整値。`debug` は Vite の `import.meta.env.DEV` |
| `settings.js` | 19 | 酔い止めモード（`localStorage`） |

### 4.2 カメラ・手認識・入力
| ファイル | 役割 |
|---|---|
| `camera/cameraManager.js` | `getUserMedia` でカメラ起動。エラーを種類分け |
| `hand/handTracker.js` | **MediaPipe を使う唯一のファイル**。検出結果を `{side, landmarks, world}` に整形 |
| `hand/landmarkProcessor.js` | 左右反転・平滑化（手の位置・大きさ） |
| `hand/gestureDetector.js` | グリップ・親指・パーの判定（`worldLandmarks`で計算） |
| `hand/ballStick.js` | 右手の傾き（見えないボールスティック） |
| `input/inputManager.js` | 上記を束ねて、ゲーム用の `input` を作る |
| `input/oneEuroFilter.js` | One Euro Filter（自作のブレ取り） |
| `input/calibration.js` | 基準位置の平均を求める |
| `input/debugKeyboardInput.js` | 開発用キーボード入力（K で切替。展示版は無効） |

### 4.3 ゲーム本体（`game/`）
| ファイル | 役割 |
|---|---|
| `gameManager.js` | 全体の司令塔（自機・敵・武器・ウェーブ・勝敗・各機能の呼び出し順） |
| `gameState.js` | 状態の定義 |
| `player.js` | HP・移動・旋回・縦方向の物理（ジャンプ）・搭乗時の揺れ。カメラを子に持つ |
| `aim.js` | 照準・上下の自動照準・エイムアシスト |
| `weapon.js` | 自機の銃（エネルギー制・連射）、当たり判定の関数 `segmentHitsSphere` |
| `sword.js` | 共闘モードの剣と斬撃 |
| `companion.js` | 相棒ロボット（共闘では自動で戦う、搭乗では自機そのもの） |
| （`gameManager.js` 内） | **シンクロゲージ**（共闘で剣を当てて溜める）と**バースト**（満タンで乗ると出るロボットの必殺技） |
| `boarding.js` | 乗り降りの演出（約2〜3秒のテンポ重視版） |
| `boarding.classic.js` | 上の元の遅い版（バックアップ。使われていない） |
| `stage.js` | 闘技場（`robot_field.glb`）、移動範囲、門、敵の出現位置 |
| `effects.js` | 爆発の代わりの「広がる球」 |
| `tutorialSteps.js` / `tutorialZone.js` | チュートリアルの各手順と、黄色い目的地ゾーン |
| `jumpPad.js` | **ジャンプ板**（3か所） |
| `pickups.js` | **回復アイテム** |
| `container.js` | **コンテナ**（ドローンが持ってきて頭上から垂直に落とす。ロボット大。着地後は弾を遮る障害物。自機の弾・剣は一撃で壊せる） |
| `enemies/enemyBase.js` | 敵の共通（HP・半径・点滅・アニメ・撃破） |
| `enemies/drone.js` `walker.js` `boss.js` | 各敵の動きと攻撃 |
| `enemies/enemyBullets.js` | 敵の弾（コンテナで防がれる） |

### 4.4 描画（`render/`）
| ファイル | 役割 |
|---|---|
| `sceneManager.js` | `WebGLRenderer`・`Scene`・カメラ・ライト・空・環境マップ |
| `gltfLoader.js` | `GLTFLoader` + `DRACOLoader`（Draco 圧縮対応） |
| `modelUtils.js` | glb の位置合わせ（`Box3`）・クリップ再生の共通処理 |
| `robotModel.js` | 演出用の自機ロボット（アニメ再生・演出カメラ `SHOTS`） |
| `enemyModels.js` | 敵 glb の読み込みと1体ずつの複製（骨ごと複製） |
| `bulletModel.js` | 弾のモデル（`barrett.glb`） |
| `cockpit.js` | コックピット枠・操縦桿・ハンドル（カメラの子） |
| `cockpitDebug.js` | 開発用：コックピット調整スライダー（C キー） |
| `showcase.js` | タイトル/クリア/ゲームオーバーの外からのカメラ演出 |

### 4.5 UI・音
| ファイル | 役割 |
|---|---|
| `ui/screens.js` | タイトル・許可・キャリブ・チュートリアル・一時停止・リザルト（`#screen` の中身を差し替え） |
| `ui/Hud.js` | HP・照準・手の状態などの計器 |
| `ui/handPreview.js` / `bonesDisplay.js` | 手の骨格を Canvas に描く |
| `audio/sound.js` | 効果音・BGM（Web Audio API） |

---

## 5. ライブラリ別：どこで何を使っているか

依存は `package.json` の2つだけです。

| ライブラリ | バージョン | 用途 |
|---|---|---|
| `three` | 0.186.1 | 3D 描画・モデル読み込み・アニメーション再生 |
| `@mediapipe/tasks-vision` | 1.0.1 | 手のランドマーク検出 |
| `vite`（開発用） | ^8.3.0 | 開発サーバー・ビルド |

### 5.1 MediaPipe（手認識）— 1ファイルだけ

| 場所 | 使っているもの | 内容 |
|---|---|---|
| `hand/handTracker.js:6` | `FilesetResolver`, `HandLandmarker` | import はここだけ |
| 同 `:15` | `FilesetResolver.forVisionTasks(...)` | wasm を `public/mediapipe/wasm`（ローカル同梱）から読む |
| 同 `:16` | `HandLandmarker.createFromOptions` | モデル `public/models/hand_landmarker.task`、`delegate:'GPU'`、`runningMode:'VIDEO'`、`numHands:2` |
| 同 `:33` | `landmarker.detectForVideo(video, t)` | 新しい映像フレームごとに検出（**メインスレッドで実行**） |
| 同 `:12` | `HandLandmarker.HAND_CONNECTIONS` | 骨格描画用の接続情報 |
| `scripts/copy-mediapipe.mjs` | — | `npm run dev/build` の前に wasm を `public/` へコピー（会場でネット無しでも動かすため） |

→ 結果は `toHands()` で `{side, score, landmarks（映像座標）, world（3D・メートル）}` に変換され、以降は MediaPipe を意識しない。

### 5.2 three.js — 使い方の地図

`import * as THREE from 'three'` しているのは 24ファイル。種類別に整理します。

#### (A) 描画の土台 … `render/sceneManager.js`
| 行 | API | 内容 |
|---|---|---|
| 13–15 | `WebGLRenderer` / `setPixelRatio` | 描画器。`CONFIG.render.maxPixelRatio` で負荷を抑える |
| 17 | `Scene` | シーン（ゲーム全体で1つ） |
| 24 | `Fog` | 遠くを霞ませる |
| 25 | `TextureLoader` | `public/sky.png` の読み込み |
| 44–45 | `ShaderMaterial` + `SphereGeometry` + `BackSide` | **空のドーム（独自シェーダー）**。視線方向から sky.png を引く |
| 85 | `PerspectiveCamera` | ゲーム用カメラ（プレイヤーの子になる） |
| 89–90 | `HemisphereLight` / `DirectionalLight` | ライト |
| 95–96 | `PMREMGenerator` + `RoomEnvironment` | 金属の映り込み用の環境マップ（`envMap`）を作り、各所へ配る |
| 113 | `renderer.render(scene, cam)` | **描画の呼び出しはここだけ**（演出中は演出カメラに切替） |

#### (B) モデル読み込み（glTF/glb）
| 場所 | API | 内容 |
|---|---|---|
| `render/gltfLoader.js:4-10` | `GLTFLoader`, `DRACOLoader` | デコーダーは `public/draco/`。**全員ここを経由** |
| `render/robotModel.js:50` | `loadAsync` | 自機ロボット（`robot_kansei_coop_anim.glb`） |
| `render/enemyModels.js:25` | `loadAsync` | 敵（`robot_teki*.glb`, `robot_boss*.glb`） |
| `render/bulletModel.js:20` | `loadAsync` | 弾（`barrett.glb`） |
| `render/cockpit.js:106` | `loadAsync` | コックピット枠・操縦桿・ハンドル（3本を並列読み込み） |
| `game/stage.js:47` | `loadAsync` | 闘技場（`robot_field.glb`） |
| `main.js:308` | `Promise.all` | 起動時に上をまとめて待つ |

#### (C) アニメーション（`AnimationMixer`）
| 場所 | 内容 |
|---|---|
| `render/robotModel.js:81` | ロボットのクリップ再生（Stand/Walk/Mount/HatchOpen…）。`finished` イベントで次へ |
| `render/enemyModels.js:78` | 敵のクリップ（Stand/Run/Attack/Hit/Defeat） |
| `render/cockpit.js:194-204` | 操縦桿・ハンドル。`AnimationUtils.makeClipAdditive` + `AdditiveAnimationBlendMode`（加算ブレンド）で、手の入力に応じたポーズを作る |
| `game/stage.js:60-65` | 門（GateClose）を **LoopOnce + clampWhenFinished** で閉じたまま固定 |
| `render/modelUtils.js:31-33` | クリップ再生の共通処理（`LoopOnce` / `LoopRepeat`） |

> `render/enemyModels.js:8,58` の `SkeletonUtils.clone`（`cloneSkinned`）：骨つきモデルを敵1体ごとに複製。普通の `clone` だと骨が共有されて全員が同じ動きになるため。

#### (D) 当たり判定・数学（three の数学クラスだけを利用。物理エンジンは未使用）
| 場所 | API | 内容 |
|---|---|---|
| `game/weapon.js:27, 80` | `Raycaster`, `Ray.intersectSphere`, `Sphere` | 照準の方向に撃ち、敵の球と交差判定 |
| `game/weapon.js:112-116` | `Line3` | `segmentHitsSphere`：弾の1フレーム分の線分と球の判定。弾・剣の斬撃・敵の弾・コンテナで共用 |
| `render/*Model.js`, `cockpit.js`, `modelUtils.js` | `Box3` | モデルの大きさ取得→位置合わせ |
| ほぼ全ゲームファイル | `Vector3`, `MathUtils` | 位置・補間・角度 |

→ 敵・コンテナの当たりは**すべて「球」**（`position` + `radius`）の自作判定です。

#### (E) ゲーム内オブジェクトの見た目（箱・球などのプリミティブを自作で組み立て）
| ファイル | 作っているもの |
|---|---|
| `game/jumpPad.js` | ジャンプ板（`Cylinder` + `Torus` + `Cone` の矢印） |
| `game/pickups.js` | 回復アイテム（緑の十字 `Box` + `Torus`） |
| `game/container.js` | コンテナ（`Box` + 骨組み、落下地点に `RingGeometry` の警告） |
| `game/sword.js` | 剣・斬撃の三日月（`AdditiveBlending`） |
| `game/tutorialZone.js` | 黄色いゾーン（`Circle`/`Ring`/`Cylinder`、`AdditiveBlending`） |
| `game/effects.js` | 爆発（広がって消える `Sphere`） |
| `game/enemies/enemyBullets.js` | 敵の弾 |
| `game/enemies/enemyBase.js` | 被弾点滅・`BackSide` の輪郭 |
| `render/enemyModels.js:99-113` | 輪郭（`BackSide` + `SkinnedMesh`）の複製 |
| `game/stage.js:90` | 仮の地面（`GridHelper`）。glb 読み込み失敗時の代替 |

#### (F) 起動・負荷対策
| 場所 | 内容 |
|---|---|
| `game/gameManager.js:64-90` | `warmUp(renderer)`：画面外の `WebGLRenderTarget` に一度描いて、シェーダー・ジオメトリを事前コンパイル（初回カクつき防止） |
| `render/robotModel.js:57` | ロボット用の `PMREMGenerator` 環境マップ |

#### (G) three の「addons」（`three/addons/...`）
| import | 場所 | 用途 |
|---|---|---|
| `loaders/GLTFLoader.js` | `render/gltfLoader.js` | glb 読み込み |
| `loaders/DRACOLoader.js` | `render/gltfLoader.js` | Draco 圧縮の展開 |
| `utils/SkeletonUtils.js` | `render/enemyModels.js` | 骨つきモデルの複製 |
| `environments/RoomEnvironment.js` | `sceneManager.js`, `robotModel.js` | 環境マップの元 |
| `controls/OrbitControls.js` | `tools/robotViewer.js`（開発用のみ） | カメラ操作 |

### 5.3 ブラウザ標準 API（ライブラリではないが「独自」の外にあるもの）
| API | 場所 | 用途 |
|---|---|---|
| Web Audio（`AudioContext`） | `audio/sound.js:25` | 効果音・BGM・クロスフェード・ループ音。**three の Audio は使っていない** |
| `getUserMedia` | `camera/cameraManager.js:21` | カメラ起動 |
| `requestVideoFrameCallback` | `hand/handTracker.js` | 新しい映像フレームごとに検出 |
| `requestAnimationFrame` | `main.js` | ゲームのメインループ |
| `localStorage` | `settings.js`, `audio/sound.js` | 酔い止めモード・音量の保存 |
| `import.meta.env` | `config.js`, `gltfLoader.js` ほか | Vite：`DEV`（デバッグ有効/無効）、`BASE_URL`（素材のパス） |

---

## 6. 「自作のロジック」はどこか（ライブラリに頼っていない部分）

調べるときの目安として、**ゲームの中身そのもの**は自作です。

| 内容 | 場所 |
|---|---|
| 手の形の判定（グリップ・親指・パー・傾き） | `hand/gestureDetector.js`, `hand/ballStick.js` |
| 手の位置の平滑化（One Euro Filter） | `input/oneEuroFilter.js` |
| 照準・エイムアシスト | `game/aim.js` |
| 当たり判定（球と線分） | `game/weapon.js` の `segmentHitsSphere` |
| 敵の AI（回り込み・3連射・ボス第2形態） | `game/enemies/*.js` |
| ウェーブ・勝敗・状態遷移 | `game/gameManager.js`, `main.js` |
| プレイヤーの移動・重力・ジャンプ・揺れ | `game/player.js` |
| ジャンプ板・回復ドロップ・コンテナ | `game/jumpPad.js`, `pickups.js`, `container.js` |
| 空シェーダー（GLSL） | `render/sceneManager.js` 内 |
| 音のミキシング | `audio/sound.js` |

---

## 7. 素材（`public/`）

| 場所 | 内容 |
|---|---|
| `models/robot_kansei_coop_anim.glb` | 自機ロボット（アニメ付き） |
| `models/robot_field.glb` | 闘技場（門のアニメ付き） |
| `models/robot_teki.glb` / `robot_teki2.glb` / `robot_boss.glb` | ウォーカー / ドローン / ボス（`*_draco.glb` は圧縮版） |
| `models/cockpit_view.glb` `stick_controller.glb` `handle_controller.glb` | コックピット一式（`*_draco` あり） |
| `models/barrett.glb` | 弾 |
| `models/hand_landmarker.task` | MediaPipe の手認識モデル |
| `mediapipe/wasm/` | MediaPipe 実行用（`copy-mediapipe.mjs` が生成。git 管理外にしてよい） |
| `draco/` | Draco デコーダー |
| `music/bgm/*.mp3`, `music/sound/*.mp3` | BGM（tutorial / battle / boss）と効果音 |
| `sky.png` | 空の画像 |
| `human/*.png` | キャリブレーション画面の手本画像 |

---

## 8. 調査の進め方（おすすめ順）

1. `index.html` → `src/main.js`（起動・状態遷移・`frame()`）
2. `src/game/gameManager.js` の `update()`（ゲームの1フレーム）
3. `src/config.js`（何が調整できるか）
4. 入力側：`hand/handTracker.js` → `input/inputManager.js`
5. 描画側：`render/sceneManager.js` → `render/gltfLoader.js` → `render/robotModel.js`
6. 新機能の例：`game/container.js` / `pickups.js` / `jumpPad.js`（小さくて読みやすい）

**ライブラリの使用箇所を自分で確かめるコマンド**
```bash
# three.js の import
grep -rn "from 'three" src
# three のクラスをファイル別に
grep -rnoE "THREE\.[A-Za-z0-9]+" src | sort | uniq -c | sort -rn
# MediaPipe
grep -rn "mediapipe" src scripts
```

---

## 9. 既知の注意点

- MediaPipe の `detectForVideo` はメインスレッドで動くため、検出が重いと描画が1フレーム止まることがある（Web Worker 化は未実施）。
- 敵・コンテナの当たり判定は球のみ。細長い形状は実際の見た目と少しズレる。
- 相棒ロボットはコンテナを避けず、攻撃対象にもしない。
- バースト中は `game.update` が早期 return するので、その間 `time` も進まない。
- 音は、ジャンプ・回復・コンテナの着地/破壊にまだ付いていない。
- `public/models/` に `stick_controller copy.glb` などの複製ファイルが残っている（使われていない）。
- `window.game` は開発サーバーのときだけコンソールから触れる（`main.js`）。
