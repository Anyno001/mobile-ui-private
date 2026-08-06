import { GROUP_COLORS } from './groups.js';

export function getConversationSaveKey(state) {
    return state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
}

export function resolveConversationTarget(state, getStorageId) {
    const storageId = state.activeStorageId || getStorageId();
    const targetKey = getConversationSaveKey(state);
    if (!storageId || storageId === 'sms_unknown__default' || !targetKey) return null;
    return { storageId, targetKey, saveKey: targetKey, isGroup: state.isGroupChat };
}

export function snapshotConversationContext(state) {
    return {
        saveKey: getConversationSaveKey(state),
        storageId: state.activeStorageId,
        normalizationContext: {
            isGroupChat: state.isGroupChat,
            groupMembers: state.groupMembers.slice(),
        },
    };
}

export function applyConversationTarget(state, key, groupMeta) {
    if (groupMeta) {
        state.isGroupChat = true;
        state.currentGroupKey = key;
        state.groupMembers = groupMeta.members.slice();
        state.groupExtras = Array.isArray(groupMeta.extras) ? groupMeta.extras.slice() : [];
        state.groupDisplayName = groupMeta.name;
        state.groupRandomNpcEnabled = groupMeta.randomNpcEnabled === true;
        state.groupNature = typeof groupMeta.groupNature === 'string' ? groupMeta.groupNature : '';
        state.groupRandomNpcPrompt = typeof groupMeta.randomNpcPrompt === 'string' ? groupMeta.randomNpcPrompt : '';
        state.groupColorMap = {};
        state.groupMembers.forEach((name, index) => {
            state.groupColorMap[name] = groupMeta.memberColors?.[name]
                || GROUP_COLORS[index % GROUP_COLORS.length].bg;
        });
        return;
    }
    state.isGroupChat = false;
    state.groupMembers = [];
    state.groupExtras = [];
    state.groupColorMap = {};
    state.groupDisplayName = '';
    state.groupRandomNpcEnabled = false;
    state.groupNature = '';
    state.groupRandomNpcPrompt = '';
    state.currentGroupKey = '';
}
