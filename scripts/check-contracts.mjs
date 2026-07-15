import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const [srcEntries, bundle, css, manifestText] = await Promise.all([
  readdir(srcRoot, { recursive: true }),
  readFile(path.join(root, 'index.js'), 'utf8'),
  readFile(path.join(root, 'style.css'), 'utf8'),
  readFile(path.join(root, 'manifest.json'), 'utf8'),
]);
const sourceFiles = srcEntries
  .filter(entry => entry.endsWith('.js'))
  .sort()
  .map(entry => path.join(srcRoot, entry));
const sourceModules = await Promise.all(sourceFiles.map(async file => ({
  file,
  code: await readFile(file, 'utf8'),
})));
const sourceModuleByName = new Map(sourceModules.map(module => [path.basename(module.file), module]));
const source = sourceModules.map(({ code }) => code).join('\n');
const manifest = JSON.parse(manifestText);
const failures = [];

function requireText(label, text, expected) {
  if (!text.includes(expected)) failures.push(`${label}: missing ${expected}`);
}

function parseJavaScript(code, sourceType = 'script') {
  return parse(code, {
    ecmaVersion: 'latest',
    sourceType,
    allowAwaitOutsideFunction: true,
  });
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

function memberName(node) {
  if (node?.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return null;
}

function propertyName(property) {
  if (property?.type !== 'Property' || property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return null;
}

function isString(node, expected) {
  return node?.type === 'Literal' && node.value === expected;
}

function analyze(code, sourceType = 'script') {
  const result = { commandObject: false, legacyCommand: false, styleElement: false, windowAssignments: new Set() };
  walk(parseJavaScript(code, sourceType), node => {
    if (node.type === 'AssignmentExpression' && node.operator === '=') {
      const target = node.left;
      if (target?.type === 'MemberExpression' && target.object?.type === 'Identifier' && target.object.name === 'window') {
        const name = memberName(target);
        if (name) result.windowAssignments.add(name);
      }
    }
    if (node.type !== 'CallExpression') return;
    const calleeName = memberName(node.callee);
    if (calleeName === 'registerSlashCommand' && isString(node.arguments[0], 'phone')) result.legacyCommand = true;
    if (calleeName === 'createElement' && isString(node.arguments[0], 'style')) result.styleElement = true;
    if (calleeName !== 'addCommandObject') return;
    const fromPropsCall = node.arguments[0];
    if (fromPropsCall?.type !== 'CallExpression' || memberName(fromPropsCall.callee) !== 'fromProps') return;
    const properties = fromPropsCall.arguments[0]?.type === 'ObjectExpression' ? fromPropsCall.arguments[0].properties : [];
    const nameProperty = properties.find(property => propertyName(property) === 'name');
    const callbackProperty = properties.find(property => propertyName(property) === 'callback');
    if (isString(nameProperty?.value, 'phone') && callbackProperty) result.commandObject = true;
  });
  return result;
}

function verifyDetector(label, field, positives, negatives) {
  for (const sample of positives) {
    if (!analyze(sample)[field]) failures.push(`self-test: ${label} rejected valid sample`);
  }
  for (const sample of negatives) {
    if (analyze(sample)[field]) failures.push(`self-test: ${label} accepted invalid sample`);
  }
}

function verifyWindowAssignmentDetector() {
  const positives = [`window.__pmShowConfig = () => {}`, `window['__pmShowConfig'] = function () {}`];
  const negatives = [
    `const fake = 'window.__pmShowConfig = () => {}'`,
    'const html = `<button onclick="window.__pmShowConfig()">设置</button>`',
    `other.__pmShowConfig = () => {}`,
    `window.__pmShowConfig()`,
  ];
  for (const sample of positives) {
    if (!analyze(sample).windowAssignments.has('__pmShowConfig')) failures.push('self-test: window assignment detector rejected valid sample');
  }
  for (const sample of negatives) {
    if (analyze(sample).windowAssignments.has('__pmShowConfig')) failures.push('self-test: window assignment detector accepted invalid sample');
  }
}

verifyDetector('command object', 'commandObject', [
  `SCP.addCommandObject(SC.fromProps({ name: 'phone', callback: cb }))`,
  `parser.addCommandObject(command.fromProps({\n name: "phone", callback: cb\n }))`,
], [
  `const fake = "SCP.addCommandObject(SC.fromProps({ name: 'phone', callback: cb }))"`,
  `const fake = \`SCP.addCommandObject(SC.fromProps({ name: 'phone', callback: cb }))\``,
  `const fake = /addCommandObject\\(fromProps/`,
  `// SCP.addCommandObject(SC.fromProps({ name: 'phone', callback: cb }))`,
  `const x = { surname: 'phone', callback: cb }`,
]);
verifyDetector('legacy command', 'legacyCommand', [
  `ctx.registerSlashCommand('phone', cb)`,
  `ctx.registerSlashCommand( "phone" , cb)`,
], [
  `const fake = "ctx.registerSlashCommand('phone', cb)"`,
  `const fake = \`ctx.registerSlashCommand('phone', cb)\``,
  `// ctx.registerSlashCommand('phone', cb)`,
  `ctx.registerSlashCommand('telephone', cb)`,
]);
verifyDetector('style element', 'styleElement', [
  `document.createElement('style')`,
  `document.createElement( "style" )`,
], [
  `const fake = "document.createElement('style')"`,
  `const fake = \`document.createElement('style')\``,
  `// document.createElement('style')`,
  `document.createElement('div')`,
]);
verifyWindowAssignmentDetector();

const sourceResult = { commandObject: false, legacyCommand: false, styleElement: false, windowAssignments: new Set() };
for (const { file, code } of sourceModules) {
  const relativeFile = path.relative(root, file).replaceAll('\\', '/');
  const lineCount = code.split(/\r?\n/).length;
  if (lineCount >= 800) {
    failures.push(`${relativeFile}: ${lineCount} lines; source modules must stay below 800 lines`);
  }

  let result;
  try {
    result = analyze(code, 'module');
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error.message}`);
    continue;
  }
  sourceResult.commandObject ||= result.commandObject;
  sourceResult.legacyCommand ||= result.legacyCommand;
  sourceResult.styleElement ||= result.styleElement;
  for (const name of result.windowAssignments) sourceResult.windowAssignments.add(name);
}

const analyzedFiles = [['source', source, sourceResult], ['bundle', bundle, analyze(bundle)]];

for (const expected of ['PhoneModeDB', 'ST_SMS_DATA_V2', 'window.__pmOpen', 'installSettingsUi']) {
  for (const [label, text] of analyzedFiles) requireText(label, text, expected);
}
for (const [label, , result] of analyzedFiles) {
  if (!result.commandObject) failures.push(`${label}: missing SlashCommand.fromProps phone registration`);
  if (!result.legacyCommand) failures.push(`${label}: missing registerSlashCommand phone fallback`);
  if (result.styleElement) failures.push(`${label}: forbidden style element injection`);
}

// === Settings entry check ===
const SETTING_ENTRIES = [
  '__pmDeleteProfile', '__pmPickProfile', '__pmSetMode', '__pmToggleWordyLimit',
  '__pmSetDarkMode', '__pmExportData', '__pmImportData', '__pmShowConfig',
  '__pmSwitchTab', '__pmSetPreset', '__pmSetCustomColor', '__pmClearCustomColor',
  '__pmSetBorderColor', '__pmSetLayout', '__pmUploadBg', '__pmBgUrl',
  '__pmClearBg', '__pmTestApi', '__pmTestModel', '__pmSaveConfig', '__pmShowModelPicker',
];

for (const [label, , result] of analyzedFiles) {
  for (const entry of SETTING_ENTRIES) {
    if (!result.windowAssignments.has(entry)) failures.push(`${label}: missing window.${entry} assignment`);
  }
}

// Every migrated entry must be implemented by the settings module itself, not
// merely somewhere outside main.js where the aggregate source check can see it.
const settingsFile = sourceModules.find(m => m.file.endsWith('settings-ui.js'));
if (!settingsFile) {
  failures.push('source: missing src/settings-ui.js');
} else {
  const assignments = analyze(settingsFile.code, 'module').windowAssignments;
  for (const entry of SETTING_ENTRIES) {
    if (!assignments.has(entry)) failures.push(`settings-ui.js: missing window.${entry} assignment`);
  }
}

// === Composition-root and phone entry ownership checks ===
const LEGACY_WINDOW_ENTRIES = [
  '__pmAddEmojiImage', '__pmAddEmojiSet', '__pmAutoGenContacts', '__pmAutoPoke',
  '__pmBeforeUnloadRegistered', '__pmBgGlobal',
  '__pmBgLocal', '__pmBgUrl', '__pmBidirectional', '__pmClearBg', '__pmClearCustomColor',
  '__pmConfig', '__pmConfirmAddEmojiImage', '__pmConfirmAddEmojiSet', '__pmConfirmAutoGen',
  '__pmConfirmExpandInput', '__pmConfirmGroup', '__pmDel', '__pmDelGroup',
  '__pmDeleteEmojiImage', '__pmDeleteEmojiSet', '__pmDeleteProfile', '__pmDeleteSelected',
  '__pmEditGroup', '__pmEmojiSetDot', '__pmEmoFileRead',
  '__pmEmojis', '__pmEnd', '__pmExportData', '__pmGroupInputChanged', '__pmGroupMeta',
  '__pmHistories', '__pmImportData', '__pmIncrementCounters', '__pmOpen', '__pmPickProfile',
  '__pmPoke', '__pmPokeConfig', '__pmPokeGroup', '__pmProfiles',
  '__pmSaveAndCloseContactConfig', '__pmSaveAndCloseGroupEdit', '__pmSaveConfig', '__pmSend',
  '__pmSetBorderColor', '__pmSetCustomColor', '__pmSetDarkMode', '__pmSetLayout', '__pmSetMode',
  '__pmSetPreset', '__pmShowAddContact', '__pmShowConfig', '__pmShowExpandInput',
  '__pmShowEmojiPicker', '__pmShowGroupCreate', '__pmShowList', '__pmShowModelPicker',
  '__pmSwitch', '__pmSwitchContact', '__pmSwitchTab', '__pmTempText', '__pmTestApi',
  '__pmTestModel', '__pmTheme', '__pmRenderEmojiSetList', '__pmInsertEmoji',
  '__pmToggleAutoPoke', '__pmToggleAutoPokeGroup', '__pmToggleBidirectional', '__pmToggleMin',
  '__pmToggleSelect', '__pmToggleWordyLimit', '__pmUploadBg', '__pmWordyLimit',
];

const PHONE_ENTRY_OWNERS = {
  'phone-foundation.js': ['__pmToggleBidirectional', '__pmCloseOverlay'],
  'phone-chat.js': ['__pmSend', '__pmSubmitPending', '__pmIncrementCounters'],
  'phone-control-center.js': [
    '__pmShowControlCenter', '__pmShowExpandInput', '__pmConfirmExpandInput',
    '__pmRefreshControlCenter', '__pmEditPending', '__pmDeletePending', '__pmClearPending', '__pmResetPendingEditor',
  ],
  'phone-directory.js': [
    '__pmSaveAndCloseGroupEdit', '__pmShowGroupCreate', '__pmGroupInputChanged',
    '__pmConfirmGroup', '__pmShowList', '__pmShowAddContact', '__pmDelGroup', '__pmDel',
  ],
  'contact-generator.js': ['__pmConfirmAutoGen', '__pmAutoGenContacts'],
  'conversation.js': ['__pmSwitchContact', '__pmSwitch'],
  'phone-chat-poke.js': [
    '__pmAutoPoke', '__pmSaveAndCloseContactConfig', '__pmToggleAutoPoke',
    '__pmPoke', '__pmEditGroup', '__pmToggleAutoPokeGroup', '__pmPokeGroup',
  ],
  'phone-lifecycle.js': [
    '__pmToggleSelect', '__pmDeleteSelected', '__pmToggleMin', '__pmEnd', '__pmOpen',
  ],
  'emoji-ui.js': [
    '__pmRenderEmojiSetList', '__pmAddEmojiSet', '__pmConfirmAddEmojiSet', '__pmDeleteEmojiSet',
    '__pmAddEmojiImage', '__pmEmoFileRead', '__pmConfirmAddEmojiImage', '__pmDeleteEmojiImage',
    '__pmShowEmojiPicker', '__pmEmojiSetDot', '__pmInsertEmoji', '__pmTempText',
  ],
};

const phoneEntryOwnerByName = new Map();
for (const [ownerFile, entries] of Object.entries(PHONE_ENTRY_OWNERS)) {
  const ownerModule = sourceModuleByName.get(ownerFile);
  if (!ownerModule) {
    failures.push(`source: missing src/${ownerFile}`);
    continue;
  }
  const ownerAssignments = analyze(ownerModule.code, 'module').windowAssignments;
  for (const entry of entries) {
    phoneEntryOwnerByName.set(entry, ownerFile);
    if (!ownerAssignments.has(entry)) failures.push(`${ownerFile}: missing window.${entry} assignment`);
  }
}

for (const { file, code } of sourceModules) {
  const fileName = path.basename(file);
  const assignments = analyze(code, 'module').windowAssignments;
  for (const entry of assignments) {
    const expectedOwner = phoneEntryOwnerByName.get(entry);
    if (expectedOwner && expectedOwner !== fileName) {
      failures.push(`${fileName}: must not define window.${entry}; owner is ${expectedOwner}`);
    }
  }
}

for (const [label, , result] of analyzedFiles) {
  for (const entry of LEGACY_WINDOW_ENTRIES) {
    if (!result.windowAssignments.has(entry)) failures.push(`${label}: legacy window API missing window.${entry}`);
  }
}

const mainFile = sourceModuleByName.get('main.js');
if (mainFile) {
  const assignments = analyze(mainFile.code, 'module').windowAssignments;
  for (const entry of assignments) {
    if (entry.startsWith('__pm')) failures.push(`main.js: composition root must not define window.${entry}`);
  }
  const expectedInstallerCalls = [
    'installPhoneFoundation(state, deps)', 'installConversation(state, deps)',
    'installPhoneChat(state, deps)', 'installPhoneControlCenter(state, deps)', 'installPhoneDirectory(state, deps)',
    'installContactGenerator(state, deps)', 'installPhoneChatPoke(state, deps)',
    'installPhoneLifecycle(state, deps)',
  ];
  for (const installerCall of expectedInstallerCalls) requireText('main.js', mainFile.code, installerCall);

  const installerOrder = [];
  walk(parseJavaScript(mainFile.code, 'module'), node => {
    if (node.type !== 'CallExpression' || node.callee?.type !== 'Identifier') return;
    if (node.callee.name.startsWith('install')) installerOrder.push({ name: node.callee.name, start: node.start });
  });
  installerOrder.sort((a, b) => a.start - b.start);
  const actualOrder = installerOrder.map(item => item.name);
  const expectedOrder = [
    'installPhoneFoundation', 'installConversation', 'installEmojiUi', 'installSettingsUi',
    'installPhoneChat', 'installPhoneControlCenter', 'installPhoneDirectory', 'installContactGenerator',
    'installPhoneChatPoke', 'installPhoneLifecycle',
  ];
  if (actualOrder.length !== expectedOrder.length
      || actualOrder.some((installer, index) => installer !== expectedOrder[index])) {
    failures.push(
      `main.js: installer order invalid; expected ${expectedOrder.join(' -> ')}, got ${actualOrder.join(' -> ')}`,
    );
  }
}

requireText('source', source, "import { installSettingsUi } from './settings-ui.js'");
requireText('source', source, "installSettingsUi({");
requireText('behavior-config.js', sourceModuleByName.get('behavior-config.js')?.code || '', 'normalizeCharacterBehaviorStore');
requireText('behavior-config.js', sourceModuleByName.get('behavior-config.js')?.code || '', 'normalizeGroupMetaStore');
requireText('constants.js', sourceModuleByName.get('constants.js')?.code || '', 'NONE: -1');
requireText('constants.js', sourceModuleByName.get('constants.js')?.code || '', 'IN_PROMPT: 0');
requireText('constants.js', sourceModuleByName.get('constants.js')?.code || '', 'IN_CHAT: 1');
requireText('constants.js', sourceModuleByName.get('constants.js')?.code || '', 'BEFORE_PROMPT: 2');
requireText('constants.js', sourceModuleByName.get('constants.js')?.code || '', 'MAX_INJECTION_DEPTH = 10000');
requireText('storage.js', sourceModuleByName.get('storage.js')?.code || '', 'saveCharacterBehavior');
requireText('runtime.js', sourceModuleByName.get('runtime.js')?.code || '', 'pendingMessages: new Map()');
requireText('phone-chat.js', sourceModuleByName.get('phone-chat.js')?.code || '', 'removePendingBatch(runtime');
requireText('phone-chat.js', sourceModuleByName.get('phone-chat.js')?.code || '', 'rebaseRenderedHistory(historyWindow.trimmedCount)');
requireText('phone-chat-poke.js', sourceModuleByName.get('phone-chat-poke.js')?.code || '', 'rebaseRenderedHistory(historyWindow.trimmedCount)');
requireText('phone-control-center.js', sourceModuleByName.get('phone-control-center.js')?.code || '', 'updatePendingMessage(');
for (const iconName of ['MENU_ICON_SVG', 'TRASH_ICON_SVG', 'CLOSE_ICON_SVG', 'CONTROL_ICON_SVG', 'SEND_ICON_SVG']) {
  requireText('icons.js', sourceModuleByName.get('icons.js')?.code || '', `export const ${iconName}`);
}
requireText('contact-generator.js', sourceModuleByName.get('contact-generator.js')?.code || '', 'installContactGenerator(state, deps)');
requireText('contact-generator.js', sourceModuleByName.get('contact-generator.js')?.code || '', '!state.generationTask');

// Cold-start recovery must be tied to the phone window lifecycle. SillyTavern's
// storage id can legitimately stabilize while IndexedDB is loading; treating that
// change as a stale callback leaves the loading placeholder on screen forever.
const lifecycleFile = sourceModuleByName.get('phone-lifecycle.js');
if (!lifecycleFile) {
  failures.push('source: missing src/phone-lifecycle.js');
} else {
  requireText('phone-lifecycle.js', lifecycleFile.code, 'if (!state.phoneActive || state.phoneWindow !== openingWindow) return;');
  if (lifecycleFile.code.includes('openingStorageId')) failures.push('phone-lifecycle.js: cold-start callback must not be invalidated by a storage id transition');
}


for (const expected of ['#pm-iphone', '#pm-overlay', '.pm-model-options', '--pm-model-visible-rows', '@media(max-width:500px),(max-height:700px)']) {
  requireText('css', css, expected);
}
if (source.includes('pm-css')) failures.push('source: inline CSS injector id still present');
if (css.includes('${')) failures.push('css: JavaScript template expression remains');
if (manifest.js !== 'index.js') failures.push('manifest: js entry must remain index.js');
if (manifest.css !== 'style.css') failures.push('manifest: css entry must be style.css');

const entries = await readdir(root, { recursive: true });
for (const entry of entries) {
  const normalized = entry.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.includes('.git') || segments.includes('node_modules')) continue;
  if (/PhoneMode.*Backup.*\.json$/i.test(normalized)) failures.push(`sensitive backup file present: ${normalized}`);
  if (/(^|\/)\.env(?:\.|$)/.test(normalized) && path.posix.basename(normalized) !== '.env.example') failures.push(`environment file present: ${normalized}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Static contracts verified.');
