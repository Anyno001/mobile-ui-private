export const SAVE_LIMIT = 60;
export const CONTEXT_LIMIT = 20;
export const BIDIRECTIONAL_LIMIT = 20;
export const MAX_BIDIRECTIONAL = 5;
export const BIDIRECTIONAL_KEY = 'PHONE_SMS_MEMORY';
export const VOICE_MAX_SEC = 60;
export const MODEL_VISIBLE_ROWS = 4;
export const MAX_GROUP_MEMBERS = 16;
export const PM_IDB_NAME = 'PhoneModeDB';
export const PM_IDB_STORE = 'kv';
export const IDB_MARKER = '__idb__';

export const POPOVER_SUPPORTED =
    typeof HTMLElement !== 'undefined' && HTMLElement.prototype.hasOwnProperty('popover');
