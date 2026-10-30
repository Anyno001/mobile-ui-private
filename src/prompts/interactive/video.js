import { COMMUNITY_COMMON_RULES, communityContentRule, communitySystemPrompt, dataBlock } from './shared.js';

// 视频（B站式视频页）的提示词。平台名在提示词里写真名，模型才知道模仿哪家的语感；界面显示名见 app-names.js。
export const VIDEO_KINDS = Object.freeze(['video_create', 'video_comments', 'video_replies', 'video_danmaku']);
export const isVideoKind = kind => VIDEO_KINDS.includes(kind);

const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const line = (value, max) => String(value ?? '').trim().slice(0, max);

function videoSummary({ video, uploaderName, uploaderIsUser, idea }) {
    const scenes = (video?.scenes || []).map(scene => `${clock(scene.at)} ${line(scene.text, 200)}`).join('\n');
    return [
        `标题：${line(video?.title, 60) || '（留空，由你起标题）'}`,
        `分区：${line(video?.category, 12) || '未分区'}`,
        `UP主：${line(uploaderName, 80) || 'UP主'}${uploaderIsUser ? '（用户本人）' : ''}`,
        `${uploaderIsUser ? '简介' : '想法'}：${line(idea ?? video?.description, 500) || '（无）'}`,
        video?.duration ? `时长：${video.duration} 秒` : '',
        scenes ? `分镜：\n${scenes}` : '',
    ].filter(Boolean).join('\n');
}

const USER_UPLOADER_RULE = 'UP主是用户本人：UP主的发言（包括视频简介、对评论的回复）由用户自己写，不要代写，也不要以UP主的名字发言或描写UP主的反应。';
const respondRule = name => `写作者 ${name} 是用户本人，评论里不得以这个名字发言，也不要替用户说话或描写用户的反应。其余作者另起符合平台与世界观的网名。`;

const COMMENT_STYLE = '评论像B站评论区：有总结、玩梗、课代表式补充、杠精，语气各不相同。';

function createTask({ uploaderIsUser, uploaderName, aiScenes }) {
    const sceneFields = 'scenes（1-8 段，每段 {at, text, image}：at 是秒数、从 0 开始严格递增且小于 duration；text 写成画面描述，包含镜头、动作和字幕，读起来像在看视频；image 是一句中文画面描述，可以是 text 的精简版）、cover（一句中文画面描述，作封面）';
    const commentFields = 'comments（6-10 条，每条 {author, content, replies?}；其中 2-4 条带 replies，每条 replies 有 2-5 项，字段为 author、content、replyTo?，replyTo 是被回复者的名字）';
    const danmaku = 'items 返回 15-25 条弹幕，字段为 author、content（不超过 60 字）、at（秒数，0 到 duration）。弹幕集中出现在分镜的高潮点，口吻多样：前方高能、空耳、玩梗、刷屏、考据。';
    if (uploaderIsUser) {
        const meta = aiScenes
            ? `meta.video 只需 duration（10-1800 的整数秒）、${sceneFields}；标题和简介以用户为准，不要重写。`
            : 'meta.video 只需 cover；分镜和时长已由用户确定，不要重写。';
        return `为用户投稿的这条视频补齐内容。视频内容扣住 video_data 里用户写的标题、简介和正文剧情。${meta}\nmeta 里另有 ${commentFields}。\n${danmaku}\n${COMMENT_STYLE}${USER_UPLOADER_RULE}`;
    }
    return `为UP主「${uploaderName}」的这条视频生成完整内容。视频内容扣住正文剧情和UP主的人设，想法见 video_data。meta 对象包含 video 与 comments 两项：meta.video 为 {title（不超过 60 字）, category（不超过 12 字）, description（不超过 500 字）, duration（10-1800 的整数秒）, ${sceneFields}}；meta.comments 为 ${commentFields}。\n${danmaku}\n${COMMENT_STYLE}UP主本人偶尔回复评论，作者名写「${uploaderName}」。`;
}

function respondBlock(respondTo) {
    if (!respondTo) return '';
    const author = line(respondTo.author, 80) || '用户';
    const replyTo = line(respondTo.replyTo, 80);
    const block = dataBlock('respond_data', JSON.stringify({ author, content: line(respondTo.content, 1000), ...(replyTo ? { replyTo } : {}) }), 1400);
    const target = replyTo ? `\n用户这条是在回复 @${replyTo}，接话要顺着这个对象展开。` : '';
    return `\n${respondRule(author)}${target}\n${block}`;
}

function commentsTask({ uploaderIsUser, uploaderName, respondTo }) {
    const fields = 'items 字段为 author、content（不超过 1000 字）、replies?（可选，每项字段为 author、content、replyTo?）。';
    const uploader = uploaderIsUser ? USER_UPLOADER_RULE : `UP主「${uploaderName}」偶尔回复。`;
    if (respondTo) {
        return `用户刚在这条视频下发表了评论（见 respond_data）。生成 3-6 条评论：有附和、玩梗、追问和不同看法，可以有 1-2 条带 replies。${fields}${COMMENT_STYLE}${uploader}${respondBlock(respondTo)}`;
    }
    return `为这条视频再来一批评论，生成 4-8 条，可以带楼中楼。${fields}${COMMENT_STYLE}${uploader}`;
}

function repliesTask({ uploaderIsUser, uploaderName, comment, respondTo }) {
    const fields = 'items 字段为 author、content（不超过 500 字）、replyTo?（被回复者的名字）。';
    const target = dataBlock('comment_data', JSON.stringify({
        author: line(comment?.author, 80), content: line(comment?.content, 1000),
        replies: (comment?.replies || []).slice(-6).map(reply => ({ author: line(reply.author, 80), content: line(reply.content, 200) })),
    }), 3000);
    const uploader = uploaderIsUser ? USER_UPLOADER_RULE : `UP主「${uploaderName}」可以回复。`;
    if (respondTo) {
        return `用户刚在下方这条评论的回复区发言（见 respond_data）。生成 2-4 条接话：被回复的人可能回应，其他人也可能插话。${fields}${uploader}\n${target}${respondBlock(respondTo)}`;
    }
    return `针对下方这条评论生成 3-5 条回复，回复里用 replyTo 写明在回复谁。${fields}${uploader}\n${target}`;
}

function danmakuTask({ segment, uploaderIsUser }) {
    const from = Math.max(0, Math.floor(Number(segment?.from) || 0));
    const to = Math.max(from, Math.floor(Number(segment?.to) || from));
    const scenes = (segment?.scenes || []).map(scene => `${clock(scene.at)} ${line(scene.text, 200)}`).join('\n');
    const block = dataBlock('segment_data', `时间段：${from} 秒到 ${to} 秒\n${scenes}`, 2000);
    const uploader = uploaderIsUser ? USER_UPLOADER_RULE : '';
    return `为这一时间段补充 8-14 条弹幕。items 字段为 author、content（不超过 60 字）、at（秒数，必须在 ${from} 到 ${to} 之间）。弹幕贴合这段画面，口吻多样：前方高能、空耳、玩梗、刷屏、考据。${uploader}\n${block}`;
}

// 入参：{ kind, nsfw, context, worldBookText, actorRoster, video, uploaderName, uploaderIsUser, idea, aiScenes, comment, segment, respondTo }
export function buildVideoRequest(args) {
    const { kind, nsfw, context, worldBookText, actorRoster, uploaderIsUser = args.video?.uploaderIsUser === true } = args;
    if (!isVideoKind(kind)) throw new Error(`不支持的视频生成类型：${kind}`);
    const uploaderName = line(args.uploaderName ?? args.video?.uploaderNameSnapshot, 80) || 'UP主';
    const shared = { uploaderIsUser, uploaderName };
    const roster = Array.isArray(actorRoster) ? actorRoster.map(name => line(name, 80)).filter(Boolean).slice(0, 20).join('、') : '';
    const task = kind === 'video_create' ? createTask({ ...shared, aiScenes: args.aiScenes !== false })
        : kind === 'video_comments' ? commentsTask({ ...shared, respondTo: args.respondTo })
            : kind === 'video_replies' ? repliesTask({ ...shared, comment: args.comment, respondTo: args.respondTo })
                : danmakuTask({ ...shared, segment: args.segment });
    const blocks = [
        '平台：B站视频页',
        dataBlock('world_context_data', context, 6000),
        worldBookText ? dataBlock('world_book_data', worldBookText, String(worldBookText).length) : '',
        dataBlock('known_actor_names_data', roster, 1600),
        dataBlock('video_data', videoSummary({ video: args.video, uploaderName, uploaderIsUser, idea: args.idea }), 3000),
    ].filter(Boolean).join('\n');
    return {
        systemPrompt: communitySystemPrompt(kind, kind === 'video_create'),
        userPrompt: `${blocks}\n\n任务：${task}\n${COMMUNITY_COMMON_RULES}\n${communityContentRule(nsfw === true)}`,
    };
}
