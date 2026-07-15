(() => {
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

  // src/constants.js
  var SAVE_LIMIT = 60;
  var CONTEXT_LIMIT = 20;
  var BIDIRECTIONAL_LIMIT = 20;
  var MAX_BIDIRECTIONAL = 5;
  var BIDIRECTIONAL_KEY = "PHONE_SMS_MEMORY";
  var CHARACTER_BEHAVIOR_KEY = "ST_SMS_CHARACTER_BEHAVIOR";
  var VOICE_MAX_SEC = 60;
  var MODEL_VISIBLE_ROWS = 4;
  var MAX_GROUP_MEMBERS = 16;
  var MESSAGE_LENGTH_VALUES = Object.freeze(["persona", "short", "medium", "long"]);
  var FREQUENCY_VALUES = Object.freeze(["never", "rare", "occasional", "frequent"]);
  var MAX_INJECTION_DEPTH = 1e4;
  var EXTENSION_PROMPT_POSITIONS = Object.freeze({
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2
  });
  var DEFAULT_GROUP_INJECTION = Object.freeze({
    position: EXTENSION_PROMPT_POSITIONS.IN_PROMPT,
    depth: 0,
    historyLimit: BIDIRECTIONAL_LIMIT
  });
  var PM_IDB_NAME = "PhoneModeDB";
  var PM_IDB_STORE = "kv";
  var IDB_MARKER = "__idb__";
  var POPOVER_SUPPORTED = typeof HTMLElement !== "undefined" && HTMLElement.prototype.hasOwnProperty("popover");

  // src/behavior-config.js
  var DEFAULT_CHARACTER_BEHAVIOR = Object.freeze({
    privateStylePrompt: "",
    groupStylePrompt: "",
    messageLength: "persona",
    transferFrequency: "occasional",
    imageFrequency: "occasional",
    emojiFrequency: "occasional"
  });
  function plainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? value : {};
  }
  function safeKey(value, maxLength) {
    return text(value, maxLength);
  }
  function storeKey(value) {
    return typeof value === "string" && value.length > 0 ? value : "";
  }
  function setOwn(target, key, value) {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  function text(value, maxLength = 2e3) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  }
  function enumValue(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }
  function boundedInteger(value, fallback, min, max) {
    if (typeof value !== "number" && typeof value !== "string") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
  }
  function uniqueNames(value, excluded = /* @__PURE__ */ new Set()) {
    if (!Array.isArray(value)) return [];
    const seen = new Set(excluded);
    return value.flatMap((item) => {
      const name = text(item, 80);
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) return [];
      seen.add(key);
      return [name];
    });
  }
  function normalizeCharacterBehavior(value) {
    const source = plainObject(value);
    return {
      privateStylePrompt: text(source.privateStylePrompt),
      groupStylePrompt: text(source.groupStylePrompt),
      messageLength: enumValue(source.messageLength, MESSAGE_LENGTH_VALUES, DEFAULT_CHARACTER_BEHAVIOR.messageLength),
      transferFrequency: enumValue(source.transferFrequency, FREQUENCY_VALUES, DEFAULT_CHARACTER_BEHAVIOR.transferFrequency),
      imageFrequency: enumValue(source.imageFrequency, FREQUENCY_VALUES, DEFAULT_CHARACTER_BEHAVIOR.imageFrequency),
      emojiFrequency: enumValue(source.emojiFrequency, FREQUENCY_VALUES, DEFAULT_CHARACTER_BEHAVIOR.emojiFrequency)
    };
  }
  function normalizeCharacterBehaviorStore(value) {
    const result = {};
    for (const [storageId, entries] of Object.entries(plainObject(value))) {
      const cleanStorageId = storeKey(storageId);
      if (!cleanStorageId) continue;
      const normalizedEntries = {};
      const seenNames = /* @__PURE__ */ new Set();
      for (const [name, config] of Object.entries(plainObject(entries))) {
        const cleanName = safeKey(name, 80);
        const nameKey = cleanName.toLocaleLowerCase();
        if (cleanName && !seenNames.has(nameKey)) setOwn(normalizedEntries, cleanName, normalizeCharacterBehavior(config));
        if (cleanName) seenNames.add(nameKey);
      }
      if (Object.keys(normalizedEntries).length) setOwn(result, cleanStorageId, normalizedEntries);
    }
    return result;
  }
  function getCharacterBehavior(store, storageId, name) {
    const entries = Object.hasOwn(plainObject(store), storageId) ? plainObject(store)[storageId] : null;
    const config = Object.hasOwn(plainObject(entries), name) ? plainObject(entries)[name] : null;
    return normalizeCharacterBehavior(config);
  }
  var MESSAGE_LENGTH_LABELS = Object.freeze({
    persona: "\u8DDF\u968F\u89D2\u8272\u4EBA\u8BBE",
    short: "\u504F\u77ED",
    medium: "\u4E2D\u7B49",
    long: "\u504F\u957F"
  });
  var FREQUENCY_LABELS = Object.freeze({
    never: "\u4E0D\u8981\u4F7F\u7528",
    rare: "\u5F88\u5C11\u4F7F\u7528",
    occasional: "\u5076\u5C14\u4F7F\u7528",
    frequent: "\u7ECF\u5E38\u4F7F\u7528"
  });
  function buildCharacterBehaviorPrompt(store, storageId, names, isGroup) {
    const entries = Object.hasOwn(plainObject(store), storageId) ? plainObject(store)[storageId] : null;
    const lines = [];
    for (const rawName of Array.isArray(names) ? names : [names]) {
      const name = safeKey(rawName, 80);
      if (!name || !Object.hasOwn(plainObject(entries), name)) continue;
      const config = normalizeCharacterBehavior(plainObject(entries)[name]);
      const style = isGroup ? config.groupStylePrompt : config.privateStylePrompt;
      const rules = [
        style ? `\u7EBF\u4E0A\u98CE\u683C\uFF1A${style}` : "",
        `\u6D88\u606F\u957F\u5EA6\uFF1A${MESSAGE_LENGTH_LABELS[config.messageLength]}`,
        `\u8F6C\u8D26\uFF1A${FREQUENCY_LABELS[config.transferFrequency]}`,
        `\u56FE\u7247\uFF1A${FREQUENCY_LABELS[config.imageFrequency]}`,
        `\u8868\u60C5\u5305\uFF1A${FREQUENCY_LABELS[config.emojiFrequency]}`
      ].filter(Boolean).join("\uFF1B");
      lines.push(`${name}\uFF1A${rules}`);
    }
    if (!lines.length) return "";
    return `

[\u7528\u6237\u914D\u7F6E\u7684\u4F4E\u4F18\u5148\u7EA7\u804A\u5929\u884C\u4E3A]
${lines.join("\n")}
\u8FD9\u4E9B\u504F\u597D\u53EA\u8C03\u6574\u8868\u8FBE\u98CE\u683C\u4E0E\u4F7F\u7528\u9891\u7387\uFF0C\u4E0D\u5F97\u8986\u76D6\u7CFB\u7EDF\u683C\u5F0F\u3001\u89D2\u8272\u4E8B\u5B9E\u3001\u5B89\u5168\u8FB9\u754C\u6216\u5F53\u524D\u4EFB\u52A1\u8981\u6C42\u3002`;
  }
  function buildChatPreferencePrompt({
    store,
    storageId,
    names,
    isGroup,
    emojiPrompt = "",
    wordyPrompt = ""
  }) {
    const list = (Array.isArray(names) ? names : [names]).map((name) => safeKey(name, 80)).filter(Boolean);
    const entries = Object.hasOwn(plainObject(store), storageId) ? plainObject(store)[storageId] : null;
    const configured = list.flatMap((name) => Object.hasOwn(plainObject(entries), name) ? [{ name, config: normalizeCharacterBehavior(plainObject(entries)[name]) }] : []);
    const behaviorPrompt = buildCharacterBehaviorPrompt(store, storageId, list, isGroup);
    const emojiDisabled = configured.filter((item) => item.config.emojiFrequency === "never");
    let resolvedEmojiPrompt = emojiPrompt;
    if (emojiDisabled.length && emojiDisabled.length === list.length) {
      resolvedEmojiPrompt = "";
    } else if (resolvedEmojiPrompt && emojiDisabled.length) {
      resolvedEmojiPrompt += `
\u4EE5\u4E0B\u6210\u5458\u4E0D\u5F97\u4F7F\u7528\u8868\u60C5\u5305\uFF1A${emojiDisabled.map((item) => item.name).join("\u3001")}\u3002`;
    }
    return behaviorPrompt + resolvedEmojiPrompt + wordyPrompt;
  }
  function normalizeGroupInjection(value) {
    const source = plainObject(value);
    const allowedPositions = Object.values(EXTENSION_PROMPT_POSITIONS);
    return {
      position: enumValue(Number(source.position), allowedPositions, DEFAULT_GROUP_INJECTION.position),
      depth: boundedInteger(source.depth, DEFAULT_GROUP_INJECTION.depth, 0, MAX_INJECTION_DEPTH),
      historyLimit: boundedInteger(source.historyLimit, DEFAULT_GROUP_INJECTION.historyLimit, 1, 100)
    };
  }
  function normalizeGroupMeta(value) {
    const source = plainObject(value);
    const members = uniqueNames(source.members);
    const memberKeys = new Set(members.map((name) => name.toLocaleLowerCase()));
    const extras = uniqueNames(source.extras, memberKeys);
    const allowedNames = new Map([...members, ...extras].map((name) => [name.toLocaleLowerCase(), name]));
    const memberColors = {};
    for (const [name, color] of Object.entries(plainObject(source.memberColors))) {
      const canonicalName = allowedNames.get(name.trim().toLocaleLowerCase());
      if (canonicalName && typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) setOwn(memberColors, canonicalName, color);
    }
    return {
      ...source,
      name: text(source.name, 80),
      members,
      extras,
      memberColors,
      injection: normalizeGroupInjection(source.injection)
    };
  }
  function normalizeGroupMetaStore(value) {
    const result = {};
    for (const [storageId, groups] of Object.entries(plainObject(value))) {
      const cleanStorageId = storeKey(storageId);
      if (!cleanStorageId) continue;
      const normalizedGroups = {};
      for (const [groupKey, meta] of Object.entries(plainObject(groups))) {
        const cleanGroupKey = storeKey(groupKey);
        if (!cleanGroupKey) continue;
        const normalized = normalizeGroupMeta(meta);
        if (normalized.name && normalized.members.length >= 2) setOwn(normalizedGroups, cleanGroupKey, normalized);
      }
      if (Object.keys(normalizedGroups).length) setOwn(result, cleanStorageId, normalizedGroups);
    }
    return result;
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
      window.__pmGroupMeta = normalizeGroupMetaStore(JSON.parse(localStorage.getItem("ST_SMS_GROUP_META")) || {});
    } catch (error) {
      window.__pmGroupMeta = {};
    }
  }
  function saveGroupMeta() {
    window.__pmGroupMeta = normalizeGroupMetaStore(window.__pmGroupMeta);
    try {
      localStorage.setItem("ST_SMS_GROUP_META", JSON.stringify(window.__pmGroupMeta));
    } catch (error) {
    }
  }
  function loadCharacterBehavior() {
    try {
      window.__pmCharacterBehavior = normalizeCharacterBehaviorStore(
        JSON.parse(localStorage.getItem(CHARACTER_BEHAVIOR_KEY)) || {}
      );
    } catch (error) {
      window.__pmCharacterBehavior = {};
    }
  }
  function saveCharacterBehavior() {
    window.__pmCharacterBehavior = normalizeCharacterBehaviorStore(window.__pmCharacterBehavior);
    try {
      localStorage.setItem(CHARACTER_BEHAVIOR_KEY, JSON.stringify(window.__pmCharacterBehavior));
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

  // src/contact-generator.js
  var MAX_TOTAL = 10;
  function getDirectoryState(id) {
    const histories = window.__pmHistories[id] || {};
    const groups = window.__pmGroupMeta[id] || {};
    const contacts = Object.keys(histories).filter((key) => !key.startsWith("__group_"));
    const groupNames = Object.values(groups).map((group) => group.name).filter(Boolean);
    return { histories, groups, contacts, groupNames, total: contacts.length + groupNames.length };
  }
  function setSpinning(active) {
    const icon2 = document.getElementById("pm-autogen-icon");
    const button = document.getElementById("pm-autogen-btn");
    if (icon2) icon2.style.animation = active ? "pm-spin 0.8s linear infinite" : "";
    if (button) button.style.pointerEvents = active ? "none" : "";
  }
  function buildPrompts(context, existingNames, maxNew) {
    const { cardDesc, cardPersonality, cardScenario, mainChatText, worldBookText, userName, userDesc } = context;
    const minNew = Math.min(3, maxNew);
    const existingText = existingNames.length ? `\u5DF2\u6709\u8054\u7CFB\u4EBA/\u7FA4\u804A\uFF08\u8DF3\u8FC7\u540C\u540D\uFF09\uFF1A${existingNames.join("\u3001")}` : "\u76EE\u524D\u6682\u65E0\u8054\u7CFB\u4EBA\u3002";
    const amountText = minNew === maxNew ? `${maxNew}` : `${minNew} \u5230 ${maxNew}`;
    const systemPrompt = `\u4F60\u662F\u4E00\u4E2A\u89D2\u8272\u626E\u6F14\u8F85\u52A9\u5DE5\u5177\uFF0C\u8D1F\u8D23\u6839\u636E\u5F53\u524D\u5267\u60C5\u80CC\u666F\u81EA\u52A8\u751F\u6210\u7B26\u5408\u4E16\u754C\u89C2\u7684\u8054\u7CFB\u4EBA\u5217\u8868\u3002
\u8F93\u51FA\u5FC5\u987B\u4E25\u683C\u4E3A JSON\uFF1A{"contacts":["\u89D2\u8272\u540D"],"groups":[{"name":"\u7FA4\u804A\u540D\u79F0","members":["\u6210\u54581","\u6210\u54582"]}]}
\u8981\u6C42\uFF1A
1. contacts \u662F\u5355\u4E2A\u8054\u7CFB\u4EBA\uFF0Cgroups \u662F\u7FA4\u804A\uFF08\u6BCF\u4E2A\u7FA4 2~15 \u4E2A\u6210\u5458\uFF09
2. \u751F\u6210\u603B\u6570\u4E3A ${amountText} \u4E2A
3. \u540D\u79F0\u5FC5\u987B\u7B26\u5408\u5F53\u524D\u5267\u60C5\u4E16\u754C\u89C2
4. \u4E0D\u5F97\u4E0E ${existingText} \u540C\u540D\uFF08\u5FFD\u7565\u5927\u5C0F\u5199\uFF09
5. \u4E0D\u751F\u6210\u7528\u6237\u81EA\u5DF1\uFF08${userName}\uFF09\uFF0C\u8054\u7CFB\u4EBA\u540D\u3001\u7FA4\u804A\u540D\u548C\u7FA4\u804A\u6210\u5458\u5747\u4E0D\u5F97\u4F7F\u7528\u8BE5\u7528\u6237\u540D\uFF08\u5FFD\u7565\u5927\u5C0F\u5199\uFF09
6. \u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8F93\u51FA\u6CE8\u91CA\u6216 markdown`;
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
      existingText,
      `\u8BF7\u751F\u6210 ${amountText} \u4E2A\u7B26\u5408\u4EE5\u4E0A\u80CC\u666F\u7684\u8054\u7CFB\u4EBA\u548C/\u6216\u7FA4\u804A\uFF0C\u4EE5 JSON \u8F93\u51FA\u3002`
    ].filter(Boolean).join("\n\n");
    return { systemPrompt, userPrompt };
  }
  function parseGeneratedDirectory(raw) {
    const text2 = String(raw ?? "").trim();
    const fenced = text2.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const jsonText = fenced ? fenced[1].trim() : text2;
    if (!jsonText) throw new Error("AI \u8FD4\u56DE\u4E86\u7A7A\u5185\u5BB9");
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      throw new Error(`AI \u8FD4\u56DE\u683C\u5F0F\u65E0\u6CD5\u89E3\u6790\uFF1A${jsonText.slice(0, 100)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AI \u8FD4\u56DE\u7684 JSON \u9876\u5C42\u5FC5\u987B\u662F\u5BF9\u8C61");
    return parsed;
  }
  function installContactGenerator(state, deps) {
    const {
      getStorageId: getStorageId2,
      gatherContext: gatherContext2,
      callAI,
      beginGeneration,
      isGenerationTaskActive,
      finishGeneration
    } = deps;
    window.__pmConfirmAutoGen = () => {
      const id = getStorageId2();
      if (!id || id === "sms_unknown__default") return;
      const { total } = getDirectoryState(id);
      if (total >= MAX_TOTAL) {
        alert(`\u5DF2\u6709 ${total} \u4E2A\u8054\u7CFB\u4EBA/\u7FA4\u804A\uFF0C\u5DF2\u8FBE\u4E0A\u9650\uFF08${MAX_TOTAL}\uFF09\uFF0C\u65E0\u6CD5\u7EE7\u7EED\u751F\u6210\u3002`);
        return;
      }
      const canAdd = MAX_TOTAL - total;
      if (!confirm(`AI \u5C06\u6839\u636E\u5F53\u524D\u5267\u60C5\u4FE1\u606F\u81EA\u52A8\u751F\u6210\u8054\u7CFB\u4EBA\u548C\u7FA4\u804A\uFF08\u6700\u591A ${canAdd} \u4E2A\uFF09\uFF0C\u76F4\u63A5\u5199\u5165\u5217\u8868\uFF0C\u662F\u5426\u7EE7\u7EED\uFF1F`)) return;
      window.__pmAutoGenContacts();
    };
    window.__pmAutoGenContacts = async () => {
      const id = getStorageId2();
      if (!id || id === "sms_unknown__default") return;
      const directory = getDirectoryState(id);
      const maxNew = Math.min(MAX_TOTAL - directory.total, MAX_TOTAL);
      if (maxNew <= 0) return;
      const task = beginGeneration(id);
      if (!task) return;
      setSpinning(true);
      try {
        const context = await gatherContext2(task.context);
        if (!isGenerationTaskActive(task)) return;
        const existingNames = [...directory.contacts, ...directory.groupNames];
        const { systemPrompt, userPrompt } = buildPrompts(context, existingNames, maxNew);
        const raw = await callAI(systemPrompt, userPrompt, { maxTokens: 600 });
        if (!isGenerationTaskActive(task)) return;
        const parsed = parseGeneratedDirectory(raw);
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
        const latestDirectory = getDirectoryState(id);
        const remaining = Math.max(0, MAX_TOTAL - latestDirectory.total);
        const knownNames = new Set([...latestDirectory.contacts, ...latestDirectory.groupNames].map((name) => name.toLowerCase()));
        const userName = String(context.userName || "").trim().toLowerCase();
        let added = 0;
        for (const value of Array.isArray(parsed.contacts) ? parsed.contacts : []) {
          if (added >= remaining) break;
          if (typeof value !== "string") continue;
          const name = value.trim();
          const normalized = name.toLowerCase();
          if (!name || normalized === userName || knownNames.has(normalized)) continue;
          window.__pmHistories[id][name] = [];
          knownNames.add(normalized);
          added++;
        }
        for (const group of Array.isArray(parsed.groups) ? parsed.groups : []) {
          if (added >= remaining) break;
          const name = typeof group?.name === "string" ? group.name.trim() : "";
          const normalized = name.toLowerCase();
          if (!name || normalized === userName || knownNames.has(normalized) || !Array.isArray(group.members)) continue;
          const memberNames = /* @__PURE__ */ new Set();
          const members = [];
          for (const value of group.members) {
            if (typeof value !== "string") continue;
            const member = value.trim();
            const memberKey = member.toLowerCase();
            if (!member || memberKey === userName || memberNames.has(memberKey)) continue;
            memberNames.add(memberKey);
            members.push(member);
            if (members.length >= 15) break;
          }
          if (members.length < 2) continue;
          const groupKey = `__group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          window.__pmGroupMeta[id][groupKey] = { name, members };
          knownNames.add(normalized);
          added++;
        }
        if (!isGenerationTaskActive(task)) return;
        saveHistories();
        saveGroupMeta();
        if (document.getElementById("pm-autogen-btn")) window.__pmShowList();
      } catch (error) {
        console.error("[phone-mode] __pmAutoGenContacts \u5F02\u5E38", error);
        if (isGenerationTaskActive(task)) alert(`\u81EA\u52A8\u751F\u6210\u5931\u8D25\uFF1A${error?.message || error}`);
      } finally {
        const finishedOwnTask = finishGeneration(task);
        if (finishedOwnTask || !state.generationTask) setSpinning(false);
      }
    };
  }

  // src/prompts.js
  function cleanResponse(raw) {
    return (raw ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "").replace(/<reflection>[\s\S]*?<\/reflection>/gi, "").replace(/<inner_thought>[\s\S]*?<\/inner_thought>/gi, "").replace(/<scene>[\s\S]*?<\/scene>/gi, "").replace(/<narration>[\s\S]*?<\/narration>/gi, "").replace(/<action>[\s\S]*?<\/action>/gi, "").replace(/\x60{3}[\s\S]*?\x60{3}/g, "").replace(/^.*【[^】]{2,}】.*$/gm, "").replace(/---+[\s\S]*$/g, "").replace(/<[^>]+>/g, "").trim();
  }
  function splitToSentences(str, stripFn = null) {
    const protectedText = (str || "").replace(/[\(（][^)）]*[\)）]/g, (match) => match.replace(/\//g, ""));
    return protectedText.split(/\s*\/\s*/).map((part) => {
      let text2 = part.replace(/\u0001/g, "/").trim();
      if (stripFn) text2 = stripFn(text2);
      if (!text2 || text2 === ")" || text2 === "\uFF09" || text2 === "(" || text2 === "\uFF08") return "";
      const opens = (text2.match(/[（(]/g) || []).length;
      const closes = (text2.match(/[）)]/g) || []).length;
      if (opens > closes) text2 += "\uFF09".repeat(opens - closes);
      else if (closes > opens && opens === 0) text2 = text2.replace(/^[)）]+\s*/, "").replace(/\s*[)）]+$/, "");
      return text2;
    }).filter(Boolean).flatMap((text2) => {
      const parts = [];
      let lastIndex = 0;
      let match;
      const emojiPattern = /\[emo:[^\]]+\]/g;
      while ((match = emojiPattern.exec(text2)) !== null) {
        const before = text2.slice(lastIndex, match.index).trim();
        if (before) parts.push(before);
        parts.push(match[0]);
        lastIndex = match.index + match[0].length;
      }
      const after = text2.slice(lastIndex).trim();
      if (after) parts.push(after);
      return parts.length ? parts : [text2];
    }).filter(Boolean).slice(0, 15);
  }

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

  // src/conversation.js
  function getSaveKey(state) {
    return state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
  }
  function persistCurrentHistory(state, getStorageId2, saveKeyOverride, storageIdOverride, historyOverride) {
    const id = storageIdOverride || state.activeStorageId || getStorageId2();
    if (!id || id === "sms_unknown__default") {
      console.warn("[phone-mode] persistCurrentHistory: storageId \u5C1A\u672A\u5C31\u7EEA\uFF0C\u8DF3\u8FC7\u4FDD\u5B58");
      return false;
    }
    const saveKey = saveKeyOverride ?? getSaveKey(state);
    if (typeof saveKey !== "string" || !saveKey.trim()) return false;
    if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
    const history = Array.isArray(historyOverride) ? historyOverride : state.conversationHistory;
    window.__pmHistories[id][saveKey.trim()] = history.slice(-SAVE_LIMIT);
    saveHistories();
    return true;
  }
  function getStoredHistory(id, saveKey) {
    const history = window.__pmHistories[id]?.[saveKey];
    return Array.isArray(history) ? history.slice(-SAVE_LIMIT) : [];
  }
  function installConversation(state, deps) {
    const {
      getStorageId: getStorageId2,
      addNote,
      addBubble,
      addDirector,
      fitNameFont,
      applyBackground,
      applyBidirectionalInjection
    } = deps;
    window.__pmSwitchContact = (key) => {
      if (!key?.trim()) return;
      key = key.trim();
      loadGroupMeta();
      const id = getStorageId2();
      if (!id || id === "sms_unknown__default") {
        console.warn("[phone-mode] __pmSwitchContact: SillyTavern \u4E0A\u4E0B\u6587\u5C1A\u672A\u5C31\u7EEA\uFF0CstorageId \u65E0\u6548\uFF0C\u8DF3\u8FC7\u5207\u6362");
        return;
      }
      const groupMeta = window.__pmGroupMeta[id]?.[key];
      const _prevSaveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
      const _prevStorageId = state.activeStorageId;
      state.activeStorageId = id;
      if (groupMeta) {
        state.isGroupChat = true;
        state.currentGroupKey = key;
        state.groupMembers = groupMeta.members.slice();
        state.groupDisplayName = groupMeta.name;
        state.groupColorMap = {};
        state.groupMembers.forEach((n, i) => {
          state.groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length];
        });
      } else {
        state.isGroupChat = false;
        state.groupMembers = [];
        state.groupColorMap = {};
        state.groupDisplayName = "";
        state.currentGroupKey = "";
      }
      window.__pmSwitch(key, _prevSaveKey, _prevStorageId);
    };
    window.__pmSwitch = (name, _prevSaveKey, _prevStorageId) => {
      if (!name?.trim()) return;
      name = name.trim();
      deps.closeControlCenter?.();
      deps.closeOverlay?.("conversation-switch");
      const id = getStorageId2();
      if (!id || id === "sms_unknown__default") {
        console.warn("[phone-mode] __pmSwitch: storageId \u5C1A\u672A\u5C31\u7EEA\uFF0C\u8DF3\u8FC7\u5207\u6362");
        return;
      }
      if (_prevSaveKey || state.currentPersona) {
        persistCurrentHistory(state, getStorageId2, _prevSaveKey ?? getSaveKey(state), _prevStorageId);
      }
      state.activeStorageId = id;
      state.currentPersona = name;
      state.conversationHistory = getStoredHistory(id, name);
      if (state.phoneWindow) {
        const nameEl = state.phoneWindow.querySelector(".pm-name");
        const editBtn = state.phoneWindow.querySelector(".pm-name-edit");
        if (nameEl) {
          if (state.isGroupChat) {
            const display = state.groupDisplayName || name;
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
        const list = state.phoneWindow.querySelector(".pm-msg-list");
        list.innerHTML = "";
        if (state.conversationHistory.length > 0) {
          addNote("\u5386\u53F2\u8BB0\u5F55");
          state.conversationHistory.forEach((m, hi) => {
            if (state.isGroupChat && m.role === "assistant") {
              const lines = m.content.split("\n");
              for (const line of lines) {
                const match = line.match(/^(.{1,20})[：:]\s*(.+)$/);
                if (match && state.groupMembers.some((gm) => gm.toLowerCase() === match[1].trim().toLowerCase())) {
                  const sender = state.groupMembers.find((gm) => gm.toLowerCase() === match[1].trim().toLowerCase());
                  splitToSentences(match[2]).forEach((s) => addBubble(s, "left", sender, hi));
                } else {
                  splitToSentences(line).forEach((s) => addBubble(s, "left", void 0, hi));
                }
              }
            } else {
              if (m.role === "user" && m.directorNote) addDirector(m.directorNote, { historyIndex: hi });
              splitToSentences(m.content).forEach((s) => addBubble(
                s,
                m.role === "user" ? "right" : "left",
                void 0,
                hi
              ));
            }
          });
          addNote("\u2500\u2500 \u4EE5\u4E0A\u4E3A\u5386\u53F2 \u2500\u2500");
        } else addNote("\u5F00\u59CB\u5BF9\u8BDD");
        deps.renderPendingConversation?.(id, name);
        applyBackground();
      }
      applyBidirectionalInjection();
    };
    Object.assign(deps, {
      persistCurrentHistory: (saveKey, storageId, history) => persistCurrentHistory(state, getStorageId2, saveKey, storageId, history),
      getSaveKey: () => getSaveKey(state)
    });
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
      const input = document.querySelector(".pm-input");
      window.__pmTempText = input ? input.value : "";
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
    <span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">\u2715</span>
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
      const text2 = window.__pmTempText || "";
      document.getElementById("pm-overlay")?.remove();
      const input = document.querySelector(".pm-input");
      if (!input) return;
      input.value = text2 + code + " ";
      window.__pmTempText = input.value;
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
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

  // src/history-window.js
  function createHistoryWindow(history, limit) {
    const source = Array.isArray(history) ? history : [];
    const size = Number.isInteger(limit) && limit > 0 ? limit : source.length;
    const trimmedCount = Math.max(0, source.length - size);
    return {
      history: source.slice(trimmedCount),
      trimmedCount,
      toWindowIndex(sourceIndex) {
        if (!Number.isInteger(sourceIndex)) return null;
        const index = sourceIndex - trimmedCount;
        return index >= 0 && index < Math.min(source.length, size) ? index : null;
      }
    };
  }

  // src/pending-messages.js
  function getStorageBucket(runtime, storageId, create = false) {
    if (!(runtime.pendingMessages instanceof Map) || !storageId) return null;
    let bucket = runtime.pendingMessages.get(storageId);
    if (!bucket && create) {
      bucket = /* @__PURE__ */ new Map();
      runtime.pendingMessages.set(storageId, bucket);
    }
    return bucket || null;
  }
  function getPendingMessages(runtime, storageId, saveKey) {
    const items = getStorageBucket(runtime, storageId)?.get(saveKey);
    return Array.isArray(items) ? items : [];
  }
  function getPendingMessage(runtime, storageId, saveKey, itemId) {
    return getPendingMessages(runtime, storageId, saveKey).find((item) => item.id === itemId) || null;
  }
  function addPendingMessage(runtime, storageId, saveKey, value) {
    if (!storageId || !saveKey) return null;
    const rawText = String(value?.rawText || "").trim();
    const plainText = String(value?.plainText || "").trim();
    const directorNote = String(value?.directorNote || "").trim();
    const bubbleParts = Array.isArray(value?.bubbleParts) ? value.bubbleParts.map(String).filter(Boolean) : [];
    if (!plainText && !directorNote) return null;
    const bucket = getStorageBucket(runtime, storageId, true);
    let items = bucket.get(saveKey);
    if (!Array.isArray(items)) {
      items = [];
      bucket.set(saveKey, items);
    }
    const item = {
      id: ++runtime.pendingSequence,
      rawText,
      plainText,
      directorNote,
      bubbleParts,
      status: "pending",
      createdAt: Date.now()
    };
    items.push(item);
    return item;
  }
  function updatePendingMessage(runtime, storageId, saveKey, itemId, value) {
    const item = getPendingMessage(runtime, storageId, saveKey, itemId);
    if (!item || item.status === "submitting") return null;
    const plainText = String(value?.plainText || "").trim();
    const directorNote = String(value?.directorNote || "").trim();
    if (!plainText && !directorNote) return null;
    item.rawText = String(value?.rawText || "").trim();
    item.plainText = plainText;
    item.directorNote = directorNote;
    item.bubbleParts = Array.isArray(value?.bubbleParts) ? value.bubbleParts.map(String).filter(Boolean) : [];
    item.status = "pending";
    return item;
  }
  function removePendingMessage(runtime, storageId, saveKey, itemId) {
    const bucket = getStorageBucket(runtime, storageId);
    const items = bucket?.get(saveKey);
    if (!Array.isArray(items)) return false;
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) return false;
    if (items[index].status === "submitting") return false;
    items.splice(index, 1);
    if (!items.length) bucket.delete(saveKey);
    if (!bucket.size) runtime.pendingMessages.delete(storageId);
    return true;
  }
  function clearPendingMessages(runtime, storageId, saveKey) {
    const bucket = getStorageBucket(runtime, storageId);
    if (!bucket?.delete(saveKey)) return false;
    if (!bucket.size) runtime.pendingMessages.delete(storageId);
    return true;
  }
  function setPendingBatchStatus(runtime, storageId, saveKey, itemIds, status) {
    const ids = new Set(itemIds);
    let changed = 0;
    for (const item of getPendingMessages(runtime, storageId, saveKey)) {
      if (!ids.has(item.id)) continue;
      item.status = status;
      changed += 1;
    }
    return changed;
  }
  function removePendingBatch(runtime, storageId, saveKey, itemIds) {
    const ids = new Set(itemIds);
    const bucket = getStorageBucket(runtime, storageId);
    const items = bucket?.get(saveKey);
    if (!Array.isArray(items)) return 0;
    let removed = 0;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (!ids.has(items[index].id)) continue;
      items.splice(index, 1);
      removed += 1;
    }
    if (!items.length) bucket.delete(saveKey);
    if (!bucket.size) runtime.pendingMessages.delete(storageId);
    return removed;
  }
  function combinePendingMessages(runtime, storageId, saveKey) {
    const items = getPendingMessages(runtime, storageId, saveKey);
    return {
      items,
      plainText: items.map((item) => item.plainText).filter(Boolean).join(" / "),
      directorNote: items.map((item) => item.directorNote).filter(Boolean).join("\uFF1B"),
      bubbleParts: items.flatMap((item) => item.bubbleParts)
    };
  }

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
  function resolveEmojiText(text2, emojis) {
    return (text2 || "").replace(/\[emo:([^\]:]+):(\d+)\]/g, (match, setName, index) => {
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
      let text2 = (value || "").trim();
      const outer = text2.match(/^[\(（]\s*(.{1,20}?)\s*[：:]\s*([\s\S]+?)\s*[\)）]\s*$/);
      if (outer && memberMap.has(normalizeName(outer[1]))) {
        return outer[2].trim();
      }
      for (let index = 0; index < 3; index++) {
        const match = text2.match(speakerPattern);
        if (!match || !memberMap.has(normalizeName(match[1]))) break;
        text2 = match[2].trim();
      }
      return text2;
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
  function createBubbles(text2, side, senderName, { groupColorMap, groupMembers, emojis }) {
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
    while ((match = specialPattern.exec(text2)) !== null) {
      if (match.index > lastIndex) pushPlain(text2.slice(lastIndex, match.index));
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
    if (lastIndex < text2.length) pushPlain(text2.slice(lastIndex));
    if (!results.length) pushPlain(text2);
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

  // src/chat-prompts.js
  function buildUserBlock(userName, userDesc) {
    return [`\u7528\u6237\u540D\u5B57\uFF1A${userName}`, userDesc ? `\u7528\u6237\u4EBA\u8BBE\uFF1A${userDesc}` : ""].filter(Boolean).join("\n");
  }
  function buildHistoryText(history, limit, userName, personaName, excludeLast = false) {
    const slice = excludeLast ? history.slice(-limit, -1) : history.slice(-limit);
    return slice.map((m) => {
      const clean = cleanResponse(m.content);
      const director = m.directorNote ? `[\u5267\u60C5\u5F15\u5BFC] ${m.directorNote}` : "";
      const userLine = clean ? `${userName}\uFF1A${clean}` : "";
      if (m.role === "user") return [userLine, director].filter(Boolean).join("\n");
      if (personaName) return `${personaName}\uFF1A${clean}`;
      return clean;
    }).filter(Boolean).join("\n");
  }
  function buildAntiFluff() {
    return "\u3010\u52A1\u5FC5\u76F4\u63A5\u6309\u683C\u5F0F\u8F93\u51FA\u77ED\u4FE1\u5185\u5BB9\uFF0C\u4E25\u7981\u5728\u5F00\u5934\u8F93\u51FA\u201C\u597D\u7684\u201D\u3001\u201C\u4E0B\u9762\u662F\u201D\u7B49\u4EFB\u4F55\u8BF4\u660E\u6027\u5E9F\u8BDD\uFF0C\u4E25\u7981\u8F93\u51FA\u975E\u89D2\u8272\u7684\u8BED\u8A00\u3002\u3011";
  }
  function buildSingleInjectedInstruction({
    currentPersona,
    userName,
    userBlock,
    contextBlockMain,
    smsHistoryText,
    directorNote,
    userMsgClean,
    userMsg
  }) {
    return `
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
  }
  function buildSingleSystemPrompt({
    currentPersona,
    userName,
    userBlock,
    cardDesc,
    cardPersonality,
    cardScenario,
    cardFirstMes,
    cardMesExample,
    worldBookText,
    mainChatText
  }) {
    return [
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
  function buildGroupInjectedInstruction({
    groupName,
    memberList,
    userName,
    userBlock,
    cardScenario,
    worldBookText,
    smsHistoryText,
    directorNote,
    userMsgClean,
    userMsg
  }) {
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
    return `${groupRules}

\u3010\u7528\u6237\u4FE1\u606F\u3011
${userBlock}

${cardScenario ? "\u3010\u573A\u666F\u3011\n" + cardScenario + "\n\n" : ""}${worldBookText ? "\u3010\u4E16\u754C\u4E66\u3011\n" + worldBookText + "\n\n" : ""}\u7FA4\u804A\u5386\u53F2\uFF1A
${smsHistoryText}
${directorNote ? `
[\u5267\u60C5\u5F15\u5BFC] ${directorNote}
` : ""}
${userMsg.trim() ? `${userName}\uFF1A${userMsgClean}` : "[\u4EC5\u6709\u5267\u60C5\u5F15\u5BFC\uFF0C\u65E0\u7528\u6237\u53D1\u8A00\uFF0C\u8BF7\u6309\u5F15\u5BFC\u63A8\u8FDB\u5267\u60C5]"}`;
  }
  function buildGroupSystemPrompt({
    memberList,
    groupName,
    userName,
    userBlock,
    cardDesc,
    cardPersonality,
    cardScenario,
    worldBookText,
    mainChatText
  }) {
    return [
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
  }
  function buildPokeSinglePrompt({
    contactName,
    userName,
    userBlock,
    cardDesc,
    cardPersonality,
    cardScenario,
    cardMesExample,
    worldBookText,
    mainChatText,
    smsHistoryText
  }) {
    return `\u7528\u6237\u6709\u4E00\u6BB5\u65F6\u95F4\u6CA1\u6709\u56DE\u590D\u3002\u4F5C\u4E3A${contactName}\uFF0C\u6839\u636E\u4F60\u7684\u4EBA\u8BBE\u548C\u5F53\u524D\u804A\u5929\u60C5\u5883\uFF0C\u81EA\u7136\u5730\u53D1\u9001 3-8 \u53E5\u77ED\u4FE1\u7EE7\u7EED\u5BF9\u8BDD\u6216\u53D1\u8D77\u65B0\u8BDD\u9898\uFF0C\u4E0D\u8981\u63D0\u53CA\u7528\u6237\u6CA1\u6709\u56DE\u590D\u8FD9\u4EF6\u4E8B\u3002

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

\u8F93\u51FA\u683C\u5F0F\uFF1A\u77ED\u4FE1\u5185\u5BB9 / \u77ED\u4FE1\u5185\u5BB9\uFF08\u6BCF\u53E5\u7528 / \u5206\u9694\uFF0C\u7279\u6B8A\u683C\u5F0F\u4E2D\u6587\u5355\u884C\u95ED\u5408\uFF09`;
  }
  function buildPokeGroupPrompt({
    groupName,
    memberList,
    userName,
    userBlock,
    cardDesc,
    cardPersonality,
    cardScenario,
    worldBookText,
    mainChatText,
    smsHistoryText
  }) {
    return `\u7FA4\u804A\u540D\u79F0\uFF1A${groupName}
\u7FA4\u804A\u6210\u5458\uFF1A${memberList}

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
${smsHistoryText}`;
  }
  function buildPokeGroupActivePrompt({
    groupDisplayName,
    memberList,
    userName,
    userBlock,
    cardDesc,
    cardPersonality,
    cardScenario,
    worldBookText,
    mainChatText,
    smsHistoryText
  }) {
    return `\u7FA4\u804A\u540D\u79F0\uFF1A${groupDisplayName || "\u7FA4\u804A"}
\u7FA4\u804A\u6210\u5458\uFF1A${memberList}

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
${smsHistoryText}`;
  }
  function buildIndependentSingleUserPrompt({
    smsHistoryText,
    directorNote,
    userMsgClean,
    userMsg,
    userName,
    currentPersona
  }) {
    return `\u3010\u77ED\u4FE1\u5BF9\u8BDD\u5386\u53F2\u3011
${smsHistoryText}
${directorNote ? `
[\u5267\u60C5\u5F15\u5BFC] ${directorNote}
` : ""}${userMsg.trim() ? `
${userName}\uFF1A${userMsgClean}
${currentPersona}\uFF1A` : `
[\u4EC5\u6709\u5267\u60C5\u5F15\u5BFC\uFF0C\u65E0\u7528\u6237\u53D1\u8A00\uFF0C\u8BF7\u6309\u5F15\u5BFC\u63A8\u8FDB\u5267\u60C5]
${currentPersona}\uFF1A`}`;
  }
  function buildIndependentGroupUserPrompt({
    smsHistoryText,
    directorNote,
    userMsgClean,
    userMsg,
    userName
  }) {
    return `\u3010\u7FA4\u804A\u5386\u53F2\u3011
${smsHistoryText}
${directorNote ? `
[\u5267\u60C5\u5F15\u5BFC] ${directorNote}
` : ""}${userMsg.trim() ? `
${userName}\uFF1A${userMsgClean}` : "\n[\u4EC5\u6709\u5267\u60C5\u5F15\u5BFC\uFF0C\u65E0\u7528\u6237\u53D1\u8A00\uFF0C\u8BF7\u6309\u5F15\u5BFC\u63A8\u8FDB\u5267\u60C5]"}`;
  }
  function buildPokeSystemPrompt(isGroup, contactName, userName) {
    if (isGroup) {
      return `\u4F60\u540C\u65F6\u626E\u6F14\u7FA4\u804A\u4E2D\u7684\u6240\u6709\u6210\u5458\u3002
\u3010\u52A1\u5FC5\u76F4\u63A5\u6309\u683C\u5F0F\u8F93\u51FA\u77ED\u4FE1\u5185\u5BB9\uFF0C\u4E25\u7981\u5728\u5F00\u5934\u8F93\u51FA\u201C\u597D\u7684\u201D\u7B49\u5E9F\u8BDD\u3002\u3011`;
    }
    return `\u4F60\u6B63\u5728\u626E\u6F14"${contactName}"\u901A\u8FC7\u624B\u673A\u77ED\u4FE1\u4E0E\u7528\u6237 ${userName} \u804A\u5929\u3002
\u3010\u52A1\u5FC5\u76F4\u63A5\u6309\u683C\u5F0F\u8F93\u51FA\u77ED\u4FE1\u5185\u5BB9\uFF0C\u4E25\u7981\u5728\u5F00\u5934\u8F93\u51FA\u201C\u597D\u7684\u201D\u7B49\u5E9F\u8BDD\u3002\u3011`;
  }

  // src/phone-chat.js
  function installPhoneChat(state, deps) {
    const {
      runtime,
      getStorageId: getStorageId2,
      gatherContext: gatherContext2,
      callAI,
      applyBidirectionalInjection,
      addBubble,
      addNote,
      addDirector,
      rebaseRenderedHistory,
      showTyping,
      hideTyping,
      persistCurrentHistory: persistCurrentHistory2,
      beginGeneration,
      isGenerationTaskActive,
      finishGeneration
    } = deps;
    async function fetchSMS(userMsg, directorNote, task, request) {
      const {
        storageId,
        saveKey,
        isGroup,
        currentPersona,
        groupMembers,
        groupDisplayName,
        targetHistory
      } = request;
      const userMsgClean = userMsg.replace(/\[emo:([^\]:]+):(\d+)\]/g, (_, setName, idxStr) => {
        const set = (window.__pmEmojis || []).find((item) => item.name === setName);
        const image = set?.images?.[parseInt(idxStr, 10) - 1];
        return image?.desc ? `[\u8868\u60C5\u5305\uFF1A${image.desc}]` : "[\u8868\u60C5\u5305]";
      }).replace(/\s{2,}/g, " ").trim();
      const ctxData = await gatherContext2(task.context);
      if (!isGenerationTaskActive(task)) return null;
      const { cardDesc, cardPersonality, cardScenario, cardFirstMes, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;
      const userBlock = buildUserBlock(userName, userDesc);
      const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, isGroup ? null : currentPersona);
      let injectedInstruction, systemPrompt;
      if (isGroup) {
        const memberList = groupMembers.join("\u3001");
        const groupName = groupDisplayName || `\u7FA4\u804A\uFF1A${memberList}`;
        injectedInstruction = buildGroupInjectedInstruction({
          groupName,
          memberList,
          userName,
          userBlock,
          cardScenario,
          worldBookText,
          smsHistoryText,
          directorNote,
          userMsgClean,
          userMsg
        });
        systemPrompt = buildGroupSystemPrompt({
          memberList,
          groupName,
          userName,
          userBlock,
          cardDesc,
          cardPersonality,
          cardScenario,
          worldBookText,
          mainChatText
        });
      } else {
        const contextBlockMain = [
          cardScenario ? `\u3010\u573A\u666F\u53C2\u8003\u3011
${cardScenario}` : "",
          cardMesExample ? `\u3010\u5BF9\u8BDD\u793A\u4F8B\u3011
${cardMesExample}` : ""
        ].filter(Boolean).join("\n\n");
        injectedInstruction = buildSingleInjectedInstruction({
          currentPersona,
          userName,
          userBlock,
          contextBlockMain,
          smsHistoryText,
          directorNote,
          userMsgClean,
          userMsg
        });
        systemPrompt = buildSingleSystemPrompt({
          currentPersona,
          userName,
          userBlock,
          cardDesc,
          cardPersonality,
          cardScenario,
          cardFirstMes,
          cardMesExample,
          worldBookText,
          mainChatText
        });
      }
      const antiFluff = buildAntiFluff();
      const preferencePrompt = buildChatPreferencePrompt({
        store: window.__pmCharacterBehavior,
        storageId,
        names: isGroup ? groupMembers : currentPersona,
        isGroup,
        emojiPrompt: getEmojiPrompt(saveKey, storageId, window.__pmPokeConfig, window.__pmEmojis),
        wordyPrompt: getWordyPrompt(window.__pmWordyLimit)
      });
      if (preferencePrompt) {
        systemPrompt += preferencePrompt;
        injectedInstruction += preferencePrompt;
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
          const indepUserPrompt = isGroup ? buildIndependentGroupUserPrompt({
            smsHistoryText,
            directorNote,
            userMsgClean,
            userMsg,
            userName
          }) : buildIndependentSingleUserPrompt({
            smsHistoryText,
            directorNote,
            userMsgClean,
            userMsg,
            userName,
            currentPersona
          });
          raw = await callAI(systemPrompt, indepUserPrompt, { maxTokens: isGroup ? 600 : 300 });
        } else {
          raw = await callAI("", injectedInstruction, { maxTokens: isGroup ? 600 : 300 });
        }
        if (!isGenerationTaskActive(task)) return null;
        if (request.userHistoryEntry) {
          targetHistory.push(request.userHistoryEntry);
        }
        let resultData;
        if (isGroup) {
          const parsed = parseGroupResponse(raw, groupMembers);
          if (parsed.length) {
            const contentParts = parsed.map((p) => `${p.name}\uFF1A${p.sentences.join(" / ")}`);
            targetHistory.push({ role: "assistant", content: contentParts.join("\n") });
            resultData = { type: "group", data: parsed };
          } else {
            console.warn("[phone-mode] \u26A0\uFE0F \u7FA4\u804A\u683C\u5F0F\u89E3\u6790\u5931\u8D25\uFF01AI \u539F\u59CB\u8FD4\u56DE\u5185\u5BB9\uFF1A", raw);
            targetHistory.push({ role: "assistant", content: "\uFF08\u683C\u5F0F\u65E0\u6CD5\u89E3\u6790\u6216AI\u62D2\u7B54\uFF09" });
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
          targetHistory.push({ role: "assistant", content: sentences.join(" / ") });
          resultData = { type: "single", data: sentences };
        }
        persistCurrentHistory2(saveKey, storageId, targetHistory);
        if (isGenerationTaskActive(task)) applyBidirectionalInjection();
        return resultData;
      } catch (e) {
        console.error("[phone-mode]", e);
        if (!isGenerationTaskActive(task)) return null;
        throw e;
      }
    }
    function parsePendingInput(value) {
      const rawText = String(value || "").trim();
      if (!rawText) return null;
      const placeholder = "";
      const emojiSlots = [];
      const protectedText = rawText.replace(/\[emo:[^\]]+\]/g, (match2) => {
        emojiSlots.push(match2);
        return `${placeholder}${emojiSlots.length - 1}${placeholder}`;
      });
      const directorPattern = /[【\[［]([^】\]］]+)[】\]］]/g;
      const directorNotes = [];
      let match;
      while ((match = directorPattern.exec(protectedText)) !== null) directorNotes.push(match[1].trim());
      const plainProtected = protectedText.replace(/[【\[［][^】\]］]*[】\]］]/g, "").trim();
      const plainText = plainProtected.replace(
        new RegExp(`${placeholder}(\\d+)${placeholder}`, "g"),
        (_, index) => emojiSlots[Number(index)] || ""
      );
      const protectedSlashes = plainText.replace(/[\(（][^)）]+[\)）]/g, (value2) => value2.replace(/\//g, ""));
      const chunks = protectedSlashes.split(/[/／]/).map((value2) => value2.replace(/\u0001/g, "/").trim()).filter(Boolean);
      const bubbleParts = chunks.flatMap((chunk) => {
        const parts = [];
        let lastIndex = 0;
        const emojiPattern = /\[emo:[^\]]+\]/g;
        while ((match = emojiPattern.exec(chunk)) !== null) {
          const before = chunk.slice(lastIndex, match.index).trim();
          if (before) parts.push(before);
          parts.push(match[0]);
          lastIndex = match.index + match[0].length;
        }
        const after = chunk.slice(lastIndex).trim();
        if (after) parts.push(after);
        return parts.length ? parts : [chunk];
      });
      const directorNote = directorNotes.join("\uFF1B");
      return plainText || directorNote ? { rawText, plainText, directorNote, bubbleParts } : null;
    }
    function getPendingTarget() {
      const storageId = state.activeStorageId || getStorageId2();
      const saveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
      if (!storageId || storageId === "sms_unknown__default" || !saveKey) return null;
      return { storageId, saveKey };
    }
    function renderPendingItem(item) {
      const metadata = { pendingId: item.id, pendingStatus: item.status };
      if (item.directorNote) addDirector(item.directorNote, metadata);
      for (const part of item.bubbleParts) addBubble(part, "right", void 0, void 0, metadata);
    }
    function renderPendingConversation(storageId, saveKey) {
      const list = state.phoneWindow?.querySelector(".pm-msg-list");
      if (!list) return;
      for (const node of list.querySelectorAll(".pm-pending-entry")) {
        if (!node.parentElement?.closest(".pm-pending-entry")) node.remove();
      }
      for (const item of getPendingMessages(runtime, storageId, saveKey)) renderPendingItem(item);
    }
    function updatePendingDomStatus(itemIds, status) {
      const ids = new Set(itemIds.map(String));
      for (const node of state.phoneWindow?.querySelectorAll("[data-pending-id]") || []) {
        if (ids.has(node.dataset.pendingId)) node.dataset.pendingStatus = status;
      }
    }
    function queuePendingText(value) {
      const target = getPendingTarget();
      const parsed = parsePendingInput(value);
      if (!target || !parsed) return null;
      const item = addPendingMessage(runtime, target.storageId, target.saveKey, parsed);
      if (!item) return null;
      renderPendingItem(item);
      return item;
    }
    window.__pmSend = () => {
      const input = state.phoneWindow?.querySelector(".pm-input");
      if (!input || !queuePendingText(input.value)) return;
      input.value = "";
      window.__pmRefreshControlCenter?.();
      input.focus();
    };
    window.__pmSubmitPending = async () => {
      if (state.isGenerating) return;
      const target = getPendingTarget();
      if (!target) return;
      const combined = combinePendingMessages(runtime, target.storageId, target.saveKey);
      const batch = combined.items.filter((item) => item.status !== "submitting");
      if (!batch.length) return;
      const itemIds = batch.map((item) => item.id);
      const task = beginGeneration(target.storageId);
      if (!task) return;
      setPendingBatchStatus(runtime, target.storageId, target.saveKey, itemIds, "submitting");
      updatePendingDomStatus(itemIds, "submitting");
      window.__pmRefreshControlCenter?.();
      const request = {
        storageId: target.storageId,
        saveKey: target.saveKey,
        isGroup: state.isGroupChat,
        currentPersona: state.currentPersona,
        groupMembers: state.groupMembers.slice(),
        groupDisplayName: state.groupDisplayName,
        targetHistory: state.conversationHistory.slice(),
        userHistoryEntry: {
          role: "user",
          content: combined.plainText,
          ...combined.directorNote ? { directorNote: combined.directorNote } : {}
        }
      };
      const isStillTarget = () => isGenerationTaskActive(task) && state.activeStorageId === target.storageId && (state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona) === target.saveKey;
      if (isStillTarget()) showTyping();
      try {
        const result = await fetchSMS(combined.plainText, combined.directorNote, task, request);
        if (!result || !isGenerationTaskActive(task)) return;
        if (isStillTarget()) hideTyping();
        const historyWindow = createHistoryWindow(request.targetHistory, SAVE_LIMIT);
        const userHistoryIndex = historyWindow.toWindowIndex(request.targetHistory.length - 2);
        const aiHistoryIndex = historyWindow.toWindowIndex(request.targetHistory.length - 1);
        removePendingBatch(runtime, target.storageId, target.saveKey, itemIds);
        if (isStillTarget()) {
          rebaseRenderedHistory(historyWindow.trimmedCount);
          state.conversationHistory = historyWindow.history;
          const ids = new Set(itemIds.map(String));
          for (const node of state.phoneWindow?.querySelectorAll("[data-pending-id]") || []) {
            if (!ids.has(node.dataset.pendingId)) continue;
            node.classList.remove("pm-pending-entry");
            delete node.dataset.pendingId;
            delete node.dataset.pendingStatus;
            if (userHistoryIndex !== null) node.dataset.historyIndex = String(userHistoryIndex);
          }
        }
        if (result.type === "group") {
          for (const block of result.data) {
            for (const sentence of block.sentences) {
              await new Promise((resolve) => setTimeout(resolve, 120));
              if (isStillTarget()) addBubble(sentence, "left", block.name, aiHistoryIndex);
            }
          }
        } else {
          for (const sentence of result.data) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            if (isStillTarget()) addBubble(sentence, "left", void 0, aiHistoryIndex);
          }
        }
        setTimeout(() => {
          if (!state.isGenerating && typeof window.__pmIncrementCounters === "function") window.__pmIncrementCounters();
        }, 300);
      } catch (error) {
        setPendingBatchStatus(runtime, target.storageId, target.saveKey, itemIds, "failed");
        updatePendingDomStatus(itemIds, "failed");
        if (isStillTarget()) {
          hideTyping();
          addNote(`\uFF08\u53D1\u9001\u5931\u8D25\uFF1A${error?.message || error}\uFF0C\u6682\u5B58\u5185\u5BB9\u5DF2\u4FDD\u7559\uFF09`);
        }
        console.error("[phone-mode] __pmSubmitPending \u5F02\u5E38", error);
      } finally {
        const remaining = getPendingMessages(runtime, target.storageId, target.saveKey);
        const remainingIds = new Set(remaining.map((item) => item.id));
        const interruptedIds = itemIds.filter((itemId) => remainingIds.has(itemId));
        if (interruptedIds.length) {
          setPendingBatchStatus(runtime, target.storageId, target.saveKey, interruptedIds, "failed");
          updatePendingDomStatus(interruptedIds, "failed");
        }
        finishGeneration(task);
        window.__pmRefreshControlCenter?.();
      }
    };
    Object.assign(deps, {
      parsePendingInput,
      queuePendingText,
      renderPendingItem,
      renderPendingConversation
    });
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
        if (counterEl && configs[state.currentPersona]) counterEl.textContent = configs[state.currentPersona].autoPoke.counter;
        const groupCounterEl = document.getElementById("pm-poke-counter-group");
        if (groupCounterEl && state.currentGroupKey && configs[state.currentGroupKey]) groupCounterEl.textContent = configs[state.currentGroupKey].autoPoke.counter;
      }
      if (toPoke.length > 0) {
        (async () => {
          for (const contact of toPoke) {
            await window.__pmAutoPoke(contact);
          }
        })();
      }
    };
    Object.assign(deps, { fetchSMS });
  }

  // src/phone-chat-poke.js
  function installPhoneChatPoke(state, deps) {
    const {
      getStorageId: getStorageId2,
      gatherContext: gatherContext2,
      callAI,
      applyBidirectionalInjection,
      addBubble,
      addNote,
      rebaseRenderedHistory,
      showTyping,
      hideTyping,
      makeOverlay,
      showGroupForm,
      beginGeneration,
      isGenerationTaskActive,
      finishGeneration
    } = deps;
    window.__pmAutoPoke = async (contactName) => {
      if (state.isGenerating) return;
      const id = getStorageId2();
      if (!id || id === "sms_unknown__default") return;
      const task = beginGeneration(id);
      if (!task) return;
      const groupMeta = window.__pmGroupMeta[id]?.[contactName];
      const isGroup = !!groupMeta;
      const groupMembers = groupMeta?.members?.slice() || [];
      const isActiveView = state.phoneActive && state.activeStorageId === id && (isGroup && state.currentGroupKey === contactName || !isGroup && state.currentPersona === contactName);
      const isStillActiveView = () => isGenerationTaskActive(task) && state.phoneActive && state.activeStorageId === id && (isGroup && state.isGroupChat && state.currentGroupKey === contactName || !isGroup && !state.isGroupChat && state.currentPersona === contactName);
      if (isActiveView) {
        showTyping();
      }
      try {
        const ctxData = await gatherContext2(task.context);
        if (!isGenerationTaskActive(task)) return;
        const { cardDesc, cardPersonality, cardScenario, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;
        const userBlock = buildUserBlock(userName, userDesc);
        let targetHistory = (window.__pmHistories[id]?.[contactName] || []).slice();
        const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, isGroup ? null : contactName);
        const systemPrompt = buildPokeSystemPrompt(isGroup, contactName, userName);
        const basePrompt = isGroup ? buildPokeGroupPrompt({
          groupName: groupMeta.name,
          memberList: groupMembers.join("\u3001"),
          userName,
          userBlock,
          cardDesc,
          cardPersonality,
          cardScenario,
          worldBookText,
          mainChatText,
          smsHistoryText
        }) : buildPokeSinglePrompt({
          contactName,
          userName,
          userBlock,
          cardDesc,
          cardPersonality,
          cardScenario,
          cardMesExample,
          worldBookText,
          mainChatText,
          smsHistoryText
        });
        const userPrompt = basePrompt + buildChatPreferencePrompt({
          store: window.__pmCharacterBehavior,
          storageId: id,
          names: isGroup ? groupMembers : contactName,
          isGroup,
          emojiPrompt: getEmojiPrompt(contactName, id, window.__pmPokeConfig, window.__pmEmojis),
          wordyPrompt: getWordyPrompt(window.__pmWordyLimit)
        });
        const raw = await callAI(systemPrompt, userPrompt);
        if (!isGenerationTaskActive(task)) return;
        let historyUpdated = false;
        const renderActive = isStillActiveView();
        if (renderActive) hideTyping();
        if (isGroup) {
          const parsed = parseGroupResponse(raw, groupMembers);
          const blocks = parsed.filter((block) => block.sentences.length > 0);
          const contentParts = blocks.map((block) => `${block.name}\uFF1A${block.sentences.join(" / ")}`);
          if (contentParts.length > 0) {
            targetHistory.push({ role: "assistant", content: contentParts.join("\n") });
            historyUpdated = true;
            const historyWindow = createHistoryWindow(targetHistory, SAVE_LIMIT);
            const historyIndex = historyWindow.toWindowIndex(targetHistory.length - 1);
            if (renderActive) rebaseRenderedHistory(historyWindow.trimmedCount);
            if (renderActive && historyIndex !== null) {
              for (const block of blocks) {
                for (const s of block.sentences) {
                  await new Promise((r) => setTimeout(r, 120));
                  if (!isGenerationTaskActive(task)) return;
                  if (isStillActiveView()) addBubble(s, "left", block.name, historyIndex);
                }
              }
            }
          }
        } else {
          const clean = cleanResponse(raw);
          const sentences = splitToSentences(clean);
          if (sentences.length > 0) {
            targetHistory.push({ role: "assistant", content: sentences.join(" / ") });
            historyUpdated = true;
            if (renderActive) {
              const historyWindow = createHistoryWindow(targetHistory, SAVE_LIMIT);
              const historyIndex = historyWindow.toWindowIndex(targetHistory.length - 1);
              rebaseRenderedHistory(historyWindow.trimmedCount);
              if (historyIndex !== null) {
                for (const s of sentences) {
                  await new Promise((r) => setTimeout(r, 150));
                  if (!isGenerationTaskActive(task)) return;
                  if (isStillActiveView()) addBubble(s, "left", void 0, historyIndex);
                  if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
                  window.__pmHistories[id][contactName] = historyWindow.history;
                  saveHistories();
                }
              }
            }
          }
        }
        if (historyUpdated) {
          if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
          const newHistory = createHistoryWindow(targetHistory, SAVE_LIMIT).history;
          window.__pmHistories[id][contactName] = newHistory;
          if (isStillActiveView()) {
            state.conversationHistory = newHistory;
          }
          saveHistories();
          if (isGenerationTaskActive(task)) applyBidirectionalInjection();
        }
      } catch (e) {
        if (isStillActiveView()) hideTyping();
        console.error("[phone-mode] \u81EA\u52A8\u53D1\u6D88\u606F\u5931\u8D25", e);
      } finally {
        finishGeneration(task);
      }
    };
    function showContactConfig(contactName) {
      const id = getStorageId2();
      const config = window.__pmPokeConfig[id]?.[contactName] || {
        autoPoke: { enabled: false, interval: 3, counter: 0 }
      };
      const behavior = getCharacterBehavior(window.__pmCharacterBehavior, id, contactName);
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
    <div class="pm-contact-settings-scroll">
        <div class="pm-cfg-label">\u79C1\u804A\u7EBF\u4E0A\u98CE\u683C</div>
        <textarea id="pm-behavior-private" class="pm-cfg-input" rows="2" maxlength="2000" placeholder="\u4F8B\u5982\uFF1A\u56DE\u590D\u514B\u5236\u3001\u5C11\u7528\u8BED\u6C14\u8BCD">${escapeHtml(behavior.privateStylePrompt)}</textarea>
        <div class="pm-cfg-label">\u7FA4\u804A\u53D1\u8A00\u98CE\u683C</div>
        <textarea id="pm-behavior-group" class="pm-cfg-input" rows="2" maxlength="2000" placeholder="\u4F8B\u5982\uFF1A\u7FA4\u91CC\u66F4\u7B80\u77ED\uFF0C\u5076\u5C14\u63A5\u8BDD">${escapeHtml(behavior.groupStylePrompt)}</textarea>
        <div class="pm-behavior-grid">
          <label>\u6D88\u606F\u957F\u77ED
            <select id="pm-behavior-length" class="pm-cfg-input">
              <option value="persona" ${behavior.messageLength === "persona" ? "selected" : ""}>\u8DDF\u968F\u4EBA\u8BBE</option>
              <option value="short" ${behavior.messageLength === "short" ? "selected" : ""}>\u504F\u77ED</option>
              <option value="medium" ${behavior.messageLength === "medium" ? "selected" : ""}>\u4E2D\u7B49</option>
              <option value="long" ${behavior.messageLength === "long" ? "selected" : ""}>\u504F\u957F</option>
            </select>
          </label>
          ${[
        ["transfer", "\u8F6C\u8D26\u9891\u7387", behavior.transferFrequency],
        ["image", "\u56FE\u7247\u9891\u7387", behavior.imageFrequency],
        ["emoji", "\u8868\u60C5\u5305\u9891\u7387", behavior.emojiFrequency]
      ].map(([key, label, value]) => `<label>${label}
            <select id="pm-behavior-${key}" class="pm-cfg-input">
              <option value="never" ${value === "never" ? "selected" : ""}>\u7981\u7528</option>
              <option value="rare" ${value === "rare" ? "selected" : ""}>\u5F88\u5C11</option>
              <option value="occasional" ${value === "occasional" ? "selected" : ""}>\u5076\u5C14</option>
              <option value="frequent" ${value === "frequent" ? "selected" : ""}>\u7ECF\u5E38</option>
            </select>
          </label>`).join("")}
        </div>
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
    window.__pmShowCharacterBehavior = (contactName) => showContactConfig(contactName);
    window.__pmShowConversationSettings = () => {
      if (!state.isGroupChat) {
        showContactConfig(state.currentPersona);
        return;
      }
      const members = state.groupMembers.slice();
      makeOverlay(`
    <div class="pm-modal pm-modal-wide">
      <div class="pm-modal-header"><b>\u6210\u5458\u804A\u5929\u884C\u4E3A</b><span onclick="window.__pmCloseOverlay()" class="pm-modal-close">\u2715</span></div>
      <div class="pm-member-behavior-list">
        ${members.map((name) => `<button onclick="window.__pmShowCharacterBehavior('${safeJS(name)}')">
          <b>${escapeHtml(name)}</b><span>\u79C1\u804A\u98CE\u683C\u3001\u7FA4\u804A\u98CE\u683C\u4E0E\u6D88\u606F\u9891\u7387</span>
        </button>`).join("")}
      </div>
      <div class="pm-modal-add">
        <button onclick="window.__pmEditGroup()" style="width:100%;">\u7FA4\u804A\u4FE1\u606F\u4E0E\u81EA\u52A8\u6D88\u606F</button>
      </div>
    </div>`);
    };
    window.__pmSaveAndCloseContactConfig = (contactName) => {
      const checkEl = document.getElementById("pm-poke-check");
      const intervalEl = document.getElementById("pm-poke-interval");
      const emojiChecks = document.querySelectorAll(".pm-emoji-assign-check.is-checked");
      const selectedEmojis = Array.from(emojiChecks).map((cb) => cb.dataset.id);
      const id = getStorageId2();
      if (!window.__pmCharacterBehavior[id]) window.__pmCharacterBehavior[id] = {};
      const behavior = normalizeCharacterBehavior({
        privateStylePrompt: document.getElementById("pm-behavior-private")?.value || "",
        groupStylePrompt: document.getElementById("pm-behavior-group")?.value || "",
        messageLength: document.getElementById("pm-behavior-length")?.value,
        transferFrequency: document.getElementById("pm-behavior-transfer")?.value,
        imageFrequency: document.getElementById("pm-behavior-image")?.value,
        emojiFrequency: document.getElementById("pm-behavior-emoji")?.value
      });
      Object.defineProperty(window.__pmCharacterBehavior[id], contactName, {
        value: behavior,
        enumerable: true,
        configurable: true,
        writable: true
      });
      saveCharacterBehavior();
      if (checkEl && intervalEl) {
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
    window.__pmToggleAutoPoke = (contactName) => {
      const checkEl = document.getElementById("pm-poke-check");
      const intervalEl = document.getElementById("pm-poke-interval");
      if (!checkEl) return;
      const isChecked = checkEl.classList.toggle("is-checked");
      if (intervalEl) intervalEl.disabled = !isChecked;
    };
    window.__pmPoke = async (contactName) => {
      if (state.isGenerating) return;
      const id = getStorageId2();
      if (window.__pmPokeConfig[id]?.[contactName]) {
        window.__pmPokeConfig[id][contactName].autoPoke.counter = 0;
        savePokeConfig();
      }
      document.getElementById("pm-overlay")?.remove();
      if (state.currentPersona !== contactName) {
        window.__pmSwitchContact(contactName);
      }
      const storageId = state.activeStorageId || id;
      const saveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
      if (!storageId || storageId === "sms_unknown__default" || saveKey !== contactName) {
        console.warn("[phone-mode] __pmPoke: \u76EE\u6807\u4F1A\u8BDD\u672A\u6210\u529F\u5207\u6362\uFF0C\u53D6\u6D88\u751F\u6210");
        return;
      }
      const task = beginGeneration(storageId);
      if (!task) return;
      showTyping();
      const targetHistory = state.conversationHistory.slice();
      const isGroup = state.isGroupChat;
      const groupDisplayName = state.groupDisplayName;
      const groupMembers = state.groupMembers.slice();
      const isStillTarget = () => isGenerationTaskActive(task) && state.activeStorageId === storageId && (state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona) === saveKey;
      try {
        const ctxData = await gatherContext2(task.context);
        if (!isGenerationTaskActive(task)) return;
        const { cardDesc, cardPersonality, cardScenario, cardMesExample, mainChatText, worldBookText, userName, userDesc } = ctxData;
        const userBlock = buildUserBlock(userName, userDesc);
        const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, isGroup ? null : contactName);
        const systemPrompt = buildPokeSystemPrompt(isGroup, contactName, userName);
        const targetContactKey = saveKey;
        const basePrompt = isGroup ? buildPokeGroupPrompt({
          groupName: groupDisplayName || "\u7FA4\u804A",
          memberList: groupMembers.join("\u3001"),
          userName,
          userBlock,
          cardDesc,
          cardPersonality,
          cardScenario,
          worldBookText,
          mainChatText,
          smsHistoryText
        }) : buildPokeSinglePrompt({
          contactName,
          userName,
          userBlock,
          cardDesc,
          cardPersonality,
          cardScenario,
          cardMesExample,
          worldBookText,
          mainChatText,
          smsHistoryText
        });
        const userPrompt = basePrompt + buildChatPreferencePrompt({
          store: window.__pmCharacterBehavior,
          storageId,
          names: isGroup ? groupMembers : contactName,
          isGroup,
          emojiPrompt: getEmojiPrompt(targetContactKey, storageId, window.__pmPokeConfig, window.__pmEmojis),
          wordyPrompt: getWordyPrompt(window.__pmWordyLimit)
        });
        const raw = await callAI(systemPrompt, userPrompt);
        if (!isGenerationTaskActive(task)) return;
        let historyUpdated = false;
        if (isStillTarget()) hideTyping();
        if (isGroup) {
          const parsed = parseGroupResponse(raw, groupMembers);
          const blocks = parsed.filter((block) => block.sentences.length > 0);
          const contentParts = blocks.map((block) => `${block.name}\uFF1A${block.sentences.join(" / ")}`);
          if (contentParts.length > 0) {
            targetHistory.push({ role: "assistant", content: contentParts.join("\n") });
            historyUpdated = true;
            const historyWindow = createHistoryWindow(targetHistory, SAVE_LIMIT);
            const historyIndex = historyWindow.toWindowIndex(targetHistory.length - 1);
            if (isStillTarget()) rebaseRenderedHistory(historyWindow.trimmedCount);
            if (historyIndex !== null) {
              for (const block of blocks) {
                for (const s of block.sentences) {
                  await new Promise((r) => setTimeout(r, 120));
                  if (!isGenerationTaskActive(task)) return;
                  if (isStillTarget()) addBubble(s, "left", block.name, historyIndex);
                }
              }
            }
          }
        } else {
          const clean = cleanResponse(raw);
          const sentences = splitToSentences(clean);
          if (sentences.length > 0) {
            targetHistory.push({ role: "assistant", content: sentences.join(" / ") });
            historyUpdated = true;
            const historyWindow = createHistoryWindow(targetHistory, SAVE_LIMIT);
            const historyIndex = historyWindow.toWindowIndex(targetHistory.length - 1);
            if (isStillTarget()) rebaseRenderedHistory(historyWindow.trimmedCount);
            if (historyIndex !== null) {
              for (const s of sentences) {
                await new Promise((r) => setTimeout(r, 150));
                if (!isGenerationTaskActive(task)) return;
                if (isStillTarget()) addBubble(s, "left", void 0, historyIndex);
              }
            }
          }
        }
        if (historyUpdated) {
          if (!window.__pmHistories[storageId]) window.__pmHistories[storageId] = {};
          window.__pmHistories[storageId][saveKey] = createHistoryWindow(targetHistory, SAVE_LIMIT).history;
          if (isStillTarget()) state.conversationHistory = window.__pmHistories[storageId][saveKey];
          saveHistories();
          if (isGenerationTaskActive(task)) applyBidirectionalInjection();
        }
      } catch (e) {
        if (isStillTarget()) {
          hideTyping();
          addNote(`\uFF08\u53D1\u9001\u5931\u8D25\uFF1A${e?.message || e}\uFF09`);
        }
      } finally {
        finishGeneration(task);
      }
    };
    window.__pmEditGroup = () => {
      if (!state.isGroupChat) {
        showContactConfig(state.currentPersona);
      } else {
        showGroupForm("edit", state.groupDisplayName, state.groupMembers);
      }
    };
    window.__pmToggleAutoPokeGroup = () => {
      const checkEl = document.getElementById("pm-poke-check-group");
      const intervalEl = document.getElementById("pm-poke-interval-group");
      if (!checkEl) return;
      const isChecked = checkEl.classList.toggle("is-checked");
      if (intervalEl) intervalEl.disabled = !isChecked;
    };
    window.__pmPokeGroup = async () => {
      if (!state.isGroupChat || !state.currentGroupKey) return;
      if (state.isGenerating) return;
      const id = getStorageId2();
      const storageId = state.activeStorageId || id;
      const saveKey = state.currentGroupKey;
      if (!storageId || storageId === "sms_unknown__default") return;
      if (window.__pmPokeConfig[storageId]?.[saveKey]) {
        window.__pmPokeConfig[storageId][saveKey].autoPoke.counter = 0;
        savePokeConfig();
      }
      document.getElementById("pm-overlay")?.remove();
      const task = beginGeneration(storageId);
      if (!task) return;
      showTyping();
      const targetHistory = state.conversationHistory.slice();
      const groupDisplayName = state.groupDisplayName;
      const groupMembers = state.groupMembers.slice();
      const isStillTarget = () => isGenerationTaskActive(task) && state.activeStorageId === storageId && state.isGroupChat && state.currentGroupKey === saveKey;
      try {
        const ctxData = await gatherContext2(task.context);
        if (!isGenerationTaskActive(task)) return;
        const { cardDesc, cardPersonality, cardScenario, mainChatText, worldBookText, userName, userDesc } = ctxData;
        const userBlock = buildUserBlock(userName, userDesc);
        const smsHistoryText = buildHistoryText(targetHistory, CONTEXT_LIMIT, userName, null);
        const systemPrompt = buildPokeSystemPrompt(true, saveKey, userName);
        const userPrompt = buildPokeGroupActivePrompt({
          groupDisplayName,
          memberList: groupMembers.join("\u3001"),
          userName,
          userBlock,
          cardDesc,
          cardPersonality,
          cardScenario,
          worldBookText,
          mainChatText,
          smsHistoryText
        }) + buildChatPreferencePrompt({
          store: window.__pmCharacterBehavior,
          storageId,
          names: groupMembers,
          isGroup: true,
          emojiPrompt: getEmojiPrompt(saveKey, storageId, window.__pmPokeConfig, window.__pmEmojis),
          wordyPrompt: getWordyPrompt(window.__pmWordyLimit)
        });
        const raw = await callAI(systemPrompt, userPrompt);
        if (!isGenerationTaskActive(task)) return;
        if (isStillTarget()) hideTyping();
        const parsed = parseGroupResponse(raw, groupMembers);
        let renderedTrimmedCount = 0;
        for (const block of parsed) {
          if (block.sentences.length > 0) {
            targetHistory.push({ role: "assistant", content: `${block.name}\uFF1A${block.sentences.join(" / ")}` });
            const historyWindow = createHistoryWindow(targetHistory, SAVE_LIMIT);
            const historyIndex = historyWindow.toWindowIndex(targetHistory.length - 1);
            const newlyTrimmed = historyWindow.trimmedCount - renderedTrimmedCount;
            if (isStillTarget()) rebaseRenderedHistory(newlyTrimmed);
            renderedTrimmedCount = historyWindow.trimmedCount;
            if (!window.__pmHistories[storageId]) window.__pmHistories[storageId] = {};
            window.__pmHistories[storageId][saveKey] = historyWindow.history;
            if (isStillTarget()) state.conversationHistory = historyWindow.history;
            saveHistories();
            if (historyIndex !== null) {
              for (const s of block.sentences) {
                await new Promise((r) => setTimeout(r, 120));
                if (!isGenerationTaskActive(task)) return;
                if (isStillTarget()) addBubble(s, "left", block.name, historyIndex);
              }
            }
          }
        }
        if (parsed.some((block) => block.sentences.length > 0)) {
          if (isGenerationTaskActive(task)) applyBidirectionalInjection();
        }
      } catch (e) {
        if (isStillTarget()) {
          hideTyping();
          addNote(`\uFF08\u53D1\u9001\u5931\u8D25\uFF1A${e?.message || e}\uFF09`);
        }
      } finally {
        finishGeneration(task);
      }
    };
  }

  // src/phone-control-center.js
  function installPhoneControlCenter(state, deps) {
    const {
      runtime,
      getStorageId: getStorageId2,
      makeOverlay,
      parsePendingInput,
      renderPendingConversation,
      syncGenerationControls
    } = deps;
    const CONTROL_MENU_ID = "pm-control-menu";
    let outsideClickHandler = null;
    let escapeKeyHandler = null;
    const getTarget = () => {
      const storageId = state.activeStorageId || getStorageId2();
      const saveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
      return storageId && storageId !== "sms_unknown__default" && saveKey ? { storageId, saveKey } : null;
    };
    function renderPendingList() {
      const target = getTarget();
      const items = target ? getPendingMessages(runtime, target.storageId, target.saveKey) : [];
      if (!items.length) return '<div class="pm-pending-empty">\u8FD8\u6CA1\u6709\u6682\u5B58\u6D88\u606F</div>';
      return items.map((item) => `
<div class="pm-pending-row" data-item-id="${item.id}">
  ${editingTarget?.itemId === item.id ? `
    <input id="pm-pending-edit-input" class="pm-cfg-input" value="${escapeAttr(item.rawText || item.plainText || `\u3010${item.directorNote}\u3011`)}">
    <button onclick="window.__pmSavePendingEdit(${item.id})">\u4FDD\u5B58</button>
    <button onclick="window.__pmCancelPendingEdit()">\u53D6\u6D88</button>
  ` : `
    <div class="pm-pending-copy">
      <span class="pm-pending-state" data-status="${item.status}">${item.status === "failed" ? "\u63D0\u4EA4\u5931\u8D25" : item.status === "submitting" ? "\u63D0\u4EA4\u4E2D" : "\u5F85\u63D0\u4EA4"}</span>
      <div>${escapeHtml(item.rawText || item.plainText || `\u3010${item.directorNote}\u3011`)}</div>
    </div>
    <button onclick="window.__pmEditPending(${item.id})" ${item.status === "submitting" ? "disabled" : ""}>\u7F16\u8F91</button>
    <button onclick="window.__pmDeletePending(${item.id})" ${item.status === "submitting" ? "disabled" : ""}>\u5220\u9664</button>
  `}
</div>`).join("");
    }
    window.__pmRefreshControlCenter = () => {
      const list = document.getElementById("pm-pending-list");
      if (list) list.innerHTML = renderPendingList();
      const target = getTarget();
      const items = target ? getPendingMessages(runtime, target.storageId, target.saveKey) : [];
      const count = items.length;
      const hasSubmitting = items.some((item) => item.status === "submitting");
      const heading = document.querySelector(".pm-pending-manager .pm-modal-header b");
      if (heading) heading.textContent = `\u6682\u5B58\u6D88\u606F\uFF08${count}\uFF09`;
      const clear = document.querySelector(".pm-pending-manager-actions button");
      if (clear) {
        clear.disabled = count === 0 || hasSubmitting;
        clear.title = hasSubmitting ? "\u63D0\u4EA4\u4E2D\u7684\u6682\u5B58\u4E0D\u80FD\u6E05\u7A7A" : "\u6E05\u7A7A\u5F53\u524D\u4F1A\u8BDD\u6682\u5B58";
      }
      syncGenerationControls();
    };
    let editingTarget = null;
    function closeControlCenter(restoreFocus = false) {
      document.getElementById(CONTROL_MENU_ID)?.remove();
      if (outsideClickHandler) {
        document.removeEventListener("click", outsideClickHandler, true);
        outsideClickHandler = null;
      }
      if (escapeKeyHandler) {
        document.removeEventListener("keydown", escapeKeyHandler, true);
        escapeKeyHandler = null;
      }
      const anchor = state.phoneWindow?.querySelector(".pm-expand-btn");
      anchor?.setAttribute("aria-expanded", "false");
      if (restoreFocus) anchor?.focus({ preventScroll: true });
    }
    function showPendingManager() {
      const target = getTarget();
      if (!sameTarget(editingTarget, target)) editingTarget = null;
      const items = target ? getPendingMessages(runtime, target.storageId, target.saveKey) : [];
      const count = items.length;
      const clearDisabled = !count || items.some((item) => item.status === "submitting");
      makeOverlay(`
<div class="pm-modal pm-pending-manager">
  <div class="pm-modal-header"><b>\u6682\u5B58\u6D88\u606F\uFF08${count}\uFF09</b><span onclick="window.__pmCloseOverlay()" class="pm-modal-close">\xD7</span></div>
  <div id="pm-pending-list" class="pm-pending-list">${renderPendingList()}</div>
  <div class="pm-pending-manager-actions"><button onclick="window.__pmClearPending()" ${clearDisabled ? "disabled" : ""} title="${clearDisabled && count ? "\u63D0\u4EA4\u4E2D\u7684\u6682\u5B58\u4E0D\u80FD\u6E05\u7A7A" : "\u6E05\u7A7A\u5F53\u524D\u4F1A\u8BDD\u6682\u5B58"}">\u6E05\u7A7A\u6682\u5B58</button></div>
</div>`, { onClose: () => {
        editingTarget = null;
      } });
    }
    function runControlAction(action) {
      closeControlCenter();
      if (action === "pending") showPendingManager();
      else if (action === "settings") window.__pmShowConversationSettings();
      else if (action === "api" || action === "look" || action === "other") window.__pmOpenSettingsTab(action);
      else if (action === "emoji") window.__pmShowEmojiPicker();
      else if (action === "delete") window.__pmStartDeleteMode();
      else if (action === "forum") window.__pmOpenForumMode();
    }
    function bindControlMenu(menu, anchor) {
      menu.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button || !menu.contains(button)) return;
        runControlAction(button.dataset.action);
      });
      outsideClickHandler = (event) => {
        if (menu.contains(event.target) || anchor.contains(event.target)) return;
        closeControlCenter();
      };
      escapeKeyHandler = (event) => {
        if (event.key === "Escape") closeControlCenter(true);
      };
      document.addEventListener("click", outsideClickHandler, true);
      document.addEventListener("keydown", escapeKeyHandler, true);
    }
    function sameTarget(left, right) {
      return !!left && !!right && left.storageId === right.storageId && left.saveKey === right.saveKey;
    }
    window.__pmShowControlCenter = () => {
      const existing = document.getElementById(CONTROL_MENU_ID);
      if (existing) {
        closeControlCenter();
        return;
      }
      const phone = state.phoneWindow;
      const anchor = phone?.querySelector(".pm-expand-btn");
      if (!phone || !anchor || state.isMinimized) return;
      const menu = document.createElement("div");
      menu.id = CONTROL_MENU_ID;
      menu.className = "pm-control-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "\u5FEB\u6377\u5DE5\u5177");
      menu.innerHTML = `
  <button type="button" role="menuitem" data-action="pending">\u6682\u5B58\u6D88\u606F</button>
  <button type="button" role="menuitem" data-action="settings">\u8BBE\u7F6E</button>
  <button type="button" role="menuitem" data-action="api">API</button>
  <button type="button" role="menuitem" data-action="look">\u5916\u89C2</button>
  <button type="button" role="menuitem" data-action="other">\u5176\u4ED6</button>
  <button type="button" role="menuitem" data-action="emoji">\u8868\u60C5\u5305</button>
  <button type="button" role="menuitem" data-action="delete" class="pm-control-menu-danger">\u5220\u9664\u4FE1\u606F</button>
  <button type="button" role="menuitem" data-action="forum">\u8BBA\u575B\u6A21\u5F0F\uFF08\u5F00\u53D1\u4E2D\uFF09</button>`;
      phone.appendChild(menu);
      const phoneRect = phone.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const desiredLeft = anchorRect.left - phoneRect.left;
      const maxLeft = Math.max(8, phone.clientWidth - menu.offsetWidth - 8);
      menu.style.left = `${Math.min(Math.max(8, desiredLeft), maxLeft)}px`;
      menu.style.bottom = `${Math.max(8, phoneRect.bottom - anchorRect.top + 8)}px`;
      const availableHeight = Math.max(72, anchorRect.top - phoneRect.top - 16);
      menu.style.maxHeight = `${availableHeight}px`;
      anchor.setAttribute("aria-expanded", "true");
      bindControlMenu(menu, anchor);
      menu.querySelector("button")?.focus({ preventScroll: true });
    };
    window.__pmOpenSettingsTab = (tab) => window.__pmShowConfig(tab);
    window.__pmStartDeleteMode = () => {
      window.__pmCloseOverlay();
      window.__pmToggleSelect();
    };
    window.__pmOpenForumMode = () => alert("\u8BBA\u575B\u6A21\u5F0F\u5165\u53E3\u5DF2\u4FDD\u7559\uFF0C\u529F\u80FD\u5C06\u5728\u540E\u7EED\u7248\u672C\u63A5\u5165\u3002");
    function redrawPendingConversation() {
      const target = getTarget();
      if (target) renderPendingConversation(target.storageId, target.saveKey);
    }
    window.__pmEditPending = (itemId) => {
      const target = getTarget();
      if (!target) return;
      const item = getPendingMessages(runtime, target.storageId, target.saveKey).find((candidate) => candidate.id === itemId);
      if (!item || item.status === "submitting") return;
      editingTarget = { ...target, itemId };
      window.__pmRefreshControlCenter();
      const input = document.getElementById("pm-pending-edit-input");
      input?.focus();
      if (input) input.selectionStart = input.selectionEnd = input.value.length;
    };
    window.__pmSavePendingEdit = (itemId) => {
      const target = getTarget();
      const input = document.getElementById("pm-pending-edit-input");
      if (!sameTarget(editingTarget, target) || editingTarget.itemId !== itemId || !input) return;
      const parsed = parsePendingInput(input.value);
      if (!parsed || !updatePendingMessage(runtime, target.storageId, target.saveKey, itemId, parsed)) return;
      editingTarget = null;
      redrawPendingConversation();
      window.__pmRefreshControlCenter();
    };
    window.__pmCancelPendingEdit = () => {
      editingTarget = null;
      window.__pmRefreshControlCenter();
    };
    window.__pmDeletePending = (itemId) => {
      const target = getTarget();
      if (!target) return;
      if (!removePendingMessage(runtime, target.storageId, target.saveKey, itemId)) return;
      if (sameTarget(editingTarget, target) && editingTarget.itemId === itemId) editingTarget = null;
      redrawPendingConversation();
      window.__pmRefreshControlCenter();
    };
    window.__pmClearPending = () => {
      const target = getTarget();
      if (!target) return;
      const items = getPendingMessages(runtime, target.storageId, target.saveKey);
      if (items.some((item) => item.status === "submitting")) return;
      clearPendingMessages(runtime, target.storageId, target.saveKey);
      if (sameTarget(editingTarget, target)) editingTarget = null;
      redrawPendingConversation();
      window.__pmRefreshControlCenter();
    };
    window.__pmResetPendingEditor = () => {
      editingTarget = null;
    };
    Object.assign(deps, { closeControlCenter });
  }

  // src/icons.js
  var EDIT_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  var icon = (paths) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  var MENU_ICON_SVG = icon('<path d="M4 6h16M4 12h16M4 18h16"/>');
  var CLOSE_ICON_SVG = icon('<path d="M6 6l12 12M18 6L6 18"/>');
  var CONTROL_ICON_SVG = icon('<path d="M15 4l5 5L8 21l-5-5L15 4zM13 6l5 5M5 4v3M3.5 5.5h3M19 16v4M17 18h4"/>');
  var SEND_ICON_SVG = icon('<path d="M12 19V5M6 11l6-6 6 6"/>');
  var REFRESH_ICON_SVG = '<svg id="pm-autogen-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;transform-origin:center center;"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

  // src/phone-directory.js
  function installPhoneDirectory(state, deps) {
    const { runtime, getStorageId: getStorageId2, makeOverlay, applyBidirectionalInjection } = deps;
    function showGroupForm(mode, existingName, existingMembers) {
      document.getElementById("pm-overlay")?.remove();
      const title = mode === "create" ? "\u65B0\u5EFA\u7FA4\u804A" : "\u7F16\u8F91\u7FA4\u804A";
      const initName = existingName || "";
      const initMembers = (existingMembers || []).join(" / ");
      const closeAction = mode === "create" ? "window.__pmShowList()" : "window.__pmSaveAndCloseGroupEdit()";
      let pokeConfig = { enabled: false, interval: 3, counter: 0 };
      let assignedEmojis = [];
      if (mode === "edit" && state.currentGroupKey) {
        const id = getStorageId2();
        pokeConfig = window.__pmPokeConfig[id]?.[state.currentGroupKey]?.autoPoke || pokeConfig;
        assignedEmojis = window.__pmPokeConfig[id]?.[state.currentGroupKey]?.emojis || [];
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
    window.__pmSaveAndCloseGroupEdit = () => {
      const nameInput = document.getElementById("pm-group-name-input");
      const memInput = document.getElementById("pm-group-input");
      if (nameInput && memInput && state.currentGroupKey) {
        const groupName = nameInput.value.trim();
        const names = memInput.value.split(/[/／]/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_GROUP_MEMBERS - 1);
        if (groupName && names.length >= 2) {
          const id = getStorageId2();
          if (!window.__pmGroupMeta[id]) window.__pmGroupMeta[id] = {};
          window.__pmGroupMeta[id][state.currentGroupKey] = { name: groupName, members: names };
          saveGroupMeta();
          state.groupMembers = names;
          state.groupDisplayName = groupName;
          state.groupColorMap = {};
          names.forEach((n, i) => {
            state.groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length];
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
          const oldCounter = window.__pmPokeConfig[id][state.currentGroupKey]?.autoPoke?.counter || 0;
          window.__pmPokeConfig[id][state.currentGroupKey] = {
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
      if (state.phoneWindow && state.currentGroupKey) {
        window.__pmSwitch(state.currentGroupKey);
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
        const _prevSaveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
        window.__pmGroupMeta[id][groupKey] = { name: groupName, members: names };
        saveGroupMeta();
        state.isGroupChat = true;
        state.groupMembers = names;
        state.groupDisplayName = groupName;
        state.currentGroupKey = groupKey;
        state.groupColorMap = {};
        names.forEach((n, i) => {
          state.groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length];
        });
        window.__pmSwitch(groupKey, _prevSaveKey);
      } else {
        if (!state.currentGroupKey) return;
        window.__pmGroupMeta[id][state.currentGroupKey] = { name: groupName, members: names };
        saveGroupMeta();
        state.groupMembers = names;
        state.groupDisplayName = groupName;
        state.groupColorMap = {};
        names.forEach((n, i) => {
          state.groupColorMap[n] = GROUP_COLORS[i % GROUP_COLORS.length];
        });
        window.__pmSwitch(state.currentGroupKey);
      }
    };
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
        <span onclick="window.__pmCloseOverlay()" class="pm-modal-close">\u2715</span>
      </span>
    </div>
    <button type="button" class="pm-forum-entry" onclick="window.__pmOpenForumMode()">
      <b>\u8BBA\u575B\u6A21\u5F0F</b>
      <span>\u5F00\u53D1\u4E2D\uFF0C\u5165\u53E3\u5DF2\u9884\u7559</span>
    </button>
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
    window.__pmDelGroup = async (key) => {
      const id = getStorageId2();
      clearPendingMessages(runtime, id, key);
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
      if (state.currentGroupKey === key) {
        state.isGroupChat = false;
        state.currentGroupKey = "";
        state.currentPersona = "";
        state.conversationHistory = [];
        state.groupMembers = [];
        state.groupDisplayName = "";
        state.groupColorMap = {};
      }
      window.__pmShowList();
    };
    window.__pmDel = async (name) => {
      const id = getStorageId2();
      clearPendingMessages(runtime, id, name);
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
      if (!state.isGroupChat && state.currentPersona === name) {
        state.currentPersona = "";
        state.conversationHistory = [];
      }
      window.__pmShowList();
    };
    Object.assign(deps, { showGroupForm });
  }

  // src/phone-foundation.js
  function installPhoneFoundation(state, deps) {
    const { runtime, getCtx, getStorageId: getStorageId2, getUserPersona: getUserPersona2 } = deps;
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
    window.__pmCharacterBehavior = window.__pmCharacterBehavior || {};
    window.__pmWordyLimit = window.__pmWordyLimit || false;
    window.__pmEmojis = window.__pmEmojis || [];
    function syncGenerationControls() {
      const disabled = !!state.isGenerating;
      for (const button of document.querySelectorAll(".pm-submit-pending-btn")) {
        const empty = button.dataset.empty === "true";
        button.disabled = disabled || empty;
      }
      const status = document.querySelector(".pm-control-generation-status");
      if (status) status.textContent = disabled ? "AI \u6B63\u5728\u56DE\u590D\uFF0C\u6682\u5B58\u4ECD\u53EF\u7EE7\u7EED\u7F16\u8F91" : "";
    }
    function beginGeneration(storageId) {
      if (state.generationTask) return null;
      const id = storageId || getStorageId2();
      const context = getCtx();
      if (!context || !id || id === "sms_unknown__default") return null;
      const task = Object.freeze({
        id: ++state.generationSequence,
        hostEpoch: state.hostEpoch,
        storageId: id,
        context
      });
      state.generationTask = task;
      state.isGenerating = true;
      syncGenerationControls();
      return task;
    }
    function isGenerationTaskActive(task) {
      return !!task && state.generationTask === task && state.hostEpoch === task.hostEpoch && getStorageId2() === task.storageId;
    }
    function finishGeneration(task) {
      if (state.generationTask !== task) return false;
      state.generationTask = null;
      state.isGenerating = false;
      syncGenerationControls();
      return true;
    }
    function invalidateGeneration() {
      state.hostEpoch += 1;
      state.generationTask = null;
      state.isGenerating = false;
      hideTyping();
      syncGenerationControls();
    }
    function applyTheme() {
      const t = window.__pmTheme || {}, p = THEME_PRESETS[t.preset] || THEME_PRESETS.default;
      const darkMode = t.darkMode || "light";
      document.getElementById("pm-overlay")?.setAttribute("data-theme", darkMode);
      const el = state.phoneWindow;
      if (!el) return;
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
      el.setAttribute("data-theme", darkMode);
    }
    function applyBackground() {
      const msgList = state.phoneWindow?.querySelector(".pm-msg-list");
      if (!msgList) return;
      const id = getStorageId2(), localKey = `${id}_${state.currentPersona}`;
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
      const nameEl = state.phoneWindow?.querySelector(".pm-name");
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
            const director = m.directorNote ? `\u3010\u5267\u60C5\u5F15\u5BFC\uFF1A${m.directorNote}\u3011` : "";
            const userLine = t ? `${userName}\uFF1A${t}` : "";
            return m.role === "user" ? [userLine, director].filter(Boolean).join(" ") : t;
          }).join("\n");
          return `\u3010\u7FA4\u804A"${meta.name}"\uFF08\u6210\u5458\uFF1A${meta.members.join("\u3001")}\uFF09\u7684\u6700\u8FD1\u804A\u5929 \u2014 \u4EC5\u53C2\u4E0E\u8005\u4E0E ${userName} \u77E5\u6653\uFF0C\u5176\u4ED6\u89D2\u8272\u4E0D\u5E94\u77E5\u60C5\u3011
${lines2}`;
        }
        const lines = conv.map((m) => {
          const t = resolveEmojiText((m.content || "").replace(/\s*\/\s*/g, "\u3002"), window.__pmEmojis);
          const director = m.directorNote ? `\u3010\u5267\u60C5\u5F15\u5BFC\uFF1A${m.directorNote}\u3011` : "";
          const userLine = t ? `${userName}\uFF1A${t}` : "";
          return m.role === "user" ? [userLine, director].filter(Boolean).join(" ") : `${name}\uFF1A${t}`;
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
          if (state.phoneActive && typeof window.__pmEnd === "function") {
            window.__pmEnd(true);
          } else {
            invalidateGeneration();
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
    function applyBubbleMetadata(node, metadata) {
      if (!metadata) return;
      if (metadata.historyIndex !== void 0) node.dataset.historyIndex = String(metadata.historyIndex);
      if (metadata.pendingId !== void 0) node.dataset.pendingId = String(metadata.pendingId);
      if (metadata.pendingStatus) node.dataset.pendingStatus = metadata.pendingStatus;
      if (metadata.pendingId !== void 0) node.classList.add("pm-pending-entry");
    }
    function addBubble(text2, side, senderName, historyIndex, metadata) {
      const list = state.phoneWindow?.querySelector(".pm-msg-list");
      if (!list) return [];
      const nodes = createBubbles(text2, side, senderName, {
        groupColorMap: state.groupColorMap,
        groupMembers: state.groupMembers,
        emojis: window.__pmEmojis
      });
      nodes.forEach((b) => {
        applyBubbleMetadata(b, metadata);
        if (b.classList?.contains("pm-bubble")) {
          b.dataset.side = side;
          b.dataset.text = text2;
          if (historyIndex !== void 0) b.dataset.historyIndex = historyIndex;
        } else if (b.classList?.contains("pm-group-bubble-wrap")) {
          b.dataset.side = side;
          b.dataset.text = text2;
          if (historyIndex !== void 0) b.dataset.historyIndex = historyIndex;
          const inner = b.querySelector(".pm-bubble");
          if (inner) {
            applyBubbleMetadata(inner, metadata);
            inner.dataset.side = side;
            inner.dataset.text = text2;
            if (historyIndex !== void 0) inner.dataset.historyIndex = historyIndex;
          }
        }
        list.appendChild(b);
      });
      list.scrollTop = list.scrollHeight;
      return nodes;
    }
    function rebaseRenderedHistory(trimmedCount) {
      if (!Number.isInteger(trimmedCount) || trimmedCount <= 0) return;
      const list = state.phoneWindow?.querySelector(".pm-msg-list");
      if (!list) return;
      for (const child of [...list.children]) {
        const indexed = child.dataset.historyIndex !== void 0 ? child : child.querySelector?.("[data-history-index]");
        if (!indexed) continue;
        const previousIndex = Number(indexed.dataset.historyIndex);
        if (!Number.isInteger(previousIndex)) continue;
        if (previousIndex < trimmedCount) {
          child.remove();
          continue;
        }
        const nextIndex = String(previousIndex - trimmedCount);
        if (child.dataset.historyIndex !== void 0) child.dataset.historyIndex = nextIndex;
        child.querySelectorAll?.("[data-history-index]").forEach((node) => {
          node.dataset.historyIndex = nextIndex;
        });
      }
    }
    function addNote(text2) {
      const list = state.phoneWindow?.querySelector(".pm-msg-list");
      if (!list) return;
      const n = document.createElement("div");
      n.className = "pm-note";
      n.textContent = text2;
      list.appendChild(n);
      list.scrollTop = list.scrollHeight;
    }
    function addDirector(text2, metadata) {
      const list = state.phoneWindow?.querySelector(".pm-msg-list");
      if (!list) return null;
      const d = document.createElement("div");
      d.className = "pm-director";
      applyBubbleMetadata(d, metadata);
      d.innerHTML = `<span class="pm-director-icon">\u{1F3AC}</span><span class="pm-director-text">${escapeHtml(text2)}</span>`;
      list.appendChild(d);
      list.scrollTop = list.scrollHeight;
      return d;
    }
    function showTyping() {
      const list = state.phoneWindow?.querySelector(".pm-msg-list");
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
    function closeOverlay(reason = "close") {
      const current = document.getElementById("pm-overlay");
      if (!current) return false;
      const onClose = current.__pmOnClose;
      current.remove();
      if (typeof onClose === "function") onClose(reason);
      return true;
    }
    function makeOverlay(html, options = {}) {
      closeOverlay("replace");
      const ov = document.createElement("div");
      ov.id = "pm-overlay";
      ov.dataset.theme = window.__pmTheme?.darkMode || "light";
      if (POPOVER_SUPPORTED) ov.setAttribute("popover", "manual");
      ov.__pmOnClose = typeof options.onClose === "function" ? options.onClose : null;
      ov.innerHTML = html;
      ov.addEventListener("click", (e) => {
        if (e.target === ov) closeOverlay("backdrop");
      });
      document.body.appendChild(ov);
      if (ov.showPopover) try {
        ov.showPopover();
      } catch (e) {
      }
      return ov;
    }
    window.__pmCloseOverlay = () => closeOverlay("close");
    Object.assign(deps, {
      applyTheme,
      applyBackground,
      fitNameFont,
      migrateOldHistory,
      applyBidirectionalInjection,
      hookGenerationEvent,
      bindIsland,
      addBubble,
      addNote,
      addDirector,
      rebaseRenderedHistory,
      showTyping,
      hideTyping,
      makeOverlay,
      closeOverlay,
      beginGeneration,
      isGenerationTaskActive,
      finishGeneration,
      invalidateGeneration,
      syncGenerationControls
    });
  }

  // src/press-gesture.js
  function bindPressGesture(element, options) {
    const {
      delay = 550,
      moveThreshold = 10,
      onPress,
      onHold,
      setTimer = setTimeout,
      clearTimer = clearTimeout,
      eventTarget = globalThis.window
    } = options;
    let timer = null;
    let activePointerId = null;
    let startX = 0;
    let startY = 0;
    const clearActiveTimer = () => {
      if (timer !== null) clearTimer(timer);
      timer = null;
    };
    const resetPointer = () => {
      clearActiveTimer();
      activePointerId = null;
    };
    const isActivePointer = (event) => activePointerId !== null && (event?.pointerId === void 0 || event.pointerId === activePointerId);
    const cancelPointer = (event) => {
      if (!isActivePointer(event)) return;
      resetPointer();
    };
    const releasePointer = (event) => {
      if (!isActivePointer(event)) return;
      const isShortPress = timer !== null;
      resetPointer();
      if (isShortPress) onPress?.();
    };
    const onPointerDown = (event) => {
      if (event.button !== 0 || element.disabled || activePointerId !== null) return;
      activePointerId = event.pointerId;
      startX = Number(event.clientX) || 0;
      startY = Number(event.clientY) || 0;
      try {
        element.setPointerCapture?.(event.pointerId);
      } catch (error) {
      }
      timer = setTimer(() => {
        timer = null;
        onHold?.();
      }, delay);
    };
    const onPointerMove = (event) => {
      if (!isActivePointer(event) || timer === null) return;
      const deltaX = (Number(event.clientX) || 0) - startX;
      const deltaY = (Number(event.clientY) || 0) - startY;
      if (Math.hypot(deltaX, deltaY) > moveThreshold) cancelPointer(event);
    };
    const onClick = (event) => {
      const isKeyboardOrProgrammatic = Number(event?.detail) === 0;
      if (!isKeyboardOrProgrammatic) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }
      onPress?.();
    };
    const onContextMenu = (event) => event.preventDefault?.();
    const onWindowBlur = () => {
      resetPointer();
    };
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", releasePointer);
    element.addEventListener("pointercancel", cancelPointer);
    element.addEventListener("lostpointercapture", cancelPointer);
    element.addEventListener("click", onClick);
    element.addEventListener("contextmenu", onContextMenu);
    eventTarget?.addEventListener("blur", onWindowBlur);
    return () => {
      resetPointer();
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", releasePointer);
      element.removeEventListener("pointercancel", cancelPointer);
      element.removeEventListener("lostpointercapture", cancelPointer);
      element.removeEventListener("click", onClick);
      element.removeEventListener("contextmenu", onContextMenu);
      eventTarget?.removeEventListener("blur", onWindowBlur);
    };
  }

  // src/phone-lifecycle.js
  function installPhoneLifecycle(state, deps) {
    const {
      runtime,
      getCtx,
      getStorageId: getStorageId2,
      applyBidirectionalInjection,
      persistCurrentHistory: persistCurrentHistory2,
      applyBackground,
      applyTheme,
      bindIsland,
      migrateOldHistory,
      hookGenerationEvent,
      invalidateGeneration,
      syncGenerationControls,
      closeOverlay,
      closeControlCenter
    } = deps;
    let unbindSendGesture = null;
    window.__pmToggleSelect = () => {
      state.isSelectMode = !state.isSelectMode;
      const list = state.phoneWindow?.querySelector(".pm-msg-list");
      const confirmBar = state.phoneWindow?.querySelector(".pm-confirm-bar");
      if (!list) return;
      if (state.isSelectMode) {
        if (confirmBar) confirmBar.style.display = "flex";
        list.querySelectorAll(".pm-bubble, .pm-group-bubble-wrap, .pm-director").forEach((b) => {
          if (b.id === "pm-typing" || b.closest(".pm-select-wrap") || b.closest(".pm-pending-entry")) return;
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
            const checked = cb.dataset.checked === "0" ? "1" : "0";
            const historyIndex = wrap.dataset.historyIndex;
            if (historyIndex === void 0 || historyIndex === "") {
              cb.dataset.checked = checked;
              return;
            }
            list.querySelectorAll(`.pm-select-wrap[data-history-index="${historyIndex}"] .pm-custom-check`).forEach((peer) => {
              peer.dataset.checked = checked;
            });
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
        if (confirmBar) confirmBar.style.display = "none";
        list.querySelectorAll(".pm-select-wrap").forEach((wrap) => {
          const b = wrap.querySelector(".pm-bubble, .pm-group-bubble-wrap, .pm-director");
          if (b) wrap.parentNode.insertBefore(b, wrap);
          wrap.remove();
        });
      }
    };
    window.__pmDeleteSelected = () => {
      const list = state.phoneWindow?.querySelector(".pm-msg-list");
      if (!list) return;
      const toRemoveIndices = /* @__PURE__ */ new Set();
      list.querySelectorAll(".pm-select-wrap").forEach((wrap) => {
        const cb = wrap.querySelector(".pm-custom-check");
        if (cb?.dataset.checked === "1") {
          const hi = wrap.dataset.historyIndex;
          if (hi !== void 0 && hi !== "") toRemoveIndices.add(Number(hi));
        }
      });
      list.querySelectorAll(".pm-select-wrap").forEach((wrap) => {
        const hi = wrap.dataset.historyIndex;
        if (hi !== void 0 && hi !== "" && toRemoveIndices.has(Number(hi))) {
          wrap.remove();
        } else {
          const b = wrap.querySelector(".pm-bubble, .pm-group-bubble-wrap, .pm-director");
          if (b) wrap.parentNode.insertBefore(b, wrap);
          wrap.remove();
        }
      });
      if (toRemoveIndices.size > 0) {
        state.conversationHistory = state.conversationHistory.filter((_, i) => !toRemoveIndices.has(i));
        persistCurrentHistory2();
        applyBidirectionalInjection();
      }
      state.isSelectMode = false;
      const bar = state.phoneWindow?.querySelector(".pm-confirm-bar");
      if (bar) bar.style.display = "none";
    };
    window.__pmToggleMin = () => {
      closeControlCenter?.();
      state.isMinimized = !state.isMinimized;
      state.phoneWindow.classList.toggle("is-min", state.isMinimized);
      state.phoneWindow.style.removeProperty("transform");
    };
    window.__pmEnd = (force = false) => {
      if (state.currentPersona) persistCurrentHistory2();
      invalidateGeneration();
      unbindSendGesture?.();
      unbindSendGesture = null;
      closeControlCenter?.();
      closeOverlay("phone-close");
      if (state.phoneWindow) {
        try {
          state.phoneWindow.hidePopover?.();
        } catch (e) {
        }
        state.phoneWindow.remove();
      }
      state.phoneWindow = null;
      state.phoneActive = false;
      state.isMinimized = false;
      state.isSelectMode = false;
      state.activeStorageId = "";
      state.currentPersona = "";
      state.conversationHistory = [];
      state.isGroupChat = false;
      state.groupMembers = [];
      state.groupColorMap = {};
      state.groupDisplayName = "";
      state.currentGroupKey = "";
      runtime.firstOpen = true;
      if (runtime.visibilityTimer) {
        clearInterval(runtime.visibilityTimer);
        runtime.visibilityTimer = null;
      }
    };
    function loadHistoriesOnce() {
      if (!runtime.historyLoadPromise) {
        runtime.historyLoadPromise = loadHistoriesFromIDB();
      }
      return runtime.historyLoadPromise;
    }
    function ensureVisibility() {
      if (!state.phoneWindow) return;
      const cs = getComputedStyle(state.phoneWindow);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") < 0.1) {
        state.phoneWindow.style.setProperty("display", "flex", "important");
        state.phoneWindow.style.setProperty("visibility", "visible", "important");
        state.phoneWindow.style.setProperty("opacity", "1", "important");
      }
    }
    runtime.visibilityTimer = setInterval(ensureVisibility, 2e3);
    window.__pmOpen = () => {
      if (state.phoneActive && state.phoneWindow) {
        try {
          state.phoneWindow.showPopover?.();
        } catch (e) {
        }
        state.phoneWindow.style.display = "flex";
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
      loadCharacterBehavior();
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
      state.phoneWindow = document.createElement("div");
      state.phoneWindow.id = "pm-iphone";
      state.phoneWindow.dataset.layout = window.__pmTheme.layout || "standard";
      state.phoneWindow.setAttribute("data-theme", window.__pmTheme.darkMode || "light");
      if (POPOVER_SUPPORTED) state.phoneWindow.setAttribute("popover", "manual");
      state.phoneWindow.innerHTML = `
<div class="pm-island"></div>
<div class="pm-main-ui">
  <div class="pm-navbar">
    <button onclick="window.__pmShowList()" class="pm-nav-btn pm-nav-left-btn" title="\u8054\u7CFB\u4EBA">${MENU_ICON_SVG}</button>
    <div class="pm-name-wrap">
      <div class="pm-name">${escapeHtml(defaultChar)}</div>
      <button onclick="window.__pmEditGroup()" class="pm-name-edit is-hidden" title="\u7F16\u8F91">${EDIT_ICON_SVG}</button>
    </div>
    <div class="pm-nav-right">
      <button onclick="window.__pmEnd()" class="pm-nav-btn pm-close-btn" title="\u5173\u95ED">${CLOSE_ICON_SVG}</button>
    </div>
  </div>
  <div class="pm-confirm-bar" style="display:none;">
    <span class="pm-confirm-tip">\u9009\u62E9\u8981\u5220\u9664\u7684\u6D88\u606F</span>
    <button onclick="window.__pmDeleteSelected()" class="pm-confirm-btn">\u5220\u9664\u6240\u9009</button>
    <button onclick="window.__pmToggleSelect()" class="pm-cancel-btn">\u53D6\u6D88</button>
  </div>
  <div class="pm-msg-list"></div>
  <div class="pm-input-bar">
    <button type="button" onclick="window.__pmShowControlCenter()" class="pm-expand-btn" title="\u5FEB\u6377\u5DE5\u5177" aria-haspopup="menu" aria-expanded="false">${CONTROL_ICON_SVG}</button>
    <input class="pm-input" placeholder="\u8F93\u5165\u540E\u52A0\u5165\u6682\u5B58">
    <button type="button" class="pm-up-btn" title="\u70B9\u51FB\u52A0\u5165\u6682\u5B58\uFF0C\u957F\u6309\u6700\u7EC8\u63D0\u4EA4\u7ED9 AI">${SEND_ICON_SVG}</button>
  </div>
</div>`;
      document.body.appendChild(state.phoneWindow);
      if (state.phoneWindow.showPopover) try {
        state.phoneWindow.showPopover();
      } catch (e) {
      }
      state.phoneActive = true;
      syncGenerationControls();
      state.phoneWindow.querySelector(".pm-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          window.__pmSend();
        }
      });
      const sendButton = state.phoneWindow.querySelector(".pm-up-btn");
      unbindSendGesture = bindPressGesture(sendButton, {
        delay: 550,
        onPress: () => window.__pmSend(),
        onHold: () => {
          const storageId = state.activeStorageId || getStorageId2();
          const saveKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
          const pending = storageId && saveKey ? getPendingMessages(runtime, storageId, saveKey) : [];
          if (!pending.length) {
            alert("\u5F53\u524D\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u6682\u5B58\u6D88\u606F\u3002");
            return;
          }
          if (state.isGenerating) {
            alert("AI \u6B63\u5728\u56DE\u590D\uFF0C\u8BF7\u7B49\u5F85\u5F53\u524D\u56DE\u590D\u7ED3\u675F\u540E\u518D\u6700\u7EC8\u63D0\u4EA4\u3002");
            return;
          }
          if (confirm("\u786E\u8BA4\u5C06\u5F53\u524D\u4F1A\u8BDD\u7684\u5168\u90E8\u6682\u5B58\u6D88\u606F\u6700\u7EC8\u63D0\u4EA4\u7ED9 AI\uFF1F")) {
            window.__pmSubmitPending();
          }
        }
      });
      bindIsland(state.phoneWindow, state.phoneWindow.querySelector(".pm-island"));
      applyTheme();
      state.isGroupChat = false;
      state.groupMembers = [];
      state.groupColorMap = {};
      state.groupDisplayName = "";
      state.currentGroupKey = "";
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
        const list = state.phoneWindow?.querySelector(".pm-msg-list");
        if (list) {
          list.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;font-size:13px;">\u6B63\u5728\u52A0\u8F7D\u5386\u53F2\u8BB0\u5F55\u2026</div>';
        }
        const historyLoad = loadHistoriesOnce();
        const openingWindow = state.phoneWindow;
        Promise.all([historyLoad, loadEmojis()]).then(() => {
          if (!state.phoneActive || state.phoneWindow !== openingWindow) return;
          window.__pmSwitch(defaultChar);
          applyBidirectionalInjection();
          ensureVisibility();
        }).finally(() => {
          if (runtime.historyLoadPromise === historyLoad) runtime.historyLoadPromise = null;
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
          SCP.addCommandObject(SC.fromProps({ name: "phone", callback: cb, helpString: "\u6253\u5F00\u5929\u97F3\u5C0F\u7B3A" }));
          return true;
        }
      } catch (e) {
      }
      try {
        if (typeof ctx.registerSlashCommand === "function") {
          ctx.registerSlashCommand("phone", cb, [], "\u6253\u5F00\u5929\u97F3\u5C0F\u7B3A", true, true);
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
    loadCharacterBehavior();
    loadWordyLimit();
    loadHistoriesOnce();
    setTimeout(() => {
      migrateOldHistory();
      applyBidirectionalInjection();
      hookGenerationEvent();
    }, 1500);
    console.log("[phone-mode] v9.5.7 \u5DF2\u52A0\u8F7D\uFF1A\u4E16\u754C\u4E66\u9884\u7B97\u6539\u4E3A\u8BFB\u53D6ST\u5B9E\u9645\u4E0A\u4E0B\u6587\u7A97\u53E3\u5927\u5C0F");
  }

  // src/runtime.js
  function createRuntimeState() {
    return {
      modelList: [],
      eventHooked: false,
      firstOpen: true,
      lastChatLength: 0,
      historyLoadPromise: null,
      visibilityTimer: null,
      pendingMessages: /* @__PURE__ */ new Map(),
      pendingSequence: 0
    };
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

  // src/settings-templates.js
  function renderApiSettings({ cfg, useIndependent, profilesHtml }) {
    return `
    <div id="pm-tab-api" class="pm-tab-pane">
      <div style="padding:12px 14px 6px;">
        <div class="pm-cfg-label" style="margin-bottom:6px;">API \u6A21\u5F0F</div>
        <div class="pm-mode-switch">
          <div id="pm-mode-main" class="pm-mode-opt ${!useIndependent ? "pm-mode-active" : ""}" onclick="window.__pmSetMode(false)">\u4E3B API</div>
          <div id="pm-mode-indep" class="pm-mode-opt ${useIndependent ? "pm-mode-active" : ""}" onclick="window.__pmSetMode(true)">\u72EC\u7ACB API</div>
        </div>
        <div id="pm-mode-tip" class="pm-cfg-tip" style="text-align:left;padding:6px 2px 0;">${useIndependent ? "\u72EC\u7ACB API" : "\u4E3B API"}</div>
      </div>
      <div style="padding:6px 14px 4px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin:8px 0 6px;">\u5DF2\u4FDD\u5B58\u6863\u6848</div>
        <div class="pm-prof-list">${profilesHtml}</div>
      </div>
      <div style="padding:10px 16px;display:flex;flex-direction:column;gap:10px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label">API \u5730\u5740</div>
        <input id="pm-cfg-url" class="pm-cfg-input" placeholder="https://api.xxx.com \u6216 .../v1" value="${cfg.apiUrl}">
        <div class="pm-cfg-label">API Key</div>
        <input id="pm-cfg-key" class="pm-cfg-input" placeholder="sk-..." value="${cfg.apiKey}" maxlength="999">
        <div class="pm-cfg-label">\u6A21\u578B\u540D\u79F0</div>
        <div class="pm-model-row">
          <input id="pm-cfg-model" class="pm-cfg-input" placeholder="\u624B\u52A8\u8F93\u5165\u6216 \u25BC" value="${cfg.model}">
          <button id="pm-model-arrow" type="button" onclick="window.__pmShowModelPicker()">\u25BC</button>
        </div>
        <div id="pm-api-status" class="pm-cfg-tip" style="font-weight:bold;">\u8FDE\u63A5\u6210\u529F\u540E\u81EA\u52A8\u4FDD\u5B58</div>
        <div style="display:flex;gap:6px;margin-top:4px;">
          <button onclick="window.__pmTestApi()" style="flex:1;background:#ff9500;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">\u62C9\u53D6\u6A21\u578B</button>
          <button onclick="window.__pmTestModel()" style="flex:1;background:#5856d6;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;cursor:pointer;font-weight:600;">\u6D4B\u8BD5 API</button>
        </div>
      </div>
      <div style="height:12px;"></div>
    </div>`;
  }
  function renderLookSettings({ theme, layoutButtons, presetButtons, globalBackgroundButtons, localBackgroundButtons }) {
    return `
    <div id="pm-tab-look" class="pm-tab-pane" style="display:none;">
      <div style="padding:12px 16px 0;">
        <div class="pm-cfg-label" style="margin-bottom:8px;">\u65E5\u591C\u6A21\u5F0F</div>
        <div class="pm-theme-row" style="margin-bottom:8px;">
          <div class="pm-layout-chip ${theme.darkMode === "light" ? "pm-layout-active" : ""}" onclick="window.__pmSetDarkMode('light')">\u65E5\u95F4</div>
          <div class="pm-layout-chip ${theme.darkMode === "dark" ? "pm-layout-active" : ""}" onclick="window.__pmSetDarkMode('dark')">\u591C\u95F4</div>
        </div>
      </div>
      <div style="padding:12px 16px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:8px;">\u754C\u9762\u5E03\u5C40</div>
        <div class="pm-layout-row">${layoutButtons}</div>
      </div>
      <div style="padding:14px 16px 12px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">\u6C14\u6CE1\u4E3B\u9898</div>
        <div class="pm-theme-row">${presetButtons}</div>
        <div style="display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap;">
          <label class="pm-cfg-label" style="margin:0;">\u81EA\u5B9A\u4E49\u53F3</label>
          <input id="pm-custom-right" type="color" value="${theme.customRight || "#007aff"}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <label class="pm-cfg-label" style="margin:0;">\u81EA\u5B9A\u4E49\u5DE6</label>
          <input id="pm-custom-left" type="color" value="${theme.customLeft || "#e9e9eb"}" onchange="window.__pmSetCustomColor()" class="pm-color-pick">
          <button onclick="window.__pmClearCustomColor()" class="pm-color-clear">\u91CD\u7F6E</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center;">
          <label class="pm-cfg-label" style="margin:0;">\u8FB9\u6846\u989C\u8272</label>
          <input id="pm-border-color" type="color" value="${theme.borderColor || "#1a1a1a"}" onchange="window.__pmSetBorderColor()" class="pm-color-pick">
          <button onclick="document.getElementById('pm-border-color').value='#1a1a1a';window.__pmSetBorderColor()" class="pm-color-clear">\u91CD\u7F6E</button>
        </div>
      </div>
      <div style="padding:12px 16px 12px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:14px;">\u80CC\u666F\u56FE</div>
        <div style="display:flex;flex-direction:column;gap:14px;padding:0 4px;">
          <div class="pm-bg-row"><span class="pm-bg-label">\u5168\u5C40\u80CC\u666F</span>${globalBackgroundButtons}</div>
          <div class="pm-bg-row"><span class="pm-bg-label">\u672C\u8054\u7CFB\u4EBA</span>${localBackgroundButtons}</div>
        </div>
      </div>
      <div style="height:12px;"></div>
    </div>`;
  }
  function renderOtherSettings() {
    return `
    <div id="pm-tab-other" class="pm-tab-pane" style="display:none;">
      <div style="padding:14px 16px 12px;border-bottom:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">\u5B57\u6570\u63A7\u5236</div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
          <div style="display:flex;flex-direction:column;gap:3px;">
            <span style="font-size:13px;font-weight:600;color:#333;">\u8BDD\u5C11\u4E00\u70B9</span>
            <span style="font-size:11px;color:#aaa;">\u6BCF\u6761\u6D88\u606F\u4E0D\u8D85\u8FC735\u5B57\uFF08\u8BDD\u75E8\u4EBA\u8BBE\u9664\u5916\uFF09</span>
          </div>
          <div id="pm-wordy-check" onclick="window.__pmToggleWordyLimit()" class="pm-custom-check pm-bi-style" style="cursor:pointer;width:22px;height:22px;min-width:22px;min-height:22px;flex-shrink:0;border-radius:50%;"></div>
        </div>
      </div>
      <div style="padding:14px 16px 12px;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">\u8868\u60C5\u5305\u7BA1\u7406</div>
        <div id="pm-emoji-set-list"></div>
        <button onclick="window.__pmAddEmojiSet()" style="width:100%;margin-top:8px;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u6DFB\u52A0\u65B0\u5957\u7EC4</button>
        <div class="pm-cfg-tip" style="text-align:left;margin-top:6px;">\u6700\u591A 10 \u5957\uFF0C\u6BCF\u5957\u6700\u591A 20 \u5F20\u56FE\u7247</div>
      </div>
      <div style="padding:12px 16px 12px;border-top:1px solid #f0f0f0;">
        <div class="pm-cfg-label" style="margin-bottom:10px;">\u6570\u636E\u5907\u4EFD</div>
        <div style="display:flex;gap:6px;">
          <button onclick="window.__pmExportData()" style="flex:1;background:#34c759;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u5BFC\u51FA\u5907\u4EFD</button>
          <button onclick="document.getElementById('pm-import-file').click()" style="flex:1;background:#5856d6;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u5BFC\u5165\u5907\u4EFD</button>
          <input id="pm-import-file" type="file" accept=".json" onchange="window.__pmImportData(this)" hidden>
        </div>
        <div class="pm-cfg-tip" style="text-align:left;margin-top:6px;color:#ff9500;">\u6CE8\u610F\uFF1A\u5BFC\u5165\u4F1A\u8986\u76D6\u5F53\u524D\u6240\u6709\u8054\u7CFB\u4EBA\u4E0E\u8BB0\u5F55</div>
      </div>
      <div style="height:12px;"></div>
    </div>`;
  }
  function renderSettingsModal({ apiPane, lookPane, otherPane }) {
    return `
<div class="pm-modal pm-modal-wide" style="height: 560px;">
  <div class="pm-modal-header"><b>\u8BBE\u7F6E</b><span onclick="document.getElementById('pm-overlay').remove()" class="pm-modal-close">\u2715</span></div>
  <div class="pm-cfg-tabs">
    <div class="pm-cfg-tab pm-cfg-tab-active" data-tab="api" onclick="window.__pmSwitchTab('api')">API</div>
    <div class="pm-cfg-tab" data-tab="look" onclick="window.__pmSwitchTab('look')">\u5916\u89C2</div>
    <div class="pm-cfg-tab" data-tab="other" onclick="window.__pmSwitchTab('other')">\u5176\u4ED6</div>
  </div>
  <div class="pm-modal-scroll">${apiPane}${lookPane}${otherPane}</div>
  <div class="pm-modal-add" id="pm-config-bottom">
    <button onclick="window.__pmSaveConfig()" style="width:100%;background:#007aff;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;cursor:pointer;font-weight:600;">\u4FDD\u5B58\u914D\u7F6E</button>
  </div>
</div>`;
  }

  // src/settings-ui.js
  function installSettingsUi(deps) {
    const {
      makeOverlay,
      applyTheme,
      applyBackground,
      fitNameFont,
      addNote,
      getPhoneWindow,
      getCurrentPersona,
      getStorageId: getStorageId2,
      runtime,
      closePhone
    } = deps;
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
      if (t) t.textContent = v ? "\u72EC\u7ACB API" : "\u4E3B API";
    };
    window.__pmToggleWordyLimit = () => {
      window.__pmWordyLimit = !window.__pmWordyLimit;
      saveWordyLimit();
      const el = document.getElementById("pm-wordy-check");
      if (el) el.classList.toggle("is-checked", window.__pmWordyLimit);
    };
    window.__pmSetDarkMode = (mode) => {
      window.__pmTheme.darkMode = mode;
      saveTheme();
      const pw = getPhoneWindow();
      if (pw) pw.setAttribute("data-theme", mode);
      document.getElementById("pm-overlay")?.setAttribute("data-theme", mode);
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
        emojis: window.__pmEmojis || [],
        characterBehavior: window.__pmCharacterBehavior || {}
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TianyinXiaojian_Backup_${(/* @__PURE__ */ new Date()).getTime()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      alert("\u5907\u4EFD\u5DF2\u6210\u529F\u5BFC\u51FA\u3002");
    };
    window.__pmImportData = (input) => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("\u5907\u4EFD\u6839\u8282\u70B9\u5FC5\u987B\u662F\u5BF9\u8C61");
          if (Object.hasOwn(data, "histories")) window.__pmHistories = data.histories ?? {};
          if (Object.hasOwn(data, "config")) window.__pmConfig = data.config ?? {};
          if (Object.hasOwn(data, "theme")) window.__pmTheme = data.theme ?? {};
          if (Object.hasOwn(data, "profiles")) window.__pmProfiles = data.profiles ?? [];
          if (Object.hasOwn(data, "groupMeta")) window.__pmGroupMeta = data.groupMeta ?? {};
          if (Object.hasOwn(data, "pokeConfig")) window.__pmPokeConfig = data.pokeConfig ?? {};
          if (Object.hasOwn(data, "bidirectional")) window.__pmBidirectional = data.bidirectional ?? {};
          if (Object.hasOwn(data, "characterBehavior")) window.__pmCharacterBehavior = data.characterBehavior ?? {};
          if (Object.hasOwn(data, "emojis")) {
            window.__pmEmojis = data.emojis ?? [];
            saveEmojis();
          }
          saveHistories();
          try {
            localStorage.setItem("ST_SMS_CONFIG", JSON.stringify(window.__pmConfig));
          } catch (err) {
          }
          saveTheme();
          saveGroupMeta();
          saveCharacterBehavior();
          try {
            localStorage.setItem("ST_SMS_POKE_CONFIG", JSON.stringify(window.__pmPokeConfig));
          } catch (err) {
          }
          try {
            localStorage.setItem("ST_SMS_BIDIRECTIONAL", JSON.stringify(window.__pmBidirectional));
          } catch (err) {
          }
          alert("\u6570\u636E\u5BFC\u5165\u6210\u529F\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u754C\u9762\u751F\u6548\u3002");
          document.getElementById("pm-overlay")?.remove();
          closePhone();
        } catch (err) {
          alert("\u5BFC\u5165\u5931\u8D25\uFF0C\u6587\u4EF6\u683C\u5F0F\u4E0D\u6B63\u786E\u3002\n" + err.message);
        }
      };
      reader.readAsText(file);
      input.value = "";
    };
    window.__pmShowConfig = async (initialTab = "api") => {
      loadProfiles();
      loadTheme();
      await loadBgSettings();
      const cfg = window.__pmConfig, t = window.__pmTheme;
      const shortUrl = (u) => (u || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const maskKey = (k) => !k ? "" : k.length <= 8 ? "****" : k.slice(0, 4) + "****" + k.slice(-4);
      const persona = getCurrentPersona();
      const profilesHtml = window.__pmProfiles.length > 0 ? window.__pmProfiles.map((p, i) => `<div class="pm-prof-li"><div class="pm-prof-info" onclick="window.__pmPickProfile(${i})"><div class="pm-prof-url">${escapeHtml(shortUrl(p.apiUrl))}</div><div class="pm-prof-meta">${escapeHtml(maskKey(p.apiKey))}${p.model ? " \xB7 " + escapeHtml(p.model) : ""}</div></div><i class="pm-prof-del" onclick="window.__pmDeleteProfile(${i})">\u2715</i></div>`).join("") : '<div class="pm-prof-empty">\u6682\u65E0\u6863\u6848</div>';
      const useIndep = !!cfg.useIndependent;
      const presetBtns = Object.entries(THEME_PRESETS).map(
        ([k, v]) => `<div class="pm-theme-chip ${t.preset === k ? "pm-theme-active" : ""}" data-preset="${k}" onclick="window.__pmSetPreset('${safeJS(k)}')"><span class="pm-theme-dot" style="background:${v.right}"></span>${v.label}</div>`
      ).join("");
      const layoutBtns = ["standard", "relaxed"].map(
        (v) => `<div class="pm-layout-chip ${t.layout === v ? "pm-layout-active" : ""}" onclick="window.__pmSetLayout('${safeJS(v)}')">${v === "standard" ? "\u6807\u51C6" : "\u5BBD\u677E"}</div>`
      ).join("");
      const id = getStorageId2(), localKey = `${id}_${persona}`;
      const hasGlobalBg = !!window.__pmBgGlobal, hasLocalBg = !!window.__pmBgLocal[localKey];
      const globalBgBtn = hasGlobalBg ? `<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('global')">\u6E05\u9664</button>` : `<label class="pm-bg-btn">\u9009\u62E9\u56FE\u7247<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'global')" hidden></label>
               <button class="pm-bg-btn" onclick="window.__pmBgUrl('global')">URL</button>`;
      const localBgBtn = hasLocalBg ? `<button class="pm-bg-btn pm-bg-del" onclick="window.__pmClearBg('local')">\u6E05\u9664</button>` : `<label class="pm-bg-btn">\u9009\u62E9\u56FE\u7247<input type="file" accept="image/*" onchange="window.__pmUploadBg(this,'local')" hidden></label>
               <button class="pm-bg-btn" onclick="window.__pmBgUrl('local')">URL</button>`;
      const apiPane = renderApiSettings({
        cfg: {
          apiUrl: escapeAttr(cfg.apiUrl || ""),
          apiKey: escapeAttr(cfg.apiKey || ""),
          model: escapeAttr(cfg.model || "")
        },
        useIndependent: useIndep,
        profilesHtml
      });
      const lookPane = renderLookSettings({
        theme: t,
        layoutButtons: layoutBtns,
        presetButtons: presetBtns,
        globalBackgroundButtons: globalBgBtn,
        localBackgroundButtons: localBgBtn
      });
      makeOverlay(renderSettingsModal({
        apiPane,
        lookPane,
        otherPane: renderOtherSettings()
      }));
      window.__pmSwitchTab(initialTab);
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
      const pw = getPhoneWindow();
      if (pw) pw.dataset.layout = v;
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
            const persona = getCurrentPersona();
            if (scope === "global") {
              window.__pmBgGlobal = croppedDataUrl;
              saveBgGlobal();
            } else {
              const id = getStorageId2();
              window.__pmBgLocal[`${id}_${persona}`] = croppedDataUrl;
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
      const persona = getCurrentPersona();
      if (scope === "global") {
        window.__pmBgGlobal = url.trim();
        saveBgGlobal();
      } else {
        const id = getStorageId2();
        window.__pmBgLocal[`${id}_${persona}`] = url.trim();
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
        const id = getStorageId2(), persona = getCurrentPersona(), key = `${id}_${persona}`;
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
        s.textContent = "\u8BF7\u586B\u5199 API \u5730\u5740";
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
          s.textContent = `\u5DF2\u62C9\u53D6 ${runtime.modelList.length} \u4E2A\u6A21\u578B`;
          s.style.color = "#34c759";
        } else {
          s.textContent = "\u8FDE\u63A5\u6210\u529F";
          s.style.color = "#34c759";
        }
        addOrUpdateProfile({ apiUrl: u, apiKey: k, model: m });
      } catch (e) {
        s.textContent = "\u8FDE\u63A5\u5931\u8D25\uFF1A" + e.message;
        s.style.color = "#ff3b30";
      }
    };
    window.__pmTestModel = async () => {
      const u = document.getElementById("pm-cfg-url").value.trim(), k = document.getElementById("pm-cfg-key").value.trim(), m = document.getElementById("pm-cfg-model").value.trim();
      const s = document.getElementById("pm-api-status");
      if (!u || !k || !m) {
        s.textContent = "\u8BF7\u586B\u5199\u5B8C\u6574\u7684 API\u3001\u5BC6\u94A5\u4E0E\u6A21\u578B";
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
        s.textContent = reply != null ? `\u6D4B\u8BD5\u6210\u529F\uFF1A"${String(reply).slice(0, 25)}"` : "\u54CD\u5E94\u683C\u5F0F\u5F02\u5E38";
        s.style.color = reply != null ? "#34c759" : "#ff9500";
      } catch (e) {
        clearTimeout(tm);
        s.textContent = "\u6D4B\u8BD5\u5931\u8D25\uFF1A" + (e.name === "AbortError" ? "\u8D85\u65F6" : e.message);
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
          s.textContent = "\u8BF7\u5148\u62C9\u53D6\u6A21\u578B";
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
  }

  // src/main.js
  (async function bootstrapPhoneMode() {
    await new Promise((resolve) => setTimeout(resolve, 1e3));
    const runtime = createRuntimeState();
    const state = {
      phoneActive: false,
      phoneWindow: null,
      activeStorageId: "",
      currentPersona: "",
      conversationHistory: [],
      isGenerating: false,
      generationTask: null,
      generationSequence: 0,
      hostEpoch: 0,
      isMinimized: false,
      isSelectMode: false,
      isGroupChat: false,
      groupMembers: [],
      groupColorMap: {},
      groupDisplayName: "",
      currentGroupKey: "",
      groupExtras: []
    };
    const getCtx = () => typeof SillyTavern !== "undefined" ? SillyTavern.getContext() : null;
    const getStorageId2 = () => getStorageId(getCtx);
    const getUserPersona2 = () => getUserPersona(getCtx);
    const gatherContext2 = (context) => gatherContext(context ? () => context : getCtx);
    const deps = { runtime, getCtx, getStorageId: getStorageId2, getUserPersona: getUserPersona2, gatherContext: gatherContext2 };
    deps.callAI = createAiClient({
      getConfig: () => window.__pmConfig,
      getContext: getCtx,
      getDefaultMaxTokens: () => state.isGroupChat ? 600 : 300
    });
    installPhoneFoundation(state, deps);
    installConversation(state, deps);
    installEmojiUi({ makeOverlay: deps.makeOverlay, saveEmojis });
    installSettingsUi({
      makeOverlay: deps.makeOverlay,
      applyTheme: deps.applyTheme,
      applyBackground: deps.applyBackground,
      fitNameFont: deps.fitNameFont,
      addNote: deps.addNote,
      getPhoneWindow: () => state.phoneWindow,
      getCurrentPersona: () => state.currentPersona,
      getStorageId: getStorageId2,
      runtime,
      closePhone: () => window.__pmEnd()
    });
    installPhoneChat(state, deps);
    installPhoneControlCenter(state, deps);
    installPhoneDirectory(state, deps);
    installContactGenerator(state, deps);
    installPhoneChatPoke(state, deps);
    installPhoneLifecycle(state, deps);
  })();
})();
