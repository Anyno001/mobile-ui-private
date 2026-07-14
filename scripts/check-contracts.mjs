import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

const root = process.cwd();
const [source, bundle, css, manifestText] = await Promise.all([
  readFile(path.join(root, 'src/main.js'), 'utf8'),
  readFile(path.join(root, 'index.js'), 'utf8'),
  readFile(path.join(root, 'style.css'), 'utf8'),
  readFile(path.join(root, 'manifest.json'), 'utf8'),
]);
const manifest = JSON.parse(manifestText);
const failures = [];

function requireText(label, text, expected) {
  if (!text.includes(expected)) failures.push(`${label}: missing ${expected}`);
}

function parseJavaScript(code) {
  return parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
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

function analyze(code) {
  const result = { commandObject: false, legacyCommand: false, styleElement: false };
  walk(parseJavaScript(code), node => {
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

const analyzedFiles = [['source', source, analyze(source)], ['bundle', bundle, analyze(bundle)]];

for (const expected of ['PhoneModeDB', 'ST_SMS_DATA_V2', 'window.__pmOpen', 'v9.5.7']) {
  for (const [label, text] of analyzedFiles) requireText(label, text, expected);
}
for (const [label, , result] of analyzedFiles) {
  if (!result.commandObject) failures.push(`${label}: missing SlashCommand.fromProps phone registration`);
  if (!result.legacyCommand) failures.push(`${label}: missing registerSlashCommand phone fallback`);
  if (result.styleElement) failures.push(`${label}: forbidden style element injection`);
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
