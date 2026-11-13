import { CONFIG } from '../config.js';

// チュートリアルの各ステップ：done(input, game) が true の間だけ進む
export const TUTORIAL = [
    { title: '右手で照準', text: {
        horizontalAuto: 'まずは右手で照準を動かしてみましょう！右手を握ったまま左右に動かしてくださいね。上下は自動で敵に合います。照準を画面の端に寄せると、機体が旋回しますよ',
        orientationSwitch: '右手を縦にして左右に動かすと照準が左右に、横に寝かせて動かすと上下に動きます。やってみましょう！',
        free: '右手のボールスティックを前後・左右に倒して、照準を動かしてみましょう！',
    }[CONFIG.aimAxis], done: (i) => Math.hypot(i.aimX, i.aimY) > 0.4 },
    { title: '親指で射撃', text: 'ボールを握ったまま親指を閉じている間、連射できます。親指を離すと止まりますよ。照準を合わせて、正面に浮かぶドローンを撃ち落としてみましょう！',
        enter: (g) => g.spawnTutorialTarget(), done: (i, g) => g.kills > 0 },
    { title: '左手で移動', text: '次は左手で移動です！左手を握ったまま、手首を曲げて指を下に向けると前進、上に向けると後退します。左右に動かすと横移動ですよ。黄色く光るゾーンまで行ってみましょう！',
        enter: (g) => g.showZone(), leave: (g) => g.hideZone(), done: (i, g) => g.inZone },
    { title: 'ロボットから降りる', text: '両手をパーにして少し待つと、ロボットから降りて共闘モードになります。ロボットが自分で歩いて戦ってくれるので、頼もしいですよ！',
        done: (i, g) => g.mode === 'coop' },
    { title: '剣で斬る', text: '右手をすばやく振ると、剣で斬れます！斬撃は前方の敵へ飛んでいきますよ。左手は、左右で旋回、前後で移動です。さあ、振ってみましょう！',
        done: (i, g) => g.mode === 'coop' && g.sword.slashes > 0 },
    { title: 'ロボットに乗る', text: '最後です！もう一度両手をパーにすると、ロボットに乗り込んで搭乗モードに戻れます。いよいよ出撃ですね！', done: (i, g) => g.mode === 'ride' },
];
