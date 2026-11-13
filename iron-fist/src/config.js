// 調整用の値をまとめる。数値はすべて仮（Phase 1〜4 の検証で決める）

export const CONFIG = {
    // 開発用キーボード入力（K キーで切り替え）。展示用ビルドでは無効
    debug: import.meta.env?.DEV ?? false,

    // 照準（画面上の照準マーカー）の動かし方
    aim: {
        control: 'position',  // 'position'＝スティックの倒れ具合＝照準の位置 / 'rate'＝倒れ具合＝照準が動く速さ（戻すと止まる）
        rateSpeed: 1.6,       // 'rate' のとき、最大まで倒したときの速さ（画面の半分／秒）
        filter: { minCutoff: 1.0, beta: 0.4 },   // ブレ取り（minCutoff を下げるとなめらか、beta を上げると速い動きに追従）
        assistRadius: 0.15,   // エイムアシスト：照準からこの距離（画面の半分＝1）以内の敵に吸い付く。0 で無効
        assistStrength: 0.6,  // 吸い付く強さ（0〜1）
    },
    // 照準の軸：
    //   'free'              … 上下左右を同時に動かす（aimMode の方式で）
    //   'horizontalAuto'    … 右手を左右に動かすのは照準の左右だけ。上下は近くの敵の高さに自動で合わせる
    //   'orientationSwitch' … 右手を縦にして左右に動かす＝照準の左右 / 横に寝かせて左右に動かす＝照準の上下
    aimAxis: 'horizontalAuto',
    autoVerticalWidth: 0.3,     // 'horizontalAuto'：照準の縦の線からこの幅（画面の半分＝1）以内の敵に高さを合わせる
    orientSwitchFreezeMs: 200,  // 'orientationSwitch'：手を回した直後は照準を動かさない時間
    invertOrientY: false,       // 'orientationSwitch'：右に動かす＝上。逆にしたいとき true

    // 手の骨格をゲーム画面の左上に表示する（仮。H キーで切り替え）
    showBones: true,

    // 旋回：'leftStick'＝左手の左右で旋回、前後で前進 / 'aimEdge'＝照準を画面端に寄せると旋回（左手の左右は横移動）
    turnWith: 'aimEdge',

    // ジャンプ（ジャンプ板で打ち上げられる）
    jump: {
        gravity: 30,          // 落ちる速さ（m/s²）
        launch: 26,           // ジャンプ板で打ち上がる初速（m/s）。頂点の高さ＝launch² ÷ (2 × gravity) ≒ 11m
    },
    // 回復アイテム：雑魚敵が倒れたとき、確率で落とす（HP が減っているほど出やすい）
    pickup: {
        chance: 0.2,          // 基本の確率
        lowHpBonus: 0.3,      // HP が 0 のときに足される確率（HP に比例して減る）
        heal: 20,             // 回復量（HP は最大 100）
        life: 20,             // 落ちてから消えるまで（秒）
    },
    // コンテナ：ドローンが投げ落とす。着地するとその場に残り、弾を遮る。攻撃を受け続けると壊れる
    container: {
        chance: 0.35,         // ドローンが撃つ代わりに投げる確率
        max: 3,               // 同時に存在できる数
        hp: 150,              // 自機の弾（1発10）で15発ぶん
        damage: 25,           // 着地点の近くにいたときのダメージ
        splash: 5.5,          // 着地でダメージを受ける範囲（m）
        flight: 1.6,          // 投げてから着地するまで（秒）。ここで見て避けられる
    },

    // 描画：高解像度ディスプレイで重いときは下げる（1＝等倍。上げるほど細かいが重い）
    render: { maxPixelRatio: 1.5 },

    // 搭乗中の機体の揺れ（一人称）。値はすべて強さの倍率ではなく実寸（m / rad）。0 にするとその揺れだけ消える
    sway: {
        enabled: true,    // false＝酔い止めモード（揺れなし）。スタート画面・一時停止画面で切り替えられる
        bob: 0.2,         // 歩くときの上下（m）。1歩ごとに沈む
        side: 0.14,       // 歩くときの左右（m）。左右の足に体重が乗り換わる
        roll: 0.014,      // 歩くときの左右の傾き（rad）
        nod: 0.008,       // 歩くときの前後のうなずき（rad）
        turnLean: 0.035,  // 旋回するとき、旋回の向きに傾く量（rad）
        idle: 0.012,      // 止まっているときの、エンジンの微かな揺れ（m）
        hit: 0.5,         // 被弾したときの衝撃（m）。0.3秒ほどで収まる
        follow: 6,        // 揺れの強さが変わるときの追従の速さ（大きいほどすぐ切り替わる）
    },

    // 右手の照準：'ballstick'＝見えないボールスティックを倒す / 'position'＝手の位置のずれ
    aimMode: 'ballstick',
    ballStick: {
        xSource: 'position',  // 左右：'position'＝手の左右のずれ / 'roll'＝手首を左右に倒す
        pitchRange: 25,       // 前後にこの角度（度）倒すと最大
        rollRange: 25,
        invertPitch: false,   // 向きが逆なら true
        invertRoll: false,
    },
    // aimMode が 'position' のときの上下：'depth'＝手を奥・手前に動かす / 'screen'＝画面上の上下
    aimYMode: 'depth',
    // 左手の前後移動：'screen'＝画面上の上下 / 'depth'＝奥・手前（未決定事項）
    // 左手の前後移動：'tilt'＝指を上に向けると後退・下に向けると前進 / 'depth'＝奥・手前 / 'screen'＝画面上の上下
    moveYMode: 'tilt',
    moveTiltRange: { forward: 30, back: 25 },   // 'tilt'：基準の構えからこの角度（度）傾けると最大

    // 基準位置からこれだけずれたら入力が最大（±1）になる
    aimRange: { x: 0.12, y: 0.10, depth: 0.25 },  // x, y は画面の幅・高さに対する割合。depth は手の大きさの変化率
    // depthForward / depthBack：基準からカメラまでの距離の何割、奥（前進）・手前（後退）に動かすと最大か
    //   手前には腕を引ける距離が短いので、後退側を小さく（敏感に）している
    moveRange: { x: 0.10, y: 0.10, depthForward: 0.15, depthBack: 0.08 },
    deadzone: 0.15,

    smoothing: 0.45,          // 位置の平滑化（0＝なし、1に近いほどなめらかで遅い）
    minHandScore: 0.6,        // これより信頼度が低い手は使わない
    // 音量（0〜1）。se は効果音ごとの倍率
    sound: {
        bgmVolume: 0.35,
        seVolume: 0.8,
        se: { gun: 0.35, outOfEnergy: 0.9, enemyShot: 0.35, footstep: 0.7, steam: 0.6 },
    },
    // 銃のエネルギー：1発ごとに消費し、撃たずにいると自動で回復する
    //   0 になるとオーバーヒート：resumeAt まで回復するまで撃てない
    energy: {
        max: 100,
        costPerShot: 4,       // 連射 10発/秒 なので 40/秒 消費（満タンから約2.5秒撃てる）
        regenPerSec: 35,      // 回復の速さ（/秒）
        regenDelayMs: 400,    // 最後に撃ってからこの時間たつと回復が始まる
        resumeAt: 30,         // オーバーヒートしたら、ここまで回復すると撃てるようになる
    },
    thumbGraceMs: 60,         // 親指が一瞬「立った」と判定されても、この時間は連射を続ける（長いと指を上げても撃ち続ける）
    handLostPauseMs: 1500,    // 両手をこの時間見失ったら一時停止
    calibrationMs: 2000,      // 基準位置を取る時間

    // モード切り替え（搭乗 ⇄ 共闘）：手をパーにして holdMs 待つ。一度パーをやめるまで次の切り替えはしない
    modeSwitch: {
        hands: 'both',        // 'both'＝両手ともパー / 'either'＝どちらかの手がパー
        holdMs: 500,
        // パーの判定：4本指がすべて伸びていて、指の曲がりの平均が maxCurl（度）以下、親指の開きが minThumb 以上
        //   HUD 左上の表示（左／右の「曲」「親」）を見ながら調整する
        maxCurl: 32,
        minThumb: 0.45,
    },
    // 共闘モードの剣（右手）
    sword: {
        swingSpeed: 1.6,      // 右手をこの速さ（画面の高さ／秒）より速く振ると斬る
        cooldownMs: 350,      // 一度斬ったら、次に斬れるまでの時間
        handRange: 0.15,      // 右手を基準位置からこれだけ動かすと、画面の剣が端まで動く
    },
};
