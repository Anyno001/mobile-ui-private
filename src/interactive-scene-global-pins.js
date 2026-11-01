/** 全局固定社区：桌面显示项与来源名。固定列表本身在 phoneUi 状态的 globalPins（见 interactive-scene-model.js）。 */

// storageId 形如 sms_<角色头像>__<聊天编号>；取得到角色名就返回，取不到返回空字符串。
export function storageSourceLabel(storageId, characters) {
    const match = /^sms_(.+)__[^_].*$/s.exec(String(storageId || ''));
    const avatar = match?.[1] || '';
    const list = Array.isArray(characters) ? characters : Object.values(characters || {});
    const name = avatar ? list.find(item => item?.avatar === avatar)?.name : '';
    return typeof name === 'string' ? name.trim() : '';
}

// 桌面固定项：按固定先后排列，找得到社区的才显示；别的聊天的带上 storageId 与来源名。
export function buildDesktopPins({ store, phoneUiState, currentStorageId, characters }) {
    const pins = [];
    for (const pin of phoneUiState?.globalPins || []) {
        const scene = store?.scopes?.[pin.storageId]?.scenes?.[pin.sceneId];
        if (!scene) continue;
        pins.push(pin.storageId === currentStorageId
            ? { scene }
            : { scene, storageId: pin.storageId, source: storageSourceLabel(pin.storageId, characters) });
    }
    return pins;
}
