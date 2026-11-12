// 金手指设置页（App 内二级页）：只输出 HTML。开关点按即存（data-origin-action="setting-toggle"），
// 选项胶囊点按即存（setting-pick），数字与文字框失焦即存（data-origin-setting，由 origin-app.js 的 change 监听处理）。
import {
    ORIGIN_CREDIT, ORIGIN_ECON_STYLES, ORIGIN_MOD_LABELS, ORIGIN_MODS, ORIGIN_PERSONALITIES, ORIGIN_REPO_URL, originBoundRole, originEconStyle,
} from './origin-settings.js';
import { escapeAttr as rawAttr, escapeHtml as rawHtml } from './ui.js';

// 状态里的 id、数量是数字，转成字符串再转义。
const escapeAttr = value => rawAttr(String(value ?? ''));
const escapeHtml = value => rawHtml(String(value ?? ''));

const esc = escapeHtml;
const act = (action, extra = '') => `data-origin-action="${action}"${extra ? ` ${extra}` : ''}`;

function switchRow(label, hint, key, on, action = 'setting-toggle') {
    return `<div class="pm-origin-set-row"><span class="pm-origin-set-text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span><button type="button" class="pm-origin-switch${on ? ' is-on' : ''}" role="switch" aria-checked="${on}" aria-label="${escapeAttr(label)}" ${act(action, `data-key="${key}"`)}></button></div>`;
}
function numberRow(label, hint, key, value, [min, max]) {
    return `<label class="pm-origin-set-row"><span class="pm-origin-set-text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span><input class="pm-origin-input is-number" type="number" inputmode="numeric" min="${min}" max="${max}" value="${escapeAttr(value)}" data-origin-setting="${key}" aria-label="${escapeAttr(label)}"></label>`;
}
function textRow(label, hint, key, value, { multiline = false, placeholder = '' } = {}) {
    const attrs = `class="pm-origin-input" data-origin-setting="${key}" aria-label="${escapeAttr(label)}"${placeholder ? ` placeholder="${escapeAttr(placeholder)}"` : ''}`;
    return `<label class="pm-origin-set-field"><span class="pm-origin-set-text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span>${multiline ? `<textarea ${attrs} rows="3" maxlength="1200">${esc(value)}</textarea>` : `<input ${attrs} type="text" maxlength="120" autocomplete="off" value="${escapeAttr(value)}">`}</label>`;
}
function pickRow(label, key, options, value) {
    return `<div class="pm-origin-set-field"><span class="pm-origin-set-text"><b>${esc(label)}</b></span><div class="pm-origin-choices" role="radiogroup" aria-label="${escapeAttr(label)}">${options.map(([id, text]) => `<button type="button" class="pm-origin-chip" role="radio" aria-checked="${id === value}" ${act('setting-pick', `data-key="${key}" data-value="${escapeAttr(id)}"`)}>${esc(text)}</button>`).join('')}</div></div>`;
}
function linkRow(label, hint, action, extra = '', danger = false) {
    return `<button type="button" class="pm-origin-set-link${danger ? ' is-danger' : ''}" ${act(action, extra)}><span class="pm-origin-set-text"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span><span aria-hidden="true">›</span></button>`;
}
const group = (title, rows) => `<section class="pm-origin-set-group">${title ? `<h3>${esc(title)}</h3>` : ''}<div class="pm-origin-set-card">${rows.join('')}</div></section>`;

// chat：{ available, paused, world, legacy, blocked }，没开聊天时 available 为 false，不出「本聊天」组。
export function renderOriginSettings(s, chat = {}) {
    const role = originBoundRole(s);
    const groups = [group('', [switchRow('启用金手指', '默认关闭。开启后系统随剧情派发任务、结算奖励', 'enabled', s.enabled)])];
    if (s.enabled && chat.available) {
        groups.push(group('本聊天', [
            switchRow('暂停系统', '暂停期间不派发任务，时限冻结', 'paused', chat.paused === true, 'pause'),
            linkRow('世界名', chat.world || '未设定，按角色卡推断', 'world-edit'),
            linkRow('按全部楼层重算', '规则改动后重新结算本聊天的每一楼', 'recalc'),
            ...(chat.legacy ? [linkRow('导入旧存档', '检测到原版Origin的数据，导入后原数据保留', 'legacy-import')] : []),
            linkRow('清空本局', '删除本聊天的全部金手指数据', 'reset', '', true),
        ]));
    }
    groups.push(group('系统', [
        textRow('系统名', '', 'sysName', s.sysName),
        pickRow('性格', 'personality', ORIGIN_PERSONALITIES.map(name => [name, name]), s.personality),
        textRow('自定义人设', '填写后代替上面的性格', 'personaText', s.personaText, { multiline: true, placeholder: '可留空' }),
        textRow('绑定对象', role ? `当前为反串：系统绑定在${role}身上，对话页改为私聊` : '填「宿主」或某个角色名；填角色名为反串', 'bindTo', s.bindTo),
    ]));
    groups.push(group('任务', [
        numberRow('派发间隔', '每隔几回合可以派一个新任务', 'freq', s.freq, [1, 10]),
        switchRow('未完成时不派新任务', '还有主线或支线在进行时暂停派发', 'blockWhenUnfinished', s.blockWhenUnfinished),
        pickRow('任务来源', 'taskSource', [['auto', '随剧情自动'], ['manual', '只手动添加']], s.taskSource === 'manual' ? 'manual' : 'auto'),
        numberRow('时限下限', '0为不限', 'limitMin', s.limitMin, [0, 99]),
        numberRow('时限上限', '0为任务不设时限；大于0时任务时限在上下限之间浮动', 'limitMax', s.limitMax, [0, 99]),
        switchRow('失败带来后果', '任务失败或超时，剧情出现相称的不利后果', 'punishEvent', s.punishEvent),
        textRow('奖励倾向', '', 'rewardPref', s.rewardPref, { placeholder: '可留空，例如：多给道具' }),
        textRow('惩罚倾向', '', 'penaltyPref', s.penaltyPref, { placeholder: '可留空' }),
    ]));
    groups.push(group('商城与抽奖', [
        numberRow('抽奖价格', '积分', 'drawCost', s.drawCost, [0, 99999]),
        numberRow('商城刷新间隔', '每隔几回合由正文上新，0为不自动', 'shopRefresh', s.shopRefresh, [0, 99]),
        numberRow('奖池刷新间隔', '0为不自动', 'gachaRefresh', s.gachaRefresh, [0, 99]),
        pickRow('使用策略', 'econStyle', ORIGIN_ECON_STYLES, originEconStyle(s)),
        textRow('自定义策略', '填写后代替上面的使用策略', 'econText', s.econText, { multiline: true, placeholder: '例如：只在任务卡住时买道具，抽奖留到剧情转折' }),
    ]));
    groups.push(group('对话', [
        switchRow('对话结果进剧情', '和系统谈成的交易、拿到的东西随下一轮正文生效', 'chatToStory', s.chatToStory),
        ...(role ? [pickRow('私聊生成', 'rpChat', [['auto', '随正文'], ['manual', '手动']], s.rpChat)] : []),
        numberRow('第四面墙', '系统偶尔打破第四面墙吐槽的概率（%）', 'fourthWall', s.fourthWall, [0, 100]),
    ]));
    groups.push(group('模块', ORIGIN_MODS.map(mod => switchRow(ORIGIN_MOD_LABELS[mod], '', `mods.${mod}`, s.mods[mod] !== false))));
    groups.push(group('高级', [
        switchRow('自动解锁成就', '', 'achieveOn', s.achieveOn),
        numberRow('注入长度上限', '每轮写进提示词的系统状态最多多少字', 'budget', s.budget, [400, 6000]),
        linkRow('模型分配', '在「API › 按模块分配」里给金手指单独指定；未指定时跟随酒馆当前连接', 'open-api'),
    ]));
    return `<div class="pm-origin-settings">${groups.join('')}<p class="pm-origin-credit">${esc(ORIGIN_CREDIT)}<br><a href="${escapeAttr(ORIGIN_REPO_URL)}" target="_blank" rel="noopener noreferrer">${esc(ORIGIN_REPO_URL.replace(/^https:\/\//, ''))}</a></p></div>`;
}
