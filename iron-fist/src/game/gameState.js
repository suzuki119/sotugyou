// ゲーム状態（仕様書 11. ゲーム状態）

export const STATE = {
    LOADING: 'LOADING',
    START: 'START',
    CAMERA_PERMISSION: 'CAMERA_PERMISSION',
    CALIBRATION: 'CALIBRATION',
    TUTORIAL: 'TUTORIAL',
    READY: 'READY',
    PLAYING: 'PLAYING',
    BOSS: 'BOSS',
    HAND_LOST: 'HAND_LOST',
    CLEAR: 'CLEAR',
    GAME_OVER: 'GAME_OVER',
    RESULT: 'RESULT',
};

export class GameState {
    constructor() {
        this.current = STATE.LOADING;
        this.listeners = [];
    }

    set(next, data) {
        const prev = this.current;
        if (prev === next) return;
        this.current = next;
        for (const fn of this.listeners) fn(next, prev, data);
    }

    is(...states) {
        return states.includes(this.current);
    }

    onChange(fn) {
        this.listeners.push(fn);
    }
}
