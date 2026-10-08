// 開発用の入力（手を使わずにゲームロジックを確かめるため）。展示版では無効
//   K：手入力 ⇄ キーボード入力の切り替え
//   マウス：照準 / クリック or Space：射撃 / WASD：移動

export class DebugKeyboardInput {
    constructor() {
        this.enabled = false;
        this.keys = new Set();
        this.aim = { x: 0, y: 0 };
        this.mouseDown = false;

        addEventListener('keydown', (e) => {
            if (e.code === 'KeyK') this.enabled = !this.enabled;
            this.keys.add(e.code);
        });
        addEventListener('keyup', (e) => this.keys.delete(e.code));
        addEventListener('blur', () => this.keys.clear());
        addEventListener('mousemove', (e) => {
            this.aim.x = (e.clientX / innerWidth) * 2 - 1;
            this.aim.y = -((e.clientY / innerHeight) * 2 - 1);
        });
        addEventListener('mousedown', () => (this.mouseDown = true));
        addEventListener('mouseup', () => (this.mouseDown = false));
    }

    get() {
        const k = (c) => (this.keys.has(c) ? 1 : 0);
        return {
            aimX: this.aim.x,
            aimY: this.aim.y,
            fire: this.mouseDown || this.keys.has('Space'),
            moveX: k('KeyD') - k('KeyA'),
            moveY: k('KeyW') - k('KeyS'),
            rightGrip: true, leftGrip: true, rightTracked: true, leftTracked: true,
        };
    }
}
