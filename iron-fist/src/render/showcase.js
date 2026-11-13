// 自機ロボットを外から映す演出（タイトル・クリア・ゲームオーバー）。それ以外はゲームのモードどおりの視点

import { STATE } from '../game/gameState.js';
import { TITLE_ROBOT_SPOT } from '../game/stage.js';

export function createShowcase({ robot, sceneManager, game }) {
    let showcase = false;
    return function update(next) {
        const c = game.companion;   // 共闘モードでも、ロボットのいる場所で演出する
        let shown = true;
        switch (next) {
            case STATE.START:
                shown = robot.show('title', TITLE_ROBOT_SPOT, 0);
                robot.resetHatch();
                robot.play('Stand');
                break;
            case STATE.CLEAR:
                shown = robot.show('victory', c.position, c.yaw);
                robot.resetHatch();
                robot.play('Victory', { once: true, fade: 0.2 });
                break;
            case STATE.GAME_OVER:
                shown = robot.show('defeat', c.position, c.yaw);
                robot.resetHatch();
                robot.play('Defeat', { once: true, fade: 0.1 });
                break;
            case STATE.RESULT:
                shown = showcase;   // クリア・ゲームオーバーの最後のポーズのまま映し続ける
                break;
            default:
                shown = false;
        }
        showcase = !!shown;
        sceneManager.overrideCamera = showcase ? robot.camera : null;
        if (showcase) {
            // コックピットの枠や剣が外から見えないように
            game.cockpit.group.visible = false;
            game.sword.group.visible = false;
        } else {
            game.syncView();
        }
    };
}

