const FIELD_IDS = ['pm-indep-profile-fields', 'pm-indep-config-fields'];

export function createApiDraftMode(initial = false) {
    let useIndependent = !!initial;
    return {
        current: () => useIndependent,
        set(value) {
            useIndependent = !!value;
            const main = document.getElementById('pm-mode-main');
            const independent = document.getElementById('pm-mode-indep');
            const tip = document.getElementById('pm-mode-tip');
            main?.classList.toggle('pm-mode-active', !useIndependent);
            independent?.classList.toggle('pm-mode-active', useIndependent);
            if (tip) tip.textContent = useIndependent
                ? '独立 API 必须填写地址、密钥和模型'
                : '默认使用酒馆API预设';
            for (const id of FIELD_IDS) {
                const fields = document.getElementById(id);
                if (fields) fields.hidden = !useIndependent;
            }
            return useIndependent;
        },
    };
}
