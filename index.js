(() => {
  // src/constants.js
  var SAVE_LIMIT = 60;
  var CONTEXT_LIMIT = 20;
  var BIDIRECTIONAL_LIMIT = 20;
  var MAX_BIDIRECTIONAL = 5;
  var BIDIRECTIONAL_KEY = "PHONE_SMS_MEMORY";
  var VOICE_MAX_SEC = 60;
  var MODEL_VISIBLE_ROWS = 4;
  var MAX_GROUP_MEMBERS = 16;
  var PM_IDB_NAME = "PhoneModeDB";
  var PM_IDB_STORE = "kv";
  var IDB_MARKER = "__idb__";
  var POPOVER_SUPPORTED = typeof HTMLElement !== "undefined" && HTMLElement.prototype.hasOwnProperty("popover");

  // src/groups.js
  var GROUP_COLORS = [
    { bg: "#e9e9eb", text: "#000" },
    { bg: "#b8e6c8", text: "#1b4332" },
    { bg: "#f5d0d0", text: "#4a2030" },
    { bg: "#d4d0f5", text: "#2d2252" },
    { bg: "#f5e6b8", text: "#4a3a10" },
    { bg: "#cceef5", text: "#144652" },
    { bg: "#ffd6a5", text: "#5c3200" },
    { bg: "#d0f0e8", text: "#0d3b2e" },
    { bg: "#f0d4f5", text: "#3b0d52" },
    { bg: "#fce4b8", text: "#4a2800" },
    { bg: "#c8dff5", text: "#0d2952" },
    { bg: "#f5d4e4", text: "#4a0d2a" },
    { bg: "#d4efd4", text: "#1a3d1a" },
    { bg: "#f5e0c8", text: "#4a2800" },
    { bg: "#c8c8f5", text: "#1a1a52" }
  ];

  // src/config.js
  var THEME_PRESETS = {
    default: { right: "#007aff", left: "#e9e9eb", rightText: "#fff", leftText: "#000", label: "\u9ED8\u8BA4\u84DD" },
    pink: { right: "#ff6b8a", left: "#fce4ec", rightText: "#fff", leftText: "#4a2030", label: "\u6A31\u82B1\u7C89" },
    dark: { right: "#5856d6", left: "#2c2c2e", rightText: "#fff", leftText: "#e0e0e0", label: "\u6697\u591C\u7D2B" },
    frost: { right: "rgba(0,122,255,0.55)", left: "rgba(255,255,255,0.35)", rightText: "#fff", leftText: "#222", label: "\u78E8\u7802\u73BB\u7483", frost: true },
    mint: { right: "#34c759", left: "#e8f5e9", rightText: "#fff", leftText: "#1b4332", label: "\u8584\u8377\u7EFF" }
  };
  function normalizeApiUrls(input) {
    const url = (input || "").trim().replace(/\/+$/, "");
    if (!url) return { chatUrl: "", modelsUrl: "" };
    if (/\/chat\/completions$/i.test(url)) return { chatUrl: url, modelsUrl: url.replace(/\/chat\/completions$/i, "/models") };
    if (/\/models$/i.test(url)) return { chatUrl: url.replace(/\/models$/i, "/chat/completions"), modelsUrl: url };
    if (/\/v\d+$/i.test(url)) return { chatUrl: url + "/chat/completions", modelsUrl: url + "/models" };
    return { chatUrl: url + "/v1/chat/completions", modelsUrl: url + "/v1/models" };
  }

  // src/prompts.js
  function cleanResponse(raw) {
    return (raw ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "").replace(/<reflection>[\s\S]*?<\/reflection>/gi, "").replace(/<inner_thought>[\s\S]*?<\/inner_thought>/gi, "").replace(/<scene>[\s\S]*?<\/scene>/gi, "").replace(/<narration>[\s\S]*?<\/narration>/gi, "").replace(/<action>[\s\S]*?<\/action>/gi, "").replace(/\x60{3}[\s\S]*?\x60{3}/g, "").replace(/^.*【[^】]{2,}】.*$/gm, "").replace(/---+[\s\S]*$/g, "").replace(/<[^>]+>/g, "").trim();
  }
  function splitToSentences(str, stripFn = null) {
    const protectedText = (str || "").replace(/[\(（][^)）]*[\)）]/g, (match) => match.replace(/\//g, ""));
    return protectedText.split(/\s*\/\s*/).map((part) => {
      let text = part.replace(/\u0001/g, "/").trim();
      if (stripFn) text = stripFn(text);
      if (!text || text === ")" || text === "\uFF09" || text === "(" || text === "\uFF08") return "";
      const opens = (text.match(/[（(]/g) || []).length;
      const closes = (text.match(/[）)]/g) || []).length;
      if (opens > closes) text += "\uFF09".repeat(opens - closes);
      else if (closes > opens && opens === 0) text = text.replace(/^[)）]+\s*/, "").replace(/\s*[)）]+$/, "");
      return text;
    }).filter(Boolean).flatMap((text) => {
      const parts = [];
      let lastIndex = 0;
      let match;
      const emojiPattern = /\[emo:[^\]]+\]/g;
      while ((match = emojiPattern.exec(text)) !== null) {
        const before = text.slice(lastIndex, match.index).trim();
        if (before) parts.push(before);
        parts.push(match[0]);
        lastIndex = match.index + match[0].length;
      }
      const after = text.slice(lastIndex).trim();
      if (after) parts.push(after);
      return parts.length ? parts : [text];
    }).filter(Boolean).slice(0, 15);
  }

  // src/ui.js
  function contrastText(bg) {
    if (!bg || bg.startsWith("rgba")) return "#fff";
    const color = bg.replace("#", "");
    if (color.length !== 6) return "#000";
    const r = parseInt(color.slice(0, 2), 16);
    const g = parseInt(color.slice(2, 4), 16);
    const b = parseInt(color.slice(4, 6), 16);
    return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#000" : "#fff";
  }
  function cssUrlEscape(url) {
    return (url || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  function escapeHtml(value) {
    return (value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(value) {
    return (value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function safeJS(value) {
    const escaped = (value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return escapeAttr(escaped);
  }

  // src/icons.js
  var EDIT_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  var REFRESH_ICON_SVG = '<svg id="pm-autogen-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#007aff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;transform-origin:center center;"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

  // src/messaging.js
  var SPECIAL_KEYWORDS = {
    "\u8F6C\u8D26": "\u8F6C\u8D26",
    "transfer": "\u8F6C\u8D26",
    "Transfer": "\u8F6C\u8D26",
    "TRANSFER": "\u8F6C\u8D26",
    "\u8F49\u8CEC": "\u8F6C\u8D26",
    "\u8F49\u5E33": "\u8F6C\u8D26",
    "\u6536\u6B3E": "\u6536\u6B3E",
    "receive": "\u6536\u6B3E",
    "Receive": "\u6536\u6B3E",
    "RECEIVE": "\u6536\u6B3E",
    "\u6536\u94B1": "\u6536\u6B3E",
    "\u6536\u5230": "\u6536\u6B3E",
    "\u6536\u9322": "\u6536\u6B3E",
    "\u9000\u8FD8": "\u9000\u8FD8",
    "\u9000\u94B1": "\u9000\u8FD8",
    "\u9000\u6B3E": "\u9000\u8FD8",
    "refund": "\u9000\u8FD8",
    "Refund": "\u9000\u8FD8",
    "REFUND": "\u9000\u8FD8",
    "\u9000\u9084": "\u9000\u8FD8",
    "\u9000\u9322": "\u9000\u8FD8",
    "\u56FE\u7247": "\u56FE\u7247",
    "image": "\u56FE\u7247",
    "Image": "\u56FE\u7247",
    "IMAGE": "\u56FE\u7247",
    "img": "\u56FE\u7247",
    "pic": "\u56FE\u7247",
    "photo": "\u56FE\u7247",
    "\u5716\u7247": "\u56FE\u7247",
    "\u8BED\u97F3": "\u8BED\u97F3",
    "voice": "\u8BED\u97F3",
    "Voice": "\u8BED\u97F3",
    "VOICE": "\u8BED\u97F3",
    "audio": "\u8BED\u97F3",
    "\u8A9E\u97F3": "\u8BED\u97F3"
  };
  var KEYWORD_PATTERN = Object.keys(SPECIAL_KEYWORDS).join("|");
  var SPECIAL_RE = new RegExp(`[\\(\uFF08]\\s*(${KEYWORD_PATTERN})\\s*[+\uFF1A:\\s]*([^)\uFF09]+)[\\)\uFF09]`, "gi");
  function normalizeKeyword(keyword) {
    return SPECIAL_KEYWORDS[keyword] || SPECIAL_KEYWORDS[keyword.toLowerCase()] || keyword;
  }
  function findEmojiUrl(setName, index, emojis) {
    const set = emojis.find((item) => item.name === setName);
    const image = set?.images[index - 1];
    return image?.url || null;
  }
  function resolveEmojiText(text, emojis) {
    return (text || "").replace(/\[emo:([^\]:]+):(\d+)\]/g, (match, setName, index) => {
      const set = emojis.find((item) => item.name === setName);
      const image = set?.images[parseInt(index, 10) - 1];
      return image ? `(\u8868\u60C5:${image.desc})` : "";
    });
  }
  function getWordyPrompt(enabled) {
    if (!enabled) return "";
    return "\n\n[\u5B57\u6570\u9650\u5236] \u9664\u975E\u89D2\u8272\u4EBA\u8BBE\u660E\u786E\u4E3A\u8BDD\u75E8\u6216\u788E\u5634\u6027\u683C\uFF0C\u5426\u5219\u6BCF\u6761\u72EC\u7ACB\u6D88\u606F\uFF08\u6BCF\u4E2A / \u5206\u9694\u7684\u7247\u6BB5\uFF09\u4E0D\u5F97\u8D85\u8FC735\u4E2A\u5B57\u7B26\uFF0C\u8D85\u51FA\u8BF7\u62C6\u5206\u4E3A\u591A\u6761\u3002";
  }
  function getEmojiPrompt(contactKey, storageId, pokeConfig, emojis) {
    const assignedIds = pokeConfig[storageId]?.[contactKey]?.emojis || [];
    if (!assignedIds.length) return "";
    const sets = emojis.filter((set) => assignedIds.includes(set.id));
    if (!sets.length) return "";
    const lines = sets.map((set) => set.images.map((image, index) => `[emo:${set.name}:${index + 1}] - ${image.desc}`).join("\n")).join("\n");
    return `

[\u8868\u60C5\u5305\u6743\u9650]
\u4F60\u53EF\u4EE5\u5728\u5408\u9002\u65F6\u673A\u4F7F\u7528\u4EE5\u4E0B\u8868\u60C5\u5305\uFF0C\u4F7F\u7528\u683C\u5F0F [emo:\u5957\u7EC4\u540D:\u5E8F\u53F7] \u72EC\u884C\u53D1\u9001\uFF1A
${lines}
\u8BF7\u5728\u81EA\u7136\u8BED\u5883\u4E0B\u9002\u5F53\u4F7F\u7528\uFF0C\u4E25\u7981\u81EA\u751F\u65B0\u683C\u5F0F\u3002`;
  }
  function parseGroupResponse(raw, groupMembers) {
    const cleaned = cleanResponse(raw);
    const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
    const result = [];
    const normalizeName = (value) => (value || "").trim().replace(/^[【\[\(（*「『"'\s]+|[】\]\)）*「』」"'\s]+$/g, "").trim().toLowerCase();
    const memberMap = /* @__PURE__ */ new Map();
    groupMembers.forEach((name) => memberMap.set(normalizeName(name), name));
    const speakerPattern = /^[\s\*【\[「『"'（\(]*(.{1,20}?)[\s\*】\]」』"'）\)]*\s*[：:]\s*([\s\S]+)$/;
    const stripSpeakerPrefix = (value) => {
      let text = (value || "").trim();
      const outer = text.match(/^[\(（]\s*(.{1,20}?)\s*[：:]\s*([\s\S]+?)\s*[\)）]\s*$/);
      if (outer && memberMap.has(normalizeName(outer[1]))) {
        return outer[2].trim();
      }
      for (let index = 0; index < 3; index++) {
        const match = text.match(speakerPattern);
        if (!match || !memberMap.has(normalizeName(match[1]))) break;
        text = match[2].trim();
      }
      return text;
    };
    for (const line of lines) {
      const match = line.match(speakerPattern);
      if (match && memberMap.has(normalizeName(match[1]))) {
        const name = memberMap.get(normalizeName(match[1]));
        const sentences2 = splitToSentences(match[2], stripSpeakerPrefix);
        if (sentences2.length) result.push({ name, sentences: sentences2 });
        continue;
      }
      const sentences = splitToSentences(line, stripSpeakerPrefix);
      if (!sentences.length) continue;
      if (result.length > 0) result[result.length - 1].sentences.push(...sentences);
      else result.push({ name: groupMembers[0] || "???", sentences });
    }
    return result;
  }
  function resolveGroupColor(name, groupColorMap, groupMembers) {
    if (!name) return null;
    if (groupColorMap[name]) return groupColorMap[name];
    const normalizedName = name.toLowerCase();
    for (const [memberName, color] of Object.entries(groupColorMap)) {
      if (memberName.toLowerCase() === normalizedName) return color;
    }
    const index = groupMembers.findIndex((memberName) => memberName.toLowerCase() === normalizedName);
    return index >= 0 ? GROUP_COLORS[index % GROUP_COLORS.length] : null;
  }
  function createBubbles(text, side, senderName, { groupColorMap, groupMembers, emojis }) {
    const results = [];
    const specialPattern = new RegExp(SPECIAL_RE.source, "gi");
    let lastIndex = 0;
    let match;
    const groupColor = senderName && side === "left" ? resolveGroupColor(senderName, groupColorMap, groupMembers) : null;
    const pushPlain = (value) => {
      const plain = value.trim();
      if (!plain) return;
      if (senderName && side === "left") {
        const wrapper = document.createElement("div");
        wrapper.className = "pm-group-bubble-wrap";
        const nameTag = document.createElement("div");
        nameTag.className = "pm-group-name";
        nameTag.textContent = senderName;
        if (groupColor) nameTag.style.color = groupColor.bg;
        wrapper.appendChild(nameTag);
        const inner = document.createElement("div");
        inner.className = `pm-bubble pm-${side}`;
        if (groupColor) {
          inner.style.setProperty("background", groupColor.bg, "important");
          inner.style.setProperty("color", groupColor.text, "important");
        }
        inner.innerHTML = escapeHtml(plain).replace(/\n/g, "<br>");
        wrapper.appendChild(inner);
        results.push(wrapper);
        return;
      }
      const bubble = document.createElement("div");
      bubble.className = `pm-bubble pm-${side}`;
      bubble.innerHTML = escapeHtml(plain).replace(/\n/g, "<br>");
      results.push(bubble);
    };
    while ((match = specialPattern.exec(text)) !== null) {
      if (match.index > lastIndex) pushPlain(text.slice(lastIndex, match.index));
      const kind = normalizeKeyword(match[1]);
      const isGroupLeft = senderName && side === "left";
      let container;
      if (isGroupLeft) {
        container = document.createElement("div");
        container.className = "pm-group-bubble-wrap";
        const nameTag = document.createElement("div");
        nameTag.className = "pm-group-name";
        nameTag.textContent = senderName;
        if (groupColor) nameTag.style.color = groupColor.bg;
        container.appendChild(nameTag);
      }
      const bubble = document.createElement("div");
      bubble.className = `pm-bubble pm-${side} pm-special`;
      if (kind === "\u8F6C\u8D26" || kind === "\u6536\u6B3E" || kind === "\u9000\u8FD8") {
        const amount = parseFloat(match[2]) || 0;
        const className = kind === "\u8F6C\u8D26" ? "pm-transfer-card" : kind === "\u6536\u6B3E" ? "pm-receive-card" : "pm-refund-card";
        const title = kind === "\u9000\u8FD8" ? "\u5DF2\u9000\u8FD8" : kind;
        bubble.innerHTML = `<div class="${className}"><div class="pm-t-icon">\xA5</div><div class="pm-t-info"><b>${title}</b><span>\xA5${amount.toFixed(2)}</span></div></div>`;
      } else if (kind === "\u56FE\u7247") {
        bubble.innerHTML = `<div class="pm-img-card">\u{1F5BC}\uFE0F ${escapeHtml(match[2].trim())}</div>`;
      } else {
        const voiceText = match[2].trim();
        const length = [...voiceText].length;
        const duration = length <= 5 ? Math.max(1, length) : length <= 15 ? 5 + (length - 5) : length <= 40 ? 15 + Math.ceil((length - 15) * 0.8) : Math.min(VOICE_MAX_SEC, 35 + Math.ceil((length - 40) * 0.5));
        const width = Math.min(240, Math.max(110, 90 + Math.min(length, 30) * 4));
        let voiceStyle = `width:${width}px`;
        let voiceClass = `pm-voice-card pm-voice-${side}`;
        if (isGroupLeft && groupColor) {
          voiceStyle = `width:${width}px;background:${groupColor.bg} !important;color:${groupColor.text} !important;`;
          voiceClass = "pm-voice-card pm-voice-left pm-voice-group";
        }
        bubble.innerHTML = `<div class="pm-voice-wrap"><div class="${voiceClass}" style="${voiceStyle}" onclick="window.__pmToggleVoice(this)"><span class="pm-voice-icon">\u{1F3A4}</span><span class="pm-voice-wave"><i></i><i></i><i></i></span><span class="pm-voice-dur">${duration}"</span></div><div class="pm-voice-text" style="display:none;">${escapeHtml(voiceText)}</div></div>`;
      }
      if (container) {
        container.appendChild(bubble);
        results.push(container);
      } else results.push(bubble);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) pushPlain(text.slice(lastIndex));
    if (!results.length) pushPlain(text);
    for (const bubble of results) {
      const elements = bubble.classList?.contains("pm-group-bubble-wrap") ? bubble.querySelectorAll(".pm-bubble") : bubble.classList?.contains("pm-bubble") ? [bubble] : [];
      for (const element of elements) {
        if (!element.innerHTML.includes("[emo:")) continue;
        element.innerHTML = element.innerHTML.replace(/\[emo:([^\]:]+):(\d+)\]/g, (raw, setName, index) => {
          const url = findEmojiUrl(setName, parseInt(index, 10), emojis);
          return url ? `<img src="${url.replace(/"/g, "&quot;")}" style="max-width:98px;border-radius:8px;display:block;box-shadow:0 2px 8px rgba(0,0,0,0.15);vertical-align:middle;">` : `<span style="font-size:12px;color:#999;">\u{1F914}[${setName}:${index}]</span>`;
        });
        const imageOnly = element.querySelector("img") && element.childNodes.length === 1;
        element.style.background = imageOnly ? "transparent" : "";
        element.style.boxShadow = imageOnly ? "none" : "";
        element.style.padding = imageOnly ? "0" : "";
      }
    }
    return results;
  }

  // src/storage.js
  var database = null;
  function pmOpenIDB() {
    return new Promise((resolve) => {
      if (database) {
        try {
          database.transaction(PM_IDB_STORE, "readonly");
          resolve(database);
          return;
        } catch (error) {
          database = null;
        }
      }
      try {
        const request = indexedDB.open(PM_IDB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(PM_IDB_STORE)) db.createObjectStore(PM_IDB_STORE);
        };
        request.onsuccess = () => {
          database = request.result;
          resolve(database);
        };
        request.onerror = () => resolve(null);
      } catch (error) {
        resolve(null);
      }
    });
  }
  async function pmIDBSet(key, value) {
    const db = await pmOpenIDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(PM_IDB_STORE, "readwrite");
        transaction.objectStore(PM_IDB_STORE).put(value, key);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        resolve(false);
      }
    });
  }
  async function pmIDBGet(key) {
    const db = await pmOpenIDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(PM_IDB_STORE, "readonly");
        const request = transaction.objectStore(PM_IDB_STORE).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      } catch (error) {
        resolve(null);
      }
    });
  }
  async function pmIDBDel(key) {
    const db = await pmOpenIDB();
    if (!db) return;
    try {
      const transaction = db.transaction(PM_IDB_STORE, "readwrite");
      transaction.objectStore(PM_IDB_STORE).delete(key);
    } catch (error) {
    }
  }
  function isBigData(value) {
    return typeof value === "string" && value.length > 4096 && (value.startsWith("data:") || value.startsWith("blob:"));
  }
  function saveHistories() {
    pmIDBSet("ST_SMS_DATA_V2", window.__pmHistories).catch(() => {
    });
    try {
      localStorage.setItem("ST_SMS_DATA_V2", JSON.stringify(window.__pmHistories));
    } catch (error) {
      console.warn("[phone-mode] localStorage \u5DF2\u6EE1\uFF0C\u77ED\u4FE1\u5386\u53F2\u4EC5\u4FDD\u5B58\u5728 IDB");
    }
  }
  function saveHistoriesBeforeUnload() {
    const data = window.__pmHistories;
    if (!data || !Object.keys(data).length) return;
    try {
      localStorage.setItem("ST_SMS_DATA_V2", JSON.stringify(data));
    } catch (error) {
      try {
        const slim = {};
        for (const [storyId, contacts] of Object.entries(data)) {
          slim[storyId] = {};
          for (const [persona, history] of Object.entries(contacts)) {
            slim[storyId][persona] = Array.isArray(history) ? history.slice(-10) : history;
          }
        }
        localStorage.setItem("ST_SMS_DATA_V2", JSON.stringify(slim));
      } catch (backupError) {
        console.warn("[phone-mode] beforeunload: localStorage \u5B8C\u5168\u65E0\u6CD5\u5199\u5165");
      }
    }
    pmIDBSet("ST_SMS_DATA_V2", data).catch(() => {
    });
  }
  async function loadHistoriesFromIDB() {
    try {
      const value = await pmIDBGet("ST_SMS_DATA_V2");
      if (!value) {
        try {
          const fallback = JSON.parse(localStorage.getItem("ST_SMS_DATA_V2"));
          if (fallback && typeof fallback === "object" && Object.keys(fallback).length > 0) {
            window.__pmHistories = fallback;
            console.log("[phone-mode] IDB \u65E0\u6570\u636E\uFF0C\u5DF2\u4ECE localStorage \u6062\u590D");
          }
        } catch (error) {
        }
        return;
      }
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      if (!parsed || typeof parsed !== "object") return;
      const idbCount = Object.keys(parsed).length;
      if (idbCount > 0) {
        window.__pmHistories = parsed;
        try {
          localStorage.setItem("ST_SMS_DATA_V2", JSON.stringify(parsed));
        } catch (error) {
          console.warn("[phone-mode] localStorage \u5DF2\u6EE1\uFF0C\u4EC5\u4F7F\u7528 IDB \u5B58\u50A8");
        }
        console.log("[phone-mode] \u4ECE IndexedDB \u52A0\u8F7D\u4E86\u77ED\u4FE1\u5386\u53F2\uFF0C\u5171", idbCount, "\u4E2A\u4F1A\u8BDD");
      }
    } catch (error) {
      console.warn("[phone-mode] IDB \u6062\u590D\u5931\u8D25\uFF0C\u5C1D\u8BD5 localStorage \u515C\u5E95", error);
      try {
        const fallback = JSON.parse(localStorage.getItem("ST_SMS_DATA_V2"));
        if (fallback && typeof fallback === "object" && Object.keys(fallback).length > 0) {
          window.__pmHistories = fallback;
        }
      } catch (fallbackError) {
      }
    }
  }
  async function loadEmojis() {
    try {
      const value = await pmIDBGet("ST_SMS_EMOJIS");
      window.__pmEmojis = Array.isArray(value) ? value : [];
    } catch (error) {
      window.__pmEmojis = [];
    }
  }
  async function saveEmojis() {
    await pmIDBSet("ST_SMS_EMOJIS", window.__pmEmojis).catch(() => {
    });
  }
  function loadTheme() {
    try {
      window.__pmTheme = { ...window.__pmTheme, ...JSON.parse(localStorage.getItem("ST_SMS_THEME")) };
    } catch (error) {
    }
  }
  function saveTheme() {
    try {
      localStorage.setItem("ST_SMS_THEME", JSON.stringify(window.__pmTheme));
    } catch (error) {
    }
  }
  function loadPokeConfig() {
    try {
      window.__pmPokeConfig = JSON.parse(localStorage.getItem("ST_SMS_POKE_CONFIG")) || {};
    } catch (error) {
      window.__pmPokeConfig = {};
    }
  }
  function savePokeConfig() {
    try {
      localStorage.setItem("ST_SMS_POKE_CONFIG", JSON.stringify(window.__pmPokeConfig));
    } catch (error) {
    }
  }
  function loadWordyLimit() {
    try {
      window.__pmWordyLimit = !!JSON.parse(localStorage.getItem("ST_SMS_WORDY_LIMIT"));
    } catch (error) {
      window.__pmWordyLimit = false;
    }
  }
  function saveWordyLimit() {
    try {
      localStorage.setItem("ST_SMS_WORDY_LIMIT", JSON.stringify(window.__pmWordyLimit));
    } catch (error) {
    }
  }
  async function loadBgSettings() {
    try {
      const storedGlobal = localStorage.getItem("ST_SMS_BG_GLOBAL") || "";
      if (storedGlobal === IDB_MARKER) {
        window.__pmBgGlobal = await pmIDBGet("ST_SMS_BG_GLOBAL") || "";
      } else if (isBigData(storedGlobal)) {
        window.__pmBgGlobal = storedGlobal;
        await pmIDBSet("ST_SMS_BG_GLOBAL", storedGlobal);
        try {
          localStorage.setItem("ST_SMS_BG_GLOBAL", IDB_MARKER);
        } catch (error) {
        }
      } else {
        window.__pmBgGlobal = storedGlobal;
      }
    } catch (error) {
      window.__pmBgGlobal = "";
    }
    try {
      const storedLocal = JSON.parse(localStorage.getItem("ST_SMS_BG_LOCAL")) || {};
      const result = {};
      let migrated = 0;
      for (const [key, value] of Object.entries(storedLocal)) {
        if (value === IDB_MARKER) {
          result[key] = await pmIDBGet("ST_SMS_BG_LOCAL_" + key) || "";
        } else if (isBigData(value)) {
          result[key] = value;
          await pmIDBSet("ST_SMS_BG_LOCAL_" + key, value);
          storedLocal[key] = IDB_MARKER;
          migrated++;
        } else {
          result[key] = value;
        }
      }
      if (migrated > 0) {
        try {
          localStorage.setItem("ST_SMS_BG_LOCAL", JSON.stringify(storedLocal));
        } catch (error) {
        }
      }
      window.__pmBgLocal = result;
    } catch (error) {
      window.__pmBgLocal = {};
    }
  }
  async function saveBgGlobal() {
    const value = window.__pmBgGlobal || "";
    if (isBigData(value)) {
      await pmIDBSet("ST_SMS_BG_GLOBAL", value);
      try {
        localStorage.setItem("ST_SMS_BG_GLOBAL", IDB_MARKER);
      } catch (error) {
      }
    } else {
      await pmIDBDel("ST_SMS_BG_GLOBAL");
      try {
        localStorage.setItem("ST_SMS_BG_GLOBAL", value);
      } catch (error) {
      }
    }
  }
  async function saveBgLocal() {
    const pointers = {};
    for (const [key, value] of Object.entries(window.__pmBgLocal || {})) {
      if (isBigData(value)) {
        await pmIDBSet("ST_SMS_BG_LOCAL_" + key, value);
        pointers[key] = IDB_MARKER;
      } else {
        await pmIDBDel("ST_SMS_BG_LOCAL_" + key);
        if (value !== void 0) pointers[key] = value;
      }
    }
    try {
      localStorage.setItem("ST_SMS_BG_LOCAL", JSON.stringify(pointers));
    } catch (error) {
    }
  }
  function loadGroupMeta() {
    try {
      window.__pmGroupMeta = JSON.parse(localStorage.getItem("ST_SMS_GROUP_META")) || {};
    } catch (error) {
      window.__pmGroupMeta = {};
    }
  }
  function saveGroupMeta() {
    try {
      localStorage.setItem("ST_SMS_GROUP_META", JSON.stringify(window.__pmGroupMeta));
    } catch (error) {
    }
  }
  function loadProfiles() {
    try {
      window.__pmProfiles = JSON.parse(localStorage.getItem("ST_SMS_API_PROFILES")) || [];
    } catch (error) {
      window.__pmProfiles = [];
    }
  }
  function saveProfiles() {
    try {
      localStorage.setItem("ST_SMS_API_PROFILES", JSON.stringify(window.__pmProfiles));
    } catch (error) {
    }
  }
  function addOrUpdateProfile(profile) {
    if (!profile.apiUrl || !profile.apiKey) return;
    const index = window.__pmProfiles.findIndex((item) => item.apiUrl === profile.apiUrl && item.apiKey === profile.apiKey);
    if (index >= 0) window.__pmProfiles[index] = { ...window.__pmProfiles[index], ...profile, savedAt: Date.now() };
    else window.__pmProfiles.push({ ...profile, savedAt: Date.now() });
    saveProfiles();
  }
  function loadBidirectional() {
    try {
      window.__pmBidirectional = JSON.parse(localStorage.getItem("ST_SMS_BIDIRECTIONAL")) || {};
    } catch (error) {
      window.__pmBidirectional = {};
    }
  }
  function saveBidirectional() {
    try {
      localStorage.setItem("ST_SMS_BIDIRECTIONAL", JSON.stringify(window.__pmBidirectional));
    } catch (error) {
    }
  }

  // src/runtime.js
  function createRuntimeState() {
    return {
      modelList: [],
      eventHooked: false,
      firstOpen: true,
      lastChatLength: 0,
      visibilityTimer: null
    };
  }

  // src/host-context.js
  function getStorageId(getCtx) {
    const context = getCtx();
    if (!context) return "sms_unknown__default";
    const character = context.characters?.[context.characterId];
    const avatar = character?.avatar || `idx_${context.characterId}`;
    const chatFile = context.chatId || (typeof context.getCurrentChatId === "function" ? context.getCurrentChatId() : null) || context.chat_metadata?.chat_id_hash || context.chat_file || "default";
    return `sms_${avatar}__${chatFile}`;
  }
  function getUserPersona(getCtx) {
    const context = getCtx();
    if (!context) return { name: "\u7528\u6237", description: "" };
    let name = context.name1 || "User";
    let description = "";
    try {
      const settings = context.powerUserSettings || context.power_user || window.power_user;
      if (settings) {
        description = settings.persona_description || settings.personaDescription || "";
        const avatar = context.userAvatar || settings.user_avatar || settings.default_persona;
        if (!description && avatar) {
          const descriptions = settings.persona_descriptions || settings.personaDescriptions;
          const persona = descriptions?.[avatar];
          if (typeof persona === "string") description = persona;
          else if (persona?.description) description = persona.description;
        }
      }
    } catch (error) {
    }
    if (!description) {
      try {
        const metadata = context.chatMetadata || context.chat_metadata;
        if (metadata?.persona) description = String(metadata.persona);
      } catch (error) {
      }
    }
    try {
      if (typeof context.substituteParams === "function") {
        const resolvedName = context.substituteParams("{{user}}");
        if (resolvedName && resolvedName !== "{{user}}" && resolvedName.trim()) name = resolvedName.trim();
      }
    } catch (error) {
    }
    return { name, description };
  }
  async function gatherContext(getCtx) {
    const context = getCtx();
    const character = context?.characters?.[context.characterId] || {};
    const cleanMessage = (value) => (value || "").replace(/```[\s\S]*?```/g, "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<[^>]+>/g, "").trim();
    const mainChat = (context?.chat || []).slice(-8).map((message) => ({
      who: message.is_user ? "\u7528\u6237" : message.name || "\u89D2\u8272",
      content: cleanMessage(message.mes || "")
    })).filter((message) => message.content);
    let worldBookText = "";
    try {
      if (typeof context?.getWorldInfoPrompt === "function") {
        const contextSize = context?.powerUserSettings?.openai_max_context || context?.oai_settings?.openai_max_context || context?.maxContext || 131072;
        const worldInfo = await context.getWorldInfoPrompt(
          (context.chat || []).map((message) => message.mes || "").slice(-10),
          contextSize,
          false
        );
        worldBookText = worldInfo?.worldInfoString || worldInfo?.worldInfoBefore || "";
        if (!worldBookText && worldInfo && typeof worldInfo === "object") {
          worldBookText = [worldInfo.worldInfoBefore, worldInfo.worldInfoAfter].filter(Boolean).join("\n");
        }
      }
    } catch (error) {
    }
    const userPersona = getUserPersona(getCtx);
    return { cardDesc: character.description ?? "", cardPersonality: character.personality ?? "", cardScenario: character.scenario ?? "", cardFirstMes: character.first_mes ?? "", cardMesExample: character.mes_example ?? "", mainChatText: mainChat.map((message) => `${message.who}\uFF1A${message.content}`).join("\n"), worldBookText, userName: userPersona.name, userDesc: userPersona.description };
  }

  // src/cropper.js
  function openCropper(imgDataUrl, { onCancel, onConfirm }) {
    const ratio = 330 / 450;
    document.getElementById("pm-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "pm-overlay";
    if (POPOVER_SUPPORTED) overlay.setAttribute("popover", "manual");
    overlay.innerHTML = `
<div class="pm-modal pm-modal-wide">
  <div class="pm-modal-header"><b>\u88C1\u526A\u56FE\u7247</b><span id="pm-crop-close" class="pm-modal-close">\u2715</span></div>
  <div style="padding:12px 14px;">
    <div class="pm-crop-tip">\u62D6\u52A8\u56FE\u7247\u8C03\u6574\u4F4D\u7F6E\uFF0C\u6EDA\u8F6E/\u634F\u5408\u7F29\u653E</div>
    <div class="pm-crop-frame" id="pm-crop-frame">
      <img id="pm-crop-img" src="${escapeAttr(imgDataUrl)}" alt="">
      <div class="pm-crop-mask"></div>
    </div>
    <div class="pm-crop-zoom">
      <span style="font-size:11px;color:#888;">\u7F29\u653E</span>
      <input type="range" id="pm-crop-zoom" min="100" max="400" value="100">
    </div>
  </div>
  <div class="pm-modal-add" style="display:flex;gap:8px;">
    <button id="pm-crop-cancel" style="flex:1;background:#f0f0f0;color:#333;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;">\u53D6\u6D88</button>
    <button id="pm-crop-confirm" style="flex:1;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u786E\u8BA4\u88C1\u526A</button>
  </div>
</div>`;
    const cancel = () => {
      overlay.remove();
      onCancel?.();
    };
    overlay.querySelector("#pm-crop-close").addEventListener("click", cancel);
    overlay.querySelector("#pm-crop-cancel").addEventListener("click", cancel);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cancel();
    });
    document.body.appendChild(overlay);
    if (overlay.showPopover) try {
      overlay.showPopover();
    } catch (error) {
    }
    const frame = overlay.querySelector("#pm-crop-frame");
    const image = overlay.querySelector("#pm-crop-img");
    const zoomSlider = overlay.querySelector("#pm-crop-zoom");
    let tx = 0, ty = 0, scale = 1;
    let frameWidth = 0, frameHeight = 0, baseWidth = 0, baseHeight = 0;
    function updateTransform() {
      const width = baseWidth * scale;
      const height = baseHeight * scale;
      tx = Math.max(frameWidth - width, Math.min(0, tx));
      ty = Math.max(frameHeight - height, Math.min(0, ty));
      image.style.width = width + "px";
      image.style.height = height + "px";
      image.style.transform = `translate(${tx}px, ${ty}px)`;
    }
    image.onload = () => {
      frameWidth = frame.clientWidth;
      frameHeight = frameWidth / ratio;
      frame.style.height = frameHeight + "px";
      const imageRatio = image.naturalWidth / image.naturalHeight;
      if (imageRatio > ratio) {
        baseHeight = frameHeight;
        baseWidth = baseHeight * imageRatio;
      } else {
        baseWidth = frameWidth;
        baseHeight = baseWidth / imageRatio;
      }
      updateTransform();
    };
    zoomSlider.oninput = () => {
      scale = parseInt(zoomSlider.value, 10) / 100;
      updateTransform();
    };
    let dragging = false, startX = 0, startY = 0, startTx = 0, startTy = 0;
    const onDragStart = (event) => {
      dragging = true;
      const point = event.touches ? event.touches[0] : event;
      startX = point.clientX;
      startY = point.clientY;
      startTx = tx;
      startTy = ty;
      if (event.cancelable) event.preventDefault();
    };
    const onDragMove = (event) => {
      if (!dragging) return;
      const point = event.touches ? event.touches[0] : event;
      tx = startTx + point.clientX - startX;
      ty = startTy + point.clientY - startY;
      updateTransform();
      if (event.cancelable) event.preventDefault();
    };
    const onDragEnd = () => {
      dragging = false;
    };
    frame.addEventListener("mousedown", onDragStart);
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    frame.addEventListener("touchstart", onDragStart, { passive: false });
    window.addEventListener("touchmove", onDragMove, { passive: false });
    window.addEventListener("touchend", onDragEnd);
    let pinchDistance = 0, pinchScale = 1;
    frame.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 2) return;
      pinchDistance = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY
      );
      pinchScale = scale;
    }, { passive: false });
    frame.addEventListener("touchmove", (event) => {
      if (event.touches.length !== 2 || !pinchDistance) return;
      const distance = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY
      );
      scale = Math.max(1, Math.min(4, pinchScale * distance / pinchDistance));
      zoomSlider.value = Math.round(scale * 100);
      updateTransform();
      event.preventDefault();
    }, { passive: false });
    frame.addEventListener("wheel", (event) => {
      event.preventDefault();
      scale = Math.max(1, Math.min(4, scale + (event.deltaY > 0 ? -0.1 : 0.1)));
      zoomSlider.value = Math.round(scale * 100);
      updateTransform();
    });
    overlay.querySelector("#pm-crop-confirm").addEventListener("click", () => {
      const canvas = document.createElement("canvas");
      const outputWidth = 600;
      const outputHeight = Math.round(outputWidth / ratio);
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d");
      const sourceScale = image.naturalWidth / (baseWidth * scale);
      context.drawImage(
        image,
        -tx * sourceScale,
        -ty * sourceScale,
        frameWidth * sourceScale,
        frameHeight * sourceScale,
        0,
        0,
        outputWidth,
        outputHeight
      );
      let quality = 0.7;
      let output = canvas.toDataURL("image/jpeg", quality);
      while (output.length > 200 * 1370 && quality > 0.2) {
        quality -= 0.1;
        output = canvas.toDataURL("image/jpeg", quality);
      }
      overlay.remove();
      onConfirm(output);
    });
  }

  // src/emoji-ui.js
  var SUB_OVERLAY_STYLE = "position:fixed !important; inset:0 !important; margin:0 !important; padding:0 !important; border:none !important; width:100vw !important; height:100vh !important; max-width:none !important; max-height:none !important; background:rgba(0,0,0,.45) !important; z-index:2147483648 !important; display:flex !important; align-items:center !important; justify-content:center !important;";
  function createSubOverlay(html) {
    document.getElementById("pm-overlay-sub")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "pm-overlay-sub";
    if (typeof HTMLElement !== "undefined" && HTMLElement.prototype.hasOwnProperty("popover")) {
      overlay.setAttribute("popover", "manual");
    }
    overlay.style.cssText = SUB_OVERLAY_STYLE;
    overlay.innerHTML = html;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    if (overlay.showPopover) try {
      overlay.showPopover();
    } catch (error) {
    }
    return overlay;
  }
  function renderPickerImages(set) {
    if (!set?.images?.length) return '<div style="text-align:center;color:#999;font-size:12px;padding:20px 0;">\u672C\u5957\u6682\u65E0\u56FE\u7247</div>';
    return set.images.map((image, index) => `
        <div onclick="window.__pmInsertEmoji('[emo:${escapeAttr(set.name)}:${index + 1}]')" style="cursor:pointer;width:60px;display:flex;flex-direction:column;align-items:center;gap:4px;">
            <img src="${escapeAttr(image.url)}" style="width:50px;height:50px;object-fit:cover;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
            <span style="font-size:10px;color:#666;width:100%;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(image.desc)}</span>
        </div>`).join("");
  }
  function renderPickerDots(sets, activeIndex) {
    if (sets.length <= 1) return "";
    return `<div style="display:flex;justify-content:center;gap:8px;padding:8px 0 4px;">${sets.map((set, index) => `<div class="pm-emoji-set-dot-btn" onclick="window.__pmEmojiSetDot(${index})" style="width:8px;height:8px;border-radius:50%;cursor:pointer;background:${index === activeIndex ? "#007aff" : "#ddd"};transition:background 0.2s;"></div>`).join("")}</div>`;
  }
  function installEmojiUi({ makeOverlay, saveEmojis: saveEmojis2 }) {
    window.__pmRenderEmojiSetList = () => {
      const container = document.getElementById("pm-emoji-set-list");
      if (!container) return;
      const sets = window.__pmEmojis;
      if (!sets.length) {
        container.innerHTML = '<div style="text-align:center;color:#aaa;font-size:13px;padding:16px 0;">\u6682\u65E0\u8868\u60C5\u5305\u5957\u7EC4</div>';
        return;
      }
      container.innerHTML = sets.map((set, setIndex) => `
            <div style="background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <span style="font-weight:600;font-size:13px;color:#222;">${escapeHtml(set.name)}</span>
                    <div style="display:flex;gap:6px;">
                        <button onclick="window.__pmAddEmojiImage(${setIndex})" style="font-size:11px;background:#007aff;color:#fff;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;">\u2795\u56FE\u7247</button>
                        <button onclick="window.__pmDeleteEmojiSet(${setIndex})" style="font-size:11px;background:#ff3b30;color:#fff;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;">\u5220\u9664</button>
                    </div>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${set.images.map((image, imageIndex) => `
                        <div style="position:relative;width:52px;">
                            <img src="${escapeAttr(image.url)}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;border:1px solid #eee;">
                            <div style="font-size:9px;color:#888;text-align:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:52px;">${escapeHtml(image.desc)}</div>
                            <span onclick="window.__pmDeleteEmojiImage(${setIndex},${imageIndex})" style="position:absolute;top:-4px;right:-4px;background:#ff3b30;color:#fff;border-radius:50%;width:16px;height:16px;font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;">\xD7</span>
                        </div>`).join("")}
                    ${set.images.length === 0 ? '<span style="font-size:12px;color:#aaa;">\u6682\u65E0\u56FE\u7247</span>' : ""}
                </div>
                <div style="font-size:11px;color:#aaa;margin-top:4px;">${set.images.length}/20 \u5F20 \xB7 [emo:${escapeHtml(set.name)}:1~${set.images.length}]</div>
            </div>`).join("");
    };
    window.__pmAddEmojiSet = () => {
      if (window.__pmEmojis.length >= 10) return alert("\u6700\u591A\u53EA\u80FD\u521B\u5EFA 10 \u4E2A\u5957\u7EC4\u3002");
      createSubOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><b>\u65B0\u5EFA\u8868\u60C5\u5305\u5957\u7EC4</b><span onclick="document.getElementById('pm-overlay-sub').remove()" class="pm-modal-close">\u2715</span></div>
  <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
    <input id="pm-new-set-name" class="pm-cfg-input" placeholder="\u5957\u7EC4\u540D\u79F0\uFF08\u5982\uFF1A\u5F00\u5FC3\u3001\u65E5\u5E38\u3001\u53EF\u7231\uFF09" style="padding:8px 10px;font-size:13px;border-radius:8px;border:1px solid #ddd;">
  </div>
  <div class="pm-modal-add"><button onclick="window.__pmConfirmAddEmojiSet()" style="width:100%;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u786E\u8BA4</button></div>
</div>`);
      setTimeout(() => document.getElementById("pm-new-set-name")?.focus(), 10);
    };
    window.__pmConfirmAddEmojiSet = () => {
      const name = document.getElementById("pm-new-set-name")?.value.trim();
      if (!name) return alert("\u5957\u7EC4\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u3002");
      if (window.__pmEmojis.some((set) => set.name === name)) return alert("\u8BE5\u540D\u79F0\u5DF2\u5B58\u5728\u3002");
      window.__pmEmojis.push({ id: "emo_" + Date.now(), name, images: [] });
      saveEmojis2();
      document.getElementById("pm-overlay-sub")?.remove();
      window.__pmRenderEmojiSetList();
    };
    window.__pmDeleteEmojiSet = (setIndex) => {
      const set = window.__pmEmojis[setIndex];
      if (!set || !confirm(`\u786E\u8BA4\u5220\u9664\u5957\u7EC4\u300C${set.name}\u300D\uFF1F`)) return;
      window.__pmEmojis.splice(setIndex, 1);
      saveEmojis2();
      window.__pmRenderEmojiSetList();
    };
    window.__pmAddEmojiImage = (setIndex) => {
      const set = window.__pmEmojis[setIndex];
      if (!set) return;
      if (set.images.length >= 20) return alert("\u672C\u5957\u7EC4\u5DF2\u6EE1 20 \u5F20\u3002");
      createSubOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><b>\u6DFB\u52A0\u56FE\u7247 \u2014 ${escapeHtml(set.name)}</b><span onclick="document.getElementById('pm-overlay-sub').remove();" class="pm-modal-close">\u2715</span></div>
  <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
    <div style="font-size:12px;color:#888;margin-bottom:2px;">\u56FE\u7247 URL \u6216\u672C\u5730\u4E0A\u4F20</div>
    <input id="pm-emo-url" class="pm-cfg-input" placeholder="https://... \u6216\u70B9\u4E0B\u65B9\u9009\u62E9\u6587\u4EF6" style="padding:8px 10px;font-size:13px;border-radius:8px;border:1px solid #ddd;">
    <button onclick="document.getElementById('pm-emo-file').click()" style="background:#f0f0f3;color:#333;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer;">\u{1F4C1} \u4E0A\u4F20\u672C\u5730\u56FE\u7247</button>
    <input id="pm-emo-file" type="file" accept="image/*" hidden onchange="window.__pmEmoFileRead(${setIndex},this)">
    <div id="pm-emo-preview" style="display:none;text-align:center;"><img id="pm-emo-preview-img" style="max-width:120px;max-height:120px;border-radius:10px;border:1px solid #eee;"></div>
    <input id="pm-emo-desc" class="pm-cfg-input" placeholder="\u56FE\u7247\u63CF\u8FF0\uFF08\u5FC5\u586B\uFF0C\u5982\uFF1A\u732B\u732B\u5F00\u5FC3\uFF09" style="padding:8px 10px;font-size:13px;border-radius:8px;border:1px solid #ddd;">
    <div style="font-size:11px;color:#aaa;">\u63CF\u8FF0\u5C06\u544A\u8BC9 AI \u8FD9\u5F20\u56FE\u5728\u4EC0\u4E48\u60C5\u5F62\u4E0B\u4F7F\u7528</div>
  </div>
  <div class="pm-modal-add"><button onclick="window.__pmConfirmAddEmojiImage(${setIndex})" style="width:100%;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u786E\u8BA4\u6DFB\u52A0</button></div>
</div>`);
      setTimeout(() => document.getElementById("pm-emo-url")?.focus(), 10);
    };
    window.__pmEmoFileRead = (setIndex, input) => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target.result;
        const urlInput = document.getElementById("pm-emo-url");
        const preview = document.getElementById("pm-emo-preview");
        const previewImage = document.getElementById("pm-emo-preview-img");
        if (urlInput) urlInput.value = url;
        if (preview && previewImage) {
          previewImage.src = url;
          preview.style.display = "block";
        }
      };
      reader.readAsDataURL(file);
    };
    window.__pmConfirmAddEmojiImage = (setIndex) => {
      const url = document.getElementById("pm-emo-url")?.value.trim();
      const description = document.getElementById("pm-emo-desc")?.value.trim();
      if (!url) return alert("\u8BF7\u8F93\u5165\u56FE\u7247 URL \u6216\u4E0A\u4F20\u56FE\u7247\u3002");
      if (!description) return alert("\u8BF7\u8F93\u5165\u56FE\u7247\u63CF\u8FF0\uFF08\u5FC5\u586B\uFF09\u3002");
      const set = window.__pmEmojis[setIndex];
      if (!set) return;
      set.images.push({ url, desc: description });
      saveEmojis2();
      document.getElementById("pm-overlay-sub")?.remove();
      window.__pmRenderEmojiSetList();
    };
    window.__pmDeleteEmojiImage = (setIndex, imageIndex) => {
      const set = window.__pmEmojis[setIndex];
      if (!set) return;
      set.images.splice(imageIndex, 1);
      saveEmojis2();
      window.__pmRenderEmojiSetList();
    };
    window.__pmShowEmojiPicker = () => {
      const sets = window.__pmEmojis;
      if (!sets.length) return alert("\u8FD8\u6CA1\u6709\u8868\u60C5\u5305\uFF01\u8BF7\u5148\u53BB\u3010\u8BBE\u7F6E-\u5176\u4ED6\u3011\u4E2D\u6DFB\u52A0\u3002");
      const textarea = document.getElementById("pm-expanded-textarea");
      window.__pmTempText = textarea ? textarea.value : "";
      let activeSetIndex = 0;
      const renderPicker = () => {
        const set = sets[activeSetIndex] || sets[0];
        const picker = document.getElementById("pm-emoji-picker-inner");
        if (!set || !picker) return;
        picker.querySelector(".pm-emoji-set-label").textContent = `${set.name} (${set.images.length})`;
        picker.querySelector(".pm-emoji-imgs").innerHTML = renderPickerImages(set);
        picker.querySelector(".pm-emoji-dots").innerHTML = renderPickerDots(sets, activeSetIndex);
      };
      window.__pmEmojiSetDot = (index) => {
        activeSetIndex = index;
        renderPicker();
      };
      const firstSet = sets[0];
      makeOverlay(`
<div class="pm-modal pm-modal-wide" id="pm-emoji-picker-inner">
  <div class="pm-modal-header" style="justify-content:space-between;padding-right:14px;">
    <b class="pm-emoji-set-label">${escapeHtml(firstSet.name)} (${firstSet.images.length})</b>
    <span onclick="document.getElementById('pm-overlay').remove();window.__pmShowExpandInput();" class="pm-modal-close">\u2715</span>
  </div>
  <div class="pm-emoji-imgs" id="pm-emoji-imgs-area" style="padding:12px 14px;overflow-y:auto;max-height:340px;display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-start;touch-action:pan-y pinch-zoom;">${renderPickerImages(firstSet)}</div>
  <div class="pm-emoji-dots">${renderPickerDots(sets, 0)}</div>
</div>`);
      const imageArea = document.getElementById("pm-emoji-imgs-area");
      if (!imageArea || sets.length <= 1) return;
      let startX = 0, startY = 0, movedHorizontally = false;
      imageArea.addEventListener("touchstart", (event) => {
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        movedHorizontally = false;
      }, { passive: true });
      imageArea.addEventListener("touchmove", (event) => {
        const dx = event.touches[0].clientX - startX;
        const dy = event.touches[0].clientY - startY;
        if (!movedHorizontally && Math.abs(dx) > Math.abs(dy) + 5) movedHorizontally = true;
        if (movedHorizontally && event.cancelable) event.preventDefault();
      }, { passive: false });
      imageArea.addEventListener("touchend", (event) => {
        const dx = event.changedTouches[0].clientX - startX;
        const dy = event.changedTouches[0].clientY - startY;
        if (Math.abs(dx) <= 40 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
        activeSetIndex = dx < 0 ? (activeSetIndex + 1) % sets.length : (activeSetIndex - 1 + sets.length) % sets.length;
        renderPicker();
      }, { passive: true });
    };
    window.__pmInsertEmoji = (code) => {
      const text = window.__pmTempText || "";
      document.getElementById("pm-overlay")?.remove();
      window.__pmShowExpandInput();
      const textarea = document.getElementById("pm-expanded-textarea");
      if (!textarea) return;
      textarea.value = text + code + " ";
      window.__pmTempText = textarea.value;
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    };
  }

  // src/ai.js
  function createAiClient({
    getConfig,
    getContext,
    getDefaultMaxTokens,
    fetchImpl
  }) {
    const request = fetchImpl || ((...args) => globalThis.fetch(...args));
    return async function callAI(systemPrompt, userPrompt, options = {}) {
      const cfg = getConfig() || {};
      const useIndependent = cfg.useIndependent && cfg.apiUrl && cfg.apiKey;
      const maxTokens = options.maxTokens || getDefaultMaxTokens();
      if (useIndependent) {
        const { chatUrl } = normalizeApiUrls(cfg.apiUrl);
        const messages = [];
        if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: userPrompt });
        const response = await request(chatUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${cfg.apiKey}`
          },
          body: JSON.stringify({
            model: cfg.model || "gpt-4o-mini",
            messages,
            max_tokens: maxTokens,
            temperature: 1.2,
            top_p: 0.95,
            frequency_penalty: 0.3,
            presence_penalty: 0.3
          })
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 120)}`);
        }
        const json = await response.json();
        return json.choices?.[0]?.message?.content ?? "";
      }
      const context = getContext();
      if (!context) throw new Error("\u65E0\u4E0A\u4E0B\u6587");
      const fullPrompt = systemPrompt ? `${systemPrompt}

${userPrompt}` : userPrompt;
      return await context.generateQuietPrompt(fullPrompt, false, false);
    };
  }

  // src/main.js
  (async function() {
    await new Promise((r) => setTimeout(r, 1e3));
    if (!window.__pmBeforeUnloadRegistered) {
      window.addEventListener("beforeunload", saveHistoriesBeforeUnload);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") saveHistoriesBeforeUnload();
      });
      window.__pmBeforeUnloadRegistered = true;
    }
    window.__pmHistories = window.__pmHistories || {};
    window.__pmConfig = window.__pmConfig || { apiUrl: "", apiKey: "", model: "", useIndependent: false };
    window.__pmProfiles = window.__pmProfiles || [];
    window.__pmBidirectional = window.__pmBidirectional || {};
    window.__pmTheme = window.__pmTheme || { preset: "default", customRight: "", customLeft: "", borderColor: "", layout: "standard", darkMode: "light" };
    window.__pmBgGlobal = window.__pmBgGlobal || "";
    window.__pmBgLocal = window.__pmBgLocal || {};
    window.__pmGroupMeta = window.__pmGroupMeta || {};
    window.__pmPokeConfig = window.__pmPokeConfig || {};
    window.__pmWordyLimit = window.__pmWordyLimit || false;
    window.__pmEmojis = window.__pmEmojis || [];
    const runtime = createRuntimeState();
    let phoneActive = false, phoneWindow = null, currentPersona = "", conversationHistory = [];
    let isGenerating = false, isMinimized = false, isSelectMode = false;
    let isGroupChat = false, groupMembers = [], groupColorMap = {}, groupDisplayName = "";
    let currentGroupKey = "";
    const getCtx = () => typeof SillyTavern !== "undefined" ? SillyTavern.getContext() : null;
    const getStorageId2 = () => getStorageId(getCtx);
    const getUserPersona2 = () => getUserPersona(getCtx);
    const gatherContext2 = () => gatherContext(getCtx);
    const callAI = createAiClient({
      getConfig: () => window.__pmConfig,
      getContext: getCtx,
      getDefaultMaxTokens: () => isGroupChat ? 600 : 300
    });
    function applyTheme() {
      const el = phoneWindow;
      if (!el) return;
      const t = window.__pmTheme, p = THEME_PRESETS[t.preset] || THEME_PRESETS.default;
      const rBg = t.customRight || p.right, lBg = t.customLeft || p.left;
      const rTxt = t.customRight ? contrastText(t.customRight) : p.rightText;
      const lTxt = t.customLeft ? contrastText(t.customLeft) : p.leftText;
      const border = t.borderColor || "#1a1a1a";
      el.style.setProperty("--pm-r-bg", rBg);
      el.style.setProperty("--pm-l-bg", lBg);
      el.style.setProperty("--pm-r-txt", rTxt);
      el.style.setProperty("--pm-l-txt", lTxt);
      el.style.setProperty("--pm-border", border);
      el.style.setProperty("--pm-frost", p.frost ? "1" : "0");
      const darkMode = t.darkMode || "light";
      el.setAttribute("data-theme", darkMode);
    }
    function applyBackground() {
      const msgList = phoneWindow?.querySelector(".pm-msg-list");
      if (!msgList) return;
      const id = getStorageId2(), localKey = `${id}_${currentPersona}`;
      const bg = window.__pmBgLocal[localKey] || window.__pmBgGlobal || "";
      if (bg) {
        msgList.style.setProperty("background-image", `url("${cssUrlEscape(bg)}")`, "important");
        msgList.style.setProperty("background-size", "cover", "important");
        msgList.style.setProperty("background-position", "center", "important");
      } else {
        msgList.style.removeProperty("background-image");
        msgList.style.removeProperty("background-size");
        msgList.style.removeProperty("background-position");
      }
    }
    function fitNameFont() {
      const nameEl = phoneWindow?.querySelector(".pm-name");
      if (!nameEl) return;
      nameEl.style.fontSize = "15px";
      requestAnimationFrame(() => {
        let fs = 15;
        while (nameEl.scrollWidth > nameEl.clientWidth && fs > 9) {
          fs -= 0.5;
          nameEl.style.fontSize = fs + "px";
        }
      });
    }
    function migrateOldHistory() {
      if (localStorage.getItem("ST_SMS_MIGRATED_V3")) return;
      const c = getCtx();
      if (!c) return;
      try {
        const oldData = window.__pmHistories || {}, newData = {};
        let migrated = 0;
        for (const oldKey of Object.keys(oldData)) {
          if (oldKey.startsWith("sms_")) {
            newData[oldKey] = oldData[oldKey];
            continue;
          }
          const m = oldKey.match(/^(\d+)_(.+)$/);
          if (!m) {
            newData[oldKey] = oldData[oldKey];
            continue;
          }
          const ch = c.characters?.[parseInt(m[1])];
          if (ch?.avatar) {
            newData[`sms_${ch.avatar}__${m[2]}`] = oldData[oldKey];
            migrated++;
          } else newData[oldKey] = oldData[oldKey];
        }
        window.__pmHistories = newData;
        saveHistories();
        localStorage.setItem("ST_SMS_MIGRATED_V3", "1");
      } catch (e) {
      }
    }
    window.__pmDeleteProfile = (idx) => {
      window.__pmProfiles.splice(idx, 1);
      saveProfiles();
      window.__pmShowConfig();
    };
    window.__pmPickProfile = (idx) => {
      const p = window.__pmProfiles[idx];
      if (!p) return;
      const u = document.getElementById("pm-cfg-url"), k = document.getElementById("pm-cfg-key"), m = document.getElementById("pm-cfg-model");
      if (u) u.value = p.apiUrl || "";
      if (k) k.value = p.apiKey || "";
      if (m) m.value = p.model || "";
    };
    window.__pmSetMode = (v) => {
      window.__pmConfig.useIndependent = !!v;
      try {
        localStorage.setItem("ST_SMS_CONFIG", JSON.stringify(window.__pmConfig));
      } catch (e) {
      }
      const a = document.getElementById("pm-mode-main"), b = document.getElementById("pm-mode-indep"), t = document.getElementById("pm-mode-tip");
      if (a && b) {
        a.classList.toggle("pm-mode-active", !v);
        b.classList.toggle("pm-mode-active", !!v);
      }
      if (t) t.textContent = v ? "\u{1F50C} \u72EC\u7ACBAPI" : "\u{1F3E0} \u4E3BAPI";
    };
    function applyBidirectionalInjection() {
      const c = getCtx();
      if (!c || typeof c.setExtensionPrompt !== "function") return;
      const userName = getUserPersona2().name || "\u7528\u6237";
      const id = getStorageId2(), checked = window.__pmBidirectional[id] || [], histories = window.__pmHistories[id] || {};
      const groups = window.__pmGroupMeta[id] || {};
      if (!checked.length) {
        try {
          c.setExtensionPrompt(BIDIRECTIONAL_KEY, "", 0, 0, false, 0);
        } catch (e) {
        }
        return;
      }
      const blocks = checked.map((name) => {
        const conv = (histories[name] || []).slice(-BIDIRECTIONAL_LIMIT);
        if (!conv.length) return "";
        if (name.startsWith("__group_")) {
          const meta = groups[name];
          if (!meta) return "";
          const lines2 = conv.map((m) => {
            const t = resolveEmojiText((m.content || "").replace(/\s*\/\s*/g, "\u3002").replace(/\n/g, "\uFF1B"), window.__pmEmojis);
            return m.role === "user" ? `${userName}\uFF1A${t}` : t;
          }).join("\n");
          return `\u3010\u7FA4\u804A"${meta.name}"\uFF08\u6210\u5458\uFF1A${meta.members.join("\u3001")}\uFF09\u7684\u6700\u8FD1\u804A\u5929 \u2014 \u4EC5\u53C2\u4E0E\u8005\u4E0E ${userName} \u77E5\u6653\uFF0C\u5176\u4ED6\u89D2\u8272\u4E0D\u5E94\u77E5\u60C5\u3011
${lines2}`;
        }
        const lines = conv.map((m) => {
          const t = resolveEmojiText((m.content || "").replace(/\s*\/\s*/g, "\u3002"), window.__pmEmojis);
          return m.role === "user" ? `${userName}\uFF1A${t}` : `${name}\uFF1A${t}`;
        }).join("\n");
        return `\u3010\u4E0E ${name} \u7684\u77ED\u4FE1 \u2014 \u4EC5 ${name} \u4E0E ${userName} \u77E5\u6653\u3011
${lines}`;
      }).filter(Boolean).join("\n\n");
      if (!blocks) {
        try {
          c.setExtensionPrompt(BIDIRECTIONAL_KEY, "", 0, 0, false, 0);
        } catch (e) {
        }
        return;
      }
      try {
        c.setExtensionPrompt(BIDIRECTIONAL_KEY, `[\u624B\u673A\u77ED\u4FE1\u8BB0\u5FC6 \u2014 \u79C1\u5BC6]
${blocks}
[\u7ED3\u675F]`, 0, 0, false, 0);
      } catch (e) {
      }
    }
    function hookGenerationEvent() {
      if (runtime.eventHooked) return;
      const c = getCtx();
      if (!c?.eventSource || !c?.event_types) return;
      const et = c.event_types;
      runtime.lastChatLength = (c.chat || []).length;
      const events = [
        et.GENERATION_STARTED || "generation_started",
        et.CHAT_CHANGED || "chat_id_changed",
        et.SETTINGS_UPDATED || "settings_updated",
        et.CHATCOMPLETION_SOURCE_CHANGED || "chatcompletion_source_changed",
        et.OAI_PRESET_CHANGED_AFTER || "oai_preset_changed_after"
      ];
      events.forEach((ev) => {
        try {
          c.eventSource.on(ev, () => {
            try {
              applyBidirectionalInjection();
            } catch (e) {
            }
          });
        } catch (e) {
        }
      });
      try {
        c.eventSource.on(et.MESSAGE_RECEIVED || "message_received", () => {
          const currentLen = (c.chat || []).length;
          if (currentLen > runtime.lastChatLength) {
            runtime.lastChatLength = currentLen;
            if (typeof window.__pmIncrementCounters === "function") {
              window.__pmIncrementCounters();
            }
          } else if (currentLen < runtime.lastChatLength) {
            runtime.lastChatLength = currentLen;
          }
        });
        c.eventSource.on(et.CHAT_CHANGED || "chat_id_changed", () => {
          runtime.lastChatLength = (c.chat || []).length;
          if (phoneActive && typeof window.__pmEnd === "function") {
            window.__pmEnd();
          }
        });
      } catch (e) {
      }
      runtime.eventHooked = true;
      console.log("[phone-mode] hooked", events.length, "events");
    }
    window.__pmToggleBidirectional = (name) => {
      const id = getStorageId2(), arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(name);
      if (idx >= 0) arr.splice(idx, 1);
      else {
        if (arr.length >= MAX_BIDIRECTIONAL) return;
        arr.push(name);
      }
      window.__pmBidirectional[id] = arr;
      saveBidirectional();
      applyBidirectionalInjection();
      window.__pmShowList();
    };
    function bindIsland(el, handle) {
      let isDragging = false, startX, startY, startTX = 0, startTY = 0, moved = false;
      const getCoord = (e) => e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
      const getT = () => {
        const m = (el.style.transform || "").match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/);
        return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
      };
      const onStart = (e) => {
        if (e.target.tagName === "BUTTON") return;
        isDragging = true;
        moved = false;
        const coords = getCoord(e);
        startX = coords.x;
        startY = coords.y;
        const t = getT();
        startTX = t.x;
        startTY = t.y;
        el.style.transition = "none";
        if (e.cancelable) e.preventDefault();
      };
      const onMove = (e) => {
        if (!isDragging) return;
        const coords = getCoord(e), dx = coords.x - startX, dy = coords.y - startY;
        if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        moved = true;
        if (e.cancelable) e.preventDefault();
        el.style.setProperty("transform", `translate(${startTX + dx}px, ${startTY + dy}px)`, "important");
      };
      const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        el.style.transition = ".35s cubic-bezier(.18,.89,.32,1.2)";
        if (!moved) window.__pmToggleMin();
      };
      handle.addEventListener("mousedown", onStart);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onEnd);
      handle.addEventListener("touchstart", onStart, { passive: false });
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onEnd);
    }
    async function fetchSMS(userMsg, directorNote) {
      const userMsgClean = userMsg.replace(/\[emo:([^\]:]+):(\d+)\]/g, (_, setName, idxStr) => {
        const set = (window.__pmEmojis || []).find((item) => item.name === setName);
        const image = set?.images?.[parseInt(idxStr, 10) - 1];
        return image?.desc ? `[\u8868\u60C5\u5305\uFF1A${image.desc}]` : "[\u8868\u60C5\u5305]";
      }).replace(/\s{2,}/g, " ").trim();
      if (userMsg.trim()) {
        conversationHistory.push({ role: "user", content: userMsg });
      }
      const ctxData = await gatherContext2();
      const { cardDesc, cardPersonality, cardScenario, cardFirstMes, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;
      const smsHistoryText = conversationHistory.slice(-CONTEXT_LIMIT, -1).map((message) => {
        const clean = cleanResponse(message.content);
        return message.role === "user" ? `${userName}\uFF1A${clean}` : isGroupChat ? clean : `${currentPersona}\uFF1A${clean}`;
      }).join("\n");
      const userBlock = [
        `\u7528\u6237\u540D\u5B57\uFF1A${userName}`,
        userDesc ? `\u7528\u6237\u4EBA\u8BBE\uFF1A${userDesc}` : ""
      ].filter(Boolean).join("\n");
      let injectedInstruction, systemPrompt;
      if (isGroupChat) {
        const memberList = groupMembers.join("\u3001");
        const groupName = groupDisplayName || `\u7FA4\u804A\uFF1A${memberList}`;
        const groupRules = `
[\u7FA4\u804A\u77ED\u4FE1\u6A21\u5F0F\u2014\u2014\u6700\u9AD8\u4F18\u5148\u7EA7]
\u7FA4\u804A\u540D\u79F0\uFF1A${groupName}
\u7FA4\u804A\u6210\u5458\uFF1A${memberList}
\u4F60\u540C\u65F6\u626E\u6F14\u4EE5\u4E0A\u6240\u6709\u89D2\u8272\u4E0E\u7528\u6237\uFF08${userName}\uFF09\u804A\u5929\u3002

\u26A0\uFE0F \u8F93\u51FA\u5FC5\u987B\u6EE1\u8DB3\u4EE5\u4E0B\u5168\u90E8\u6761\u4EF6\uFF0C\u8FDD\u53CD\u5373\u89C6\u4E3A\u65E0\u6548\uFF1A
1. \u6BCF\u4E00\u884C\u90FD\u5FC5\u987B\u4EE5 "\u89D2\u8272\u540D\uFF1A" \u5F00\u5934\uFF08\u89D2\u8272\u540D\u5FC5\u987B\u6765\u81EA\uFF1A${memberList}\uFF09
2. \u4E25\u7981\u8F93\u51FA\u5BF9\u754C\u9762\u3001\u7CFB\u7EDF\u3001\u5BF9\u8BDD\u672C\u8EAB\u7684\u603B\u7ED3\u6216\u63CF\u8FF0\u6027\u6587\u5B57
3. \u4E25\u7981\u8F93\u51FA\u7C7B\u4F3C"\u73B0\u5728\u5E94\u8BE5..."\u3001"\u6211\u5DF2\u7ECF..."\u3001"\u770B\u8D77\u6765..."\u8FD9\u7C7B\u53D9\u8FF0\u6027\u53E5\u5B50
4. \u7279\u6B8A\u683C\u5F0F\u5FC5\u987B\u5728\u540C\u4E00\u884C\u5185\u5B8C\u6574\u5199\u51FA\u4E14\u95ED\u5408\uFF1A(\u8F6C\u8D26+\u91D1\u989D) (\u6536\u6B3E+\u91D1\u989D) (\u9000\u8FD8+\u91D1\u989D) (\u56FE\u7247+\u63CF\u8FF0) (\u8BED\u97F3+\u5185\u5BB9)\u3002\u6CE8\u610F\uFF1A\u9000\u8FD8\u6307\u62D2\u7EDD\u804A\u5929\u5BF9\u8C61\u8F6C\u8D26\u3002
5. \u7279\u6B8A\u683C\u5F0F\u62EC\u53F7\u5185\u4E25\u7981\u6362\u884C\u3001\u7F16\u53F7\uFF081. 2. 3.\uFF09\u3001\u5217\u8868
6. \u6BCF\u6761\u6D88\u606F\u5185\u7684 / \u53EA\u7528\u4E8E\u5206\u9694\u540C\u4E00\u89D2\u8272\u7684\u591A\u6761\u77ED\u4FE1
7. \u6BCF\u4E2A\u89D2\u8272\u6839\u636E\u81EA\u5DF1\u7684\u4EBA\u8BBE\u548C\u5F53\u524D\u5267\u60C5\u4E3B\u52A8\u51B3\u5B9A\u53D1\u8A00\u6761\u6570\uFF0C0-8\u53E5\uFF0C\u53EF\u7A7F\u63D2\u53D1\u8A00\uFF0C\u4E0D\u5FC5\u6240\u6709\u4EBA\u90FD\u8BF4\u8BDD
8. \u4E25\u7981\u82F1\u6587\u683C\u5F0F (Voice+/Image+/Transfer+/Refund+)
9. \u5B8C\u5168\u6C89\u6D78\u4E8E\u89D2\u8272\u8BBE\u5B9A\uFF0C\u892A\u53BBAI\u5BA2\u89C2\u8BED\u6C14\u3002\u6839\u636E\u7528\u6237\u5F15\u5BFC\u81EA\u7136\u63A8\u8FDB\u5267\u60C5\uFF0C\u5728\u7528\u6237\u660E\u786E\u53D1\u8D77\u6210\u4EBA\u6216\u6781\u7AEF\u4E92\u52A8\u524D\uFF0C\u4FDD\u6301\u7B26\u5408\u65E5\u5E38\u793E\u4EA4\u5C3A\u5EA6\u7684\u5168\u5E74\u9F84\u5BF9\u8BDD\u98CE\u683C\u3002

\u2705 \u6B63\u786E\u793A\u4F8B\uFF1A
\u5C0F\u660E\uFF1A\u6211\u5148\u5230\u4E86 / \u8FD9\u5BB6\u5E97\u771F\u4E0D\u9519
\u5C0F\u7EA2\uFF1A\u7B49\u6211\u4E94\u5206\u949F / (\u8BED\u97F3+\u9A6C\u4E0A\u5230\u522B\u6025)
\u5C0F\u660E\uFF1A\u597D / (\u56FE\u7247+\u521A\u62CD\u7684\u5E97\u95E8\u53E3)
\u5C0F\u674E\uFF1A(\u9000\u8FD8+50) / \u6628\u5929\u591A\u7ED9\u7684\u94B1\u9000\u4F60\u5566

\u274C \u9519\u8BEF\u793A\u4F8B\uFF08\u7EDD\u5BF9\u7981\u6B62\uFF09\uFF1A
\u5C0F\u660E\uFF1A(\u8BED\u97F3+\u5185\u5BB9\u6709\u6362\u884C
1. \u7B2C\u4E00\u70B9)
\u5C0F\u7EA2\uFF1A\u754C\u9762\u73B0\u5728\u5E94\u8BE5\u6B63\u5E38\u4E86...`;
        injectedInstruction = `${groupRules}

\u3010\u7528\u6237\u4FE1\u606F\u3011
${userBlock}

${cardScenario ? "\u3010\u573A\u666F\u3011\n" + cardScenario + "\n\n" : ""}${worldBookText ? "\u3010\u4E16\u754C\u4E66\u3011\n" + worldBookText + "\n\n" : ""}\u7FA4\u804A\u5386\u53F2\uFF1A
${smsHistoryText}
${directorNote ? `
[\u5267\u60C5\u5F15\u5BFC] ${directorNote}
` : ""}
${userMsg.trim() ? `${userName}\uFF1A${userMsgClean}` : "[\u4EC5\u6709\u5267\u60C5\u5F15\u5BFC\uFF0C\u65E0\u7528\u6237\u53D1\u8A00\uFF0C\u8BF7\u6309\u5F15\u5BFC\u63A8\u8FDB\u5267\u60C5]"}`;
        systemPrompt = [
          `\u4F60\u540C\u65F6\u626E\u6F14 ${memberList} \u5728\u7FA4\u804A\u300C${groupName}\u300D\u4E2D\u4E0E\u7528\u6237 ${userName} \u5BF9\u8BDD\u3002`,
          `\u3010\u7528\u6237\u4FE1\u606F\u3011
${userBlock}`,
          cardDesc ? `\u3010\u89D2\u8272\u8BBE\u5B9A\u3011
${cardDesc}` : "",
          cardPersonality ? `\u3010\u6027\u683C\u3011
${cardPersonality}` : "",
          cardScenario ? `\u3010\u573A\u666F\u3011
${cardScenario}` : "",
          worldBookText ? `\u3010\u4E16\u754C\u4E66\u3011
${worldBookText}` : "",
          mainChatText ? `\u3010\u4E3B\u7EBF\u6700\u8FD1\u5BF9\u8BDD\u3011
${mainChatText}` : "",
          "",
          `\u8F93\u51FA\u683C\u5F0F\uFF1A\u89D2\u8272\u540D\uFF1A\u6D88\u606F / \u6D88\u606F\uFF08\u6BCF\u4E2A\u89D2\u82720-8\u53E5\uFF0C\u6839\u636E\u4EBA\u8BBE\u548C\u5267\u60C5\u51B3\u5B9A\u662F\u5426\u53D1\u8A00\u53CA\u53D1\u8A00\u6570\u91CF\uFF09`,
          `\u89D2\u8272\u540D\u540E\u53EA\u8DDF\u8BE5\u89D2\u8272\u7684\u8BDD\uFF0C\u4E25\u7981 "(\u89D2\u8272\u540D\uFF1Axxx)" \u8FD9\u79CD\u5D4C\u5957\u3002`,
          `\u89D2\u8272\u53EF\u7A7F\u63D2\u53D1\u8A00\uFF0C\u4E0D\u5FC5\u6240\u6709\u4EBA\u90FD\u8BF4\u8BDD\u3002`,
          "\u7279\u6B8A\u683C\u5F0F\uFF08\u5FC5\u987B\u4E2D\u6587\u4E14\u5355\u884C\u95ED\u5408\uFF09\uFF1A(\u8F6C\u8D26+\u91D1\u989D) (\u6536\u6B3E+\u91D1\u989D) (\u9000\u8FD8+\u91D1\u989D) (\u56FE\u7247+\u63CF\u8FF0) (\u8BED\u97F3+\u5185\u5BB9)\u3002\u6CE8\u610F\uFF1A\u9000\u8FD8\u6307\u62D2\u7EDD\u804A\u5929\u5BF9\u8C61\u8F6C\u8D26\u3002",
          "\u7981\u6B62\u4EFB\u4F55\u6807\u7B7E\u683C\u5F0F\u65C1\u767D\u9009\u9879\u72B6\u6001\u680F\u3002"
        ].filter(Boolean).join("\n\n");
      } else {
        const contextBlockMain = [
          cardScenario ? `\u3010\u573A\u666F\u53C2\u8003\u3011
${cardScenario}` : "",
          cardMesExample ? `\u3010\u5BF9\u8BDD\u793A\u4F8B\u3011
${cardMesExample}` : ""
        ].filter(Boolean).join("\n\n");
        injectedInstruction = `
[\u77ED\u4FE1\u6A21\u5F0F\u6307\u4EE4\u2014\u2014\u6700\u9AD8\u4F18\u5148\u7EA7]
\u5F53\u524D\u89D2\u8272\uFF1A${currentPersona}
\u4EE5${currentPersona}\u7684\u8EAB\u4EFD\u7528\u624B\u673A\u77ED\u4FE1\u65B9\u5F0F\u56DE\u590D\u6B63\u5728\u4E0E\u4F60\u804A\u5929\u7684\u7528\u6237 ${userName}\u3002

\u3010\u7528\u6237\u4FE1\u606F\u3011
${userBlock}

${contextBlockMain ? contextBlockMain + "\n\n" : ""}\u89C4\u5219\uFF1A
- \u53EA\u8F93\u51FA\u77ED\u4FE1\u6587\u5B57\uFF0C3\u52308\u53E5\uFF0C\u6BCF\u53E5\u7528 / \u5206\u9694
- \u7981\u6B62\u65C1\u767D\u5FC3\u7406\u63CF\u5199\u573A\u666F\u63CF\u8FF0\u89D2\u8272\u540D\u524D\u7F00\u6807\u7B7E\u683C\u5F0F
- \u7279\u6B8A\u683C\u5F0F\uFF08\u4E2D\u6587\u5355\u884C\u95ED\u5408\uFF09\uFF1A(\u8F6C\u8D26+\u91D1\u989D) (\u6536\u6B3E+\u91D1\u989D) (\u9000\u8FD8+\u91D1\u989D) (\u56FE\u7247+\u63CF\u8FF0) (\u8BED\u97F3+\u5185\u5BB9)\u3002\u6CE8\u610F\uFF1A\u9000\u8FD8\u6307\u62D2\u7EDD\u804A\u5929\u5BF9\u8C61\u8F6C\u8D26\u3002
- \u4E25\u7981\u82F1\u6587\u683C\u5F0F
- \u5B8C\u5168\u6C89\u6D78\u4E8E\u89D2\u8272\u8BBE\u5B9A\uFF0C\u892A\u53BBAI\u52A9\u624B\u7684\u5BA2\u89C2\u8BED\u6C14
- \u6839\u636E\u7528\u6237\u7684\u5F15\u5BFC\u81EA\u7136\u63A8\u8FDB\u5267\u60C5\uFF0C\u5728\u7528\u6237\u660E\u786E\u53D1\u8D77\u6210\u4EBA\u6216\u6781\u7AEF\u4E92\u52A8\u524D\uFF0C\u4FDD\u6301\u7B26\u5408\u65E5\u5E38\u793E\u4EA4\u5C3A\u5EA6\u7684\u5168\u5E74\u9F84\u5BF9\u8BDD\u98CE\u683C

\u77ED\u4FE1\u5BF9\u8BDD\u5386\u53F2\uFF1A
${smsHistoryText}
${directorNote ? `
[\u5267\u60C5\u5F15\u5BFC] ${directorNote}
` : ""}
${userMsg.trim() ? `${userName}\uFF1A${userMsgClean}
${currentPersona}\uFF1A` : `[\u4EC5\u6709\u5267\u60C5\u5F15\u5BFC\uFF0C\u65E0\u7528\u6237\u53D1\u8A00\uFF0C\u8BF7\u6309\u5F15\u5BFC\u63A8\u8FDB\u5267\u60C5]
${currentPersona}\uFF1A`}`;
        systemPrompt = [
          `\u4F60\u6B63\u5728\u626E\u6F14"${currentPersona}"\u901A\u8FC7\u624B\u673A\u77ED\u4FE1\u4E0E\u7528\u6237 ${userName} \u804A\u5929\u3002`,
          `\u3010\u7528\u6237\u4FE1\u606F\u3011
${userBlock}`,
          cardDesc ? `\u3010\u89D2\u8272\u8BBE\u5B9A\u3011
${cardDesc}` : "",
          cardPersonality ? `\u3010\u6027\u683C\u3011
${cardPersonality}` : "",
          cardScenario ? `\u3010\u573A\u666F\u3011
${cardScenario}` : "",
          cardFirstMes ? `\u3010\u5F00\u573A\u767D\u53C2\u8003\u3011
${cardFirstMes}` : "",
          cardMesExample ? `\u3010\u5BF9\u8BDD\u793A\u4F8B\u3011
${cardMesExample}` : "",
          worldBookText ? `\u3010\u4E16\u754C\u4E66\u3011
${worldBookText}` : "",
          mainChatText ? `\u3010\u4E3B\u7EBF\u6700\u8FD1\u5BF9\u8BDD\u3011
${mainChatText}` : "",
          "",
          "\u53EA\u8F93\u51FA3\u52308\u53E5\u77ED\u4FE1\uFF0C\u6BCF\u53E5\u7528 / \u5206\u9694\uFF0C\u4E0D\u5F97\u4E2D\u9014\u622A\u65AD\u3002",
          "\u7279\u6B8A\u683C\u5F0F\uFF08\u5FC5\u987B\u4E2D\u6587\u5355\u884C\u95ED\u5408\uFF09\uFF1A(\u8F6C\u8D26+\u91D1\u989D) (\u6536\u6B3E+\u91D1\u989D) (\u9000\u8FD8+\u91D1\u989D) (\u56FE\u7247+\u63CF\u8FF0) (\u8BED\u97F3+\u5185\u5BB9)\u3002\u6CE8\u610F\uFF1A\u9000\u8FD8\u6307\u62D2\u7EDD\u804A\u5929\u5BF9\u8C61\u8F6C\u8D26\u3002",
          "\u7981\u6B62\u4EFB\u4F55\u6807\u7B7E\u683C\u5F0F\u65C1\u767D\u9009\u9879\u72B6\u6001\u680F\u3002"
        ].filter(Boolean).join("\n\n");
      }
      const antiFluff = "\u3010\u52A1\u5FC5\u76F4\u63A5\u6309\u683C\u5F0F\u8F93\u51FA\u77ED\u4FE1\u5185\u5BB9\uFF0C\u4E25\u7981\u5728\u5F00\u5934\u8F93\u51FA\u201C\u597D\u7684\u201D\u3001\u201C\u4E0B\u9762\u662F\u201D\u7B49\u4EFB\u4F55\u8BF4\u660E\u6027\u5E9F\u8BDD\uFF0C\u4E25\u7981\u8F93\u51FA\u975E\u89D2\u8272\u7684\u8BED\u8A00\u3002\u3011";
      const targetContactKey = isGroupChat ? currentGroupKey : currentPersona;
      const emojiPrompt = getEmojiPrompt(targetContactKey, getStorageId2(), window.__pmPokeConfig, window.__pmEmojis);
      if (emojiPrompt) {
        systemPrompt += emojiPrompt;
        injectedInstruction += emojiPrompt;
      }
      const wordyPrompt = getWordyPrompt(window.__pmWordyLimit);
      if (wordyPrompt) {
        systemPrompt += wordyPrompt;
        injectedInstruction += wordyPrompt;
      }
      systemPrompt += `

${antiFluff}`;
      injectedInstruction += `

${antiFluff}`;
      try {
        const cfg = window.__pmConfig;
        const useIndep = cfg.useIndependent && cfg.apiUrl && cfg.apiKey;
        let raw = "";
        if (useIndep) {
          const indepUserPrompt = isGroupChat ? `\u3010\u7FA4\u804A\u5386\u53F2\u3011
${smsHistoryText}
${directorNote ? `
[\u5267\u60C5\u5F15\u5BFC] ${directorNote}
` : ""}${userMsg.trim() ? `
${userName}\uFF1A${userMsgClean}` : "\n[\u4EC5\u6709\u5267\u60C5\u5F15\u5BFC\uFF0C\u65E0\u7528\u6237\u53D1\u8A00\uFF0C\u8BF7\u6309\u5F15\u5BFC\u63A8\u8FDB\u5267\u60C5]"}` : `\u3010\u77ED\u4FE1\u5BF9\u8BDD\u5386\u53F2\u3011
${smsHistoryText}
${directorNote ? `
[\u5267\u60C5\u5F15\u5BFC] ${directorNote}
` : ""}${userMsg.trim() ? `
${userName}\uFF1A${userMsgClean}
${currentPersona}\uFF1A` : `
[\u4EC5\u6709\u5267\u60C5\u5F15\u5BFC\uFF0C\u65E0\u7528\u6237\u53D1\u8A00\uFF0C\u8BF7\u6309\u5F15\u5BFC\u63A8\u8FDB\u5267\u60C5]
${currentPersona}\uFF1A`}`;
          raw = await callAI(systemPrompt, indepUserPrompt, { maxTokens: isGroupChat ? 600 : 300 });
        } else {
          raw = await callAI("", injectedInstruction, { maxTokens: isGroupChat ? 600 : 300 });
        }
        let resultData;
        if (isGroupChat) {
          const parsed = parseGroupResponse(raw, groupMembers);
          if (parsed.length) {
            const contentParts = parsed.map((p) => `${p.name}\uFF1A${p.sentences.join(" / ")}`);
            conversationHistory.push({ role: "assistant", content: contentParts.join("\n") });
            resultData = { type: "group", data: parsed };
          } else {
            console.warn("[phone-mode] \u26A0\uFE0F \u7FA4\u804A\u683C\u5F0F\u89E3\u6790\u5931\u8D25\uFF01AI \u539F\u59CB\u8FD4\u56DE\u5185\u5BB9\uFF1A", raw);
            conversationHistory.push({ role: "assistant", content: "\uFF08\u683C\u5F0F\u65E0\u6CD5\u89E3\u6790\u6216AI\u62D2\u7B54\uFF09" });
            const snippet = raw ? raw.substring(0, 20).replace(/\n/g, "") + "..." : "\u7A7A\u54CD\u5E94\u6216\u7EAF\u601D\u8003\u8FC7\u7A0B";
            resultData = {
              type: "group",
              data: [{
                name: "\u7CFB\u7EDF",
                sentences: [`\uFF08\u683C\u5F0F\u89E3\u6790\u5931\u8D25\u3002AI\u539F\u8BDD: ${snippet}\uFF0C\u8BF7\u6309F12\u67E5\u770B\u63A7\u5236\u53F0\u6216\u68C0\u67E5\u662F\u5426\u89E6\u53D1\u4E86\u5B89\u5168\u5BA1\u67E5\uFF09`]
              }]
            };
          }
        } else {
          const clean = cleanResponse(raw);
          let sentences = splitToSentences(clean);
          if (!sentences.length && raw?.trim()) sentences = splitToSentences(raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<[^>]+>/g, ""));
          if (!sentences.length) sentences = !raw?.trim() ? ["\uFF08\u7A7A\u54CD\u5E94\uFF09"] : ["\uFF08\u683C\u5F0F\u65E0\u6CD5\u89E3\u6790\uFF09"];
          conversationHistory.push({ role: "assistant", content: sentences.join(" / ") });
          resultData = { type: "single", data: sentences };
        }
        const id = getStorageId2();
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        window.__pmHistories[id][currentPersona] = conversationHistory.slice(-SAVE_LIMIT);
        saveHistories();
        applyBidirectionalInjection();
        return resultData;
      } catch (e) {
        console.error("[phone-mode]", e);
        return isGroupChat ? { type: "group", data: [{ name: "\u7CFB\u7EDF", sentences: [`\uFF08\u9519\u8BEF\uFF1A${e?.message || e}\uFF09`] }] } : { type: "single", data: [`\uFF08\u9519\u8BEF\uFF1A${e?.message || e}\uFF09`] };
      }
    }
    function addBubble(text, side, senderName, historyIndex) {
      const list = phoneWindow?.querySelector(".pm-msg-list");
      if (!list) return;
      createBubbles(text, side, senderName, {
        groupColorMap,
        groupMembers,
        emojis: window.__pmEmojis
      }).forEach((b) => {
        if (b.classList?.contains("pm-bubble")) {
          b.dataset.side = side;
          b.dataset.text = text;
          if (historyIndex !== void 0) b.dataset.historyIndex = historyIndex;
        } else if (b.classList?.contains("pm-group-bubble-wrap")) {
          b.dataset.side = side;
          b.dataset.text = text;
          if (historyIndex !== void 0) b.dataset.historyIndex = historyIndex;
          const inner = b.querySelector(".pm-bubble");
          if (inner) {
            inner.dataset.side = side;
            inner.dataset.text = text;
            if (historyIndex !== void 0) inner.dataset.historyIndex = historyIndex;
          }
        }
        list.appendChild(b);
      });
      list.scrollTop = list.scrollHeight;
    }
    function addNote(text) {
      const list = phoneWindow?.querySelector(".pm-msg-list");
      if (!list) return;
      const n = document.createElement("div");
      n.className = "pm-note";
      n.textContent = text;
      list.appendChild(n);
      list.scrollTop = list.scrollHeight;
    }
    function addDirector(text) {
      const list = phoneWindow?.querySelector(".pm-msg-list");
      if (!list) return;
      const d = document.createElement("div");
      d.className = "pm-director";
      d.innerHTML = `<span class="pm-director-icon">\u{1F3AC}</span><span class="pm-director-text">${escapeHtml(text)}</span>`;
      list.appendChild(d);
      list.scrollTop = list.scrollHeight;
    }
    function showTyping() {
      const list = phoneWindow?.querySelector(".pm-msg-list");
      if (!list || document.getElementById("pm-typing")) return;
      const t = document.createElement("div");
      t.id = "pm-typing";
      t.className = "pm-bubble pm-left pm-typing-bubble";
      t.innerHTML = "<span></span><span></span><span></span>";
      list.appendChild(t);
      list.scrollTop = list.scrollHeight;
    }
    function hideTyping() {
      document.getElementById("pm-typing")?.remove();
    }
    window.__pmSend = async () => {
      if (isGenerating) return;
      const input = phoneWindow.querySelector(".pm-input");
      const val = input.value.trim();
      if (!val) return;
      input.value = "";
      const EMO_PLACEHOLDER = "";
      const emoSlots = [];
      const valProtected = val.replace(/\[emo:[^\]]+\]/g, (m2) => {
        emoSlots.push(m2);
        return EMO_PLACEHOLDER + (emoSlots.length - 1) + EMO_PLACEHOLDER;
      });
      const DIRECTOR_RE = /[【\[［]([^】\]］]+)[】\]］]/g;
      const directorNotes = [];
      let m;
      DIRECTOR_RE.lastIndex = 0;
      while ((m = DIRECTOR_RE.exec(valProtected)) !== null) directorNotes.push(m[1].trim());
      const directorNote = directorNotes.join("\uFF1B");
      const plainValProtected = valProtected.replace(/[【\[［][^】\]］]*[】\]］]/g, "").trim();
      const plainVal = plainValProtected.replace(new RegExp(EMO_PLACEHOLDER + "(\\d+)" + EMO_PLACEHOLDER, "g"), (_, i) => emoSlots[+i] || "");
      if (directorNote) addDirector(directorNote);
      if (!directorNote && !plainVal) return;
      const protect = plainVal.replace(/[\(（][^)）]+[\)\）]/g, (m2) => m2.replace(/\//g, ""));
      const rawChunks = protect.split(/[/／]/).map((s) => s.replace(/\u0001/g, "/").trim()).filter(Boolean);
      const userBubbles = rawChunks.flatMap((chunk) => {
        const parts = [];
        let lastIdx = 0, m2;
        const emoRe = /\[emo:[^\]]+\]/g;
        while ((m2 = emoRe.exec(chunk)) !== null) {
          const before = chunk.slice(lastIdx, m2.index).trim();
          if (before) parts.push(before);
          parts.push(m2[0]);
          lastIdx = m2.index + m2[0].length;
        }
        const after = chunk.slice(lastIdx).trim();
        if (after) parts.push(after);
        return parts.length ? parts : [chunk];
      });
      const pendingUserBubbles = [];
      userBubbles.forEach((chunk) => {
        addBubble(chunk, "right");
        const list = phoneWindow?.querySelector(".pm-msg-list");
        const allBubbles = list?.querySelectorAll('.pm-bubble[data-side="right"], .pm-group-bubble-wrap[data-side="right"]');
        if (allBubbles?.length) pendingUserBubbles.push(allBubbles[allBubbles.length - 1]);
      });
      isGenerating = true;
      input.disabled = true;
      const btn = phoneWindow.querySelector(".pm-up-btn");
      if (btn) btn.disabled = true;
      showTyping();
      try {
        const result = await fetchSMS(plainVal, directorNote);
        hideTyping();
        const hasUserMsg = !!plainVal.trim();
        const userHi = conversationHistory.length - (hasUserMsg ? 2 : 1);
        pendingUserBubbles.forEach((b) => {
          b.dataset.historyIndex = userHi;
          const inner = b.querySelector(".pm-bubble");
          if (inner) inner.dataset.historyIndex = userHi;
        });
        const aiHi = conversationHistory.length - 1;
        if (result.type === "group") {
          for (const block of result.data) {
            for (const s of block.sentences) {
              await new Promise((r) => setTimeout(r, 120));
              addBubble(s, "left", block.name, aiHi);
            }
          }
        } else {
          for (const s of result.data) {
            await new Promise((r) => setTimeout(r, 150));
            addBubble(s, "left", void 0, aiHi);
          }
        }
        {
          const _id = getStorageId2();
          if (!window.__pmHistories[_id]) window.__pmHistories[_id] = {};
          const _key = isGroupChat && currentGroupKey ? currentGroupKey : currentPersona;
          window.__pmHistories[_id][_key] = conversationHistory.slice(-SAVE_LIMIT);
          saveHistories();
        }
      } catch (e) {
        hideTyping();
        addNote(`\uFF08\u53D1\u9001\u5931\u8D25\uFF1A${e?.message || e}\uFF09`);
        console.error("[phone-mode] __pmSend \u5F02\u5E38", e);
      } finally {
        isGenerating = false;
        input.disabled = false;
        if (btn) btn.disabled = false;
        input.focus();
      }
      setTimeout(() => {
        if (!isGenerating && typeof window.__pmIncrementCounters === "function") {
          window.__pmIncrementCounters();
        }
      }, 300);
    };
    window.__pmShowExpandInput = () => {
      const smallInput = phoneWindow?.querySelector(".pm-input");
      const currentText = smallInput ? smallInput.value : "";
      makeOverlay(`
<div class="pm-modal pm-modal-wide">
  <div class="pm-modal-header" style="justify-content:space-between;padding-right:14px;">
    <b>\u957F\u6587\u672C\u8F93\u5165</b>
    <!-- \u4FEE\u590D\u95EE\u98981\uFF1A\u70B9\u51FB\u53C9\u53F7\u5173\u95ED\u65F6\uFF0C\u5148\u5C06\u957F\u6587\u672C\u540C\u6B65\u56DE\u5C0F\u8F93\u5165\u6846\uFF0C\u518D\u9500\u6BC1\u754C\u9762 -->
    <span onclick="(()=>{ const ta=document.getElementById('pm-expanded-textarea'); const si=document.querySelector('.pm-input'); if(ta && si) si.value=ta.value; document.getElementById('pm-overlay').remove(); })()" class="pm-modal-close">\u2715</span>
  </div>
  <div style="padding:14px 16px;">
    <textarea id="pm-expanded-textarea" class="pm-cfg-input" rows="7"
        style="height:auto; resize:none; font-size:14px; padding:10px; line-height:1.5; font-family:inherit;"
        placeholder="\u5728\u8FD9\u91CC\u8F93\u5165\u591A\u884C\u6587\u672C...">${escapeAttr(currentText)}</textarea>
  </div>
  <div class="pm-modal-add" style="display:flex;gap:8px;">
    <!-- \u4FEE\u590D\u95EE\u98982\uFF1A\u70B9\u5F00\u8868\u60C5\u5305\u524D\uFF0C\u5148\u5C06\u5F53\u524D\u8F93\u5165\u7684\u6587\u672C\u540C\u6B65\u56DE\u5C0F\u8F93\u5165\u6846\uFF0C\u9632\u6B62\u4ECE\u8868\u60C5\u5305\u754C\u9762\u8FD4\u56DE\u65F6\u91CD\u65B0\u8BFB\u53D6\u5230\u65E7\u6570\u636E\u800C\u6E05\u7A7A\u6587\u672C -->
    <button onclick="(()=>{ const ta=document.getElementById('pm-expanded-textarea'); const si=document.querySelector('.pm-input'); if(ta && si) si.value=ta.value; window.__pmShowEmojiPicker(); })()" style="flex:2;background:#f0f0f3;color:#333;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:14px;cursor:pointer;font-weight:600;">(^ ^)</button>
    <button onclick="window.__pmConfirmExpandInput()" style="flex:8;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u53D1\u9001</button>
  </div>
</div>`);
      setTimeout(() => {
        const ta = document.getElementById("pm-expanded-textarea");
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = ta.value.length;
        }
      }, 10);
    };
    window.__pmConfirmExpandInput = () => {
      const ta = document.getElementById("pm-expanded-textarea");
      const smallInput = phoneWindow?.querySelector(".pm-input");
      if (ta && smallInput) {
        smallInput.value = ta.value;
        document.getElementById("pm-overlay")?.remove();
        if (ta.value.trim()) {
          window.__pmSend();
        }
      }
    };
    window.__pmIncrementCounters = () => {
      const id = getStorageId2();
      const configs = window.__pmPokeConfig[id];
      if (!configs) return;
      let updated = false;
      const toPoke = [];
      for (const [contact, config] of Object.entries(configs)) {
        if (config?.autoPoke?.enabled) {
          config.autoPoke.counter = (config.autoPoke.counter || 0) + 1;
          updated = true;
          if (config.autoPoke.counter >= config.autoPoke.interval) {
            config.autoPoke.counter = 0;
            toPoke.push(contact);
          }
        }
      }
      if (updated) {
        savePokeConfig();
        const counterEl = document.getElementById("pm-poke-counter");
        if (counterEl && configs[currentPersona]) counterEl.textContent = configs[currentPersona].autoPoke.counter;
        const groupCounterEl = document.getElementById("pm-poke-counter-group");
        if (groupCounterEl && currentGroupKey && configs[currentGroupKey]) groupCounterEl.textContent = configs[currentGroupKey].autoPoke.counter;
      }
      if (toPoke.length > 0) {
        (async () => {
          for (const contact of toPoke) {
            await window.__pmAutoPoke(contact);
          }
        })();
      }
    };
    window.__pmAutoPoke = async (contactName) => {
      if (isGenerating) return;
      isGenerating = true;
      const id = getStorageId2();
      const groupMeta = window.__pmGroupMeta[id]?.[contactName];
      const isGroup = !!groupMeta;
      const isActiveView = phoneActive && (isGroup && currentGroupKey === contactName || !isGroup && currentPersona === contactName);
      if (isActiveView) {
        const input = phoneWindow?.querySelector(".pm-input");
        const btn = phoneWindow?.querySelector(".pm-up-btn");
        if (input) input.disabled = true;
        if (btn) btn.disabled = true;
        showTyping();
      }
      const ctxData = await gatherContext2();
      const { cardDesc, cardPersonality, cardScenario, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;
      const userBlock = [`\u7528\u6237\u540D\u5B57\uFF1A${userName}`, userDesc ? `\u7528\u6237\u4EBA\u8BBE\uFF1A${userDesc}` : ""].filter(Boolean).join("\n");
      let targetHistory = window.__pmHistories[id]?.[contactName] || [];
      const smsHistoryText = targetHistory.slice(-CONTEXT_LIMIT).map((m) => {
        const clean = cleanResponse(m.content);
        return m.role === "user" ? `${userName}\uFF1A${clean}` : isGroup ? clean : `${contactName}\uFF1A${clean}`;
      }).join("\n");
      const systemPrompt = isGroup ? `\u4F60\u540C\u65F6\u626E\u6F14\u7FA4\u804A\u4E2D\u7684\u6240\u6709\u6210\u5458\u3002
\u3010\u52A1\u5FC5\u76F4\u63A5\u6309\u683C\u5F0F\u8F93\u51FA\u77ED\u4FE1\u5185\u5BB9\uFF0C\u4E25\u7981\u5728\u5F00\u5934\u8F93\u51FA\u201C\u597D\u7684\u201D\u7B49\u5E9F\u8BDD\u3002\u3011` : `\u4F60\u6B63\u5728\u626E\u6F14"${contactName}"\u901A\u8FC7\u624B\u673A\u77ED\u4FE1\u4E0E\u7528\u6237 ${userName} \u804A\u5929\u3002
\u3010\u52A1\u5FC5\u76F4\u63A5\u6309\u683C\u5F0F\u8F93\u51FA\u77ED\u4FE1\u5185\u5BB9\uFF0C\u4E25\u7981\u5728\u5F00\u5934\u8F93\u51FA\u201C\u597D\u7684\u201D\u7B49\u5E9F\u8BDD\u3002\u3011`;
      const emojiPrompt = getEmojiPrompt(contactName, getStorageId2(), window.__pmPokeConfig, window.__pmEmojis);
      const userPrompt = (isGroup ? `\u7FA4\u804A\u540D\u79F0\uFF1A${groupMeta.name}
\u7FA4\u804A\u6210\u5458\uFF1A${groupMeta.members.join("\u3001")}

\u7528\u6237\u6709\u4E00\u6BB5\u65F6\u95F4\u6CA1\u6709\u8BF4\u8BDD\u3002\u8BF7\u4EE5\u6240\u6709\u7FA4\u6210\u5458\u7684\u8EAB\u4EFD\uFF0C\u6839\u636E\u5404\u81EA\u7684\u6027\u683C\u3001\u4EBA\u8BBE\u548C\u5F53\u524D\u804A\u5929\u4E0A\u4E0B\u6587\uFF0C\u81EA\u7136\u5730\u53D1\u8D77\u8BDD\u9898\u6216\u7EE7\u7EED\u804A\u5929\u3002\u6BCF\u4E2A\u6210\u5458\u6839\u636E\u4EBA\u8BBE\u51B3\u5B9A\u53D1\u8A00 0-8 \u53E5\u3002

\u8F93\u51FA\u683C\u5F0F\uFF1A\u89D2\u8272\u540D\uFF1A\u6D88\u606F / \u6D88\u606F

\u3010\u7528\u6237\u4FE1\u606F\u3011
${userBlock}

\u3010\u89D2\u8272\u8BBE\u5B9A\u3011
${cardDesc || ""}

\u3010\u6027\u683C\u3011
${cardPersonality || ""}

\u3010\u573A\u666F\u3011
${cardScenario || ""}

\u3010\u4E16\u754C\u4E66\u3011
${worldBookText || ""}

\u3010\u4E3B\u7EBF\u6700\u8FD1\u5BF9\u8BDD\u3011
${mainChatText || ""}

\u3010\u7FA4\u804A\u5386\u53F2\u3011
${smsHistoryText}` + (emojiPrompt ? emojiPrompt : "") : `\u7528\u6237\u6709\u4E00\u6BB5\u65F6\u95F4\u6CA1\u6709\u56DE\u590D\u3002\u4F5C\u4E3A${contactName}\uFF0C\u6839\u636E\u4F60\u7684\u4EBA\u8BBE\u548C\u5F53\u524D\u804A\u5929\u60C5\u5883\uFF0C\u81EA\u7136\u5730\u53D1\u9001 3-8 \u53E5\u77ED\u4FE1\u7EE7\u7EED\u5BF9\u8BDD\u6216\u53D1\u8D77\u65B0\u8BDD\u9898\uFF0C\u4E0D\u8981\u63D0\u53CA\u7528\u6237\u6CA1\u6709\u56DE\u590D\u8FD9\u4EF6\u4E8B\u3002

\u3010\u7528\u6237\u4FE1\u606F\u3011
${userBlock}

\u3010\u89D2\u8272\u8BBE\u5B9A\u3011
${cardDesc || ""}

\u3010\u6027\u683C\u3011
${cardPersonality || ""}

\u3010\u573A\u666F\u3011
${cardScenario || ""}

\u3010\u5BF9\u8BDD\u793A\u4F8B\u3011
${cardMesExample || ""}

\u3010\u4E16\u754C\u4E66\u3011
${worldBookText || ""}

\u3010\u4E3B\u7EBF\u6700\u8FD1\u5BF9\u8BDD\u3011
${mainChatText || ""}

\u3010\u77ED\u4FE1\u5BF9\u8BDD\u5386\u53F2\u3011
${smsHistoryText}

\u8F93\u51FA\u683C\u5F0F\uFF1A\u77ED\u4FE1\u5185\u5BB9 / \u77ED\u4FE1\u5185\u5BB9\uFF08\u6BCF\u53E5\u7528 / \u5206\u9694\uFF0C\u7279\u6B8A\u683C\u5F0F\u4E2D\u6587\u5355\u884C\u95ED\u5408\uFF09` + (emojiPrompt ? emojiPrompt : "")) + getWordyPrompt(window.__pmWordyLimit);
      try {
        const raw = await callAI(systemPrompt, userPrompt);
        let historyUpdated = false;
        if (isActiveView) hideTyping();
        if (isGroup) {
          const parsed = parseGroupResponse(raw, groupMeta.members);
          const contentParts = [];
          for (const block of parsed) {
            if (block.sentences.length > 0) {
              contentParts.push(`${block.name}\uFF1A${block.sentences.join(" / ")}`);
              if (isActiveView) {
                const _pgHi = targetHistory.length;
                for (const s of block.sentences) {
                  await new Promise((r) => setTimeout(r, 120));
                  addBubble(s, "left", block.name, _pgHi);
                }
              }
            }
          }
          if (contentParts.length > 0) {
            targetHistory.push({ role: "assistant", content: contentParts.join("\n") });
            historyUpdated = true;
          }
        } else {
          const clean = cleanResponse(raw);
          const sentences = splitToSentences(clean);
          if (sentences.length > 0) {
            targetHistory.push({ role: "assistant", content: sentences.join(" / ") });
            historyUpdated = true;
            if (isActiveView) {
              const _pokeHi = targetHistory.length - 1;
              for (const s of sentences) {
                await new Promise((r) => setTimeout(r, 150));
                addBubble(s, "left", void 0, _pokeHi);
                {
                  const _id = getStorageId2();
                  if (!window.__pmHistories[_id]) window.__pmHistories[_id] = {};
                  window.__pmHistories[_id][isGroupChat && currentGroupKey ? currentGroupKey : currentPersona] = targetHistory.slice(-SAVE_LIMIT);
                  saveHistories();
                }
              }
            }
          }
        }
        if (historyUpdated) {
          if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
          const newHistory = targetHistory.slice(-SAVE_LIMIT);
          window.__pmHistories[id][contactName] = newHistory;
          if (isActiveView) {
            conversationHistory = newHistory;
          }
          saveHistories();
          applyBidirectionalInjection();
          if (phoneActive && !isActiveView) {
            addNote(`\u{1F4E9} ${isGroup ? groupMeta.name : contactName} \u53D1\u6765\u4E86\u65B0\u6D88\u606F`);
          }
        }
      } catch (e) {
        if (isActiveView) hideTyping();
        console.error("[phone-mode] \u81EA\u52A8\u53D1\u6D88\u606F\u5931\u8D25", e);
      }
      if (isActiveView) {
        const input = phoneWindow?.querySelector(".pm-input");
        const btn = phoneWindow?.querySelector(".pm-up-btn");
        if (input) input.disabled = false;
        if (btn) btn.disabled = false;
      }
      isGenerating = false;
    };
    function showContactConfig(contactName) {
      const id = getStorageId2();
      const config = window.__pmPokeConfig[id]?.[contactName] || {
        autoPoke: { enabled: false, interval: 3, counter: 0 }
      };
      const assignedEmojis = config.emojis || [];
      const emojiCheckHtml = window.__pmEmojis.length ? `
        <div style="margin-bottom:8px;border-bottom:1px solid #f0f0f0;padding-bottom:14px;">
            <div class="pm-cfg-label" style="margin-bottom:8px;">\u{1F970} \u5141\u8BB8 AI \u4F7F\u7528\u7684\u8868\u60C5\u5305\u5957\u7EC4</div>
            <div style="display:flex;flex-direction:column;gap:10px;max-height:130px;overflow-y:auto;background:#fafafa;border-radius:8px;padding:10px;border:1px solid #eee;">
                ${window.__pmEmojis.map((set) => `
                    <div style="display:flex;align-items:center;gap:10px;cursor:pointer;"
                         onclick="this.querySelector('.pm-emoji-assign-check').classList.toggle('is-checked')">
                        <div class="pm-custom-check pm-bi-style pm-emoji-assign-check ${assignedEmojis.includes(set.id) ? "is-checked" : ""}"
                             data-id="${escapeAttr(set.id)}"
                             style="width:20px;height:20px;min-width:20px;flex-shrink:0;margin-bottom:0;"></div>
                        <span style="font-size:13px;color:#333;">${escapeHtml(set.name)}</span>
                        <span style="color:#aaa;font-size:11px;margin-left:auto;">(${set.images.length}\u5F20)</span>
                    </div>
                `).join("")}
            </div>
            <div style="font-size:11px;color:#aaa;margin-top:4px;">\u52FE\u9009\u540E AI \u4F1A\u77E5\u9053\u5982\u4F55\u4F7F\u7528\u8FD9\u4E9B\u8868\u60C5</div>
        </div>` : "";
      makeOverlay(`
    <div class="pm-modal pm-modal-wide">
    <div class="pm-modal-header">
        <b>${escapeHtml(contactName)} \u8BBE\u7F6E</b>
        <span onclick="window.__pmSaveAndCloseContactConfig('${safeJS(contactName)}')" class="pm-modal-close">\u2715</span>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:8px;">
        ${emojiCheckHtml}
        <div style="margin-top:-6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:600;">\u23F0 \u81EA\u52A8\u53D1\u6D88\u606F</span>
            <div onclick="window.__pmToggleAutoPoke('${safeJS(contactName)}')"
                class="pm-custom-check pm-bi-style ${config.autoPoke.enabled ? "is-checked" : ""}"
                id="pm-poke-check"
                style="cursor:pointer;width:22px;height:22px;min-width:22px;min-height:22px;flex-shrink:0;border-radius:50%;">
            </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;color:#888;">\u6BCF\u9694</span>
            <input id="pm-poke-interval" type="number" min="1" max="99"
                value="${config.autoPoke.interval}"
                style="width:50px;border:1px solid #ddd;border-radius:6px;padding:4px 8px;font-size:13px;text-align:center;"
                ${!config.autoPoke.enabled ? "disabled" : ""}>
            <span style="font-size:12px;color:#888;">\u8F6E\u65E0\u8F93\u5165\u4E3B\u52A8\u53D1\u6D88\u606F</span>
        </div>
        <div style="font-size:11px;color:#999;margin-top:4px;">
            \u5F53\u524D\u8BA1\u6570\uFF1A<span id="pm-poke-counter">${config.autoPoke.counter}</span> / ${config.autoPoke.interval}
        </div>
        </div>
        <div style="margin-top:4px;">
        <button onclick="window.__pmPoke('${safeJS(contactName)}')"
                style="width:100%;background:linear-gradient(135deg,#ff9500,#ff6b00);color:#fff;border:none;border-radius:12px;padding:14px;font-size:14px;cursor:pointer;font-weight:600;display:flex;align-items:center;justify-content:center;">
            \u62CD\u4E00\u62CD
        </button>
        </div>
    </div>
    </div>`);
    }
    window.__pmSaveAndCloseContactConfig = (contactName) => {
      const checkEl = document.getElementById("pm-poke-check");
      const intervalEl = document.getElementById("pm-poke-interval");
      const emojiChecks = document.querySelectorAll(".pm-emoji-assign-check.is-checked");
      const selectedEmojis = Array.from(emojiChecks).map((cb) => cb.dataset.id);
      if (checkEl && intervalEl) {
        const id = getStorageId2();
        if (!window.__pmPokeConfig[id]) window.__pmPokeConfig[id] = {};
        const enabled = checkEl.classList.contains("is-checked");
        const interval = parseInt(intervalEl.value) || 3;
        const oldCounter = window.__pmPokeConfig[id][contactName]?.autoPoke?.counter || 0;
        window.__pmPokeConfig[id][contactName] = {
          autoPoke: {
            enabled,
            interval: Math.max(1, Math.min(99, interval)),
            counter: enabled ? Math.min(oldCounter, interval - 1) : oldCounter
          },
          emojis: selectedEmojis
        };
        savePokeConfig();
      }
      document.getElementById("pm-overlay")?.remove();
      addNote(`\u5DF2\u4FDD\u5B58 ${contactName} \u7684\u8BBE\u7F6E`);
    };
    window.__pmToggleWordyLimit = () => {
      window.__pmWordyLimit = !window.__pmWordyLimit;
      saveWordyLimit();
      const el = document.getElementById("pm-wordy-check");
      if (el) el.classList.toggle("is-checked", window.__pmWordyLimit);
    };
    window.__pmToggleAutoPoke = (contactName) => {
      const checkEl = document.getElementById("pm-poke-check");
      const intervalEl = document.getElementById("pm-poke-interval");
      if (!checkEl) return;
      const isChecked = checkEl.classList.toggle("is-checked");
      if (intervalEl) intervalEl.disabled = !isChecked;
    };
    window.__pmPoke = async (contactName) => {
      if (isGenerating) return;
      const id = getStorageId2();
      if (window.__pmPokeConfig[id]?.[contactName]) {
        window.__pmPokeConfig[id][contactName].autoPoke.counter = 0;
        savePokeConfig();
      }
      document.getElementById("pm-overlay")?.remove();
      if (currentPersona !== contactName) {
        window.__pmSwitchContact(contactName);
      }
      isGenerating = true;
      const input = phoneWindow?.querySelector(".pm-input");
      const btn = phoneWindow?.querySelector(".pm-up-btn");
      if (input) input.disabled = true;
      if (btn) btn.disabled = true;
      showTyping();
      const ctxData = await gatherContext2();
      const { cardDesc, cardPersonality, cardScenario, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;
      const userBlock = [
        `\u7528\u6237\u540D\u5B57\uFF1A${userName}`,
        userDesc ? `\u7528\u6237\u4EBA\u8BBE\uFF1A${userDesc}` : ""
      ].filter(Boolean).join("\n");
      const smsHistoryText = conversationHistory.slice(-CONTEXT_LIMIT).map((m) => {
        const clean = cleanResponse(m.content);
        return m.role === "user" ? `${userName}\uFF1A${clean}` : isGroupChat ? clean : `${contactName}\uFF1A${clean}`;
      }).join("\n");
      const systemPrompt = isGroupChat ? `\u4F60\u540C\u65F6\u626E\u6F14\u7FA4\u804A\u4E2D\u7684\u6240\u6709\u6210\u5458\u3002
\u3010\u52A1\u5FC5\u76F4\u63A5\u6309\u683C\u5F0F\u8F93\u51FA\u77ED\u4FE1\u5185\u5BB9\uFF0C\u4E25\u7981\u5728\u5F00\u5934\u8F93\u51FA\u201C\u597D\u7684\u201D\u7B49\u5E9F\u8BDD\u3002\u3011` : `\u4F60\u6B63\u5728\u626E\u6F14"${contactName}"\u901A\u8FC7\u624B\u673A\u77ED\u4FE1\u4E0E\u7528\u6237 ${userName} \u804A\u5929\u3002
\u3010\u52A1\u5FC5\u76F4\u63A5\u6309\u683C\u5F0F\u8F93\u51FA\u77ED\u4FE1\u5185\u5BB9\uFF0C\u4E25\u7981\u5728\u5F00\u5934\u8F93\u51FA\u201C\u597D\u7684\u201D\u7B49\u5E9F\u8BDD\u3002\u3011`;
      const targetContactKey = isGroupChat ? currentGroupKey : contactName;
      const emojiPrompt = getEmojiPrompt(targetContactKey, getStorageId2(), window.__pmPokeConfig, window.__pmEmojis);
      const userPrompt = isGroupChat ? `\u7FA4\u804A\u540D\u79F0\uFF1A${groupDisplayName || "\u7FA4\u804A"}
\u7FA4\u804A\u6210\u5458\uFF1A${groupMembers.join("\u3001")}

\u8BF7\u4EE5\u6240\u6709\u7FA4\u6210\u5458\u7684\u8EAB\u4EFD\uFF0C\u6839\u636E\u5404\u81EA\u7684\u6027\u683C\u548C\u5F53\u524D\u804A\u5929\u4E0A\u4E0B\u6587\uFF0C\u81EA\u7136\u5730\u53D1\u8D77\u8BDD\u9898\u6216\u7EE7\u7EED\u804A\u5929\u3002\u6BCF\u4E2A\u6210\u5458\u6839\u636E\u4EBA\u8BBE\u51B3\u5B9A\u53D1\u8A00 0-8 \u53E5\u3002

\u8F93\u51FA\u683C\u5F0F\uFF1A\u89D2\u8272\u540D\uFF1A\u6D88\u606F\u5185\u5BB9 / \u6D88\u606F\u5185\u5BB9

\u3010\u7528\u6237\u4FE1\u606F\u3011
${userBlock}

\u3010\u89D2\u8272\u8BBE\u5B9A\u3011
${cardDesc || ""}

\u3010\u6027\u683C\u3011
${cardPersonality || ""}

\u3010\u573A\u666F\u3011
${cardScenario || ""}

\u3010\u4E16\u754C\u4E66\u3011
${worldBookText || ""}

\u3010\u4E3B\u7EBF\u6700\u8FD1\u5BF9\u8BDD\u3011
${mainChatText || ""}

\u3010\u7FA4\u804A\u5386\u53F2\u3011
${smsHistoryText}` : `\u4F5C\u4E3A${contactName}\uFF0C\u6839\u636E\u4F60\u7684\u4EBA\u8BBE\u3001\u6027\u683C\u548C\u5F53\u524D\u804A\u5929\u60C5\u5883\uFF0C\u81EA\u7136\u5730\u53D1\u9001 3-8 \u53E5\u77ED\u4FE1\uFF0C\u4E0D\u8981\u63D0\u53CA\u4EFB\u4F55\u5916\u90E8\u89E6\u53D1\uFF0C\u5C31\u50CF\u4F60\u81EA\u5DF1\u7A81\u7136\u60F3\u53D1\u6D88\u606F\u4E00\u6837\u3002

\u3010\u7528\u6237\u4FE1\u606F\u3011
${userBlock}

\u3010\u89D2\u8272\u8BBE\u5B9A\u3011
${cardDesc || ""}

\u3010\u6027\u683C\u3011
${cardPersonality || ""}

\u3010\u573A\u666F\u3011
${cardScenario || ""}

\u3010\u5BF9\u8BDD\u793A\u4F8B\u3011
${cardMesExample || ""}

\u3010\u4E16\u754C\u4E66\u3011
${worldBookText || ""}

\u3010\u4E3B\u7EBF\u6700\u8FD1\u5BF9\u8BDD\u3011
${mainChatText || ""}

\u3010\u77ED\u4FE1\u5BF9\u8BDD\u5386\u53F2\u3011
${smsHistoryText}

\u8F93\u51FA\u683C\u5F0F\uFF1A\u77ED\u4FE1\u5185\u5BB9 / \u77ED\u4FE1\u5185\u5BB9\uFF08\u6BCF\u53E5\u7528 / \u5206\u9694\uFF0C\u7279\u6B8A\u683C\u5F0F\u4E2D\u6587\u5355\u884C\u95ED\u5408\uFF09` + (emojiPrompt ? emojiPrompt : "") + getWordyPrompt(window.__pmWordyLimit);
      try {
        const raw = await callAI(systemPrompt, userPrompt);
        let historyUpdated = false;
        hideTyping();
        if (isGroupChat) {
          const parsed = parseGroupResponse(raw, groupMembers);
          const contentParts = [];
          for (const block of parsed) {
            if (block.sentences.length > 0) {
              contentParts.push(`${block.name}\uFF1A${block.sentences.join(" / ")}`);
              for (const s of block.sentences) {
                await new Promise((r) => setTimeout(r, 120));
                addBubble(s, "left", block.name);
              }
            }
          }
          if (contentParts.length > 0) {
            conversationHistory.push({ role: "assistant", content: contentParts.join("\n") });
            historyUpdated = true;
          }
        } else {
          const clean = cleanResponse(raw);
          const sentences = splitToSentences(clean);
          if (sentences.length > 0) {
            conversationHistory.push({ role: "assistant", content: sentences.join(" / ") });
            historyUpdated = true;
            for (const s of sentences) {
              await new Promise((r) => setTimeout(r, 150));
              addBubble(s, "left");
            }
          }
        }
        if (historyUpdated) {
          const id2 = getStorageId2();
          if (!window.__pmHistories[id2]) window.__pmHistories[id2] = {};
          const saveKey = isGroupChat && currentGroupKey ? currentGroupKey : currentPersona;
          window.__pmHistories[id2][saveKey] = conversationHistory.slice(-SAVE_LIMIT);
          saveHistories();
          applyBidirectionalInjection();
        }
      } catch (e) {
        hideTyping();
        addNote(`\uFF08\u53D1\u9001\u5931\u8D25\uFF1A${e?.message || e}\uFF09`);
      }
      if (input) input.disabled = false;
      if (btn) btn.disabled = false;
      isGenerating = false;
    };
    window.__pmEditGroup = () => {
      if (!isGroupChat) {
        showContactConfig(currentPersona);
      } else {
        showGroupForm("edit", groupDisplayName, groupMembers);
      }
    };
    function showGroupForm(mode, existingName, existingMembers) {
      document.getElementById("pm-overlay")?.remove();
      const title = mode === "create" ? "\u65B0\u5EFA\u7FA4\u804A" : "\u7F16\u8F91\u7FA4\u804A";
      const initName = existingName || "";
      const initMembers = (existingMembers || []).join(" / ");
      const closeAction = mode === "create" ? "window.__pmShowList()" : "window.__pmSaveAndCloseGroupEdit()";
      let pokeConfig = { enabled: false, interval: 3, counter: 0 };
      let assignedEmojis = [];
      if (mode === "edit" && currentGroupKey) {
        const id = getStorageId2();
        pokeConfig = window.__pmPokeConfig[id]?.[currentGroupKey]?.autoPoke || pokeConfig;
        assignedEmojis = window.__pmPokeConfig[id]?.[currentGroupKey]?.emojis || [];
      }
      const emojiCheckHtml = window.__pmEmojis.length ? `
        <div style="padding-top:12px;border-top:1px solid #f0f0f0;">
            <div class="pm-cfg-label" style="margin-bottom:8px;">\u{1F970} \u5141\u8BB8 AI \u4F7F\u7528\u7684\u8868\u60C5\u5305\u5957\u7EC4</div>
            <div style="display:flex;flex-direction:column;gap:10px;max-height:120px;overflow-y:auto;background:#fafafa;border-radius:8px;padding:10px;border:1px solid #eee;">
                ${window.__pmEmojis.map((set) => `
                    <div style="display:flex;align-items:center;gap:10px;cursor:pointer;"
                         onclick="this.querySelector('.pm-emoji-assign-check').classList.toggle('is-checked')">
                        <div class="pm-custom-check pm-bi-style pm-emoji-assign-check ${assignedEmojis.includes(set.id) ? "is-checked" : ""}"
                             data-id="${escapeAttr(set.id)}"
                             style="width:20px;height:20px;min-width:20px;flex-shrink:0;margin-bottom:0;"></div>
                        <span style="font-size:13px;color:#333;">${escapeHtml(set.name)}</span>
                        <span style="color:#aaa;font-size:11px;margin-left:auto;">(${set.images.length}\u5F20)</span>
                    </div>
                `).join("")}
            </div>
        </div>` : "";
      makeOverlay(`
    <div class="pm-modal pm-modal-wide">
    <div class="pm-modal-header"><b>${title}</b><span onclick="${closeAction}" class="pm-modal-close">\u2715</span></div>
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
        <div class="pm-cfg-label">\u7FA4\u804A\u540D\u79F0</div>
        <input id="pm-group-name-input" class="pm-cfg-input" placeholder="\u7ED9\u7FA4\u804A\u8D77\u4E2A\u540D\u5B57" value="${escapeAttr(initName)}" maxlength="30">
        <div class="pm-cfg-label" style="margin-top:4px;">\u6210\u5458\uFF08\u7528 / \u5206\u9694\uFF09</div>
        <input id="pm-group-input" class="pm-cfg-input" placeholder="\u89D2\u8272A / \u89D2\u8272B / \u89D2\u8272C" oninput="window.__pmGroupInputChanged()" value="${escapeAttr(initMembers)}">
        <div id="pm-group-counter" class="pm-cfg-tip" style="text-align:left;font-weight:600;">0/${MAX_GROUP_MEMBERS - 1} \u4E2A\u89D2\u8272</div>
        <div id="pm-group-preview" style="display:flex;flex-wrap:wrap;gap:4px;"></div>

        ${mode === "edit" ? `
        ${emojiCheckHtml}
        <div style="margin-top:0px;padding-top:8px;border-top:1px solid #f0f0f0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:600;">\u23F0 \u81EA\u52A8\u53D1\u6D88\u606F</span>
            <div onclick="window.__pmToggleAutoPokeGroup()"
                class="pm-custom-check pm-bi-style ${pokeConfig.enabled ? "is-checked" : ""}"
                id="pm-poke-check-group"
                style="cursor:pointer;width:22px;height:22px;min-width:22px;min-height:22px;flex-shrink:0;border-radius:50%;">
            </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:12px;color:#888;">\u6BCF\u9694</span>
            <input id="pm-poke-interval-group" type="number" min="1" max="99"
                value="${pokeConfig.interval}"
                style="width:50px;border:1px solid #ddd;border-radius:6px;padding:4px 8px;font-size:13px;text-align:center;"
                ${!pokeConfig.enabled ? "disabled" : ""}>
            <span style="font-size:12px;color:#888;">\u8F6E\u65E0\u8F93\u5165\u4E3B\u52A8\u53D1\u6D88\u606F</span>
        </div>
        <div style="font-size:11px;color:#999;margin-top:4px;">
            \u5F53\u524D\u8BA1\u6570\uFF1A<span id="pm-poke-counter-group">${pokeConfig.counter}</span> / ${pokeConfig.interval}
        </div>
        <div style="margin-top:12px;">
            <button onclick="window.__pmPokeGroup()"
                    style="width:100%;background:linear-gradient(135deg,#ff9500,#ff6b00);color:#fff;border:none;border-radius:12px;padding:14px;font-size:14px;cursor:pointer;font-weight:600;display:flex;align-items:center;justify-content:center;">
            \u62CD\u4E00\u62CD
            </button>
        </div>
        </div>
        ` : ""}
    </div>
    ${mode === "create" ? `
    <div class="pm-modal-add">
        <button onclick="window.__pmConfirmGroup('${safeJS(mode)}')" style="flex:1;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u521B\u5EFA</button>
    </div>` : ""}
    </div>`);
      setTimeout(() => window.__pmGroupInputChanged(), 0);
    }
    window.__pmToggleAutoPokeGroup = () => {
      const checkEl = document.getElementById("pm-poke-check-group");
      const intervalEl = document.getElementById("pm-poke-interval-group");
      if (!checkEl) return;
      const isChecked = checkEl.classList.toggle("is-checked");
      if (intervalEl) intervalEl.disabled = !isChecked;
    };
    window.__pmPokeGroup = async () => {
      if (!isGroupChat || !currentGroupKey) return;
      if (isGenerating) return;
      const id = getStorageId2();
      if (window.__pmPokeConfig[id]?.[currentGroupKey]) {
        window.__pmPokeConfig[id][currentGroupKey].autoPoke.counter = 0;
        savePokeConfig();
      }
      document.getElementById("pm-overlay")?.remove();
      isGenerating = true;
      const input = phoneWindow?.querySelector(".pm-input");
      const btn = phoneWindow?.querySelector(".pm-up-btn");
      if (input) input.disabled = true;
      if (btn) btn.disabled = true;
      showTyping();
      const ctxData = await gatherContext2();
      const { cardDesc, cardPersonality, cardScenario, mainChatText, worldBookText, userName, userDesc } = ctxData;
      const userBlock = [
        `\u7528\u6237\u540D\u5B57\uFF1A${userName}`,
        userDesc ? `\u7528\u6237\u4EBA\u8BBE\uFF1A${userDesc}` : ""
      ].filter(Boolean).join("\n");
      const smsHistoryText = conversationHistory.slice(-CONTEXT_LIMIT).map((m) => {
        const clean = cleanResponse(m.content);
        return m.role === "user" ? `${userName}\uFF1A${clean}` : clean;
      }).join("\n");
      const systemPrompt = `\u4F60\u540C\u65F6\u626E\u6F14\u7FA4\u804A\u4E2D\u7684\u6240\u6709\u6210\u5458\u3002
\u3010\u52A1\u5FC5\u76F4\u63A5\u6309\u683C\u5F0F\u8F93\u51FA\u77ED\u4FE1\u5185\u5BB9\uFF0C\u4E25\u7981\u5728\u5F00\u5934\u8F93\u51FA\u201C\u597D\u7684\u201D\u7B49\u5E9F\u8BDD\u3002\u3011`;
      const userPrompt = `\u7FA4\u804A\u540D\u79F0\uFF1A${groupDisplayName || "\u7FA4\u804A"}
\u7FA4\u804A\u6210\u5458\uFF1A${groupMembers.join("\u3001")}

\u8BF7\u4EE5\u6BCF\u4E2A\u7FA4\u6210\u5458\u7684\u8EAB\u4EFD\uFF0C\u6839\u636E\u5404\u81EA\u7684\u6027\u683C\u3001\u4EBA\u8BBE\u548C\u5F53\u524D\u804A\u5929\u4E0A\u4E0B\u6587\uFF0C\u81EA\u7136\u5730\u53D1\u8D77\u8BDD\u9898\u6216\u7EE7\u7EED\u804A\u5929\uFF0C\u4E0D\u8981\u63D0\u53CA\u4EFB\u4F55\u5916\u90E8\u89E6\u53D1\u3002
\u6BCF\u4E2A\u6210\u5458\u6839\u636E\u81EA\u5DF1\u7684\u5224\u65AD\u9009\u62E9\u53D1\u8A00 0-8 \u6761\u3002

\u8F93\u51FA\u683C\u5F0F\uFF1A\u89D2\u8272\u540D\uFF1A\u6D88\u606F\u5185\u5BB9 / \u6D88\u606F\u5185\u5BB9

\u3010\u7528\u6237\u4FE1\u606F\u3011
${userBlock}

\u3010\u89D2\u8272\u8BBE\u5B9A\u3011
${cardDesc || ""}

\u3010\u6027\u683C\u3011
${cardPersonality || ""}

\u3010\u573A\u666F\u3011
${cardScenario || ""}

\u3010\u4E16\u754C\u4E66\u3011
${worldBookText || ""}

\u3010\u4E3B\u7EBF\u6700\u8FD1\u5BF9\u8BDD\u3011
${mainChatText || ""}

\u3010\u7FA4\u804A\u5386\u53F2\u3011
${smsHistoryText}` + (getEmojiPrompt(currentGroupKey, getStorageId2(), window.__pmPokeConfig, window.__pmEmojis) || "") + getWordyPrompt(window.__pmWordyLimit);
      try {
        const raw = await callAI(systemPrompt, userPrompt);
        hideTyping();
        const parsed = parseGroupResponse(raw, groupMembers);
        const contentParts = [];
        for (const block of parsed) {
          if (block.sentences.length > 0) {
            contentParts.push(`${block.name}\uFF1A${block.sentences.join(" / ")}`);
            for (const s of block.sentences) {
              await new Promise((r) => setTimeout(r, 120));
              addBubble(s, "left", block.name, conversationHistory.length);
            }
            conversationHistory.push({ role: "assistant", content: contentParts[contentParts.length - 1] });
            {
              const _id = getStorageId2();
              if (!window.__pmHistories[_id]) window.__pmHistories[_id] = {};
              const _key = isGroupChat && currentGroupKey ? currentGroupKey : currentPersona;
              window.__pmHistories[_id][_key] = conversationHistory.slice(-SAVE_LIMIT);
              saveHistories();
            }
          }
        }
        if (contentParts.length > 0) {
          applyBidirectionalInjection();
        }
      } catch (e) {
        hideTyping();
        addNote(`\uFF08\u53D1\u9001\u5931\u8D25\uFF1A${e?.message || e}\uFF09`);
      }
      if (input) input.disabled = false;
      if (btn) btn.disabled = false;
      isGenerating = false;
    };
    window.__pmSaveAndCloseGroupEdit = () => {
      const nameInput = document.getElementById("pm-group-name-input");
      const memInput = document.getElementById("pm-group-input");
      if (nameInput && memInput && currentGroupKey) {
        const groupName = nameInput.value.trim();
        const names = memInput.value.split(/[/／]/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_GROUP_MEMBERS - 1);
        if (groupName && names.length >= 2) {
          const id = getStorageId2();
          if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
          window.__pmGroupMeta[id][currentGroupKey] = { name: groupName, members: names };
          saveGroupMeta();
          groupMembers = names;
          groupDisplayName = groupName;
          groupColorMap = {};
          names.forEach((n, i) => {
            groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length];
          });
        }
        const checkEl = document.getElementById("pm-poke-check-group");
        const intervalEl = document.getElementById("pm-poke-interval-group");
        const emojiChecks = document.querySelectorAll(".pm-emoji-assign-check.is-checked");
        const selectedEmojis = Array.from(emojiChecks).map((cb) => cb.dataset.id);
        if (checkEl && intervalEl) {
          const id = getStorageId2();
          if (!window.__pmPokeConfig[id]) window.__pmPokeConfig[id] = {};
          const enabled = checkEl.classList.contains("is-checked");
          const interval = parseInt(intervalEl.value) || 3;
          const oldCounter = window.__pmPokeConfig[id][currentGroupKey]?.autoPoke?.counter || 0;
          window.__pmPokeConfig[id][currentGroupKey] = {
            autoPoke: {
              enabled,
              interval: Math.max(1, Math.min(99, interval)),
              counter: enabled ? Math.min(oldCounter, interval - 1) : oldCounter
            },
            emojis: selectedEmojis
          };
          savePokeConfig();
        }
      }
      document.getElementById("pm-overlay")?.remove();
      if (phoneWindow && currentGroupKey) {
        window.__pmSwitch(currentGroupKey);
      }
    };
    window.__pmShowGroupCreate = () => showGroupForm("create");
    window.__pmGroupInputChanged = () => {
      const input = document.getElementById("pm-group-input");
      const counter = document.getElementById("pm-group-counter");
      const preview = document.getElementById("pm-group-preview");
      if (!input) return;
      const names = input.value.split(/[/／]/).map((s) => s.trim()).filter(Boolean);
      const max = MAX_GROUP_MEMBERS - 1;
      const count = Math.min(names.length, max);
      const over = names.length > max;
      counter.textContent = `${count}/${max} \u4E2A\u89D2\u8272${over ? " \u26A0\uFE0F \u8D85\u51FA\u4E0A\u9650" : ""}`;
      counter.style.color = over ? "#ff3b30" : "#b87a00";
      preview.innerHTML = names.slice(0, max).map((n, i) => {
        const gc = GROUP_COLORS[i % GROUP_COLORS.length];
        return `<span style="background:${gc.bg};color:${gc.text};padding:3px 8px;border-radius:10px;font-size:11px;">${escapeHtml(n)}</span>`;
      }).join("");
    };
    window.__pmConfirmGroup = (mode) => {
      const nameInput = document.getElementById("pm-group-name-input");
      const memInput = document.getElementById("pm-group-input");
      if (!nameInput || !memInput) return;
      const groupName = nameInput.value.trim();
      const names = memInput.value.split(/[/／]/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_GROUP_MEMBERS - 1);
      if (!groupName) {
        alert("\u8BF7\u8F93\u5165\u7FA4\u804A\u540D\u79F0");
        return;
      }
      if (names.length < 2) {
        alert("\u81F3\u5C11\u9700\u8981 2 \u4E2A\u89D2\u8272");
        return;
      }
      document.getElementById("pm-overlay")?.remove();
      const id = getStorageId2();
      if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
      if (mode === "create") {
        const groupKey = `__group_${Date.now()}`;
        const _prevSaveKey = isGroupChat && currentGroupKey ? currentGroupKey : currentPersona;
        window.__pmGroupMeta[id][groupKey] = { name: groupName, members: names };
        saveGroupMeta();
        isGroupChat = true;
        groupMembers = names;
        groupDisplayName = groupName;
        currentGroupKey = groupKey;
        groupColorMap = {};
        names.forEach((n, i) => {
          groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length];
        });
        window.__pmSwitch(groupKey, _prevSaveKey);
      } else {
        if (!currentGroupKey) return;
        window.__pmGroupMeta[id][currentGroupKey] = { name: groupName, members: names };
        saveGroupMeta();
        groupMembers = names;
        groupDisplayName = groupName;
        groupColorMap = {};
        names.forEach((n, i) => {
          groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length];
        });
        window.__pmSwitch(currentGroupKey);
      }
    };
    window.__pmSetDarkMode = (mode) => {
      window.__pmTheme.darkMode = mode;
      saveTheme();
      if (phoneWindow) {
        phoneWindow.setAttribute("data-theme", mode);
      }
      document.querySelectorAll(".pm-layout-chip").forEach((el) => {
        if (el.textContent.includes("\u65E5\u95F4") || el.textContent.includes("\u591C\u95F4")) {
          el.classList.toggle(
            "pm-layout-active",
            mode === "light" && el.textContent.includes("\u65E5\u95F4") || mode === "dark" && el.textContent.includes("\u591C\u95F4")
          );
        }
      });
    };
    window.__pmExportData = () => {
      const data = {
        histories: window.__pmHistories || {},
        config: window.__pmConfig || {},
        theme: window.__pmTheme || {},
        profiles: window.__pmProfiles || [],
        groupMeta: window.__pmGroupMeta || {},
        pokeConfig: window.__pmPokeConfig || {},
        bidirectional: window.__pmBidirectional || {},
        emojis: window.__pmEmojis || []
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PhoneMode_Backup_${(/* @__PURE__ */ new Date()).getTime()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      alert("\u2705 \u77ED\u4FE1\u5907\u4EFD\u5DF2\u6210\u529F\u5BFC\u51FA\uFF01");
    };
    window.__pmImportData = (input) => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.histories) window.__pmHistories = data.histories;
          if (data.config) window.__pmConfig = data.config;
          if (data.theme) window.__pmTheme = data.theme;
          if (data.profiles) window.__pmProfiles = data.profiles;
          if (data.groupMeta) window.__pmGroupMeta = data.groupMeta;
          if (data.pokeConfig) window.__pmPokeConfig = data.pokeConfig;
          if (data.bidirectional) window.__pmBidirectional = data.bidirectional;
          if (data.emojis) {
            window.__pmEmojis = data.emojis;
            saveEmojis();
          }
          saveHistories();
          try {
            localStorage.setItem("ST_SMS_CONFIG", JSON.stringify(window.__pmConfig));
          } catch (err) {
          }
          saveTheme();
          saveGroupMeta();
          try {
            localStorage.setItem("ST_SMS_POKE_CONFIG", JSON.stringify(window.__pmPokeConfig));
          } catch (err) {
          }
          try {
            localStorage.setItem("ST_SMS_BIDIRECTIONAL", JSON.stringify(window.__pmBidirectional));
          } catch (err) {
          }
          alert("\u2705 \u6570\u636E\u5BFC\u5165\u6210\u529F\uFF01\u8BF7\u91CD\u65B0\u6253\u5F00\u77ED\u4FE1\u754C\u9762\u751F\u6548\u3002");
          document.getElementById("pm-overlay")?.remove();
          window.__pmEnd();
        } catch (err) {
          alert("\u274C \u5BFC\u5165\u5931\u8D25\uFF0C\u6587\u4EF6\u683C\u5F0F\u4E0D\u6B63\u786E\uFF01\n" + err.message);
        }
      };
      reader.readAsText(file);
      input.value = "";
    };
    window.__pmShowConfig = async () => {
      loadProfiles();
      loadTheme();
      await loadBgSettings();
      const cfg = window.__pmConfig, t = window.__pmTheme;
      const shortUrl = (u) => (u || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const maskKey = (k) => !k ? "" : k.length <= 8 ? "****" : k.slice(0, 4) + "****" + k.slice(-4);
      const profilesHtml = window.__pmProfiles.length > 0 ? window.__pmProfiles.map((p, i) => `<div class="pm-prof-li"><div class="pm-prof-info" onclick="window.__pmPickProfile(${i})"><div class="pm-prof-url">${escapeHtml(shortUrl(p.apiUrl))}</div><div class="pm-prof-meta">${escapeHtml(maskKey(p.apiKey))}${p.model ? " \xB7 " + escapeHtml(p.model) : ""}</div></div><i class="pm-prof-del" onclick="window.__pmDeleteProfile(${i})">\u2715</i></div>`).join("") : '<div class="pm-prof-empty">\u6682\u65E0\u6863\u6848</div>';
      const useIndep = !!cfg.useIndependent;
      const presetBtns = Object.entries(THEME_PRESETS).map(
        ([k, v]) => `<div class="pm-theme-chip ${t.preset === k ? "pm-theme-active" : ""}" data-preset="${k}" onclick="window.__pmSetPreset('${safeJS(k)}')"><span class="pm-theme-dot" style="background:${v.right}"></span>${v.label}</div>`
      ).join("");
      const layoutBtns = ["standard", "relaxed"].map(
        (v) => `<div class="pm-layout-chip ${t.layout === v ? "pm-layout-active" : ""}" onclick="window.__pmSetLayout('${safeJS(v)}')">${v === "standard" ? "\u6807\u51C6" : "\u5BBD\u677E"}</div>`
      ).join("");
      const id = getStorageId2(), localKey = `${id}_${currentPersona}`;
      const hasGlobalBg = !!window.__pmBgGlobal, hasLocalBg = !!window.__pmBgLocal[localKey];
      const globalBgBtn = hasGlobalBg ? `<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('global')">\u6E05\u9664</button>` : `<label class="pm-bg-btn">\u9009\u62E9\u56FE\u7247<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'global')" hidden></label>
               <button class="pm-bg-btn" onclick="window.__pmBgUrl('global')">URL</button>`;
      const localBgBtn = hasLocalBg ? `<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('local')">\u6E05\u9664</button>` : `<label class="pm-bg-btn">\u9009\u62E9\u56FE\u7247<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'local')" hidden></label>
               <button class="pm-bg-btn" onclick="window.__pmBgUrl('local')">URL</button>`;
      makeOverlay(`
<div class="pm-modal pm-modal-wide" style="height: 560px;"> <div class="pm-modal-header"><b>\u8BBE\u7F6E</b><span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">\u2715</span></div>
  <div class="pm-cfg-tabs">
    <div class="pm-cfg-tab pm-cfg-tab-active" data-tab="api" onclick="window.__pmSwitchTab('api')">API</div>
    <div class="pm-cfg-tab" data-tab="look" onclick="window.__pmSwitchTab('look')">\u5916\u89C2</div>
    <div class="pm-cfg-tab" data-tab="other" onclick="window.__pmSwitchTab('other')">\u5176\u4ED6</div>
  </div>
  <div class="pm-modal-scroll">
    <div id="pm-tab-api" class="pm-tab-pane">
      <div style="padding:12px 14px 6px;">
        <div class="pm-cfg-label" style="margin-bottom:6px;">\u26A1 API \u6A21\u5F0F</div>
        <div class="pm-mode-switch">
          <div id="pm-mode-main" class="pm-mode-opt ${!useIndep ? "pm-mode-active" : ""}" onclick="window.__pmSetMode(false)">\u{1F3E0} \u4E3BAPI</div>
          <div id="pm-mode-indep" class="pm-mode-opt ${useIndep ? "pm-mode-active" : ""}" onclick="window.__pmSetMode(true)">\u{1F50C} \u72EC\u7ACBAPI</div>
        </div>
        <div id="pm-mode-tip" class="pm-cfg-tip" style="text-align:left;padding:6px 2px 0;">${useIndep ? "\u{1F50C} \u72EC\u7ACBAPI" : "\u{1F3E0} \u4E3BAPI"}</div>
      </div>
      <div style="padding:6px 14px 4px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin:8px 0 6px;">\u{1F4DA} \u5DF2\u4FDD\u5B58\u6863\u6848</div>
        <div class="pm-prof-list">${profilesHtml}</div>
      </div>
      <div style="padding:10px 16px;display:flex;flex-direction:column;gap:10px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label">API \u5730\u5740</div>
        <input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://api.xxx.com \u6216 .../v1" value="${escapeAttr(cfg.apiUrl || "")}">
        <div class="pm-cfg-label">API Key</div>
        <input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." value="${escapeAttr(cfg.apiKey || "")}" maxlength="999">
        <div class="pm-cfg-label">\u6A21\u578B\u540D\u79F0</div>
        <div class="pm-model-row">
          <input id="pm-cfg-model" class="pm-cfg-input" placeholder="\u624B\u52A8\u8F93\u5165\u6216 \u25BC" value="${escapeAttr(cfg.model || "")}">
          <button id="pm-model-arrow" type="button" onclick="window.__pmShowModelPicker()">\u25BC</button>
        </div>
        <div id="pm-api-status" class="pm-cfg-tip" style="font-weight:bold;">\u8FDE\u63A5\u6210\u529F\u540E\u81EA\u52A8\u4FDD\u5B58</div>

        <div style="display:flex;gap:6px;margin-top:4px;">
          <button onclick="window.__pmTestApi()" style="flex:1;background:#ff9500;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">\u{1F517} \u62C9\u53D6\u6A21\u578B</button>
          <button onclick="window.__pmTestModel()" style="flex:1;background:#5856d6;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">\u{1F9EA} \u6D4B\u8BD5</button>
        </div>
      </div>
      <div style="height:12px;"></div>
    </div>

    <div id="pm-tab-look" class="pm-tab-pane" style="display:none;">
      <div style="padding:12px 16px 0;"> <div class="pm-cfg-label" style="margin-bottom:8px;">\u{1F313} \u65E5\u591C\u6A21\u5F0F</div>
        <div class="pm-theme-row" style="margin-bottom:8px;"> <div class="pm-layout-chip ${t.darkMode === "light" ? "pm-layout-active" : ""}" onclick="window.__pmSetDarkMode('light')">\u2600\uFE0F \u65E5\u95F4</div>
          <div class="pm-layout-chip ${t.darkMode === "dark" ? "pm-layout-active" : ""}" onclick="window.__pmSetDarkMode('dark')">\u{1F319} \u591C\u95F4</div>
        </div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:8px;">\u{1F4D0} \u754C\u9762\u5E03\u5C40</div>
        <div class="pm-layout-row">${layoutBtns}</div>
      </div>
      <div style="padding:14px 16px 12px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">\u{1F3A8} \u6C14\u6CE1\u4E3B\u9898</div>
        <div class="pm-theme-row">${presetBtns}</div>
        <div style="display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap;">
          <label class="pm-cfg-label" style="margin:0;">\u81EA\u5B9A\u4E49\u53F3</label>
          <input id="pm-custom-right" type="color" value="${t.customRight || "#007aff"}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <label class="pm-cfg-label" style="margin:0;">\u81EA\u5B9A\u4E49\u5DE6</label>
          <input id="pm-custom-left" type="color" value="${t.customLeft || "#e9e9eb"}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <button onclick="window.__pmClearCustomColor()" class="pm-color-clear">\u91CD\u7F6E</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center;">
          <label class="pm-cfg-label" style="margin:0;">\u8FB9\u6846\u989C\u8272</label>
          <input id="pm-border-color" type="color" value="${t.borderColor || "#1a1a1a"}" onchange="window.__pmSetBorderColor()" class="pm-color-pick">
          <button onclick="document.getElementById('pm-border-color').value='#1a1a1a';window.__pmSetBorderColor()" class="pm-color-clear">\u91CD\u7F6E</button>
        </div>
      </div>
      <div style="padding:12px 16px 12px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:14px;">\u{1F5BC}\uFE0F \u80CC\u666F\u56FE</div>
        <div style="display:flex;flex-direction:column;gap:14px;padding:0 4px;">
          <div class="pm-bg-row">
            <span class="pm-bg-label">\u5168\u5C40\u80CC\u666F</span>
            ${globalBgBtn}
          </div>
          <div class="pm-bg-row">
            <span class="pm-bg-label">\u672C\u8054\u7CFB\u4EBA</span>
            ${localBgBtn}
          </div>
        </div>
      </div>
      <div style="height:12px;"></div>
    </div>
    <div id="pm-tab-other" class="pm-tab-pane" style="display:none;">
      <div style="padding:14px 16px 12px;border-bottom:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">\u270D\uFE0F \u5B57\u6570\u63A7\u5236</div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font-size:13px;font-weight:600;color:#333;">\u8BDD\u5C11\u4E00\u70B9</span>
            <span style="font-size:11px;color:#aaa;">\u6BCF\u6761\u6D88\u606F\u4E0D\u8D85\u8FC735\u5B57\uFF08\u8BDD\u75E8\u4EBA\u8BBE\u9664\u5916\uFF09</span>
          </div>
          <div id="pm-wordy-check"
               onclick="window.__pmToggleWordyLimit()"
               class="pm-custom-check pm-bi-style"
               style="cursor:pointer;width:22px;height:22px;min-width:22px;min-height:22px;flex-shrink:0;border-radius:50%;">
          </div>
        </div>
      </div>
      <div style="padding:14px 16px 12px;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">\u{1F970} \u8868\u60C5\u5305\u7BA1\u7406</div>
        <div id="pm-emoji-set-list"></div>
        <button onclick="window.__pmAddEmojiSet()" style="width:100%;margin-top:8px;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u2795 \u6DFB\u52A0\u65B0\u5957\u7EC4</button>
        <div class="pm-cfg-tip" style="text-align:left;margin-top:6px;">\u6700\u591A 10 \u5957\uFF0C\u6BCF\u5957\u6700\u591A 20 \u5F20\u56FE\u7247</div>
      </div>
      <div style="padding:12px 16px 12px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">\u{1F4E6} \u6570\u636E\u5907\u4EFD</div>
        <div style="display:flex;gap:6px;">
         <button onclick="window.__pmExportData()" style="flex:1;background:#34c759;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u{1F4E5} \u5BFC\u51FA\u5907\u4EFD</button>
         <button onclick="document.getElementById('pm-import-file').click()" style="flex:1;background:#5856d6;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u{1F4E4} \u5BFC\u5165\u5907\u4EFD</button>
         <input id="pm-import-file" type="file" accept=".json" onchange="window.__pmImportData(this)" hidden>
        </div>
        <div class="pm-cfg-tip" style="text-align:left;margin-top:6px;color:#ff9500;">\u6CE8\u610F\uFF1A\u5BFC\u5165\u4F1A\u8986\u76D6\u5F53\u524D\u6240\u6709\u8054\u7CFB\u4EBA\u4E0E\u8BB0\u5F55</div>
      </div>
      <div style="height:12px;"></div>
    </div>
  </div>
  <div class="pm-modal-add" id="pm-config-bottom">
    <button onclick="window.__pmSaveConfig()" style="width:100%;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u4FDD\u5B58\u914D\u7F6E</button>
  </div>
</div>`);
    };
    window.__pmSwitchTab = (tab) => {
      document.querySelectorAll(".pm-cfg-tab").forEach((el) => el.classList.toggle("pm-cfg-tab-active", el.dataset.tab === tab));
      document.querySelectorAll(".pm-tab-pane").forEach((el) => el.style.display = "none");
      const pane = document.getElementById(`pm-tab-${tab}`);
      if (pane) pane.style.display = "block";
      if (tab === "other") {
        window.__pmRenderEmojiSetList();
        const wc = document.getElementById("pm-wordy-check");
        if (wc) wc.classList.toggle("is-checked", !!window.__pmWordyLimit);
      }
    };
    window.__pmSetPreset = (p) => {
      window.__pmTheme.preset = p;
      window.__pmTheme.customRight = "";
      window.__pmTheme.customLeft = "";
      saveTheme();
      applyTheme();
      document.querySelectorAll(".pm-theme-chip").forEach((el) => el.classList.toggle("pm-theme-active", el.dataset.preset === p));
    };
    window.__pmSetCustomColor = () => {
      window.__pmTheme.customRight = document.getElementById("pm-custom-right")?.value || "";
      window.__pmTheme.customLeft = document.getElementById("pm-custom-left")?.value || "";
      window.__pmTheme.preset = "custom";
      saveTheme();
      applyTheme();
      document.querySelectorAll(".pm-theme-chip").forEach((el) => el.classList.remove("pm-theme-active"));
    };
    window.__pmClearCustomColor = () => {
      window.__pmTheme.customRight = "";
      window.__pmTheme.customLeft = "";
      window.__pmTheme.preset = "default";
      saveTheme();
      applyTheme();
      const r = document.getElementById("pm-custom-right"), l = document.getElementById("pm-custom-left");
      if (r) r.value = "#007aff";
      if (l) l.value = "#e9e9eb";
      document.querySelectorAll(".pm-theme-chip").forEach((el) => el.classList.toggle("pm-theme-active", el.dataset.preset === "default"));
    };
    window.__pmSetBorderColor = () => {
      window.__pmTheme.borderColor = document.getElementById("pm-border-color")?.value || "#1a1a1a";
      saveTheme();
      applyTheme();
    };
    window.__pmSetLayout = (v) => {
      window.__pmTheme.layout = v;
      saveTheme();
      if (phoneWindow) phoneWindow.dataset.layout = v;
      document.querySelectorAll(".pm-layout-chip").forEach((el) => el.classList.toggle("pm-layout-active", el.textContent === (v === "standard" ? "\u6807\u51C6" : "\u5BBD\u677E")));
      fitNameFont();
    };
    window.__pmUploadBg = (input, scope) => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        openCropper(e.target.result, {
          onCancel: () => window.__pmShowConfig(),
          onConfirm: (croppedDataUrl) => {
            if (scope === "global") {
              window.__pmBgGlobal = croppedDataUrl;
              saveBgGlobal();
            } else {
              const id = getStorageId2();
              window.__pmBgLocal[`${id}_${currentPersona}`] = croppedDataUrl;
              saveBgLocal();
            }
            applyBackground();
            window.__pmShowConfig();
            setTimeout(() => window.__pmSwitchTab("look"), 50);
          }
        });
      };
      reader.readAsDataURL(file);
      input.value = "";
    };
    window.__pmBgUrl = (scope) => {
      const url = prompt("\u8F93\u5165\u56FE\u7247 URL\uFF1A");
      if (!url?.trim()) return;
      if (scope === "global") {
        window.__pmBgGlobal = url.trim();
        saveBgGlobal();
      } else {
        const id = getStorageId2();
        window.__pmBgLocal[`${id}_${currentPersona}`] = url.trim();
        saveBgLocal();
      }
      applyBackground();
      window.__pmShowConfig();
      setTimeout(() => window.__pmSwitchTab("look"), 50);
    };
    window.__pmClearBg = async (scope) => {
      if (scope === "global") {
        window.__pmBgGlobal = "";
        await pmIDBDel("ST_SMS_BG_GLOBAL");
        try {
          localStorage.removeItem("ST_SMS_BG_GLOBAL");
        } catch (e) {
        }
      } else {
        const id = getStorageId2(), key = `${id}_${currentPersona}`;
        delete window.__pmBgLocal[key];
        await pmIDBDel("ST_SMS_BG_LOCAL_" + key);
        await saveBgLocal();
      }
      applyBackground();
      window.__pmShowConfig();
      setTimeout(() => window.__pmSwitchTab("look"), 50);
    };
    window.__pmTestApi = async () => {
      const u = document.getElementById("pm-cfg-url").value.trim(), k = document.getElementById("pm-cfg-key").value.trim(), m = document.getElementById("pm-cfg-model").value.trim();
      const s = document.getElementById("pm-api-status");
      if (!u) {
        s.textContent = "\u274C \u586B\u5199API\u5730\u5740";
        s.style.color = "#ff3b30";
        return;
      }
      s.textContent = "\u8FDE\u63A5\u4E2D...";
      s.style.color = "#007aff";
      try {
        const r = await fetch(normalizeApiUrls(u).modelsUrl, { method: "GET", headers: { "Authorization": `Bearer ${k}` } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (d?.data && Array.isArray(d.data)) {
          runtime.modelList = d.data.map((x) => x.id).filter(Boolean);
          s.textContent = `\u2705 ${runtime.modelList.length} \u4E2A\u6A21\u578B`;
          s.style.color = "#34c759";
        } else {
          s.textContent = "\u2705 \u8FDE\u63A5\u6210\u529F";
          s.style.color = "#34c759";
        }
        addOrUpdateProfile({ apiUrl: u, apiKey: k, model: m });
      } catch (e) {
        s.textContent = "\u274C " + e.message;
        s.style.color = "#ff3b30";
      }
    };
    window.__pmTestModel = async () => {
      const u = document.getElementById("pm-cfg-url").value.trim(), k = document.getElementById("pm-cfg-key").value.trim(), m = document.getElementById("pm-cfg-model").value.trim();
      const s = document.getElementById("pm-api-status");
      if (!u || !k || !m) {
        s.textContent = "\u274C \u8BF7\u586B\u5B8C\u6574";
        s.style.color = "#ff3b30";
        return;
      }
      s.textContent = `\u6D4B\u8BD5\u300C${m}\u300D...`;
      s.style.color = "#007aff";
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), 15e3);
      try {
        const r = await fetch(normalizeApiUrls(u).chatUrl, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${k}` }, body: JSON.stringify({ model: m, messages: [{ role: "user", content: "hi" }], max_tokens: 16 }), signal: ctrl.signal });
        clearTimeout(tm);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json(), reply = j.choices?.[0]?.message?.content;
        s.textContent = reply != null ? `\u2705 "${String(reply).slice(0, 25)}"` : "\u26A0\uFE0F \u683C\u5F0F\u5F02\u5E38";
        s.style.color = reply != null ? "#34c759" : "#ff9500";
      } catch (e) {
        clearTimeout(tm);
        s.textContent = "\u274C " + (e.name === "AbortError" ? "\u8D85\u65F6" : e.message);
        s.style.color = "#ff3b30";
      }
    };
    window.__pmSaveConfig = () => {
      const apiUrl = document.getElementById("pm-cfg-url")?.value.trim() ?? "", apiKey = document.getElementById("pm-cfg-key")?.value.trim() ?? "", model = document.getElementById("pm-cfg-model")?.value.trim() ?? "";
      window.__pmConfig = { apiUrl, apiKey, model, useIndependent: !!window.__pmConfig.useIndependent };
      try {
        localStorage.setItem("ST_SMS_CONFIG", JSON.stringify(window.__pmConfig));
      } catch (e) {
      }
      if (apiUrl && apiKey) addOrUpdateProfile({ apiUrl, apiKey, model });
      document.getElementById("pm-overlay")?.remove();
      addNote(`\u5DF2\u4FDD\u5B58\uFF1A${window.__pmConfig.useIndependent && apiUrl ? "\u72EC\u7ACBAPI" : "\u4E3BAPI"}`);
    };
    window.__pmShowModelPicker = () => {
      const existing = document.getElementById("pm-model-dropdown");
      if (existing) {
        existing.remove();
        return;
      }
      if (!runtime.modelList.length) {
        const s = document.getElementById("pm-api-status");
        if (s) {
          s.textContent = "\u26A0\uFE0F \u5148\u62C9\u53D6\u6A21\u578B";
          s.style.color = "#ff9500";
        }
        return;
      }
      const input = document.getElementById("pm-cfg-model"), rect = input.getBoundingClientRect();
      const dd = document.createElement("div");
      dd.id = "pm-model-dropdown";
      dd.className = "pm-model-dropdown";
      dd.style.setProperty("--pm-model-visible-rows", String(MODEL_VISIBLE_ROWS));
      if (POPOVER_SUPPORTED) dd.setAttribute("popover", "manual");
      dd.innerHTML = `<input class="pm-model-search" placeholder="\u{1F50D} \u641C\u7D22..." /><div class="pm-model-options"></div>`;
      dd.style.left = rect.left + "px";
      dd.style.top = rect.bottom + 4 + "px";
      dd.style.width = rect.width + "px";
      document.body.appendChild(dd);
      if (dd.showPopover) try {
        dd.showPopover();
      } catch (e) {
      }
      const optsDiv = dd.querySelector(".pm-model-options");
      const render = (f = "") => {
        const fl = f.toLowerCase(), filtered = runtime.modelList.filter((m) => !fl || m.toLowerCase().includes(fl));
        optsDiv.innerHTML = filtered.length ? filtered.map((m) => `<div class="pm-model-opt" data-m="${escapeAttr(m)}">${escapeHtml(m)}</div>`).join("") : '<div class="pm-model-empty">\u65E0\u5339\u914D</div>';
        optsDiv.querySelectorAll(".pm-model-opt").forEach((el) => el.addEventListener("click", () => {
          document.getElementById("pm-cfg-model").value = el.dataset.m;
          dd.remove();
        }));
      };
      render();
      dd.querySelector(".pm-model-search").addEventListener("input", function() {
        render(this.value);
      });
      dd.querySelector(".pm-model-search").focus();
      setTimeout(() => {
        const closer = (e) => {
          if (!dd.contains(e.target) && e.target.id !== "pm-model-arrow") {
            dd.remove();
            document.removeEventListener("click", closer, true);
          }
        };
        document.addEventListener("click", closer, true);
      }, 0);
    };
    function makeOverlay(html) {
      document.getElementById("pm-overlay")?.remove();
      const ov = document.createElement("div");
      ov.id = "pm-overlay";
      if (POPOVER_SUPPORTED) ov.setAttribute("popover", "manual");
      ov.innerHTML = html;
      ov.addEventListener("click", (e) => {
        if (e.target === ov) ov.remove();
      });
      document.body.appendChild(ov);
      if (ov.showPopover) try {
        ov.showPopover();
      } catch (e) {
      }
      return ov;
    }
    installEmojiUi({ makeOverlay, saveEmojis });
    window.__pmShowList = () => {
      const id = getStorageId2();
      loadGroupMeta();
      const histories = window.__pmHistories[id] || {};
      const groups = window.__pmGroupMeta[id] || {};
      const checked = window.__pmBidirectional[id] || [];
      const singleList = Object.keys(histories).filter((k) => !k.startsWith("__group_"));
      const groupList = Object.keys(groups);
      const renderSingle = singleList.map((n) => {
        const isChk = checked.includes(n);
        return `<div class="pm-li">
                <div class="pm-custom-check pm-bi-style ${isChk ? "is-checked" : ""}" onclick="event.stopPropagation();window.__pmToggleBidirectional('${safeJS(n)}')" style="width:20px;height:20px;min-width:20px;min-height:20px;flex-shrink:0;border-radius:50%;"></div>
                <span onclick="window.__pmSwitchContact('${safeJS(n)}')">${escapeHtml(n)}</span>
                <i onclick="window.__pmDel('${safeJS(n)}')">\u5220\u9664</i>
            </div>`;
      }).join("");
      const renderGroups = groupList.map((key) => {
        const meta = groups[key];
        const isChk = checked.includes(key);
        return `<div class="pm-li">
                <div class="pm-custom-check pm-bi-style ${isChk ? "is-checked" : ""}" onclick="event.stopPropagation();window.__pmToggleBidirectional('${safeJS(key)}')" style="width:20px;height:20px;min-width:20px;min-height:20px;flex-shrink:0;border-radius:50%;"></div>
                <span onclick="window.__pmSwitchContact('${safeJS(key)}')">${escapeHtml(meta.name)}<span class="pm-group-sub">${escapeHtml(meta.members.join("\u3001"))}</span></span>
                <i onclick="window.__pmDelGroup('${safeJS(key)}')">\u5220\u9664</i>
            </div>`;
      }).join("");
      const empty = !singleList.length && !groupList.length;
      makeOverlay(`
    <div class="pm-modal">
    <div class="pm-modal-header">
      <b>\u8054\u7CFB\u4EBA</b>
      <span style="display:flex;align-items:center;gap:10px;">
        <span id="pm-autogen-btn" onclick="window.__pmConfirmAutoGen()" title="AI \u81EA\u52A8\u751F\u6210\u8054\u7CFB\u4EBA" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;transition:background .15s;" onmouseenter="this.style.background='rgba(0,122,255,0.1)'" onmouseleave="this.style.background='transparent'">
          ${REFRESH_ICON_SVG}
        </span>
        <span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">\u2715</span>
      </span>
    </div>
    <div class="pm-bi-bar"><span>\u{1F9E0} \u52FE\u9009\u89D2\u8272/\u7FA4\u804A\u53EF\u88AB\u4E3B\u697C\u8BFB\u53D6\u77ED\u4FE1</span><span class="pm-bi-tip">\u5DF2\u9009 ${checked.length}/${MAX_BIDIRECTIONAL}</span></div>
    <div class="pm-modal-list">
        ${empty ? '<div style="text-align:center;color:#999;padding:20px;font-size:13px;">\u6682\u65E0\u8054\u7CFB\u4EBA</div>' : renderGroups + renderSingle}
    </div>
    <div class="pm-modal-add" style="display:flex;gap:8px;">
        <button onclick="window.__pmShowGroupCreate()" class="pm-btn-group">\u{1F465} \u65B0\u5EFA\u7FA4\u804A</button>
        <button onclick="window.__pmShowAddContact()" class="pm-btn-add">\uFF0B \u6DFB\u52A0\u8054\u7CFB\u4EBA</button>
    </div>
    </div>`);
    };
    window.__pmShowAddContact = () => {
      document.getElementById("pm-overlay")?.remove();
      makeOverlay(`
<div class="pm-modal">
  <div class="pm-modal-header"><b>\u6DFB\u52A0\u8054\u7CFB\u4EBA</b><span onclick="window.__pmShowList()" class="pm-modal-close">\u2715</span></div>
  <div style="padding:14px 16px;">
    <div class="pm-cfg-label" style="margin-bottom:8px;">\u8F93\u5165\u89D2\u8272\u540D</div>
    <input id="pm-add-contact-input" class="pm-cfg-input" placeholder="\u89D2\u8272\u540D">
  </div>
  <div class="pm-modal-add">
    <button onclick="(()=>{const v=document.getElementById('pm-add-contact-input').value.trim();if(v)window.__pmSwitchContact(v);})()" style="flex:1;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u5F00\u59CB\u804A\u5929</button>
  </div>
</div>`);
      setTimeout(() => {
        const input = document.getElementById("pm-add-contact-input");
        input?.focus();
        input?.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const v = input.value.trim();
            if (v) window.__pmSwitchContact(v);
          }
        });
      }, 0);
    };
    window.__pmConfirmAutoGen = () => {
      const id = getStorageId2();
      const histories = window.__pmHistories[id] || {};
      const groups = window.__pmGroupMeta[id] || {};
      const singleCount = Object.keys(histories).filter((k) => !k.startsWith("__group_")).length;
      const groupCount = Object.keys(groups).length;
      const total = singleCount + groupCount;
      const MAX_TOTAL = 10;
      if (total >= MAX_TOTAL) {
        alert(`\u5DF2\u6709 ${total} \u4E2A\u8054\u7CFB\u4EBA/\u7FA4\u804A\uFF0C\u5DF2\u8FBE\u4E0A\u9650\uFF08${MAX_TOTAL}\uFF09\uFF0C\u65E0\u6CD5\u7EE7\u7EED\u751F\u6210\u3002`);
        return;
      }
      const canAdd = MAX_TOTAL - total;
      const willAdd = Math.min(canAdd, 10);
      if (!confirm(`AI \u5C06\u6839\u636E\u5F53\u524D\u5267\u60C5\u4FE1\u606F\u81EA\u52A8\u751F\u6210\u8054\u7CFB\u4EBA\u548C\u7FA4\u804A\uFF08\u6700\u591A ${willAdd} \u4E2A\uFF09\uFF0C\u76F4\u63A5\u5199\u5165\u5217\u8868\uFF0C\u662F\u5426\u7EE7\u7EED\uFF1F`)) return;
      window.__pmAutoGenContacts();
    };
    window.__pmAutoGenContacts = async () => {
      const id = getStorageId2();
      const histories = window.__pmHistories[id] || {};
      const groups = window.__pmGroupMeta[id] || {};
      const existingSingle = Object.keys(histories).filter((k) => !k.startsWith("__group_"));
      const existingGroups = Object.keys(groups).map((k) => groups[k].name);
      const total = existingSingle.length + existingGroups.length;
      const MAX_TOTAL = 10;
      const canAdd = MAX_TOTAL - total;
      if (canAdd <= 0) return;
      const maxNew = Math.min(canAdd, 10);
      const setSpinning = (on) => {
        const icon = document.getElementById("pm-autogen-icon");
        const btn = document.getElementById("pm-autogen-btn");
        if (icon) icon.style.animation = on ? "pm-spin 0.8s linear infinite" : "";
        if (btn) btn.style.pointerEvents = on ? "none" : "";
      };
      setSpinning(true);
      try {
        const ctxData = await gatherContext2();
        const { cardDesc, cardPersonality, cardScenario, mainChatText, worldBookText, userName, userDesc } = ctxData;
        const existingList = [
          ...existingSingle,
          ...Object.keys(groups).map((k) => groups[k].name)
        ];
        const existingStr = existingList.length ? `\u5DF2\u6709\u8054\u7CFB\u4EBA/\u7FA4\u804A\uFF08\u8DF3\u8FC7\u540C\u540D\uFF09\uFF1A${existingList.join("\u3001")}` : "\u76EE\u524D\u6682\u65E0\u8054\u7CFB\u4EBA\u3002";
        const systemPrompt = `\u4F60\u662F\u4E00\u4E2A\u89D2\u8272\u626E\u6F14\u8F85\u52A9\u5DE5\u5177\uFF0C\u8D1F\u8D23\u6839\u636E\u5F53\u524D\u5267\u60C5\u80CC\u666F\u81EA\u52A8\u751F\u6210\u7B26\u5408\u4E16\u754C\u89C2\u7684\u8054\u7CFB\u4EBA\u5217\u8868\u3002
\u8F93\u51FA\u5FC5\u987B\u4E25\u683C\u4E3A JSON\uFF0C\u683C\u5F0F\u5982\u4E0B\uFF08\u4E0D\u5F97\u6709\u4EFB\u4F55\u6CE8\u91CA\u6216 markdown\uFF09\uFF1A
{
  "contacts": ["\u89D2\u8272\u540DA", "\u89D2\u8272\u540DB"],
  "groups": [
    {"name": "\u7FA4\u804A\u540D\u79F0", "members": ["\u6210\u54581", "\u6210\u54582", "\u6210\u54583"]},
    ...
  ]
}
\u8981\u6C42\uFF1A
1. contacts \u662F\u5355\u4E2A\u8054\u7CFB\u4EBA\uFF0Cgroups \u662F\u7FA4\u804A\uFF08\u6BCF\u4E2A\u7FA4 2~15 \u4E2A\u6210\u5458\uFF09
2. \u751F\u6210\u603B\u6570\uFF08contacts.length + groups.length\uFF09\u5728 3 \u5230 ${maxNew} \u4E4B\u95F4
3. \u6240\u6709\u89D2\u8272\u540D\u5FC5\u987B\u4E0E\u5F53\u524D\u5267\u60C5\u4E16\u754C\u89C2\u3001\u4EBA\u8BBE\u80CC\u666F\u9AD8\u5EA6\u76F8\u5173
4. \u7EDD\u4E0D\u751F\u6210\u4E0E ${existingStr} \u540C\u540D\u7684\u8054\u7CFB\u4EBA\u6216\u7FA4\u804A
5. \u4E0D\u751F\u6210\u7528\u6237\u81EA\u5DF1\uFF08${userName}\uFF09\u4F5C\u4E3A\u8054\u7CFB\u4EBA\uFF0C\u7FA4\u804A\u6210\u5458\u91CC\u4E5F\u4E0D\u5F97\u5305\u542B ${userName}
6. \u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8F93\u51FA\u4EFB\u4F55\u5176\u4ED6\u5185\u5BB9`;
        const userPrompt = [
          `\u3010\u7528\u6237\u4FE1\u606F\u3011
\u7528\u6237\u540D\uFF1A${userName}${userDesc ? "\n" + userDesc : ""}`,
          cardDesc ? `\u3010\u89D2\u8272/\u4E16\u754C\u8BBE\u5B9A\u3011
${cardDesc}` : "",
          cardPersonality ? `\u3010\u6027\u683C\u3011
${cardPersonality}` : "",
          cardScenario ? `\u3010\u573A\u666F\u3011
${cardScenario}` : "",
          worldBookText ? `\u3010\u4E16\u754C\u4E66\u3011
${worldBookText}` : "",
          mainChatText ? `\u3010\u4E3B\u7EBF\u6700\u8FD1\u5BF9\u8BDD\u3011
${mainChatText}` : "",
          existingStr,
          `\u8BF7\u751F\u6210 3~${maxNew} \u4E2A\u7B26\u5408\u4EE5\u4E0A\u80CC\u666F\u7684\u8054\u7CFB\u4EBA\u548C/\u6216\u7FA4\u804A\uFF0C\u4EE5 JSON \u8F93\u51FA\u3002`
        ].filter(Boolean).join("\n\n");
        const raw = await callAI(systemPrompt, userPrompt, { maxTokens: 600 });
        const cleaned = raw.replace(/```json|```/gi, "").trim();
        let parsed;
        try {
          parsed = JSON.parse(cleaned);
        } catch (e) {
          throw new Error(`AI \u8FD4\u56DE\u683C\u5F0F\u65E0\u6CD5\u89E3\u6790\uFF1A${cleaned.slice(0, 100)}`);
        }
        const newContacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];
        const newGroups = Array.isArray(parsed.groups) ? parsed.groups : [];
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        let added = 0;
        for (const name of newContacts) {
          if (typeof name !== "string" || !name.trim()) continue;
          const n = name.trim();
          const alreadyExists = existingList.some((e) => e.toLowerCase() === n.toLowerCase()) || Object.keys(window.__pmHistories[id]).some((k) => !k.startsWith("__group_") && k.toLowerCase() === n.toLowerCase());
          if (alreadyExists) continue;
          if (!window.__pmHistories[id][n]) window.__pmHistories[id][n] = [];
          added++;
        }
        saveHistories();
        if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
        for (const g of newGroups) {
          if (!g?.name || !Array.isArray(g.members) || g.members.length < 2) continue;
          const gName = g.name.trim();
          const alreadyExists = Object.values(window.__pmGroupMeta[id]).some((m) => m.name.toLowerCase() === gName.toLowerCase());
          if (alreadyExists) continue;
          const members = g.members.map((m) => m.trim()).filter((m) => m && m.toLowerCase() !== userName.toLowerCase()).slice(0, 15);
          const groupKey = `__group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          window.__pmGroupMeta[id][groupKey] = { name: gName, members };
          added++;
        }
        saveGroupMeta();
        window.__pmShowList();
        setTimeout(() => addNote(`\u2728 \u5DF2\u81EA\u52A8\u6DFB\u52A0 ${added} \u4E2A\u8054\u7CFB\u4EBA/\u7FA4\u804A`), 200);
      } catch (e) {
        console.error("[phone-mode] __pmAutoGenContacts \u5F02\u5E38", e);
        alert(`\u81EA\u52A8\u751F\u6210\u5931\u8D25\uFF1A${e?.message || e}`);
      } finally {
        setSpinning(false);
      }
    };
    window.__pmDelGroup = async (key) => {
      const id = getStorageId2();
      if (window.__pmGroupMeta[id]) delete window.__pmGroupMeta[id][key];
      if (window.__pmHistories[id]) delete window.__pmHistories[id][key];
      const arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(key);
      if (idx >= 0) {
        arr.splice(idx, 1);
        window.__pmBidirectional[id] = arr;
        saveBidirectional();
      }
      const bgKey = `${id}_${key}`;
      if (window.__pmBgLocal[bgKey]) {
        delete window.__pmBgLocal[bgKey];
        await pmIDBDel("ST_SMS_BG_LOCAL_" + bgKey);
        await saveBgLocal();
      }
      if (window.__pmPokeConfig[id]?.[key]) {
        delete window.__pmPokeConfig[id][key];
        savePokeConfig();
      }
      await pmIDBSet("ST_SMS_DATA_V2", window.__pmHistories).catch(() => {
      });
      try {
        localStorage.setItem("ST_SMS_DATA_V2", JSON.stringify(window.__pmHistories));
      } catch (e) {
      }
      ;
      saveGroupMeta();
      applyBidirectionalInjection();
      if (currentGroupKey === key) {
        isGroupChat = false;
        currentGroupKey = "";
        currentPersona = "";
        conversationHistory = [];
        groupMembers = [];
        groupDisplayName = "";
        groupColorMap = {};
      }
      window.__pmShowList();
    };
    window.__pmSwitchContact = (key) => {
      if (!key?.trim()) return;
      key = key.trim();
      loadGroupMeta();
      const id = getStorageId2();
      if (id === "sms_unknown__default") {
        console.warn("[phone-mode] __pmSwitchContact: SillyTavern \u4E0A\u4E0B\u6587\u5C1A\u672A\u5C31\u7EEA\uFF0CstorageId \u4E3A unknown\uFF0C\u8DF3\u8FC7\u5207\u6362");
        return;
      }
      const groupMeta = window.__pmGroupMeta[id]?.[key];
      const _prevSaveKey = isGroupChat && currentGroupKey ? currentGroupKey : currentPersona;
      if (groupMeta) {
        isGroupChat = true;
        currentGroupKey = key;
        groupMembers = groupMeta.members.slice();
        groupDisplayName = groupMeta.name;
        groupColorMap = {};
        groupMembers.forEach((n, i) => {
          groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length];
        });
      } else {
        isGroupChat = false;
        groupMembers = [];
        groupColorMap = {};
        groupDisplayName = "";
        currentGroupKey = "";
      }
      window.__pmSwitch(key, _prevSaveKey);
    };
    window.__pmSwitch = (name, _prevSaveKey) => {
      if (!name?.trim()) return;
      name = name.trim();
      document.getElementById("pm-overlay")?.remove();
      const id = getStorageId2();
      if (currentPersona && conversationHistory.length > 0) {
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        const saveKey = _prevSaveKey || (isGroupChat && currentGroupKey ? currentGroupKey : currentPersona);
        window.__pmHistories[id][saveKey] = conversationHistory.slice(-SAVE_LIMIT);
        saveHistories();
      }
      currentPersona = name;
      conversationHistory = window.__pmHistories[id]?.[name] ?? [];
      if (phoneWindow) {
        const nameEl = phoneWindow.querySelector(".pm-name");
        const editBtn = phoneWindow.querySelector(".pm-name-edit");
        if (nameEl) {
          if (isGroupChat) {
            const display = groupDisplayName || name;
            const arr = [...display];
            nameEl.textContent = arr.length > 5 ? arr.slice(0, 5).join("") + "..." : display;
          } else {
            nameEl.textContent = name;
          }
        }
        if (editBtn) {
          editBtn.classList.remove("is-hidden");
        }
        fitNameFont();
        const list = phoneWindow.querySelector(".pm-msg-list");
        list.innerHTML = "";
        if (conversationHistory.length > 0) {
          addNote(`\u5386\u53F2\u8BB0\u5F55`);
          conversationHistory.forEach((m, hi) => {
            if (isGroupChat && m.role === "assistant") {
              const lines = m.content.split("\n");
              for (const line of lines) {
                const match = line.match(/^(.{1,20})[：:]\s*(.+)$/);
                if (match && groupMembers.some((gm) => gm.toLowerCase() === match[1].trim().toLowerCase())) {
                  const sender = groupMembers.find((gm) => gm.toLowerCase() === match[1].trim().toLowerCase());
                  splitToSentences(match[2]).forEach((s) => addBubble(s, "left", sender, hi));
                } else {
                  splitToSentences(line).forEach((s) => addBubble(s, "left", void 0, hi));
                }
              }
            } else {
              splitToSentences(m.content).forEach((s) => addBubble(s, m.role === "user" ? "right" : "left", void 0, hi));
            }
          });
          addNote("\u2500\u2500 \u4EE5\u4E0A\u4E3A\u5386\u53F2 \u2500\u2500");
        } else addNote(`\u5F00\u59CB\u5BF9\u8BDD`);
        applyBackground();
      }
      applyBidirectionalInjection();
    };
    window.__pmDel = async (name) => {
      const id = getStorageId2();
      if (window.__pmHistories[id]) delete window.__pmHistories[id][name];
      await pmIDBSet("ST_SMS_DATA_V2", window.__pmHistories).catch(() => {
      });
      try {
        localStorage.setItem("ST_SMS_DATA_V2", JSON.stringify(window.__pmHistories));
      } catch (e) {
      }
      ;
      const arr = window.__pmBidirectional[id] || [], idx = arr.indexOf(name);
      if (idx >= 0) {
        arr.splice(idx, 1);
        window.__pmBidirectional[id] = arr;
        saveBidirectional();
      }
      const bgKey = `${id}_${name}`;
      if (window.__pmBgLocal[bgKey]) {
        delete window.__pmBgLocal[bgKey];
        await pmIDBDel("ST_SMS_BG_LOCAL_" + bgKey);
        await saveBgLocal();
      }
      if (window.__pmPokeConfig[id]?.[name]) {
        delete window.__pmPokeConfig[id][name];
        savePokeConfig();
      }
      applyBidirectionalInjection();
      if (!isGroupChat && currentPersona === name) {
        currentPersona = "";
        conversationHistory = [];
      }
      window.__pmShowList();
    };
    window.__pmToggleSelect = () => {
      isSelectMode = !isSelectMode;
      const list = phoneWindow?.querySelector(".pm-msg-list");
      const trashBtn = phoneWindow?.querySelector(".pm-trash-btn");
      const confirmBar = phoneWindow?.querySelector(".pm-confirm-bar");
      if (!list) return;
      if (isSelectMode) {
        trashBtn.style.color = "#ff3b30";
        confirmBar.style.display = "flex";
        list.querySelectorAll(".pm-bubble, .pm-group-bubble-wrap, .pm-director").forEach((b) => {
          if (b.id === "pm-typing" || b.closest(".pm-select-wrap")) return;
          const isDirector = b.classList.contains("pm-director");
          const wrap = document.createElement("div");
          wrap.className = "pm-select-wrap";
          const side = isDirector ? "center" : b.dataset.side || "left";
          wrap.style.cssText = "display:flex;align-items:center;gap:8px;align-self:" + (side === "right" ? "flex-end" : side === "center" ? "center" : "flex-start") + ";";
          const cb = document.createElement("div");
          cb.className = "pm-custom-check";
          cb.dataset.checked = "0";
          cb.style.cssText = "width:22px;height:22px;min-width:22px;min-height:22px;border-radius:50%;flex-shrink:0;cursor:pointer;";
          cb.onclick = () => {
            cb.dataset.checked = cb.dataset.checked === "0" ? "1" : "0";
          };
          b.parentNode.insertBefore(wrap, b);
          wrap.appendChild(cb);
          wrap.appendChild(b);
          wrap.dataset.side = side;
          wrap.dataset.text = b.dataset.text || "";
          const hi = b.dataset.historyIndex;
          if (hi !== void 0 && hi !== "") wrap.dataset.historyIndex = hi;
        });
      } else {
        trashBtn.style.color = "";
        confirmBar.style.display = "none";
        list.querySelectorAll(".pm-select-wrap").forEach((wrap) => {
          const b = wrap.querySelector(".pm-bubble, .pm-group-bubble-wrap, .pm-director");
          if (b) wrap.parentNode.insertBefore(b, wrap);
          wrap.remove();
        });
      }
    };
    window.__pmDeleteSelected = () => {
      const list = phoneWindow?.querySelector(".pm-msg-list");
      if (!list) return;
      const toRemoveIndices = /* @__PURE__ */ new Set();
      list.querySelectorAll(".pm-select-wrap").forEach((wrap) => {
        const cb = wrap.querySelector(".pm-custom-check");
        if (cb?.dataset.checked === "1") {
          const hi = wrap.dataset.historyIndex;
          if (hi !== void 0 && hi !== "") toRemoveIndices.add(Number(hi));
          wrap.remove();
        } else {
          const b = wrap.querySelector(".pm-bubble, .pm-group-bubble-wrap, .pm-director");
          if (b) wrap.parentNode.insertBefore(b, wrap);
          wrap.remove();
        }
      });
      if (toRemoveIndices.size > 0) {
        conversationHistory = conversationHistory.filter((_, i) => !toRemoveIndices.has(i));
        const id = getStorageId2();
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        const saveKey = isGroupChat && currentGroupKey ? currentGroupKey : currentPersona;
        window.__pmHistories[id][saveKey] = conversationHistory.slice(-SAVE_LIMIT);
        saveHistories();
        applyBidirectionalInjection();
      }
      isSelectMode = false;
      phoneWindow?.querySelector(".pm-trash-btn")?.style.removeProperty("color");
      const bar = phoneWindow?.querySelector(".pm-confirm-bar");
      if (bar) bar.style.display = "none";
    };
    window.__pmToggleMin = () => {
      isMinimized = !isMinimized;
      phoneWindow.classList.toggle("is-min", isMinimized);
      phoneWindow.style.removeProperty("transform");
    };
    window.__pmEnd = () => {
      if (currentPersona && conversationHistory.length) {
        const id = getStorageId2();
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        const saveKey = isGroupChat && currentGroupKey ? currentGroupKey : currentPersona;
        window.__pmHistories[id][saveKey] = conversationHistory.slice(-SAVE_LIMIT);
        saveHistories();
      }
      if (phoneWindow) {
        try {
          phoneWindow.hidePopover?.();
        } catch (e) {
        }
        phoneWindow.remove();
      }
      phoneWindow = null;
      phoneActive = false;
      isMinimized = false;
      isSelectMode = false;
      isGroupChat = false;
      groupMembers = [];
      groupColorMap = {};
      groupDisplayName = "";
      currentGroupKey = "";
      runtime.firstOpen = true;
      if (runtime.visibilityTimer) {
        clearInterval(runtime.visibilityTimer);
        runtime.visibilityTimer = null;
      }
    };
    function ensureVisibility() {
      if (!phoneWindow) return;
      const cs = getComputedStyle(phoneWindow);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") < 0.1) {
        phoneWindow.style.setProperty("display", "flex", "important");
        phoneWindow.style.setProperty("visibility", "visible", "important");
        phoneWindow.style.setProperty("opacity", "1", "important");
      }
    }
    runtime.visibilityTimer = setInterval(ensureVisibility, 2e3);
    window.__pmOpen = () => {
      if (phoneActive && phoneWindow) {
        try {
          phoneWindow.showPopover?.();
        } catch (e) {
        }
        phoneWindow.style.display = "flex";
        ensureVisibility();
        return;
      }
      if (!runtime.visibilityTimer) runtime.visibilityTimer = setInterval(ensureVisibility, 2e3);
      try {
        const saved = JSON.parse(localStorage.getItem("ST_SMS_CONFIG"));
        window.__pmConfig = saved || { apiUrl: "", apiKey: "", model: "", useIndependent: false };
        if (typeof window.__pmConfig.useIndependent === "undefined") window.__pmConfig.useIndependent = !!(window.__pmConfig.apiUrl && window.__pmConfig.apiKey);
      } catch (e) {
        window.__pmConfig = { apiUrl: "", apiKey: "", model: "", useIndependent: false };
      }
      loadProfiles();
      loadBidirectional();
      loadTheme();
      loadGroupMeta();
      loadPokeConfig();
      loadWordyLimit();
      migrateOldHistory();
      loadEmojis();
      loadBgSettings().then(() => {
        try {
          applyBackground();
        } catch (e) {
        }
      });
      hookGenerationEvent();
      const c = getCtx(), defaultChar = c?.characters?.[c.characterId]?.name ?? "AI";
      phoneWindow = document.createElement("div");
      phoneWindow.id = "pm-iphone";
      phoneWindow.dataset.layout = window.__pmTheme.layout || "standard";
      phoneWindow.setAttribute("data-theme", window.__pmTheme.darkMode || "light");
      if (POPOVER_SUPPORTED) phoneWindow.setAttribute("popover", "manual");
      phoneWindow.innerHTML = `
<div class="pm-island"></div>
<div class="pm-main-ui">
  <div class="pm-navbar">
    <button onclick="window.__pmShowList()" class="pm-nav-btn pm-nav-left-btn">\u2630</button>
    <div class="pm-name-wrap">
      <div class="pm-name">${escapeHtml(defaultChar)}</div>
      <button onclick="window.__pmEditGroup()" class="pm-name-edit is-hidden" title="\u7F16\u8F91">${EDIT_ICON_SVG}</button>
    </div>
    <div class="pm-nav-right">
      <button onclick="window.__pmToggleSelect()" class="pm-nav-btn pm-trash-btn">\u{1F5D1}</button>
      <button onclick="window.__pmShowConfig()" class="pm-nav-btn">\u2699</button>
      <button onclick="window.__pmEnd()" class="pm-nav-btn" style="color:#ff3b30">\u2715</button>
    </div>
  </div>
  <div class="pm-confirm-bar" style="display:none;">
    <span class="pm-confirm-tip">\u9009\u62E9\u8981\u5220\u9664\u7684\u6D88\u606F</span>
    <button onclick="window.__pmDeleteSelected()" class="pm-confirm-btn">\u5220\u9664\u6240\u9009</button>
    <button onclick="window.__pmToggleSelect()" class="pm-cancel-btn">\u53D6\u6D88</button>
  </div>
  <div class="pm-msg-list"></div>
  <div class="pm-input-bar">
    <button onclick="window.__pmShowExpandInput()" class="pm-expand-btn" title="\u5C55\u5F00\u957F\u6587\u672C\u8F93\u5165">\u2922</button>
    <input class="pm-input" placeholder="iMessage">
    <button onclick="window.__pmSend()" class="pm-up-btn">\u2191</button>
  </div>
</div>`;
      document.body.appendChild(phoneWindow);
      if (phoneWindow.showPopover) try {
        phoneWindow.showPopover();
      } catch (e) {
      }
      phoneActive = true;
      phoneWindow.querySelector(".pm-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          window.__pmSend();
        }
      });
      bindIsland(phoneWindow, phoneWindow.querySelector(".pm-island"));
      applyTheme();
      isGroupChat = false;
      groupMembers = [];
      groupColorMap = {};
      groupDisplayName = "";
      currentGroupKey = "";
      if (!runtime.firstOpen) {
        const doRender = () => {
          window.__pmSwitch(defaultChar);
          applyBidirectionalInjection();
          ensureVisibility();
        };
        if (window.__pmEmojis.length > 0) {
          doRender();
        } else {
          loadEmojis().then(doRender);
        }
      } else {
        runtime.firstOpen = false;
        const list = phoneWindow?.querySelector(".pm-msg-list");
        if (list) {
          list.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;font-size:13px;">\u6B63\u5728\u52A0\u8F7D\u5386\u53F2\u8BB0\u5F55\u2026</div>';
        }
        Promise.all([loadHistoriesFromIDB(), loadEmojis()]).then(() => {
          if (!phoneWindow) return;
          window.__pmSwitch(defaultChar);
          applyBidirectionalInjection();
          ensureVisibility();
        });
      }
    };
    function registerPhoneCommand() {
      const ctx = getCtx();
      if (!ctx) return false;
      const cb = () => {
        try {
          window.__pmOpen();
        } catch (e) {
          console.error("[phone-mode]", e);
        }
        return "";
      };
      try {
        const SCP = window.SlashCommandParser || ctx.SlashCommandParser, SC = window.SlashCommand || ctx.SlashCommand;
        if (SCP && SC && typeof SCP.addCommandObject === "function" && typeof SC.fromProps === "function") {
          SCP.addCommandObject(SC.fromProps({ name: "phone", callback: cb, helpString: "\u6253\u5F00\u77ED\u4FE1" }));
          return true;
        }
      } catch (e) {
      }
      try {
        if (typeof ctx.registerSlashCommand === "function") {
          ctx.registerSlashCommand("phone", cb, [], "\u6253\u5F00\u77ED\u4FE1", true, true);
          return true;
        }
      } catch (e) {
      }
      return false;
    }
    if (!registerPhoneCommand()) {
      let t = 0;
      const i = setInterval(() => {
        t++;
        if (registerPhoneCommand() || t >= 30) clearInterval(i);
      }, 500);
    }
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const ta = document.getElementById("send_textarea");
      if (!ta || document.activeElement !== ta) return;
      if (ta.value.trim() === "/phone") {
        e.preventDefault();
        e.stopImmediatePropagation();
        ta.value = "";
        window.__pmOpen();
      }
    }, true);
    document.addEventListener("click", (e) => {
      const btn = e.target.closest?.("#send_but");
      if (!btn) return;
      const ta = document.getElementById("send_textarea");
      if (!ta) return;
      if (ta.value.trim() === "/phone") {
        e.preventDefault();
        e.stopImmediatePropagation();
        ta.value = "";
        window.__pmOpen();
      }
    }, true);
    try {
      window.__pmHistories = window.__pmHistories || {};
    } catch (e) {
    }
    loadBidirectional();
    loadGroupMeta();
    loadPokeConfig();
    loadWordyLimit();
    loadHistoriesFromIDB();
    setTimeout(() => {
      migrateOldHistory();
      applyBidirectionalInjection();
      hookGenerationEvent();
    }, 1500);
    console.log("[phone-mode] v9.5.7 \u5DF2\u52A0\u8F7D\uFF1A\u4E16\u754C\u4E66\u9884\u7B97\u6539\u4E3A\u8BFB\u53D6ST\u5B9E\u9645\u4E0A\u4E0B\u6587\u7A97\u53E3\u5927\u5C0F");
  })();
})();
