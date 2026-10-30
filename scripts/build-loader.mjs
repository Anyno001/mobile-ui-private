// 把 loader/tianyin-loader.js 包成酒馆助手可导入的脚本 json。
import { readFileSync, writeFileSync } from 'node:fs';

const content = readFileSync(new URL('../loader/tianyin-loader.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = {
    type: 'script',
    enabled: true,
    name: '天音小笺（自动更新）',
    id: '6f1d2c3e-8a47-4b5e-9c21-7d3e5a0b9f14',
    info: '从 GitHub 加载最新版天音小笺。已在扩展管理里安装天音小笺时不会重复加载。',
    button: { enabled: false, buttons: [] },
    data: {},
    content,
};
writeFileSync(new URL('../loader/tianyin-loader.json', import.meta.url), `${JSON.stringify(script, null, 2)}\n`);
console.log('loader/tianyin-loader.json');
