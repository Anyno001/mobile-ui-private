export const PHONE_QR_SET_NAME = '天音小笺 · 手机入口';
export const PHONE_QR_LABEL = '打开天音小笺';
export const PHONE_QR_AUTOMATION_ID = 'tianyin-xiaojian.phone.open.v1';
export const PHONE_QR_MESSAGE = '/phone';

const REQUIRED_METHODS = [
    'getSetByName', 'createSet', 'deleteSet', 'createQuickReply', 'updateQuickReply',
    'deleteQuickReply', 'addGlobalSet', 'removeGlobalSet', 'listGlobalSets',
];

function requireApi(api = globalThis.quickReplyApi) {
    if (!api || typeof api !== 'object') throw new Error('当前宿主未提供 Quick Reply API');
    const missing = REQUIRED_METHODS.filter(name => typeof api[name] !== 'function');
    if (missing.length) throw new Error(`当前宿主的 Quick Reply API 缺少：${missing.join('、')}`);
    return api;
}

const qrList = set => Array.isArray(set?.qrList) ? set.qrList : [];
const ownedReplies = set => qrList(set).filter(qr => qr?.automationId === PHONE_QR_AUTOMATION_ID);
function replyIdentifier(qr) {
    if (!Number.isInteger(qr?.id)) {
        throw new Error('宿主 Quick Reply 缺少稳定数字 ID，无法安全修改或删除');
    }
    return qr.id;
}
const desiredProps = {
    message: PHONE_QR_MESSAGE,
    title: '打开天音小笺手机界面',
    showLabel: true,
    isHidden: false,
    automationId: PHONE_QR_AUTOMATION_ID,
};

export function getPhoneQuickReplyStatus(api = globalThis.quickReplyApi) {
    try {
        const host = requireApi(api);
        const set = host.getSetByName(PHONE_QR_SET_NAME);
        if (!set) return { state: 'absent', active: false };
        const owned = ownedReplies(set);
        if (!owned.length) return { state: 'conflict', active: false };
        const active = host.listGlobalSets().includes(PHONE_QR_SET_NAME);
        const ready = owned.length === 1 && owned[0].label === PHONE_QR_LABEL
            && owned[0].message === PHONE_QR_MESSAGE
            && owned[0].title === desiredProps.title
            && owned[0].showLabel === desiredProps.showLabel
            && owned[0].isHidden === desiredProps.isHidden && active;
        return { state: ready ? 'ready' : 'repairable', active, count: owned.length };
    } catch (error) {
        return { state: 'unavailable', active: false, error: error.message };
    }
}

export async function ensurePhoneQuickReply(api = globalThis.quickReplyApi) {
    const host = requireApi(api);
    let set = host.getSetByName(PHONE_QR_SET_NAME);
    let createdSet = false;
    if (set && !ownedReplies(set).length) {
        throw new Error('存在同名 Quick Reply 集合，但无法证明属于天音小笺；已停止，未覆盖用户数据');
    }
    if (!set) {
        set = await host.createSet(PHONE_QR_SET_NAME, { disableSend: false, placeBeforeInput: false, injectInput: false });
        createdSet = true;
    }
    try {
        const owned = ownedReplies(set);
        if (!owned.length) {
            host.createQuickReply(PHONE_QR_SET_NAME, PHONE_QR_LABEL, desiredProps);
        } else {
            const primary = owned[0];
            host.updateQuickReply(PHONE_QR_SET_NAME, replyIdentifier(primary), { ...desiredProps, newLabel: PHONE_QR_LABEL });
            for (const duplicate of owned.slice(1)) host.deleteQuickReply(PHONE_QR_SET_NAME, replyIdentifier(duplicate));
        }
        if (!host.listGlobalSets().includes(PHONE_QR_SET_NAME)) host.addGlobalSet(PHONE_QR_SET_NAME, true);
        return getPhoneQuickReplyStatus(host);
    } catch (error) {
        if (createdSet) {
            try { await host.deleteSet(PHONE_QR_SET_NAME); }
            catch (rollbackError) { throw new Error(`${error.message}；新建集合回滚失败：${rollbackError.message}`); }
        }
        throw error;
    }
}

export async function clearPhoneQuickReply(api = globalThis.quickReplyApi) {
    const host = requireApi(api);
    const set = host.getSetByName(PHONE_QR_SET_NAME);
    if (!set) return { state: 'absent', active: false };
    const owned = ownedReplies(set);
    if (!owned.length) throw new Error('同名 Quick Reply 集合不属于天音小笺，未执行清除');
    const wasActive = host.listGlobalSets().includes(PHONE_QR_SET_NAME);
    const ownsWholeSet = qrList(set).length === owned.length;
    if (wasActive) host.removeGlobalSet(PHONE_QR_SET_NAME);
    try {
        if (ownsWholeSet) {
            await host.deleteSet(PHONE_QR_SET_NAME);
            if (host.getSetByName(PHONE_QR_SET_NAME)) throw new Error('宿主未确认删除 Quick Reply 集合');
        } else {
            for (const qr of owned) host.deleteQuickReply(PHONE_QR_SET_NAME, replyIdentifier(qr));
            if (wasActive && !host.listGlobalSets().includes(PHONE_QR_SET_NAME)) {
                host.addGlobalSet(PHONE_QR_SET_NAME, true);
            }
        }
        return { state: 'absent', active: false };
    } catch (error) {
        if (wasActive && host.getSetByName(PHONE_QR_SET_NAME)
            && !host.listGlobalSets().includes(PHONE_QR_SET_NAME)) {
            try { host.addGlobalSet(PHONE_QR_SET_NAME, true); }
            catch (rollbackError) {
                throw new Error(`${error.message}；恢复全局启用状态失败：${rollbackError.message}`);
            }
        }
        throw error;
    }
}
