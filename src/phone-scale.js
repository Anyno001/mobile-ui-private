export const PHONE_BASE_WIDTH = 330;
export const PHONE_BASE_HEIGHT = 580;
export const PHONE_MIN_SCALE = 0.6;
export const PHONE_MAX_SCALE = 1.5;

export function normalizePhoneScale(
    value,
    viewportWidth = globalThis.window?.innerWidth ?? 1200,
) {
    const rawWidth = Number(viewportWidth);
    const width = Number.isFinite(rawWidth) ? Math.max(0, rawWidth) : 1200;
    const compact = width <= 500;
    const widthLimit = (compact ? width * 0.92 : width - 24) / PHONE_BASE_WIDTH;
    const maximum = Math.max(Math.min(PHONE_MAX_SCALE, widthLimit), Math.min(PHONE_MIN_SCALE, widthLimit));
    const minimum = Math.min(PHONE_MIN_SCALE, maximum);
    const numeric = Number(value);
    const candidate = Number.isFinite(numeric) ? numeric : 1;
    return Math.round(Math.min(maximum, Math.max(minimum, candidate)) * 1000) / 1000;
}

export function phoneSizeForScale(scale) {
    const normalized = Number.isFinite(Number(scale)) ? Number(scale) : 1;
    return {
        width: Math.round(PHONE_BASE_WIDTH * normalized),
        height: Math.round(PHONE_BASE_HEIGHT * normalized),
    };
}

export function phoneSizeForViewport(
    scale,
    viewportWidth = globalThis.window?.innerWidth ?? 1200,
    viewportHeight = globalThis.window?.visualViewport?.height ?? globalThis.window?.innerHeight ?? 1000,
) {
    const normalized = normalizePhoneScale(scale, viewportWidth);
    const naturalSize = phoneSizeForScale(normalized);
    const rawWidth = Number(viewportWidth);
    const width = Number.isFinite(rawWidth) ? Math.max(0, rawWidth) : 1200;
    const height = Number(viewportHeight);
    const compact = width <= 500 || height <= 700;
    const availableHeight = Number.isFinite(height) ? Math.max(0, height) : 1000;
    const heightBudget = Math.max(0, Math.round(
        compact ? availableHeight * 0.82 : availableHeight - 24,
    ));
    return { scale: normalized, width: naturalSize.width, height: Math.min(naturalSize.height, heightBudget) };
}

export function applyPhoneScale(element, scale = globalThis.window?.__pmTheme?.phoneScale) {
    if (!element) return null;
    const size = phoneSizeForViewport(scale);
    element.style.setProperty('--pm-phone-width', `${size.width}px`);
    element.style.setProperty('--pm-phone-height', `${size.height}px`);
    return size;
}
