export function createRuntimeState() {
    return {
        modelList: [],
        eventHooked: false,
        firstOpen: true,
        lastChatLength: 0,
        historyLoadPromise: null,
        visibilityTimer: null,
    };
}
