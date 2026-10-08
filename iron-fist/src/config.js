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
    moveYMode: 'depth',

    // 基準位置からこれだけずれたら入力が最大（±1）になる
    aimRange: { x: 0.12, y: 0.10, depth: 0.25 },  // x, y は画面の幅・高さに対する割合。depth は手の大きさの変化率
    moveRange: { x: 0.10, y: 0.10, depth: 0.20 },   // depth：手の大きさが基準から20%変わると最大
    deadzone: 0.15,

    smoothing: 0.45,          // 位置の平滑化（0＝なし、1に近いほどなめらかで遅い）
    minHandScore: 0.6,        // これより信頼度が低い手は使わない
    thumbGraceMs: 150,        // 親指が一瞬「立った」と判定されても、この時間は連射を続ける
    handLostPauseMs: 1500,    // 両手をこの時間見失ったら一時停止
    calibrationMs: 2000,      // 基準位置を取る時間
};
