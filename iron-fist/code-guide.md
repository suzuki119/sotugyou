# IRON FIST コード解説（全体）

「どのファイルが何をしているか」ではなく、**「ゲームの中で何が起きていて、それがどのコードで実現されているか」** を順に説明する資料です。
ファイルの一覧とライブラリの使用箇所は `code-structure.md`、画面遷移は `flow.md`、仕様は `spec.md` を参照してください。

> 行番号は変わりやすいので、関数名・ファイル名で探してください。調整値はすべて `src/config.js` にあります。

---

## 0. このゲームを一言で

- **カメラに映した両手で、巨大ロボットを操縦する 3D シューティング**（three.js + MediaPipe）。
- モードは2つ。手を「パー」にして切り替える。
  - **搭乗（ride）**：コックピット視点。右手＝照準＋親指で連射、左手＝移動。
  - **共闘（coop）**：ロボットから降りて生身で剣を振る。ロボットは自分で歩いて戦う。
- 共闘で剣を当てて **シンクロゲージ** を溜め、満タンで乗り込むとロボットの必殺技（**バースト**）が出る。
- 敵はドローン（空中）、ウォーカー（地上）、ボス。**コンテナ**を持ったドローンは頭上から巨大コンテナを落とす。

---

## 1. 全体の構造（5つの層）

```
カメラ映像
  │  MediaPipe（hand/handTracker.js）
  ▼
手のランドマーク ──▶ 手の形・位置の判定（hand/*）
  │
  ▼
入力の抽象化（input/inputManager.js）  ← ゲームはここから先の「input」だけを見る
  │   { aimX, aimY, fire, moveX, moveY, leftOpen, rightOpen, swing, handX, handY, ... }
  ▼
ゲーム本体（game/gameManager.js が司令塔）
  │   自機・武器・敵・コンテナ・乗り降り・バースト …
  ▼
描画（render/*, three.js）＋ UI（ui/*, HTML/CSS）＋ 音（audio/sound.js）
```

**守っているルール**

| ルール | 意味 |
|---|---|
| 入力は `input` オブジェクトだけ | ゲーム側は MediaPipe を知らない。キーボードでも同じ `input` を作れば遊べる（`debugKeyboardInput.js`） |
| 数値は `config.js` | 速度・HP・確率・しきい値は全部ここ |
| モデルが無くても遊べる | glb が読めなければ箱・球の仮の形になる |
| 描画は `sceneManager.render()` の1か所 | 演出カメラへの切り替えは `overrideCamera` で行う |

---

## 2. 起動から1フレームまで（`src/main.js`）

### 2.1 起動

1. `screens.loading()` を出して `requestAnimationFrame(frame)` を開始。
2. 次を **並列** に読み込む（`Promise.all`）：MediaPipe 初期化、ロボット、敵モデル、弾モデル、闘技場、コックピット。
3. `game.warmUp()`：画面外に一度描いて、シェーダーのコンパイルを済ませる（初回のカクつき防止）。
4. `setState(STATE.START)`。

### 2.2 状態遷移（`game/gameState.js` と `state.onChange`）

```
START → CAMERA_PERMISSION → CALIBRATION → TUTORIAL → READY(3秒) → PLAYING → BOSS → CLEAR / GAME_OVER → RESULT
                                                                      └ どこでも手を2秒見失うと HAND_LOST（一時停止）
```

- `state.onChange` が **状態に入った瞬間の処理**（BGM、画面、`game.reset()` など）を担当。
- `frame()` の `switch (state.current)` が **状態の最中の処理** を担当。
- リトライはキャリブレーションを省略（同じ人が続けるため）。

### 2.3 `frame()` の流れ

```
input.get()                       今フレームの入力
switch (state)                    状態ごとの処理。PLAYING/BOSS は game.update(dt, i, 'play')
hud.update(...)                   HUD
robot.update(dt)                  ロボットのアニメ・演出カメラ
sceneManager.render()             描画（ここだけ）
sound.update()                    鳴らさなかったループ音を止める
```

`game.update` の第3引数：`'play'`＝敵あり、`'practice'`＝敵なし（チュートリアル・カウントダウン）。

---

## 3. 手認識 → 入力（`hand/`, `input/`）

### 3.1 手のランドマーク

| ファイル | 役割 |
|---|---|
| `hand/handTracker.js` | MediaPipe を呼ぶ**唯一**のファイル。新しい映像フレームごとに検出し、`{side, landmarks(画面座標), world(3D・メートル)}` へ整形 |
| `hand/landmarkProcessor.js` | 左右反転、位置・大きさの平滑化 |
| `hand/gestureDetector.js` | **手の形の判定** |
| `hand/ballStick.js` | 右手の傾き（見えないボールスティック） |

### 3.2 手の形の判定（`gestureDetector.js`）

`measure()` が3Dの手から4つの値を出します。

| 値 | 意味 | 使い道 |
|---|---|---|
| `folded` | 曲がっている指の本数 | 左手のグリップ、パーの判定 |
| `curl` | 指の曲がりの平均（度） | 右手のグリップ（ボールを握る）、パー |
| `thumb` | 親指の先と人差し指・中指の関節の近さ | **連射**（閉じている＝撃つ）、パー |
| `upright` | 手の縦横 | 照準の軸切替（`orientationSwitch` のとき） |

- **ヒステリシス**：ON と OFF のしきい値をずらして、状態が細かくバタつかないようにしている（`GRIP_ON/OFF`、`THUMB_UP/DOWN`）。
- **親指の猶予**（`thumbGraceMs`）：親指が一瞬立っても連射を続ける。
- **パー**（`open`）：4本指がすべて伸び、`curl <= maxCurl`、`thumb >= minThumb`。

### 3.3 `InputManager.onHands()`：手 → input

検出のたびに呼ばれ、`this.input` を作ります。

| 入力 | 作り方 |
|---|---|
| `aimX`（照準の左右） | 右手がグリップ中のとき、基準位置からの**ずれ** `d.x / aimRange.x`。`aimAxis:'horizontalAuto'` では上下は 0（ゲーム側が自動） |
| `fire` | `gesture` の `fire`（右手グリップ＋親指を閉じる） |
| `moveX` / `moveY` | 左手がグリップ中のとき。左右＝位置のずれ、前後＝**指の傾き**（`moveYMode:'tilt'`、下向き＝前進） |
| `leftOpen` / `rightOpen` | パーの判定（モード切替用） |
| `swing`, `swingX/Y` | 右手の速さと向き（剣を振ったか） |
| `handX/Y` | 右手の基準からのずれ（剣の画面上の位置） |

仕上げの処理：
- `shape()`：デッドゾーン＋「中央は細かく、端は大きく」のカーブ。
- `OneEuroFilter`：ブレ取り。遅さと追従のバランスは `CONFIG.aim.filter`。
- **キャリブレーション**（`calibration.js`）：両手を握って2秒、平均を取って `base`（基準位置）にする。以降、すべての入力は「基準からのずれ」。

---

## 4. ゲーム本体（`game/gameManager.js`）

### 4.1 `update(dt, input, mode)` の順序

```
burst 中なら updateBurst() だけして終了（時間も敵も止まる）
乗り降り・モード切替の判定（updateModeSwitch）
 ├ 乗り降り演出中: boarding.update だけ
 └ 通常:
     照準 aim → 自機の移動 player → ジャンプ板 → 武器 weapon / 剣 sword
     → 相棒ロボ companion（搭乗中は自機に追従、共闘中は自走）
コックピット・エフェクト・倒れ中の敵・ゾーン・回復アイテム・コンテナ
（mode が 'play' のときだけ）ウェーブ出現 → 敵の更新 → コンテナ追従 → 敵の弾 → ダメージ・勝敗
```

### 4.2 搭乗（ride）と共闘（coop）の違い

| | 搭乗 | 共闘 |
|---|---|---|
| 目の高さ | 7m | 1.7m |
| 攻撃 | 銃（連射・エネルギー制・エイムアシスト） | 剣（斬撃が飛ぶ） |
| 移動 | 22 m/s、揺れ（`sway`）あり | 11 m/s、小さく揺れる |
| 被弾半径 | 3m | 1.2m |
| ロボット | 見えない（自機そのもの） | 見える・自分で戦う（`companion.js`） |
| 敵の狙い | プレイヤー | 基本はロボット。プレイヤーが十分近い敵だけプレイヤー（`PLAYER_AGGRO`） |
| 銃エネルギー | 通常回復 | **3.5倍速で即回復**（`weapon.coop`） |

切替：`updateModeSwitch()`が、パーを `holdMs`（0.5秒）保つと `setMode()` を呼ぶ。一度パーをやめるまで次の切替はしない（`switchArmed`）。空中では切り替えない。

### 4.3 武器（`weapon.js`）と照準（`aim.js`）

- **照準**：入力で決まる `rawAim` →（上下の自動照準）→（エイムアシスト）→ `crosshair`。画面に出して撃つのは `crosshair`。
  - 上下の自動照準：照準の縦線に近い敵の高さへ滑らかに合わせる。
  - エイムアシスト：近くの敵に引き寄せる。吸い付いた敵が `lock`。
- **銃**：1発ごとに `costPerShot` 消費、10発/秒。0 になるとオーバーヒート（`resumeAt` まで回復しないと撃てない）。
- **当たり判定**：敵・コンテナはすべて「球」。弾は1フレームで進んだ線分と球で判定（`segmentHitsSphere`）。速い弾がすり抜けない。

### 4.4 剣（`sword.js`）

- 右手を `swingSpeed` より速く振る（または親指）と `slash()`。
- 前方 35° 以内で最も近い敵へ向けて、三日月形の斬撃（`waves`）が 80 m/s で飛ぶ。
- 斬撃は**敵を貫通**、同じ敵には1回だけ（`hit` の Set）。
- **コンテナには `9999` ダメージ＝一撃**。

### 4.5 敵（`game/enemies/`）

`EnemyBase` が共通部分（HP、被弾の点滅、アニメ再生、倒れる演出、壁の外に出ない）を持ち、各敵は `behave()` だけを書く。

| 敵 | HP | 動き |
|---|---|---|
| Drone | 30 | 空中で距離40を保って回り込み、2.5〜4秒ごとに1発 |
| Walker | 70 | 地上で距離28、3連射 |
| Boss | 800 | 距離60。扇形5発。HP半分以下で怒って速く・連射追加 |

ウェーブ：`updateWave()` が2.5秒ごとに出現（最大5体、ドローン65%／ウォーカー35%）。12体倒す、または120秒でボス。

### 4.6 コンテナ（`container.js` + `drone.js`）

**ドローンが持って、プレイヤーの頭上から垂直に落とす。ロボット大（10×12×6m）。**

```
 出現      carry(container)          頭上に0.6秒 or 9秒経過           着地
  │  held ─────────────────▶ release() ──▶ falling ──▶ landed
  │  （ドローンの真下に吊るす）   （警告の輪が出る）  （重力で真下に）  （弾を遮る障害物に）
```

- `Container.state`：`held`（持たれている）→ `falling` → `landed`。`dead` が `true`（＝当たり判定なし）なのは `landed` 以外。
- 生成：`updateWave()` でドローンを作るとき、確率 `container.chance` かつ同時数 `< max` なら `containers.hold(drone)` で持たせる。**出現した瞬間から持っている**ので見た目で分かる。
- ドローン側：`carry()` で高さ34mに。`carryBehave()` が頭上へ飛び、撃たない。落としたら通常のドローンに戻る（高さはなめらかに下がる）。
- **持ち主が倒された**：`onHit()` の撃破処理で `release()`。その場から落ちる。
- 追従：ドローンが動いた後に `containers.syncHeld()`（出現フレームに原点へ映らないように）。
- **一撃で壊れる**：`onHit()` のコンテナ分岐で `hitContainer(…, 9999)`。銃・剣・共闘ロボの攻撃が対象。敵の弾は `hitContainer()` を直接呼ぶので、HP（150）を削るだけ。
- 着地：`onContainerLand()` が、着地点から `splash` 以内で `p.y < 3` のプレイヤーにダメージ（ジャンプで避けられる）。
- 弾を遮る：`EnemyBullets.update()` が `landed` なコンテナに当たった弾を止める。
- プレイヤーは `footRadius` で押し返され、`height` より高く跳べば上に乗れる（`Player.update` の障害物処理）。

### 4.7 エネルギーとシンクロゲージ

```
搭乗：撃つ → エネルギー減 → オーバーヒート
        ↓ 降りる
共闘：エネルギーが3.5倍速で回復 ＋ 剣を当てて sync が溜まる
        ↓ 乗る
sync が満タンなら → バースト
```

- `sync`：0〜1。`onHit(..., 'sword')` で敵に `perHit`(0.12)、コンテナに `perContainer`(0.04)。共闘中は毎秒 `perSec` ずつも溜まる。チュートリアルでは溜まらない（`this.playing`）。
- HUD：`SYNC` バー。満タンで「搭乗でバースト！」と点滅。

### 4.8 バースト（`startBurst` / `updateBurst` / `endBurst`）

1. 乗り込み完了のコールバックで `sync >= 1` なら `startBurst()`。
2. `this.burst` が立つと `update()` は `updateBurst()` だけを実行（敵・弾・時間が止まる＝被弾しない）。
3. `robot.show('burst', …)` でロボットを表示、`sceneManager.overrideCamera = robot.camera` で**斜め後ろの三人称カメラ**に（`SHOTS.burst`）。
4. `BURST_VOLLEYS`（0.6/1.0/1.4秒）に、場の全ての敵へ弾道を引いて `burstDamage` を与える。
5. 2.4秒で `endBurst()`：ロボットを隠し、カメラを戻す。

### 4.9 乗り降りの演出（`boarding.js`）

**時間つきのステップを順に流す小さな仕組み。**

- `start(kind, done, steps)`：`steps = [{ time, enter?, run(t, dt, sec) }, …]`
- `update(dt)`：今のステップの `run` を呼び、時間が来たら次へ。最後に `done()`。
- 各 `run` は `view(at, yaw, pitch, roll)` で**プレイヤーの目線そのもの**を動かす（演出用の別カメラは使わない）。
- ロボットの `mixer.timeScale` を `SPEED`(2.5) にして、片膝・ハッチを速くする。終了・中断で 1 に戻す。

| | 流れ（合計） |
|---|---|
| 降りる（約2秒） | 片膝＋ハッチ即開き → ジャンプで飛び出す（弧を描く） → 着地（少し沈む） |
| 乗る（約3秒） | 走る（ハッチは同時に開く） → 体を回転させて飛び込む → ハッチが閉まる → 立ち上がる |

元の遅い版は `boarding.classic.js` に保存（使われていない）。

### 4.10 その他

| ファイル | 内容 |
|---|---|
| `player.js` | HP、移動・旋回、ジャンプの物理、搭乗中の揺れ（`rideSway`）。カメラを子に持つ |
| `companion.js` | 相棒ロボ。共闘中は自分で歩き、近い敵は殴り、遠い敵は撃つ。搭乗中は自機と同じ位置 |
| `stage.js` | 闘技場。移動範囲 `ARENA_RADIUS=64`、出現位置、門（閉じたまま固定） |
| `jumpPad.js` | ジャンプ板3か所。乗ると約11m打ち上がる |
| `pickups.js` | 回復アイテム。敵撃破時に確率で落ち、近づくと吸い寄せられる |
| `effects.js` | 爆発の代わりの「広がって消える球」 |
| `tutorialSteps.js` / `tutorialZone.js` | チュートリアル6ステップと目的地ゾーン。`done(input, game)` が true の間だけ進む |

---

## 5. 描画（`render/`）

| ファイル | 内容 |
|---|---|
| `sceneManager.js` | レンダラー、シーン、空のドーム（自作シェーダー）、環境マップ。**`render()` はここだけ**。`overrideCamera` があればそちらで映す |
| `robotModel.js` | 演出用の自機ロボット。クリップ再生、`seatPosition()`（コックピットの位置）、`SHOTS`（外から映すカメラの置き方） |
| `showcase.js` | タイトル・クリア・ゲームオーバーでロボットを外から映す |
| `cockpit.js` | 枠・操縦桿・ハンドル。カメラの子。手の入力に応じて操縦桿が動く（加算ブレンド） |
| `enemyModels.js` | 敵 glb を `SkeletonUtils.clone` で1体ずつ複製（骨を共有しないため） |
| `modelUtils.js` | モデルの位置合わせ、クリップ再生の共通処理 |
| `gltfLoader.js` | `GLTFLoader` + `DRACOLoader`（全員ここ経由） |

**カメラが2つある**ことに注意：ゲーム用カメラはプレイヤーの子。ロボット用カメラ（`robot.camera`）は演出用で、`overrideCamera` で切り替える。

---

## 6. UI・音

- `ui/Hud.js`：HP、照準、エネルギー、**シンクロ**、手の状態、ボス HP。`hud.update(input, game, label)` が毎フレーム呼ばれる。
- `ui/screens.js`：タイトル〜リザルトの各画面（`#screen` の中身を差し替え）。
- `ui/handPreview.js` / `bonesDisplay.js`：手の骨格を Canvas に描く。
- `audio/sound.js`：Web Audio。効果音・BGM・クロスフェード・ループ音（足音・蒸気）。

---

## 7. 調整したいとき

| やりたいこと | 触る場所 |
|---|---|
| 乗り降りの速さ・ジャンプの高さ | `boarding.js` 冒頭の `SPEED` `WALK_SPEED`、`Math.sin(k * Math.PI) * 2.2 / 2.8` |
| 降りたときの回復の速さ | `config.js` `energy.coopRegenMul` |
| ゲージの溜まりやすさ・バーストの威力 | `config.js` `sync` |
| コンテナの出やすさ・同時数・範囲 | `config.js` `container` |
| コンテナを落とすまでの時間・高さ | `drone.js` 冒頭の `CARRY_*` `ALIGN*` |
| コンテナの大きさ | `container.js` の `SIZE`（`RADIUS`/`FOOT` も合わせる） |
| バーストのカメラ | `robotModel.js` の `SHOTS.burst` |
| バーストの長さ・発射タイミング | `gameManager.js` の `BURST_VOLLEYS` `BURST_TIME` |
| 手の操作の感度 | `config.js` `aimRange` `moveRange` `deadzone` `aim.filter` |
| パーの判定が厳しい/甘い | `config.js` `modeSwitch.maxCurl` `minThumb` |

---

## 8. 既知の注意点

- MediaPipe の検出はメインスレッドで動くため、重いと描画が1フレーム止まることがある。
- 当たり判定は球のみ。細長い形（巨大コンテナの端など）は見た目とずれる。
- バースト中は `game.update` が早期 return するので、その間 `time`（経過時間）も進まない。
- `boarding.classic.js` は使われていないバックアップ。戻すときは `gameManager.js` の import を向け直す。
- 相棒ロボはコンテナを避けず、攻撃対象にもしない。
- 音は、ジャンプ・回復・コンテナの着地/破壊にまだ付いていない。

---
---

# 詳細編

ここから先は、上の説明の「中身」です。数値・式・データの形・各ファイルの関数まで書いています。コード側にも同じ内容を日本語コメントで入れてあります（`gameManager.js` / `boarding.js` / `container.js` / `drone.js` / `weapon.js` / `sword.js` / `player.js` / `aim.js` / `companion.js` / `enemyBase.js` / `main.js` / `inputManager.js` ほか）。

## 9. データの形

### 9.1 `input`（ゲームが見る入力、`InputManager.get()`）

| 項目 | 型・範囲 | 意味 |
|---|---|---|
| `aimX`, `aimY` | -1〜1 | 照準。`aimAxis:'horizontalAuto'` では `aimY` は常に 0（上下はゲーム側が自動） |
| `fire` | bool | 右手グリップ＋親指を閉じている。搭乗＝連射、共闘＝斬る（押した瞬間） |
| `moveX`, `moveY` | -1〜1 | 左手。`moveY` は指の傾き（下向き＝+前進） |
| `rightGrip`, `leftGrip` | bool | 握っているか（照準・移動はこれが true の間だけ有効） |
| `rightTracked`, `leftTracked` | bool | 手が映っているか |
| `leftOpen`, `rightOpen` | bool | パー（モード切替） |
| `handX`, `handY` | -1〜1 | 右手の位置のずれ（共闘の剣を画面のどこに出すか） |
| `swing`, `swingX`, `swingY` | 数値 | 右手の速さ（画面の高さ／秒）と向き。`swing > sword.swingSpeed` で斬る |

### 9.2 敵（`EnemyBase` を継承）が持つ値

`hp / maxHp / radius / score / dead / position（= object.position）/ rig（モデルのアニメ）`。
`radius` は当たり判定の球。ドローンは `container`（持っているコンテナ、なければ `null`）も持つ。

### 9.3 コンテナ（`Container`）

| 項目 | 意味 |
|---|---|
| `state` | `'held'` / `'falling'` / `'landed'` |
| `dead` | `state !== 'landed'`（攻撃を受けない・弾が当たらない） |
| `hp` | 敵の弾に対する耐久。自機の攻撃は 9999 を渡すので無関係 |
| `to` | 着地予定点（`release()` で決まる） |
| `radius` / `footRadius` / `height` | 弾の当たり球 / 自機が押し返される水平半径 / 乗り越えに必要な高さ |
| `isContainer` | `true`。敵と同じ配列で扱うときの目印（`onHit` の分岐に使う） |

### 9.4 `GameManager` の主な状態

`mode`（`'ride'`/`'coop'`）、`sync`（0〜1）、`burst`（バースト中は `{t, next, shown}`、普通は `null`）、`boss`、`kills`、`score`、`time`、`playing`（本番か）。

---

## 10. 時間の流れで見る各機能

### 10.1 乗り降り（`boarding.js`）

定数：`SPEED=2.5`（ロボットのアニメ倍速）。`KNEEL = 2.0/2.5 = 0.8秒`、`HATCH = 1.04/2.5 ≈ 0.42秒`。

**降りる（約2.0秒）**

| 秒 | ステップ | 目線の動き | ロボット |
|---|---|---|---|
| 0〜0.9 | ① 片膝＋ハッチ | 高さ 7m → 座席の高さへ下がる | 0.15秒後に表示。片膝をつく。ハッチが開く |
| 〜1.65 | ② 飛び出す（0.75秒） | 座席 → 前方 10m へ弧（山の高さ 2.8m）。向きは固定 | コックピットの内装が 0.2秒で消える |
| 〜2.2 | ③ 着地（0.55秒） | 地面に着き、0.3m 沈んで戻る | ハッチが閉まり、`Stand` に戻る（立ち上がる） |

終了時に `done(位置, 向き)` → プレイヤーが生身になる。

**乗る（約3秒）**

| 秒 | ステップ | 目線の動き |
|---|---|---|
| 0〜約1 | ① 走る（0.6〜1.4秒、14 m/s） | ロボットの周りを回り込み、コックピットを見上げる。同時にロボットは片膝・ハッチ開き |
| 〜+0.7 | ② 飛び込む | 前方 → 座席へ弧（山 2.2m）。向きを約180°回して「座る向き」に。視点が最大 0.18rad 傾く |
| 〜+0.47 | ③ ハッチが閉まる | コックピット枠が上から下りて閉じ、内装が 0.2秒で現れる |
| 〜+0.6 | ④ 立ち上がる | 外のロボットを隠し、目線が座席 → 7m へ上がる。ここで速度を 1 倍に戻す |

> 向きを変える式：`lerpAngle(from, to, t) = from + wrap(to − from) × t`。`wrap` が角度を -π〜π に折り返すので、常に近い回りで回る。

### 10.2 コンテナの1サイクル

```
t=0     ドローン出現。コンテナを真下に吊るして高さ34mを飛ぶ（見た目で「持っている」と分かる）
t≈数秒   プレイヤーの真上（水平距離 4m 以内）に 0.6 秒いる ──┐ もしくは 9 秒たつ
                                                          ▼
        release()：その場の真下に警告の輪 → 落下開始
        落下：vy += 22·dt、y −= vy·dt（吊り中心 24.5m → 地面接触 6m。距離 18.5m → 約 1.3 秒）
        着地：土煙＋ splash(8m) 以内で高さ3m未満のプレイヤーに 30 ダメージ → landed（障害物として残る）
着地後   弾を遮る・自機を押し返す。自機の弾/剣/ロボの攻撃で一撃破壊（敵の弾は HP150 を削る）
```

- 持っているドローンを倒すと、その場の真下へ落ちる（`onHit` が `release()`）。
- 落下中のコンテナは当たり判定がないので、撃ち落とすことはできない（避けるか、持ち主を先に倒す）。
- 巨大なので、`landed` のコンテナはジャンプ板で 11m 跳んでも（高さ12m）上には乗れない。

### 10.3 シンクロとバースト

```
共闘に入る ─▶ 剣が当たるたび +0.12 / コンテナ +0.04 / 毎秒 +0.012
                         │
 sync = 1 ──▶ HUD「搭乗でバースト！」点滅
                         │ 手をパーにして乗り込む
                         ▼
 乗り込み演出が終わる ─▶ startBurst()
   0.0s  ロボットを斜め後ろの三人称カメラで表示、Shoot クリップ開始
   0.6s  全敵へ 45 ダメージ（弾道・爆発）
   1.0s  同上
   1.4s  同上
   2.4s  endBurst()：カメラを戻し、ロボットを隠し、搭乗に復帰
```

合計ダメージは雑魚（HP30〜70）なら確実に倒せる量（135）。ボス（HP800）には約17%。

### 10.4 エネルギー

```
搭乗: 撃つ → energy −4/発（10発/秒＝40/秒）。0 でオーバーヒート。最後に撃って 0.4 秒後から +35/秒で回復
共闘: 回復が 即・3.5倍（≈122/秒）。満タン(100)まで約 0.8 秒
オーバーヒート解除: energy が 30 (resumeAt) まで回復
```

### 10.5 搭乗の揺れ（`Player.rideSway`）

`amount`（歩き具合 0〜1）に比例して、上下 `bob`・左右 `side`・傾き `roll`・うなずき `nod` を sin 波で足す。
さらに止まっているときの微振動 `idle × (1−amount)`、被弾時の衝撃 `hit × shake²`（`shake` は 1 → 0 を 0.3 秒）。`sway.enabled=false`（酔い止め）で全部オフ。

### 10.6 手の入力の整形

- **`shape(v)`**：`|v| < deadzone(0.15)` は 0。それ以外は `t=(|v|−dz)/(1−dz)` として `0.4t + 0.6t²`。中央は細かく、端は大きい。
- **One Euro Filter**：遅い動きは強く平滑化（ブレを消す）、速い動きは弱く（遅れを減らす）。`cutoff = minCutoff + beta×|速さ|`。
- **キャリブレーション**：両手を握って 2 秒の平均を `base` にする。入力は常に「基準からのずれ ÷ aimRange（moveRange）」。

---

## 11. ファイル別・関数リファレンス

### 11.1 入口

| 関数 / クラス | 内容 |
|---|---|
| `main.js: setState` | 状態を切り替える（`state.set`） |
| `main.js: state.onChange` | 状態に入った瞬間の処理（BGM・HUD・画面・リセット） |
| `main.js: frame` | 毎フレーム。入力 → 状態ごとの処理 → HUD → ロボット → 描画 → 音 |
| `main.js: updateCalibration / updateTutorial / updateRetryGesture` | 各状態の最中の処理 |
| `main.js: requestCamera` | カメラ起動 → 手認識開始 → キャリブレーションへ |

### 11.2 ゲーム（`game/`）

| ファイル | 主な関数 |
|---|---|
| `gameManager.js` | `update` `updateModeSwitch` `setMode` `finishMode` `syncView` `updateWave` `spawn` `onHit` `hitContainer` `onContainerLand` `addSync` `startBurst` `updateBurst` `endBurst` `dropPickup` `updateDying` `result` `spawnTutorialTarget` `showZone` `warmUp` `reset` |
| `player.js` | `update`（移動・旋回・ジャンプ・障害物）`rideSway` `setMode` `launch` `damage` `heal` |
| `aim.js` | `update`（rawAim → 自動上下 → エイムアシスト）`recenter` `reset` |
| `weapon.js` | `update`（撃つ・回復・弾の移動と判定）`spawn` `resetEnergy` `clear`。関数 `segmentHitsSphere` |
| `sword.js` | `update` `slash` `pose` `updateWaves` `reset` |
| `companion.js` | `update` `follow` `move` `findTarget` `startAction` `updateAction` `tracer` `updateTracers` |
| `boarding.js` | `mount` `dismount` `start` `next` `update` `cancel` `frontOf` `seat` `view` `speed` |
| `container.js` | `Container.sync/release/hit/update/dispose`、`Containers.hold/syncHeld/update/remove/clear`、`createContainerMesh` |
| `enemies/enemyBase.js` | `update` `hit` `die` `updateDying` `attack` `react` `setLoco` `setOutline` `keepDistance` `faceTarget` |
| `enemies/drone.js` | `behave` `carry` `carryBehave` `fallDown` |
| `enemies/walker.js` / `boss.js` | `behave`（歩行・3連射 / 扇形5発・怒り） |
| `enemies/enemyBullets.js` | `fire`（弾を出す）`update`（移動・当たり・コンテナで停止）`clear` |
| `stage.js` | `load`（闘技場 glb・門・出現位置）`spawnPoint` `buildGreybox` |
| `jumpPad.js` / `pickups.js` / `effects.js` | ジャンプ板 / 回復アイテム / 爆発の球 |
| `tutorialSteps.js` / `tutorialZone.js` | 各ステップの `done` 条件 / 黄色いゾーン |

### 11.3 手・入力（`hand/`, `input/`）

| ファイル | 主な関数 |
|---|---|
| `hand/handTracker.js` | `init`（MediaPipe 準備）`start`（映像フレームごとに検出）`toHands`（左右の割り当て補正） |
| `hand/landmarkProcessor.js` | `process`（左右反転・位置/大きさ・平滑化） |
| `hand/gestureDetector.js` | `measure`（folded/thumb/curl/upright）、`GestureDetector.update`（グリップ・連射・パー） |
| `hand/ballStick.js` | `measureTilt`（pitch/roll）`fingerPitch` `handFrame` `TiltSmoother` |
| `input/inputManager.js` | `onHands` `updateSwing` `updateOrientAim` `offset` `get` `setBase` `lostFor` |
| `input/oneEuroFilter.js` | `filter(x, t)` |
| `input/calibration.js` | `computeBase(samples)`（位置・大きさ・右手の基準の傾き・左手の指の向き） |

### 11.4 描画・UI・音

| ファイル | 主な関数 |
|---|---|
| `render/sceneManager.js` | コンストラクタ（空シェーダー・ライト・環境マップ）`render`（`overrideCamera` 対応）`resize` |
| `render/robotModel.js` | `load` `play` `hatch` `resetHatch` `place` `show` `hide` `muzzle` `seatPosition` `update`（アニメ＋演出カメラ） |
| `render/showcase.js` | 状態に応じて、ロボットを外から映す・やめる |
| `render/cockpit.js` | `load` `setOpen`（枠を開閉）`setFade`（透明に）`updateStick`（手に合わせて操縦桿）`kick`（反動）`update`（視野角） |
| `render/enemyModels.js` | `loadEnemyModels`（寸法を正規化）`EnemyRig`（骨ごと複製・点滅・輪郭） |
| `ui/Hud.js` | `update`（各バー・照準・手の状態）`modeChanged`（モード名を大きく出す） |
| `ui/screens.js` | `start` `cameraPermission` `calibration` `tutorial` `countdown` `banner` `handLost` `result` |
| `audio/sound.js` | `play`（1回）`loop`（毎フレーム呼ぶ間だけ鳴る）`update` `playBgm`（クロスフェード）`duckBgm` `setVolume` |

---

## 12. 機能を足すときの手順（レシピ）

### 12.1 新しい敵を足す

1. `game/enemies/` に `EnemyBase` を継承したクラスを作り、`behave(dt, {eye, bullets})` に動きと攻撃を書く。
2. モデルがあれば `render/enemyModels.js` の `DEFS` に追加、`useModel('名前')`。なければ仮の形を作る。
3. `gameManager.updateWave()` の出現の割合に加える。
4. HP・スコアはコンストラクタの `super({hp, radius, score})`。

### 12.2 新しい調整値を足す

`config.js` に書いて `CONFIG.xxx` で読む。数値をコードに直接書かない。

### 12.3 新しい攻撃を「バースト」のように演出付きで足す

`gameManager` に `this.xxx = { t, ... }` の状態を持たせ、`update()` の先頭で `if (this.xxx) return this.updateXxx(dt)` として他を止める。カメラを変えるなら `sceneManager.overrideCamera`、終わったら必ず `null` に戻し、`reset()` からも終了処理を呼ぶ。

### 12.4 敵の弾を遮るものを足す

`Containers.landed` と同じ形（`position`・`radius`・`dead`）のオブジェクトを `EnemyBullets.update` の `blockers` に渡す。

---

## 13. 開発・デバッグのヒント

- `npm run dev` のとき（`CONFIG.debug`）：**K キー**で手入力 ⇄ キーボード入力。マウス＝照準、クリック/Space＝撃つ・斬る、WASD＝移動、E 長押し＝モード切替。
- コンソールから `game` を触れる（`window.game`）。例：`game.sync = 1` でシンクロ満タン、`game.setMode('coop')`。
- **C キー**：コックピットの位置・大きさを調整するスライダー（`cockpitDebug.js`）。
- 画面左上のデバッグ表示：fps・最大フレーム間隔・描画呼び出し数・手の検出時間。カクつきの原因（検出が重い / 描画が重い）の切り分けに使う。
- 乗り降りの感触の調整：`boarding.js` の `SPEED`（アニメ倍速）と、各ステップの `time`。
