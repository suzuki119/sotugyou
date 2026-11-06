// 開発用：コックピットの操縦桿・ハンドルの値をスライダーで直接動かす（C キーで表示 / 非表示）
//   「手の入力を使う」のチェックを外すと、スライダーの値が手の入力より優先される
//   視野角・目の位置・コントローラーの位置もその場で変えられる（気に入った値は COCKPIT に書き写す）

import { COCKPIT } from './cockpit.js';

export class CockpitDebug {
    constructor(cockpit) {
        this.cockpit = cockpit;
        this.values = { stickX: 0.5, stickY: 0.5, handle: 0, button: 0 };
        const root = document.createElement('div');
        root.hidden = true;
        root.style.cssText = 'position:fixed;left:16px;top:16px;z-index:50;padding:10px 12px;width:260px;'
            + 'background:rgba(7,11,15,.85);color:#cfe;font:12px/1.6 sans-serif;border:1px solid #345;border-radius:6px';
        root.innerHTML = '<b>コックピット（C で閉じる）</b>';
        document.body.appendChild(root);
        this.root = root;

        this.checkbox('手の入力を使う', true, (on) => this.setOverride(!on));
        this.slider('操縦桿 X', 0, 1, 0.01, 0.5, (v) => { this.values.stickX = v; });
        this.slider('操縦桿 Y', 0, 1, 0.01, 0.5, (v) => { this.values.stickY = v; });
        this.slider('ハンドル', -1, 1, 0.01, 0, (v) => { this.values.handle = v; });
        this.slider('ボタン', 0, 1, 0.01, 0, (v) => { this.values.button = v; });
        this.checkbox('台座を表示', COCKPIT.showDeck, (on) => cockpit.setDeckVisible(on));
        this.slider('押し込みの深さ', 0, 1, 0.05, COCKPIT.buttonPress, (v) => { COCKPIT.buttonPress = v; });
        this.slider('視野角', 40, 100, 1, COCKPIT.view.fov, (v) => { COCKPIT.view.fov = v; });
        this.slider('枠の横幅', 1, 2.5, 0.05, COCKPIT.view.scaleX, (v) => { COCKPIT.view.scaleX = v; cockpit.applyLayout(); });
        const eye = COCKPIT.view.eyeOffset;
        this.slider('目 x', -0.3, 0.3, 0.005, eye.x, (v) => { eye.x = v; cockpit.applyLayout(); });
        this.slider('目 y', -0.3, 0.3, 0.005, eye.y, (v) => { eye.y = v; cockpit.applyLayout(); });
        this.slider('目 z', -0.3, 0.3, 0.005, eye.z, (v) => { eye.z = v; cockpit.applyLayout(); });
        for (const [name, cfg] of [['操縦桿', COCKPIT.stick], ['ハンドル', COCKPIT.handle]]) {
            for (const axis of ['x', 'y', 'z']) {
                this.slider(`${name} 位置 ${axis}`, -1, 1, 0.005, cfg.position[axis], (v) => { cfg.position[axis] = v; cockpit.applyLayout(); });
            }
        }
        const log = document.createElement('button');
        log.textContent = '今の設定をコンソールに出す';
        log.style.cssText = 'margin-top:6px;padding:4px 8px;font-size:12px;width:100%';
        log.onclick = () => console.log('COCKPIT', JSON.stringify(COCKPIT, null, 2));
        root.appendChild(log);

        addEventListener('keydown', (e) => {
            if (e.code === 'KeyC') root.hidden = !root.hidden;
        });
    }

    setOverride(on) {
        this.cockpit.override = on ? this.values : null;
    }

    row(label) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:6px';
        const name = document.createElement('span');
        name.textContent = label;
        name.style.cssText = 'flex:0 0 96px';
        row.appendChild(name);
        this.root.appendChild(row);
        return row;
    }

    slider(label, min, max, step, value, onInput) {
        const row = this.row(label);
        const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value });
        input.style.flex = '1';
        const out = document.createElement('span');
        out.style.cssText = 'flex:0 0 40px;text-align:right';
        out.textContent = Number(value).toFixed(2);
        input.oninput = () => {
            out.textContent = Number(input.value).toFixed(2);
            onInput(Number(input.value));
        };
        row.append(input, out);
    }

    checkbox(label, checked, onChange) {
        const row = this.row(label);
        const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
        input.onchange = () => onChange(input.checked);
        row.appendChild(input);
    }
}
