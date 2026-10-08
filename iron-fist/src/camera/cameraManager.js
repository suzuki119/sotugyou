// カメラの起動とエラーの種類分け

export const CAMERA_MESSAGES = {
    unsupported: 'このブラウザではカメラを使えません。Google Chrome でお楽しみください。',
    denied: 'カメラを使用できませんでした。Chrome のアドレスバー左のアイコンからカメラを許可してください。',
    notFound: 'カメラが見つかりませんでした。',
    inUse: 'カメラが他のアプリで使用中です。他のアプリを閉じてから再度お試しください。',
    unknown: 'カメラを起動できませんでした。ページを再読み込みしてください。',
};

export class CameraError extends Error {
    constructor(kind) {
        super(CAMERA_MESSAGES[kind]);
        this.kind = kind;
    }
}

export async function startCamera(video) {
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');
    try {
        video.srcObject = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
            audio: false,
        });
        await video.play();
    } catch (err) {
        const kind = {
            NotAllowedError: 'denied',
            SecurityError: 'denied',
            NotFoundError: 'notFound',
            OverconstrainedError: 'notFound',
            NotReadableError: 'inUse',
        }[err.name] ?? 'unknown';
        throw new CameraError(kind);
    }
}
