// YAML 解析交给酒馆自带的 SillyTavern.libs.yaml；测试里注入 npm 的同一个库。
let lib = null;

export function setYamlLib(value) {
    lib = value || null;
}

export function getYamlLib() {
    if (!lib) throw new Error('YAML 解析库未就绪');
    return lib;
}

export function parseYaml(text) {
    return getYamlLib().parse(String(text || ''));
}

export function stringifyYaml(value) {
    return getYamlLib().stringify(value, { indent: 2, lineWidth: 0, minContentWidth: 0 });
}

// 返回出错行号（从 1 起），拿不到时为 0。
export function yamlErrorLine(error) {
    const pos = error && error.linePos && error.linePos[0];
    if (pos && pos.line) return pos.line;
    const match = /line (\d+)/i.exec(String(error && error.message || ''));
    return match ? Number(match[1]) : 0;
}
