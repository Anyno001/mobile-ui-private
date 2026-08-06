import { pmIDBDel, pmIDBGet, pmIDBKeys, pmIDBReadEntry, pmIDBSet, pmOpenIDB } from './pm-idb.js';

export const DESKTOP_BG_KEY = 'ST_SMS_BG_DESKTOP';

export function isBigData(value) {
    return typeof value === 'string' && value.length > 4096 && (value.startsWith('data:') || value.startsWith('blob:'));
}

export { pmIDBDel, pmIDBGet, pmIDBKeys, pmIDBReadEntry, pmIDBSet, pmOpenIDB };
