export const SAVE_LIMIT = 60;
export const CONTEXT_LIMIT = 20;
export const BIDIRECTIONAL_LIMIT = 20;
export const MAX_BIDIRECTIONAL = 5;
export const BIDIRECTIONAL_KEY = 'PHONE_SMS_MEMORY';
export const CHARACTER_BEHAVIOR_KEY = 'ST_SMS_CHARACTER_BEHAVIOR';
export const VOICE_MAX_SEC = 60;
export const MODEL_VISIBLE_ROWS = 4;
export const MAX_GROUP_MEMBERS = 16;
export const MESSAGE_LENGTH_VALUES = Object.freeze(['persona', 'short', 'medium', 'long']);
export const FREQUENCY_VALUES = Object.freeze(['never', 'rare', 'occasional', 'frequent']);
export const MAX_INJECTION_DEPTH = 10000;
export const EXTENSION_PROMPT_POSITIONS = Object.freeze({
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
});
export const DEFAULT_GROUP_INJECTION = Object.freeze({
    position: EXTENSION_PROMPT_POSITIONS.IN_PROMPT,
    depth: 0,
    historyLimit: BIDIRECTIONAL_LIMIT,
});
export const PM_IDB_NAME = 'PhoneModeDB';
export const PM_IDB_STORE = 'kv';
export const IDB_MARKER = '__idb__';

export const POPOVER_SUPPORTED =
    typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');
