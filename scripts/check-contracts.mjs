import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parse } from 'acorn';
import postcss from 'postcss';
import { build } from 'esbuild';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const CSS_MODULE_FILES = [
  'styles/core.css',
  'styles/modal-settings.css',
  'styles/community.css',
  'styles/calendar.css',
  'styles/today-trend.css',
  'styles/overrides.css',
];
const [srcEntries, bundle, cssEntry, manifestText, packageText, lockText, readme, baselineText, cssTokensText, lifecycleResourcesText, governanceRegistryText, ...cssModules] = await Promise.all([
  readdir(srcRoot, { recursive: true }),
  readFile(path.join(root, 'index.js'), 'utf8'),
  readFile(path.join(root, 'style.css'), 'utf8'),
  readFile(path.join(root, 'manifest.json'), 'utf8'),
  readFile(path.join(root, 'package.json'), 'utf8'),
  readFile(path.join(root, 'package-lock.json'), 'utf8'),
  readFile(path.join(root, 'README.md'), 'utf8'),
  readFile(path.join(root, 'docs', 'BASELINE.md'), 'utf8'),
  readFile(path.join(root, 'docs', 'CSS-TOKENS.md'), 'utf8'),
  readFile(path.join(root, 'docs', 'LIFECYCLE-RESOURCES.md'), 'utf8'),
  readFile(path.join(root, 'scripts', 'css-governance-registry.json'), 'utf8'),
  ...CSS_MODULE_FILES.map(file => readFile(path.join(root, file), 'utf8')),
]);
const expectedCssImports = CSS_MODULE_FILES.map(file => `@import url("${file}");`).join('\n');
if (String(cssEntry).replace(/\r\n?/g, '\n').trim() !== expectedCssImports) {
  throw new Error('style.css: entry imports must list every CSS module in source order');
}
const css = cssModules.join('\n').replaceAll('../assets/', './assets/');
if (cssModules.some(module => module.includes('url("./assets/"'))) {
  throw new Error('styles: asset URLs must be relative to the styles directory');
}
const sourceFiles = srcEntries
  .filter(entry => entry.endsWith('.js'))
  .sort()
  .map(entry => path.join(srcRoot, entry));
const sourceModules = await Promise.all(sourceFiles.map(async file => ({
  file,
  code: await readFile(file, 'utf8'),
})));
const failures = [];
const sourceModuleByName = new Map();
const sourceModuleByRelativePath = new Map();
for (const module of sourceModules) {
  const name = path.basename(module.file);
  const relativePath = `src/${path.relative(srcRoot, module.file).replaceAll(path.sep, '/')}`;
  if (sourceModuleByName.has(name)) {
    failures.push(`src: duplicate module basename prevents unambiguous contract lookup: ${name}`);
  }
  sourceModuleByName.set(name, module);
  sourceModuleByRelativePath.set(relativePath, module);
}
const source = sourceModules.map(({ code }) => code).join('\n');
const manifest = JSON.parse(manifestText);
const packageJson = JSON.parse(packageText);
const packageLock = JSON.parse(lockText);
const rebuiltBundle = await build({
  absWorkingDir: root,
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  outfile: 'index.js',
  legalComments: 'none',
  write: false,
});
const rebuiltBundleText = rebuiltBundle.outputFiles[0]?.text || '';
if (bundle !== rebuiltBundleText) failures.push('index.js: bundle does not exactly match an in-memory esbuild rebuild');
const BUNDLE_BASELINE_BYTES = 1240219;
const BUNDLE_MAX_BYTES = 1488263;
if (Buffer.byteLength(bundle, 'utf8') > BUNDLE_MAX_BYTES) {
  failures.push(
    `index.js: ${Buffer.byteLength(bundle, 'utf8')} bytes exceeds the ${BUNDLE_MAX_BYTES}-byte baseline limit (${BUNDLE_BASELINE_BYTES} * 120%)`,
  );
}
for (const cssModulePath of CSS_MODULE_FILES) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', cssModulePath], {
      cwd: root, stdio: 'ignore', windowsHide: true,
    });
  } catch {
    failures.push(`${cssModulePath}: production CSS module must be tracked by git`);
  }
}
for (const modulePath of [
  'src/calendar-weather-source.js', 'src/calendar-page-view.js',
  'src/calendar-recipe-controller.js', 'src/calendar-recipe-model.js',
  'src/phone-quote.js', 'src/interactive-scenes-utils.js',
]) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', modulePath], {
      cwd: root, stdio: 'ignore', windowsHide: true,
    });
  } catch {
    failures.push(`${modulePath}: production source module must be tracked by git`);
  }
}

const normalizeLineEndings = value => String(value).replace(/\r\n?/g, '\n');
const normalizeCssValue = value => String(value).replace(/\s*!important\b/g, ' !important').trim();
const normalizeCssText = value => normalizeLineEndings(value).replace(/@media\s+/g, '@media').replace(/\s*([{}:;,])\s*/g, '$1').replace(/\s*!important\b/g, '!important').replace(/;}/g, '}').trim();
function normalizeStyleTokenExpectation(value) {
  const radiusTokens = new Map([
    ['0 0 2px 0', 'var(--pm-radius-none) var(--pm-radius-none) var(--pm-radius-compact) var(--pm-radius-none)'],
    ['10px 10px 0 0', 'var(--pm-radius-control) var(--pm-radius-control) var(--pm-radius-none) var(--pm-radius-none)'],
    ['50%', 'var(--pm-radius-circle)'], ['999px', 'var(--pm-radius-pill)'], ['0', 'var(--pm-radius-none)'],
    ['2px', 'var(--pm-radius-compact)'], ['4px', 'var(--pm-radius-bubble-tail)'], ['5px', 'var(--pm-radius-compact)'],
    ['6px', 'var(--pm-radius-compact)'], ['7px', 'var(--pm-radius-compact)'], ['8px', 'var(--pm-radius-compact)'],
    ['9px', 'var(--pm-radius-compact)'], ['10px', 'var(--pm-radius-control)'], ['11px', 'var(--pm-radius-panel)'],
    ['12px', 'var(--pm-radius-panel)'], ['13px', 'var(--pm-radius-card)'], ['14px', 'var(--pm-radius-card)'],
    ['15px', 'var(--pm-radius-large)'], ['16px', 'var(--pm-radius-large)'], ['17px', 'var(--pm-radius-large)'],
    ['18px', 'var(--pm-radius-bubble)'], ['20px', 'var(--pm-radius-round)'], ['26px', 'var(--pm-radius-modal)'],
  ]);
  const fontTokens = new Map([
    ['9px', 'var(--pm-font-size-micro)'], ['10px', 'var(--pm-font-size-caption)'], ['11px', 'var(--pm-font-size-helper)'],
    ['12px', 'var(--pm-font-size-label)'], ['13px', 'var(--pm-font-size-compact)'], ['14px', 'var(--pm-font-size-body)'],
    ['15px', 'var(--pm-font-size-subtitle)'], ['16px', 'var(--pm-font-size-title)'], ['17px', 'var(--pm-font-size-subtitle)'],
    ['18px', 'var(--pm-font-size-icon)'], ['20px', 'var(--pm-font-size-icon-lg)'],
  ]);
  return String(value)
    .replace(/(border(?:-(?:top|right|bottom|left))?(?:-(?:left|right))?-radius\s*:\s*)([^;{}]+)/g, (all, prefix, raw) => {
      const important = /\s*!important\s*$/.test(raw) ? ' !important' : '';
      const token = radiusTokens.get(raw.replace(/\s*!important\s*$/, '').trim());
      return token ? `${prefix}${token}${important}` : all;
    })
    .replace(/font-size\s*:\s*(9|10|11|12|13|14|15|16|17|18|20)px/g, (all, size) => `font-size:${fontTokens.get(`${size}px`)}`)
    .replace(/font-size\s*:\s*25px/g, 'font-size:var(--pm-scene-hero-title-size)')
    .replace(/font-size\s*:\s*28px/g, 'font-size:var(--pm-calendar-status-value-size)')
    .replace(/\b(600|650)\s+(9|10|11|12|13|14|15|16|17|18|20)px(?=\/)/g, (all, weight, size) => `${weight} ${fontTokens.get(`${size}px`)}`);
}
function requireText(label, text, expected) {
  const normalizedExpected = label === 'style.css' ? normalizeStyleTokenExpectation(expected) : expected;
  const normalize = label === 'style.css' || label === 'css' || label.startsWith('style.css ')
    ? normalizeCssText
    : normalizeLineEndings;
  if (!normalize(text).includes(normalize(normalizedExpected))) failures.push(`${label}: missing ${normalizedExpected}`);
}

function buttonContaining(label, text, marker) {
  const matches = [...normalizeLineEndings(text).matchAll(/<button\b[\s\S]*?<\/button>/g)]
    .map(match => match[0])
    .filter(button => button.includes(marker));
  if (!matches.length) {
    failures.push(`${label}: missing button marker ${marker}`);
    return '';
  }
  if (matches.length !== 1) {
    failures.push(`${label}: expected exactly one complete button containing ${marker}, found ${matches.length}`);
    return '';
  }
  return matches[0];
}

function elementContainingClass(label, text, className, marker = '') {
  const source = normalizeLineEndings(text);
  const classNeedle = `class="${className}"`;
  const matches = [];
  let classIndex = -1;
  while ((classIndex = source.indexOf(classNeedle, classIndex + 1)) >= 0) {
    const openStart = source.lastIndexOf('<', classIndex);
    const opening = /^<([a-z][\w-]*)\b[^>]*>/i.exec(source.slice(openStart));
    if (!opening) continue;
    const tagName = opening[1];
    const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
    tagPattern.lastIndex = openStart;
    let depth = 0;
    let fragment = '';
    for (let token = tagPattern.exec(source); token; token = tagPattern.exec(source)) {
      const raw = token[0];
      if (raw.startsWith('</')) depth -= 1;
      else if (!raw.endsWith('/>')) depth += 1;
      if (depth === 0) {
        fragment = source.slice(openStart, tagPattern.lastIndex);
        break;
      }
    }
    if (fragment && (!marker || fragment.includes(marker))) matches.push(fragment);
  }
  if (!matches.length) {
    failures.push(`${label}: missing container .${className}${marker ? ` containing ${marker}` : ''}`);
    return '';
  }
  if (matches.length !== 1) {
    failures.push(`${label}: expected one .${className}${marker ? ` containing ${marker}` : ''}, found ${matches.length}`);
    return '';
  }
  return matches[0];
}

function countDirectButtons(fragment) {
  const tagPattern = /<\/?([a-z][\w-]*)\b[^>]*>/gi;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  let depth = 0;
  let buttons = 0;
  for (let token = tagPattern.exec(fragment); token; token = tagPattern.exec(fragment)) {
    const raw = token[0];
    const tagName = token[1].toLowerCase();
    if (raw.startsWith('</')) {
      depth -= 1;
      continue;
    }
    if (depth === 1 && tagName === 'button') buttons += 1;
    if (!raw.endsWith('/>') && !voidTags.has(tagName)) depth += 1;
  }
  return buttons;
}

function requireDirectButtonCount(label, text, className, marker, expectedCount) {
  const fragment = elementContainingClass(label, text, className, marker);
  if (!fragment) return '';
  const count = countDirectButtons(fragment);
  if (count !== expectedCount) failures.push(`${label}: .${className} must contain exactly ${expectedCount} direct buttons, found ${count}`);
  return fragment;
}

function requireExactTwoButtonContainer(label, text, className, marker, orderedMarkers = []) {
  const fragment = requireDirectButtonCount(label, text, className, marker, 2);
  if (!fragment) return;
  let previous = -1;
  for (const orderedMarker of orderedMarkers) {
    const next = fragment.indexOf(orderedMarker);
    if (next < 0 || next <= previous) failures.push(`${label}: direct button marker order must include ${orderedMarkers.join(' -> ')}`);
    previous = next;
  }
}

function parseCssRules(cssText, sourcePath = 'style.css') {
  const ast = postcss.parse(normalizeLineEndings(cssText), { from: sourcePath });
  const rules = [];
  const atRuleContext = rule => {
    const ancestors = [];
    for (let node = rule.parent; node; node = node.parent) {
      if (node.type === 'atrule') ancestors.unshift(`@${node.name} ${node.params}`.trim());
    }
    return ancestors.join(' > ') || 'root';
  };

  ast.walkRules(rule => {
    const selectors = rule.selectors?.map(selector => selector.trim()).filter(Boolean) || [];
    if (!selectors.length) return;
    const declarations = new Map();
    rule.each(node => {
      if (node.type === 'decl') declarations.set(node.prop, `${node.value}${node.important ? ' !important' : ''}`);
    });
    rules.push({
      selectors,
      declarations,
      path: sourcePath,
      line: rule.source?.start?.line || 0,
      parent: atRuleContext(rule),
    });
  });
  return rules;
}

const PADDING_MARGIN_PROPERTY = /^(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$/;
const SPACING_LITERAL = /(?<![\w.-])(?:-?\d+(?:\.\d+)?px|0|auto|100%)(?![\w.-])/;
const INCREMENTAL_DIMENSION_PROPERTY = /^(?:width|height|min-width|min-height|max-width|max-height|flex-basis|grid-template-columns)$/;
const INCREMENTAL_RAW_PX = /(?<![\w.-])(-?\d+(?:\.\d+)?)px(?![\w.-])/g;
const INCREMENTAL_RAW_WEIGHT = /^(?:400|500|600)(?: !important)?$/;
const INCREMENTAL_TRANSFORM = /\b(?:translate|translateX|translateY|translate3d)\(/i;
const RADIUS_PROPERTY = /^(?:border-radius|border-(?:top|bottom)-(?:left|right)-radius|border-(?:start|end)-(?:start|end)-radius)$/;
const FONT_SIZE_LITERAL = /(?<![\w.-])\d+(?:\.\d+)?px(?![\w.-])/;
const EMPTY_LEGACY_VALUE_CATEGORIES = new Set(['fontSize', 'lineHeight', 'radius', 'zIndex', 'animation']);
const LEGACY_VALUE_PROPERTIES = {
  color: property => property === 'color' || property.endsWith('color') || property === 'background' || property === 'background-image',
  fontSize: property => property === 'font-size',
  lineHeight: property => property === 'line-height',
  spacing: property => PADDING_MARGIN_PROPERTY.test(property) || /^(?:gap|row-gap|column-gap|inset|top|right|bottom|left)$/.test(property),
  radius: property => RADIUS_PROPERTY.test(property),
  zIndex: property => property === 'z-index',
  transition: property => property === 'transition' || property === 'transition-duration',
  boxShadow: property => property === 'box-shadow',
  animation: property => property === 'animation' || property === 'animation-duration' || property === 'animation-timing-function',
};

const INTRINSIC_SPACING_VALUES = new Set(['0', '0 !important', 'auto', '100%', '50%']);

function hasRawColorLiteral(value) {
  return /#[0-9a-f]{3,8}(?![0-9a-f])|\b(?:rgba?|hsla?)\s*\(/i.test(value);
}

function hasRawColorVarFallback(value) {
  const source = String(value);
  for (let start = source.toLowerCase().indexOf('var('); start >= 0; start = source.toLowerCase().indexOf('var(', start + 4)) {
    let depth = 1;
    let comma = -1;
    let end = start + 4;
    for (; end < source.length && depth > 0; end += 1) {
      const character = source[end];
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      else if (character === ',' && depth === 1 && comma < 0) comma = end;
    }
    if (depth !== 0 || comma < 0) continue;
    if (hasRawColorLiteral(source.slice(comma + 1, end - 1))) return true;
  }
  return false;
}

function collectNewImportantFingerprints(baseline, current) {
  return [...current].filter(fingerprint => !baseline.has(fingerprint));
}

function compareLegacyCssValues(rules, legacyValues, animationExceptions = []) {
  for (const category of Object.keys(LEGACY_VALUE_PROPERTIES)) {
    if (category === 'lineHeight') continue;
    const entries = category === 'animation' ? animationExceptions : (legacyValues[category] || []);
    const approved = new Set(category === 'spacing' || category === 'animation'
      ? entries.map(entry => entry.value)
      : entries);
    const consumed = new Set();
    for (const rule of rules) for (const [property, value] of rule.declarations) {
      if (!LEGACY_VALUE_PROPERTIES[category](property)) continue;
      const normalizedValue = normalizeCssValue(value);
      const matchingEntry = category === 'spacing' || category === 'animation'
        ? entries.find(entry => entry.path === rule.path && entry.selector === rule.selectors.join(', ') && entry.property === property && entry.value === normalizedValue)
        : approved.has(normalizedValue);
      if (matchingEntry) consumed.add(category === 'spacing' || category === 'animation' ? matchingEntry : normalizedValue);
      const isTokenDeclaration = property.startsWith('--');
      if (category === 'color' && !isTokenDeclaration && hasRawColorVarFallback(normalizedValue)) {
        failures.push(`${rule.path}:${rule.line}: ${rule.selectors.join(', ')} adds raw color fallback in ${property}:${normalizedValue}`);
        continue;
      }
      if (normalizedValue.includes('var(') || normalizedValue === 'none' || normalizedValue === 'none !important' || normalizedValue === 'initial' || normalizedValue === 'inherit' || normalizedValue === 'unset' || (category === 'spacing' && INTRINSIC_SPACING_VALUES.has(normalizedValue)) || matchingEntry) continue;
      failures.push(`${rule.path}:${rule.line}: ${rule.selectors.join(', ')} adds unapproved legacy ${category} value ${property}:${normalizedValue}`);
    }
    for (const entry of category === 'spacing' || category === 'animation' ? entries : approved) {
      if (!consumed.has(entry)) failures.push(`css-governance-registry.json: legacyValues.${category} contains stale value ${category === 'spacing' ? `${entry.path} ${entry.selector} ${entry.property}:${entry.value}` : entry}`);
    }
  }
}

function normalizeIncrementalContext(value) {
  return String(value).trim().replace(/\s+/g, ' ').replace(/\s*([,:>+~()])\s*/g, '$1');
}

function incrementalDeclarationFingerprint(rule, selector, property, value) {
  return `${rule.path}::${normalizeIncrementalContext(rule.parent)}::${normalizeIncrementalContext(selector)}::${property}::${normalizeCssValue(value)}`;
}

function hasNonZeroRawPx(value) {
  return [...String(value).matchAll(INCREMENTAL_RAW_PX)].some(match => Number(match[1]) !== 0);
}

function incrementalHardcodeReason(property, value) {
  if (property === 'line-height' && !value.startsWith('var(')
      && !['inherit', 'initial', 'unset'].includes(value)) return 'bare line-height';
  if (property === 'font-weight' && INCREMENTAL_RAW_WEIGHT.test(value)) return 'bare font-weight';
  if (INCREMENTAL_DIMENSION_PROPERTY.test(property) && hasNonZeroRawPx(value)) return 'bare fixed dimension';
  if (property === 'transform' && INCREMENTAL_TRANSFORM.test(value) && hasNonZeroRawPx(value)) return 'bare transform offset';
  return '';
}

function collectIncrementalHardcodeFingerprints(rules) {
  const fingerprints = new Set();
  for (const rule of rules) for (const [property, rawValue] of rule.declarations) {
    if (property.startsWith('--')) continue;
    const value = normalizeCssValue(rawValue);
    if (!incrementalHardcodeReason(property, value)) continue;
    for (const selector of rule.selectors) fingerprints.add(incrementalDeclarationFingerprint(rule, selector, property, value));
  }
  return fingerprints;
}

function collectIncrementalHardcodeIssues(currentRules, baselineFingerprints) {
  const issues = [];
  for (const rule of currentRules) for (const [property, rawValue] of rule.declarations) {
    if (property.startsWith('--')) continue;
    const value = normalizeCssValue(rawValue);
    const reason = incrementalHardcodeReason(property, value);
    if (!reason) continue;
    for (const selector of rule.selectors) {
      const fingerprint = incrementalDeclarationFingerprint(rule, selector, property, value);
      if (!baselineFingerprints.has(fingerprint)) issues.push(`${rule.path}:${rule.line}: ${selector} adds incremental ${reason} ${property}:${value}`);
    }
  }
  return issues;
}

function readHeadCssRules(files) {
  const rules = [];
  const unavailableFiles = [];
  for (const file of files) {
    try {
      const text = execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true });
      rules.push(...parseCssRules(text, file));
    } catch {
      unavailableFiles.push(file);
    }
  }
  return { rules, unavailableFiles };
}

function collectSpacingLegacyIssues(rules, entries) {
  const issues = [];
  for (const rule of rules) for (const [property, rawValue] of rule.declarations) {
    if (!LEGACY_VALUE_PROPERTIES.spacing(property)) continue;
    const value = normalizeCssValue(rawValue);
    if (value.includes('var(') || INTRINSIC_SPACING_VALUES.has(value)) continue;
    if (!entries.some(entry => entry.path === rule.path && entry.selector === rule.selectors.join(', ') && entry.property === property && entry.value === value)) issues.push(`${rule.path}:${rule.line}: ${rule.selectors.join(', ')} adds unapproved legacy spacing value ${property}:${value}`);
  }
  return issues;
}

function requireCssDeclarations(rules, selector, expected) {
  const rule = rules.find(candidate => candidate.selectors.includes(selector));
  if (!rule) {
    failures.push(`style.css: missing selector ${selector}`);
    return;
  }
  for (const [property, value] of Object.entries(expected)) {
    const actual = rule.declarations.get(property);
    const normalizedExpected = normalizeStyleTokenExpectation(value);
    if (normalizeCssValue(actual) !== normalizeCssValue(normalizedExpected)) failures.push(`style.css:${rule.line}: ${selector} expected ${property}:${normalizedExpected}, received ${actual ?? '<missing>'}`);
  }
}

const cssRules = CSS_MODULE_FILES.flatMap((file, index) => parseCssRules(cssModules[index], file));
const governanceRegistry = JSON.parse(governanceRegistryText);
const versionedIncrementalBaseline = new Set(governanceRegistry.incrementalHardcodeBaseline || []);
const { rules: headCssRules, unavailableFiles: headUnavailableFiles } = readHeadCssRules(CSS_MODULE_FILES);
const incrementalBaselineFingerprints = collectIncrementalHardcodeFingerprints(headCssRules);
for (const file of headUnavailableFiles) {
  for (const fingerprint of versionedIncrementalBaseline) {
    if (fingerprint.startsWith(`${file}::`)) incrementalBaselineFingerprints.add(fingerprint);
  }
}
for (const issue of collectIncrementalHardcodeIssues(cssRules, incrementalBaselineFingerprints)) failures.push(issue);
const workspaceEntries = await readdir(root, { recursive: true });
const productionSvgFiles = workspaceEntries.map(entry => entry.replaceAll('\\', '/'))
  .filter(entry => /^assets\/.+\.svg$/i.test(entry)).sort();
const productionSvgTexts = new Map(await Promise.all(productionSvgFiles.map(async file => [
  file,
  await readFile(path.join(root, file), 'utf8'),
])));

function collectImportantFingerprints(rules) {
  const fingerprints = new Set();
  for (const rule of rules) for (const [property, value] of rule.declarations) {
    if (/\s!important$/i.test(normalizeCssValue(value))) {
      fingerprints.add(`${rule.path}::${rule.parent}::${rule.selectors.join(', ')}::${property}::${normalizeCssValue(value)}`);
    }
  }
  return fingerprints;
}

function collectProductionSvgIssues(texts) {
  const issues = [];
  for (const [file, svg] of texts) {
    if (!/<svg\b/i.test(svg)) issues.push(`${file}: production SVG must contain an svg root`);
    if (/<(?:image|script|foreignObject)\b/i.test(svg) || /(?:href|xlink:href)\s*=\s*["'](?:https?:|data:)/i.test(svg)) {
      issues.push(`${file}: production SVG must not embed executable, remote, or bitmap content`);
    }
    if (/<style\b/i.test(svg) || /\bstyle\s*=/i.test(svg)) issues.push(`${file}: production SVG must not contain inline CSS`);
    for (const match of svg.matchAll(/\b(?:fill|stroke|stop-color|flood-color|lighting-color)\s*=\s*(["'])([^"']+)\1/gi)) {
      const paint = match[2].trim().toLowerCase();
      if (paint !== '#000000' && paint !== 'none' && !/^url\(#[\w.-]+\)$/.test(paint)) {
        issues.push(`${file}: production SVG paint must be #000000, none, or a local paint server, received ${match[2].trim()}`);
      }
    }
  }
  return issues;
}
for (const issue of collectProductionSvgIssues(productionSvgTexts)) failures.push(issue);

const baselineImportantFingerprints = new Set(governanceRegistry.importantBaseline || []);
if (!Array.isArray(governanceRegistry.importantBaseline) || !baselineImportantFingerprints.size
    || baselineImportantFingerprints.size !== governanceRegistry.importantBaseline.length) {
  failures.push('css-governance-registry.json: importantBaseline must be a non-empty unique fingerprint array');
}
const currentImportantFingerprints = collectImportantFingerprints(cssRules);
for (const fingerprint of collectNewImportantFingerprints(baselineImportantFingerprints, currentImportantFingerprints)) failures.push(`css: unregistered !important addition ${fingerprint}`);
for (const fingerprint of collectNewImportantFingerprints(currentImportantFingerprints, baselineImportantFingerprints)) {
  failures.push(`css-governance-registry.json: stale important baseline ${fingerprint}`);
}
const importantSelfTestRules = parseCssRules('.a{color:var(--pm-color-accent)!important}\n.b{display:block}');
if (collectImportantFingerprints(importantSelfTestRules).size !== 1) {
  failures.push('self-test: !important counter did not detect a declaration');
}
if (!collectNewImportantFingerprints(collectImportantFingerprints(parseCssRules('.a{color:red!important}')), collectImportantFingerprints(parseCssRules('.b{color:red!important}'))).length) {
  failures.push('self-test: !important addition detector did not reject a new fingerprint');
}

{
  const registryFailures = [];
  if (governanceRegistry.version !== 3) registryFailures.push('css-governance-registry.json: version must be 3');
  const requireStringArray = (value, label) => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) {
      registryFailures.push(`css-governance-registry.json: ${label} must be a non-empty string array`);
      return [];
    }
    return value;
  };
  const tokensSection = governanceRegistry?.tokens;
  if (!tokensSection || typeof tokensSection !== 'object') {
    registryFailures.push('css-governance-registry.json: tokens section must be an object');
  }
  const publicPrefixes = requireStringArray(tokensSection?.public, 'tokens.public');
  const privatePrefixes = requireStringArray(tokensSection?.private, 'tokens.private');
  const compatTokens = requireStringArray(tokensSection?.compat, 'tokens.compat');
  const runtimeTokens = requireStringArray(tokensSection?.runtime, 'tokens.runtime');
  const allTokenNames = [...publicPrefixes, ...privatePrefixes, ...compatTokens, ...runtimeTokens];
  const seenTokens = new Set();
  for (const token of allTokenNames) {
    if (seenTokens.has(token)) registryFailures.push(`css-governance-registry.json: token ${token} is duplicated across categories`);
    seenTokens.add(token);
  }
  const allKnownPrefixes = [...publicPrefixes, ...privatePrefixes, ...compatTokens, ...runtimeTokens];
  for (const rule of cssRules) {
    for (const [property] of rule.declarations) {
      if (!property.startsWith('--pm-') && !property.startsWith('--scene-')) continue;
      if (allKnownPrefixes.some(prefix => prefix.endsWith('*')
        ? property.startsWith(prefix.slice(0, -1))
        : property === prefix)) continue;
      registryFailures.push(`style.css: ${rule.selectors.join(', ')} declares unregistered token ${property}`);
    }
  }
  const exceptions = governanceRegistry?.exceptions;
  if (!Array.isArray(exceptions)) registryFailures.push('css-governance-registry.json: exceptions must be an array');
  const seenExceptionIds = new Set();
  for (const exception of exceptions || []) {
    if (!exception?.id || !exception?.path || !exception?.selector || !exception?.owner || !exception?.removeWhen
        || !Array.isArray(exception?.properties) || !exception?.properties.length || !exception?.reason) {
      registryFailures.push(`css-governance-registry.json: exception ${exception?.id || '<missing id>'} must declare id/path/selector/properties/reason/owner/removeWhen`);
    }
    if (exception?.id && seenExceptionIds.has(exception.id)) registryFailures.push(`css-governance-registry.json: duplicate exception id ${exception.id}`);
    if (exception?.id) seenExceptionIds.add(exception.id);
    if (exception?.path?.startsWith('src/') && !sourceModuleByRelativePath.has(exception.path)) {
      registryFailures.push(`css-governance-registry.json: exception ${exception.id} references missing module ${exception.path}`);
    }
  }
  const stableFiles = governanceRegistry?.inline?.stableFiles;
  if (!Array.isArray(stableFiles)) registryFailures.push('css-governance-registry.json: inline.stableFiles must be an array');
  for (const file of stableFiles || []) {
    if (typeof file !== 'string' || !file.startsWith('src/') || !sourceModuleByRelativePath.has(file)) {
      registryFailures.push(`css-governance-registry.json: stableFiles entry must be a src/ path to an existing module: ${String(file)}`);
    }
  }
  const dataDriven = governanceRegistry?.inline?.dataDrivenStyle;
  if (!Array.isArray(dataDriven)) registryFailures.push('css-governance-registry.json: inline.dataDrivenStyle must be an array');
  for (const entry of dataDriven || []) {
    if (typeof entry?.file !== 'string' || !entry.file.startsWith('src/') || !sourceModuleByRelativePath.has(entry.file)
        || !entry?.scope || !Array.isArray(entry?.properties) || !entry?.properties.length || !entry?.reason) {
      registryFailures.push('css-governance-registry.json: dataDrivenStyle entry must declare file/scope/properties/reason');
    }
  }
  const tokenContracts = governanceRegistry?.tokenContracts;
  if (!Array.isArray(tokenContracts) || !tokenContracts.length) {
    registryFailures.push('css-governance-registry.json: tokenContracts must declare every private token prefix');
  }
  const componentRoots = governanceRegistry?.componentRoots;
  if (!componentRoots || typeof componentRoots !== 'object' || Array.isArray(componentRoots)) {
    registryFailures.push('css-governance-registry.json: componentRoots must be an object');
  } else {
    const seenRoots = new Set();
    for (const [owner, roots] of Object.entries(componentRoots)) {
      if (!owner || !Array.isArray(roots) || !roots.length || roots.some(root => typeof root !== 'string' || !root)) {
        registryFailures.push(`css-governance-registry.json: componentRoots.${owner} must be a non-empty string array`);
        continue;
      }
      for (const root of roots) {
        if (seenRoots.has(root)) registryFailures.push(`css-governance-registry.json: component root ${root} is registered more than once`);
        seenRoots.add(root);
        if (!cssRules.some(rule => rule.selectors.some(selector => selector.includes(root)))) {
          registryFailures.push(`css-governance-registry.json: component root ${root} has no style.css rule`);
        }
      }
    }
  }
  const privateTokenPrefixes = privatePrefixes.map(prefix => prefix.endsWith('*') ? prefix.slice(0, -1) : prefix);
  const seenContractPrefixes = new Set();
  for (const contract of tokenContracts || []) {
    if (seenContractPrefixes.has(contract?.prefix)) registryFailures.push(`css-governance-registry.json: duplicate private token contract ${contract?.prefix || '<missing prefix>'}`);
    if (contract?.prefix) seenContractPrefixes.add(contract.prefix);
  }
  for (const prefix of privateTokenPrefixes) {
    const contract = (tokenContracts || []).find(entry => entry?.prefix === prefix);
    if (!contract || !Array.isArray(contract.rootSelectors) || !contract.rootSelectors.length
        || typeof contract.owner !== 'string' || typeof contract.themeStrategy !== 'string') {
      registryFailures.push(`css-governance-registry.json: private token prefix ${prefix} must declare owner/rootSelectors/themeStrategy`);
      continue;
    }
    for (const rule of cssRules) {
      const privateDeclarations = [...rule.declarations.keys()].filter(property => property.startsWith(prefix));
      const privateConsumers = [...rule.declarations.entries()]
        .filter(([, value]) => value.includes(`var(${prefix}`))
        .map(([property]) => property);
      if (!privateDeclarations.length && !privateConsumers.length) continue;
      if (!rule.selectors.some(selector => contract.rootSelectors.some(rootSelector => selector.includes(rootSelector)))) {
        const operations = [
          privateDeclarations.length ? `declares ${privateDeclarations.join(', ')}` : '',
          privateConsumers.length ? `consumes ${privateConsumers.join(', ')}` : '',
        ].filter(Boolean).join(' and ');
        registryFailures.push(`style.css:${rule.line}: ${rule.selectors.join(', ')} ${operations} outside ${prefix}'s registered component root`);
      }
    }
  }
  const legacyValues = governanceRegistry?.legacyValues;
  if (!legacyValues || typeof legacyValues !== 'object' || Array.isArray(legacyValues)) {
    registryFailures.push('css-governance-registry.json: legacyValues must be an object');
  } else {
    for (const category of Object.keys(LEGACY_VALUE_PROPERTIES)) {
      const values = legacyValues[category];
      if (!Array.isArray(values)) {
        registryFailures.push(`css-governance-registry.json: legacyValues.${category} must be an array`);
      } else if (category === 'spacing') {
        for (const entry of values) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)
              || typeof entry.path !== 'string' || !CSS_MODULE_FILES.includes(entry.path)
              || typeof entry.selector !== 'string' || !entry.selector
              || typeof entry.property !== 'string' || !LEGACY_VALUE_PROPERTIES.spacing(entry.property)
              || typeof entry.value !== 'string' || !entry.value
              || typeof entry.owner !== 'string' || !entry.owner
              || typeof entry.reason !== 'string' || !entry.reason
              || typeof entry.removeWhen !== 'string' || !entry.removeWhen) {
            registryFailures.push('css-governance-registry.json: legacyValues.spacing entries must declare path/selector/property/value/owner/reason/removeWhen');
          }
        }
      } else if (values.some(value => typeof value !== 'string' || !value)) {
        registryFailures.push(`css-governance-registry.json: legacyValues.${category} must be a string array`);
      } else if (EMPTY_LEGACY_VALUE_CATEGORIES.has(category) && values.length) {
        registryFailures.push(`css-governance-registry.json: legacyValues.${category} must remain empty after migration`);
      } else if (!EMPTY_LEGACY_VALUE_CATEGORIES.has(category) && category !== 'spacing' && !values.length) {
        registryFailures.push(`css-governance-registry.json: legacyValues.${category} must list its remaining approved values`);
      }
    }
    const lineHeightExceptions = governanceRegistry.lineHeightExceptions;
    if (!Array.isArray(lineHeightExceptions)) {
      registryFailures.push('css-governance-registry.json: lineHeightExceptions must be an array');
    } else for (const exception of lineHeightExceptions) {
      if (!exception || typeof exception !== 'object' || Array.isArray(exception)
          || typeof exception.path !== 'string' || !CSS_MODULE_FILES.includes(exception.path)
          || typeof exception.selector !== 'string' || !exception.selector
          || !['line-height', 'font'].includes(exception.property)
          || typeof exception.value !== 'string' || !exception.value
          || typeof exception.owner !== 'string' || !exception.owner
          || typeof exception.reason !== 'string' || !exception.reason
          || typeof exception.removeWhen !== 'string' || !exception.removeWhen) {
        registryFailures.push('css-governance-registry.json: lineHeightExceptions entries must declare path/selector/property/value/owner/reason/removeWhen');
      }
    }
    const animationExceptions = governanceRegistry.animationExceptions;
    if (!Array.isArray(animationExceptions)) {
      registryFailures.push('css-governance-registry.json: animationExceptions must be an array');
    } else for (const exception of animationExceptions) {
      if (!exception || typeof exception !== 'object' || Array.isArray(exception)
          || typeof exception.path !== 'string' || !CSS_MODULE_FILES.includes(exception.path)
          || typeof exception.selector !== 'string' || !exception.selector
          || !['animation', 'animation-duration', 'animation-timing-function'].includes(exception.property)
          || typeof exception.value !== 'string' || !exception.value
          || typeof exception.owner !== 'string' || !exception.owner
          || typeof exception.reason !== 'string' || !exception.reason
          || typeof exception.removeWhen !== 'string' || !exception.removeWhen) {
        registryFailures.push('css-governance-registry.json: animationExceptions entries must declare path/selector/property/value/owner/reason/removeWhen');
      }
    }

    for (const exception of animationExceptions || []) {
      const matchesException = cssRules.some(candidate => (
        candidate.path === exception.path
        && candidate.selectors.join(', ') === exception.selector
        && normalizeCssValue(candidate.declarations.get(exception.property)) === exception.value
      ));
      if (!matchesException) {
        registryFailures.push(`css-governance-registry.json: animationExceptions contains stale entry ${exception.path} ${exception.selector} ${exception.property}:${exception.value}`);
      }
    }

    if (!Array.isArray(governanceRegistry.externallyDefinedTokens) || governanceRegistry.externallyDefinedTokens.some(token => typeof token !== 'string' || !token)) {
      registryFailures.push('css-governance-registry.json: externallyDefinedTokens must be a string array');
    }
    for (const exception of lineHeightExceptions || []) {
      const matchesException = cssRules.some(candidate => {
        if (candidate.path !== exception.path || candidate.selectors.join(', ') !== exception.selector) return false;
        const rawValue = candidate.declarations.get(exception.property);
        const actualValue = exception.property === 'font'
          ? rawValue?.replace(/\s*!important\s*$/i, '').trim().match(/\/\s*([^\s/]+)(?=\s|$)/)?.[1]
          : normalizeCssValue(rawValue);
        return actualValue === exception.value;
      });
      if (!matchesException) {
        registryFailures.push(`css-governance-registry.json: lineHeightExceptions contains stale entry ${exception.path} ${exception.selector} ${exception.property}:${exception.value}`);
      }
    }
  }
  if (registryFailures.length) failures.push(...registryFailures);
}
function collectFrozenSpacingTokenIssues(declaredSpacingTokens, frozenSpacingTokens, path = 'style.css') {
  const issues = [];
  if (!Array.isArray(frozenSpacingTokens) || frozenSpacingTokens.some(token => typeof token !== 'string' || !/^--pm-space-px-\d+(?:\.\d+)?$/.test(token))) {
    issues.push('css-governance-registry.json: frozenSpacingTokens must be a string array of --pm-space-px-* tokens');
  }
  const actualFrozenSpacingTokens = new Set([...declaredSpacingTokens].filter(token => token.startsWith('--pm-space-px-')));
  const expectedFrozenSpacingTokens = new Set(frozenSpacingTokens || []);
  for (const token of actualFrozenSpacingTokens) {
    if (!expectedFrozenSpacingTokens.has(token)) issues.push(`${path}: new frozen spacing token is forbidden: ${token}`);
  }
  for (const token of expectedFrozenSpacingTokens) {
    if (!actualFrozenSpacingTokens.has(token)) issues.push(`css-governance-registry.json: frozenSpacingTokens contains stale token ${token}`);
  }
  return issues;
}
{
  const declaredSpacingTokens = new Set();
  const frozenSpacingTokens = governanceRegistry.frozenSpacingTokens;
  for (const rule of cssRules) {
    if (!rule.selectors.includes(':root')) continue;
    for (const property of rule.declarations.keys()) {
      if (property.startsWith('--pm-space-')) declaredSpacingTokens.add(property);
    }
  }
  failures.push(...collectFrozenSpacingTokenIssues(declaredSpacingTokens, frozenSpacingTokens));
  for (const rule of cssRules) for (const [property, value] of rule.declarations) {
    for (const match of value.matchAll(/var\(\s*(--pm-space-[\w-]+)/g)) {
      if (!declaredSpacingTokens.has(match[1])) {
        failures.push(`style.css:${rule.line}: ${rule.selectors.join(', ')} consumes undefined spacing token ${match[1]}`);
      }
    }
    if (PADDING_MARGIN_PROPERTY.test(property)) {
      if (!value.includes('var(') || SPACING_LITERAL.test(value.replace(/var\([^)]*\)/g, ''))) {
        failures.push(`style.css:${rule.line}: ${rule.selectors.join(', ')} must express ${property} with variables only, received ${value}`);
      }
    }
  }
}
{
  const declaredTokens = new Set();
  for (const rule of cssRules) {
    if (!rule.selectors.includes(':root')) continue;
    for (const property of rule.declarations.keys()) {
      if (property.startsWith('--pm-font-size-') || property.startsWith('--pm-radius-') || property.startsWith('--pm-size-')) declaredTokens.add(property);
    }
  }
  for (const rule of cssRules) for (const [property, value] of rule.declarations) {
    for (const match of value.matchAll(/var\(\s*(--pm-(?:font-size|radius|size)-[\w-]+)/g)) {
      if (!declaredTokens.has(match[1])) {
        failures.push(`style.css:${rule.line}: ${rule.selectors.join(', ')} consumes undefined typography, radius, or size token ${match[1]}`);
      }
    }
    if (RADIUS_PROPERTY.test(property) && (!value.includes('var(') || FONT_SIZE_LITERAL.test(value.replace(/var\([^)]*\)/g, '')))) {
      failures.push(`style.css:${rule.line}: ${rule.selectors.join(', ')} must express ${property} with radius variables only, received ${value}`);
    }
    if (property === 'font-size' && (!value.includes('var(') || FONT_SIZE_LITERAL.test(value.replace(/var\([^)]*\)/g, '')))) {
      failures.push(`style.css:${rule.line}: ${rule.selectors.join(', ')} must express font-size with variables only, received ${value}`);
    }
    if (property === 'font' && value !== 'inherit' && !value.includes('var(') && FONT_SIZE_LITERAL.test(value)) {
      failures.push(`style.css:${rule.line}: ${rule.selectors.join(', ')} must express font shorthand size with variables only, received ${value}`);
    }
  }
}
const FONT_WEIGHT_LITERAL = /(?<![\w.-])[1-9]\d{2}(?![\w.-])/g;
const LINE_HEIGHT_SHORTHAND = /\/\s*([^\s/]+)(?=\s|$)/;
const ALLOWED_FONT_FAMILY_VALUES = new Set([
  'var(--pm-font-family-system)',
  'var(--pm-font-family-mono)',
  'var(--mainFontFamily)',
  'inherit',
]);
function collectFontFamilyIssues(rules) {
  const issues = [];
  for (const rule of rules) for (const [property, rawValue] of rule.declarations) {
    if (property !== 'font-family' && property !== 'font') continue;
    const value = rawValue.replace(/\s*!important\s*$/i, '').trim();
    const family = property === 'font-family'
      ? value
      : value === 'inherit'
        ? 'inherit'
        : value.match(/(?:^|\s)(var\(--pm-font-family-[\w-]+\))$/)?.[1];
    if (!family || !ALLOWED_FONT_FAMILY_VALUES.has(family)) {
      issues.push(`${rule.path}:${rule.line}: ${rule.selectors.join(', ')} must express ${property === 'font' ? 'font shorthand family' : 'font-family'} with an approved font-family token or inherit, received ${rawValue}`);
    }
  }
  return issues;
}
function collectEmbeddedStyleFontFamilyIssues(modules) {
  const issues = [];
  for (const module of modules) {
    const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
    for (const match of module.code.matchAll(stylePattern)) {
      const styleStartLine = module.code.slice(0, match.index).split('\n').length;
      let embeddedRules;
      try {
        embeddedRules = parseCssRules(match[1], module.file);
      } catch (error) {
        issues.push(`${module.file}:${styleStartLine}: embedded production style could not be parsed for font-family governance (${error.message})`);
        continue;
      }
      for (const issue of collectFontFamilyIssues(embeddedRules)) {
        issues.push(issue.replace(
          `${module.file}:`,
          `${module.file}:${styleStartLine - 1}+`,
        ));
      }
    }
  }
  return issues;
}
function collectLineHeightIssues(rules, lineHeightExceptions) {
  const issues = [];
  const isException = (rule, property, value) => lineHeightExceptions.some(exception => (
    exception.path === rule.path
    && exception.selector === rule.selectors.join(', ')
    && exception.property === property
    && exception.value === value
  ));
  for (const rule of rules) {
    for (const [property, rawValue] of rule.declarations) {
      if (property !== 'line-height' && property !== 'font') continue;
      const value = rawValue.replace(/\s*!important\s*$/i, '').trim();
      const lineHeight = property === 'line-height' ? value : value.match(LINE_HEIGHT_SHORTHAND)?.[1];
      if (!lineHeight) continue;
      const token = lineHeight.match(/^var\(\s*(--pm-line-height-[\w-]+)\s*\)$/)?.[1];
      if (!token && !isException(rule, property, lineHeight)) {
        issues.push(`${rule.path}:${rule.line}: ${rule.selectors.join(', ')} must express ${property === 'font' ? 'font shorthand line-height' : 'line-height'} with an approved line-height token, received ${rawValue}`);
      }
    }
  }
  return issues;
}
function collectAnimationIssues(rules, animationExceptions) {
  const issues = [];
  const isException = (rule, property, value) => animationExceptions.some(exception => (
    exception.path === rule.path
    && exception.selector === rule.selectors.join(', ')
    && exception.property === property
    && exception.value === value
  ));
  const durationPattern = /(?<![-\w.])(?:\d+(?:\.\d+)?ms|\d+(?:\.\d+)?s)(?![-\w.])/g;
  const easingPattern = /(?<![-\w])(?:ease(?:-in|-out|-in-out)?|linear|step-start|step-end|steps\([^)]*\)|cubic-bezier\([^)]*\))(?![-\w])/g;
  for (const rule of rules) for (const [property, rawValue] of rule.declarations) {
    if (!LEGACY_VALUE_PROPERTIES.animation(property)) continue;
    const value = normalizeCssValue(rawValue);
    if (value === 'none' || value === 'none !important' || isException(rule, property, value)) continue;
    const durations = [...value.matchAll(durationPattern)].map(match => match[0]);
    const easings = [...value.matchAll(easingPattern)].map(match => match[0]);
    const hasApprovedDuration = value.includes('var(--pm-motion-fast)')
      || value.includes('var(--pm-motion-normal)')
      || value.includes('var(--duration)');
    const hasApprovedEasing = value.includes('var(--pm-motion-ease)');
    const invalidDuration = durations.length > 0 && !hasApprovedDuration;
    const invalidEasing = easings.length > 0 || (property === 'animation' && !hasApprovedEasing);
    if (invalidDuration || invalidEasing) {
      issues.push(`${rule.path}:${rule.line}: ${rule.selectors.join(', ')} adds unapproved animation value ${property}:${value}`);
    }
  }
  return issues;
}
function collectVarTokenIssues(rules, tokenCategories, declaredTokens, runtimeTokens) {
  const issues = [];
  const isRegisteredToken = token => tokenCategories.some(prefix => prefix.endsWith('*')
    ? token.startsWith(prefix.slice(0, -1))
    : token === prefix);
  for (const rule of rules) for (const [property, value] of rule.declarations) {
    for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const token = match[1];
      if (!isRegisteredToken(token)) {
        issues.push(`${rule.path}:${rule.line}: ${rule.selectors.join(', ')} consumes unregistered token ${token} in ${property}`);
      }
      if (!declaredTokens.has(token) && !runtimeTokens.has(token)) {
        issues.push(`${rule.path}:${rule.line}: ${rule.selectors.join(', ')} consumes undefined token ${token} in ${property}`);
      }
      if (property === 'z-index' && !token.startsWith('--pm-z-')) {
        issues.push(`${rule.path}:${rule.line}: ${rule.selectors.join(', ')} must consume a --pm-z-* token for z-index, received ${value}`);
      }
    }
  }
  return issues;
}
const ALLOWED_FONT_WEIGHT_VALUES = new Set(['400', '500', '600']);
function collectFontWeightIssues(rules) {
  const issues = [];
  for (const rule of rules) {
    for (const [property, rawValue] of rule.declarations) {
      if (property !== 'font-weight' && property !== 'font') continue;
      const value = rawValue.replace(/\s*!important\s*$/i, '').trim();
      if (property === 'font-weight') {
        if (value.includes('var(')) continue;
        if (!ALLOWED_FONT_WEIGHT_VALUES.has(value)) {
          issues.push(`style.css:${rule.line}: ${rule.selectors.join(', ')} must express font-weight using 400/500/600 or a token, received ${rawValue}`);
        }
        continue;
      }
      const withoutVar = value.replace(/var\([^)]*\)/g, '');
      for (const match of withoutVar.matchAll(FONT_WEIGHT_LITERAL)) {
        if (!ALLOWED_FONT_WEIGHT_VALUES.has(match[0])) {
          issues.push(`style.css:${rule.line}: ${rule.selectors.join(', ')} must express font shorthand weight using 400/500/600, received ${rawValue}`);
        }
      }
    }
  }
  return issues;
}
for (const issue of collectFontWeightIssues(cssRules)) failures.push(issue);
for (const issue of collectFontFamilyIssues(cssRules)) failures.push(issue);
for (const issue of collectEmbeddedStyleFontFamilyIssues(sourceModules)) failures.push(issue);
for (const issue of collectLineHeightIssues(cssRules, governanceRegistry.lineHeightExceptions || [])) failures.push(issue);
for (const issue of collectSpacingLegacyIssues(cssRules, governanceRegistry.legacyValues?.spacing || [])) failures.push(issue);
for (const issue of collectAnimationIssues(cssRules, governanceRegistry.animationExceptions || [])) failures.push(issue);
const declaredCustomProperties = new Set(cssRules.flatMap(rule => [...rule.declarations.keys()]
  .filter(property => property.startsWith('--'))));
const registeredTokenCategories = [
  ...(governanceRegistry.tokens?.public || []),
  ...(governanceRegistry.tokens?.private || []),
  ...(governanceRegistry.tokens?.compat || []),
  ...(governanceRegistry.tokens?.runtime || []),
];
const runtimeTokenSet = new Set([
  ...(governanceRegistry.tokens?.runtime || []),
  ...(governanceRegistry.externallyDefinedTokens || []),
]);
for (const issue of collectVarTokenIssues(cssRules, registeredTokenCategories, declaredCustomProperties, runtimeTokenSet)) failures.push(issue);
{
  const fontFamilyPositiveRules = parseCssRules('.a{font-family:var(--pm-font-family-system)}\n.b{font:var(--pm-font-weight-regular) var(--pm-font-size-body)/var(--pm-line-height-body) var(--pm-font-family-mono)}\n.c{font:inherit}\n.d{font-family:var(--mainFontFamily)}');
  const fontFamilyNegativeRules = parseCssRules('.a{font-family:Arial,sans-serif}\n.b{font:var(--pm-font-weight-regular) var(--pm-font-size-body)/var(--pm-line-height-body) Arial,sans-serif}\n.c{font:var(--pm-font-weight-regular) var(--pm-font-size-body)/var(--pm-line-height-body) inherit}');
  if (collectFontFamilyIssues(fontFamilyPositiveRules).length) failures.push('self-test: font-family detector rejected compliant declarations');
  if (collectFontFamilyIssues(fontFamilyNegativeRules).length !== 3) failures.push('self-test: font-family detector did not flag raw families or invalid shorthand inherit');
  const embeddedFontFamilyPositiveModules = [{
    file: 'src/embedded-font-family-positive.js',
    code: '<style>.a{font-family:var(--pm-font-family-system)}.b{font:var(--pm-font-weight-regular) var(--pm-font-size-body)/var(--pm-line-height-body) var(--pm-font-family-mono)}.c{font:inherit}.d{font-family:var(--mainFontFamily)}</style>',
  }];
  const embeddedFontFamilyNegativeModules = [{
    file: 'src/embedded-font-family-negative.js',
    code: '<style>.a{font-family:var(--pm-font-family-system),Arial}.b{font:var(--pm-font-weight-regular) var(--pm-font-size-body)/var(--pm-line-height-body) inherit}.c{font:var(--pm-font-weight-regular) var(--pm-font-size-body)/var(--pm-line-height-body) CustomFont}</style>',
  }];
  if (collectEmbeddedStyleFontFamilyIssues(embeddedFontFamilyPositiveModules).length) failures.push('self-test: embedded font-family detector rejected compliant declarations');
  if (collectEmbeddedStyleFontFamilyIssues(embeddedFontFamilyNegativeModules).length !== 3) failures.push('self-test: embedded font-family detector did not flag invalid declarations');
  const positiveRules = parseCssRules('.a{font-weight:600}\n.b{font-weight:var(--pm-font-weight-semibold)}\n.c{font:600 var(--pm-font-size-body)/1.2 sans-serif}');
  const negativeRules = parseCssRules('.a{font-weight:650}\n.b{font:700 var(--pm-font-size-body)/1.2 sans-serif}\n.c{font:750 var(--pm-font-size-body)/1.2 sans-serif}');
  if (collectFontWeightIssues(positiveRules).length) failures.push('self-test: font-weight detector rejected compliant declarations');
  if (collectFontWeightIssues(negativeRules).length !== 3) failures.push('self-test: font-weight detector did not flag all non-compliant declarations');
}
{
  const exceptions = [{ path: 'self.css', selector: '.b', property: 'font', value: '1', owner: 'self', reason: 'fixed line box', removeWhen: 'layout migration' }];
  const positiveRules = parseCssRules('.a{line-height:var(--pm-line-height-body)}\n.b{font:600 14px/1 sans-serif}', 'self.css');
  const negativeRules = parseCssRules('.a{line-height:14px}\n.b{font:600 14px/1 sans-serif}');
  if (collectLineHeightIssues(positiveRules, exceptions).length) failures.push('self-test: line-height detector rejected compliant declarations');
  if (collectLineHeightIssues(negativeRules, []).length !== 2) failures.push('self-test: line-height detector did not flag both non-compliant declarations');
  const animationRules = parseCssRules('.a{animation:pm-pop 1s ease}\n.b{animation:pm-pop var(--pm-motion-normal) var(--pm-motion-ease)}', 'self.css');
  if (collectAnimationIssues(animationRules, [{ path: 'self.css', selector: '.a', property: 'animation', value: 'pm-pop 1s ease' }]).length !== 0) failures.push('self-test: animation detector rejected a registered exception');
  if (collectAnimationIssues(animationRules, []).length !== 1) failures.push('self-test: animation detector did not flag an unregistered duration');
  const easingRules = parseCssRules('.a{animation:pm-pop var(--pm-motion-normal) ease}\n.b{animation-timing-function:linear}\n.c{animation:pm-pop var(--pm-motion-normal) var(--pm-motion-ease)}', 'self.css');
  if (collectAnimationIssues(easingRules, []).length !== 2) failures.push('self-test: animation detector did not flag bare easing values');
  const validVarRules = parseCssRules('.a{z-index:var(--pm-z-menu)}');
  const invalidVarRules = parseCssRules('.a{z-index:var(--pm-z-missing)}\n.b{z-index:var(--whatever)}');
  if (collectVarTokenIssues(validVarRules, ['--pm-z-*'], new Set(['--pm-z-menu']), new Set()).length) failures.push('self-test: var token detector rejected a declared z-index token');
  if (collectVarTokenIssues(invalidVarRules, ['--pm-z-*'], new Set(), new Set()).length !== 4) failures.push('self-test: var token detector did not flag undefined and unregistered z-index tokens');
  const fallbackRules = parseCssRules('.a{color:var(--pm-color-accent,#fff)}\n.b{background:color-mix(in srgb,var(--pm-color-accent,rgba(0,0,0,.2)) 10%,transparent)}\n.c{color:var(--pm-color-accent)}\n.d{mask:linear-gradient(#000,var(--pm-mask))}');
  if (!hasRawColorVarFallback(fallbackRules[0].declarations.get('color')) || !hasRawColorVarFallback(fallbackRules[1].declarations.get('background'))) {
    failures.push('self-test: raw color var fallback detector did not recognize nested hex/rgb/hsl fallbacks');
  }
  if (hasRawColorVarFallback(fallbackRules[2].declarations.get('color')) || hasRawColorVarFallback(fallbackRules[3].declarations.get('mask'))) {
    failures.push('self-test: raw color var fallback detector rejected a value without a raw fallback');
  }
  const spacingEntries = [{ path: 'self.css', selector: '.a', property: 'top', value: '2px', owner: 'self', reason: 'fixed geometry', removeWhen: 'layout migration' }];
  const matchingSpacingRules = parseCssRules('.a{top:2px}', 'self.css');
  const mismatchedSpacingRules = parseCssRules('.b{top:2px}\n.a{left:2px}', 'self.css');
  if (collectSpacingLegacyIssues(matchingSpacingRules, spacingEntries).length) failures.push('self-test: spacing detector rejected an exact legacy entry');
  if (collectSpacingLegacyIssues(mismatchedSpacingRules, spacingEntries).length !== 2) failures.push('self-test: spacing detector did not bind legacy entries to selector and property');
  const incrementalBaselineRules = parseCssRules('.legacy{min-height:34px;font-weight:600;transform:translateX(-2px);line-height:normal}', 'self.css');
  const incrementalBaselineFingerprints = collectIncrementalHardcodeFingerprints(incrementalBaselineRules);
  const incrementalCompliantRules = parseCssRules('.legacy{min-height:34px;font-weight:600;transform:translateX(-2px);line-height:normal}\n.tokenized{min-height:var(--pm-size-control-compact);font-weight:var(--pm-font-weight-semibold);transform:translateX(calc(0px - var(--pm-space-0-5)));line-height:var(--pm-line-height-control)}', 'self.css');
  const incrementalRejectedRules = parseCssRules('.legacy{min-height:34px;font-weight:600;transform:translateX(-2px);line-height:normal}\n.new-size{min-height:34px}\n.new-weight{font-weight:600}\n.new-transform{transform:translateX(-2px)}\n.new-line-height{line-height:normal}\n.mixed-size{min-height:calc(var(--pm-size-control-compact) + 3px)}\n.mixed-transform{transform:translateX(-2px) scale(var(--pm-runtime-scale))}', 'self.css');
  if (collectIncrementalHardcodeIssues(incrementalCompliantRules, incrementalBaselineFingerprints).length) {
    failures.push('self-test: incremental hardcode detector rejected historical or tokenized declarations');
  }
  if (collectIncrementalHardcodeIssues(incrementalRejectedRules, incrementalBaselineFingerprints).length !== 6) {
    failures.push('self-test: incremental hardcode detector did not reject new or mixed dimensions, weights, transforms, and line-heights');
  }
  const mergedSelectorRules = parseCssRules('.legacy,.new-button{min-height:34px}', 'self.css');
  if (collectIncrementalHardcodeIssues(mergedSelectorRules, incrementalBaselineFingerprints).length !== 1) {
    failures.push('self-test: incremental hardcode detector allowed a new selector to inherit a historical bare declaration');
  }
  const formattedAtRuleBaseline = parseCssRules('@media (max-width: 500px){.legacy{min-height:34px}}', 'self.css');
  const formattedAtRuleCurrent = parseCssRules('@media(max-width:500px){.legacy{min-height:34px}}', 'self.css');
  if (collectIncrementalHardcodeIssues(formattedAtRuleCurrent, collectIncrementalHardcodeFingerprints(formattedAtRuleBaseline)).length) {
    failures.push('self-test: incremental hardcode detector rejected equivalent at-rule formatting');
  }
  const frozenSpacingTokens = ['--pm-space-px-1', '--pm-space-px-3'];
  const compliantFrozenSpacing = new Set(['--pm-space-px-1', '--pm-space-px-3', '--pm-space-neg-4']);
  const expandedFrozenSpacing = new Set([...compliantFrozenSpacing, '--pm-space-px-17']);
  if (collectFrozenSpacingTokenIssues(compliantFrozenSpacing, frozenSpacingTokens, 'self.css').length) failures.push('self-test: frozen spacing detector rejected the frozen token set');
  if (collectFrozenSpacingTokenIssues(expandedFrozenSpacing, frozenSpacingTokens, 'self.css').length !== 1) failures.push('self-test: frozen spacing detector did not reject a newly added px token');
  if (collectFrozenSpacingTokenIssues(compliantFrozenSpacing, [...frozenSpacingTokens, '--pm-space-px-19'], 'self.css').length !== 1) failures.push('self-test: frozen spacing detector did not reject a stale frozen token');
}
compareLegacyCssValues(cssRules, governanceRegistry.legacyValues || {}, governanceRegistry.animationExceptions || []);

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

function inspectModule(code) {
  const ast = parseJavaScript(code, 'module');
  const imports = new Map();
  const exports = new Set();
  const declarations = new Set();
  const functionDefinitions = new Set();
  const calls = new Set();
  for (const statement of ast.body) {
    if (statement.type === 'ImportDeclaration') {
      const names = new Set(statement.specifiers.map(specifier => specifier.imported?.name || specifier.local?.name).filter(Boolean));
      imports.set(statement.source.value, names);
    }
    if (statement.type === 'ExportNamedDeclaration') {
      if (statement.declaration?.type === 'FunctionDeclaration' && statement.declaration.id?.name) exports.add(statement.declaration.id.name);
      if (statement.declaration?.type === 'VariableDeclaration') {
        for (const declarator of statement.declaration.declarations) {
          for (const name of patternNames(declarator.id)) exports.add(name);
        }
      }
      for (const specifier of statement.specifiers || []) exports.add(specifier.exported?.name);
    }
  }
  walk(ast, node => {
    if (node.type === 'FunctionDeclaration' && node.id?.name) {
      declarations.add(node.id.name);
      functionDefinitions.add(node.id.name);
    }
    if (node.type === 'VariableDeclarator') {
      for (const name of patternNames(node.id)) declarations.add(name);
      if (['FunctionExpression', 'ArrowFunctionExpression'].includes(node.init?.type)) {
        for (const name of patternNames(node.id)) functionDefinitions.add(name);
      }
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') calls.add(node.callee.name);
  });
  return { imports, exports, declarations, functionDefinitions, calls };
}

function requireNamedImports(label, inspection, sourcePath, expectedNames) {
  const imported = inspection.imports.get(sourcePath) || new Set();
  for (const name of expectedNames) {
    if (!imported.has(name)) failures.push(`${label}: must import ${name} from ${sourcePath}`);
  }
}

function forbidNamedImports(label, inspection, sourcePath, forbiddenNames) {
  const imported = inspection.imports.get(sourcePath) || new Set();
  for (const name of forbiddenNames) {
    if (imported.has(name)) failures.push(`${label}: must not import ${name} from ${sourcePath}`);
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

function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? '';
  return null;
}

function staticStringFragments(node) {
  if (!node) return [];
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral') {
    return node.quasis.map(quasi => quasi.value.cooked ?? '');
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return [...staticStringFragments(node.left), ...staticStringFragments(node.right)];
  }
  return [];
}

function cssPropertyName(name) {
  return name.startsWith('--') ? name : name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

function uiTokenAssignmentIdentifiers(ast) {
  const identifiers = new Set();
  walk(ast, node => {
    if (node.type !== 'ForOfStatement' || node.right?.type !== 'CallExpression') return;
    const calleeName = memberName(node.right.callee);
    const sourceArg = node.right.arguments[0];
    const sourceName = sourceArg?.type === 'Identifier' ? sourceArg.name : null;
    const isUiTokens = calleeName === 'entries' && sourceName === 'uiTokens';
    const isSkinTokens = calleeName === 'keys' && sourceName === 'skinTokens';
    if (!isUiTokens && !isSkinTokens) return;
    const entry = node.left?.type === 'VariableDeclaration' ? node.left.declarations[0]?.id : node.left;
    if (entry?.type === 'ArrayPattern' && entry.elements[0]?.type === 'Identifier') identifiers.add(entry.elements[0].name);
    if (entry?.type === 'Identifier') identifiers.add(entry.name);
  });
  return identifiers;
}

function styleWriteProperty(node) {
  if (node?.type !== 'MemberExpression' || memberName(node.object) !== 'style') return null;
  return cssPropertyName(memberName(node) || '<dynamic-property>');
}

function collectDirectStyleWrites(code) {
  const writes = new Set();
  const ast = parseJavaScript(code, 'module');
  const themeTokenIdentifiers = uiTokenAssignmentIdentifiers(ast);
  walk(ast, node => {
    if (node.type === 'AssignmentExpression') {
      const property = styleWriteProperty(node.left);
      if (property) writes.add(property);
    }
    if (node.type === 'CallExpression' && memberName(node.callee) === 'setAttribute' && isString(node.arguments[0], 'style')) {
      writes.add('<style-attribute>');
    }
    if (node.type === 'AssignmentExpression' && memberName(node.left) === 'cssText'
        && node.left?.object?.type === 'MemberExpression' && memberName(node.left.object) === 'style') {
      writes.add('<css-text>');
    }
    if (node.type === 'CallExpression' && memberName(node.callee) === 'setProperty') {
      const styleObject = node.callee.object;
      if (styleObject?.type === 'MemberExpression' && memberName(styleObject) === 'style') {
        const token = staticString(node.arguments[0]);
        if (token) {
          writes.add(token.startsWith('--') && !isRegisteredThemeToken(token) ? '<unregistered-theme-token>' : token);
        }
        else if (node.arguments[0]?.type === 'Identifier' && themeTokenIdentifiers.has(node.arguments[0].name)) writes.add('<theme-preset-token>');
        else writes.add('<dynamic-token>');
      }
    }
    if (node.type === 'CallExpression' && memberName(node.callee) === 'removeProperty') {
      const styleObject = node.callee.object;
      if (styleObject?.type === 'MemberExpression' && memberName(styleObject) === 'style') {
        const token = staticString(node.arguments[0]);
        if (token) {
          writes.add(token.startsWith('--') && !isRegisteredThemeToken(token) ? '<unregistered-theme-token>' : token);
        }
        else if (node.arguments[0]?.type === 'Identifier' && themeTokenIdentifiers.has(node.arguments[0].name)) writes.add('<theme-preset-token>');
        else writes.add('<dynamic-token>');
      }
    }
  });
  for (const match of code.matchAll(/\bstyle\s*=\s*\\?["']([^"']*)\\?["']/g)) {
    const declarations = match[1].replaceAll('\\"', '"').replaceAll("\\'", "'")
      .split(';').map(value => value.trim()).filter(Boolean);
    if (!declarations.length) writes.add('<dynamic-style-attribute>');
    for (const declaration of declarations) {
      const separator = declaration.indexOf(':');
      if (separator < 1) writes.add('<dynamic-style-attribute>');
      else {
        writes.add(declaration.slice(0, separator).trim());
        if (!declaration.slice(separator + 1).includes('${')) writes.add('<static-style-attribute>');
      }
    }
  }
  return writes;
}

function collectDeclaredThemeTokens(code) {
  const tokens = new Set();
  for (const match of code.matchAll(/['"](--[\w-]+)['"]\s*:/g)) tokens.add(match[1]);
  return tokens;
}

const configCode = sourceModuleByRelativePath.get('src/config.js')?.code || '';
const registeredThemeTokenPrefixes = [
  ...(governanceRegistry.tokens?.public || []),
  ...(governanceRegistry.tokens?.private || []),
  ...(governanceRegistry.tokens?.compat || []),
  ...(governanceRegistry.tokens?.runtime || []),
];
const declaredDynamicThemeTokens = new Set([
  ...cssRules.flatMap(rule => [...rule.declarations.keys()]),
  ...collectDeclaredThemeTokens(configCode),
  ...(governanceRegistry.tokens?.runtime || []).filter(token => !token.endsWith('*')),
  ...(governanceRegistry.externallyDefinedTokens || []),
]);
for (const token of collectDeclaredThemeTokens(configCode)) {
  const registered = registeredThemeTokenPrefixes.some(prefix => prefix.endsWith('*')
    ? token.startsWith(prefix.slice(0, -1))
    : token === prefix);
  if (!registered) failures.push(`src/config.js: theme token is not registered: ${token}`);
}

function isRegisteredThemeToken(token) {
  return declaredDynamicThemeTokens.has(token);
}
const unregisteredThemeTokenSelfTest = collectDirectStyleWrites(`
  const element = { style: { setProperty() {} } };
  element.style.setProperty('--pm-color-not-declared', 'value');
`);
if (!unregisteredThemeTokenSelfTest.has('<unregistered-theme-token>')) {
  failures.push('self-test: inline theme token detector accepted an unregistered token');
}
const inlineStyleSelfTest = collectDirectStyleWrites('const html = `<i style=\\"color:red;--pm-color-accent:${accent}\\"></i>`;');
if (!inlineStyleSelfTest.has('color') || !inlineStyleSelfTest.has('--pm-color-accent')
    || !inlineStyleSelfTest.has('<static-style-attribute>')) {
  failures.push('self-test: inline style attribute detector did not preserve escaped property and static-value evidence');
}

{
  const allowedWrites = governanceRegistry?.inline?.allowedWrites;
  if (!Array.isArray(allowedWrites)) {
    failures.push('css-governance-registry.json: inline.allowedWrites must be an array');
  } else {
    const allowedByFile = new Map();
    for (const entry of allowedWrites) {
      if (typeof entry?.file !== 'string' || !sourceModuleByRelativePath.has(entry.file)
          || !Array.isArray(entry.properties) || !entry.properties.length || !entry.reason) {
        failures.push('css-governance-registry.json: inline.allowedWrites entries must declare an existing file, non-empty properties and reason');
        continue;
      }
      allowedByFile.set(entry.file, new Set(entry.properties));
    }
    for (const [relativePath, module] of sourceModuleByRelativePath) {
      const allowed = allowedByFile.get(relativePath) || new Set();
      const actualWrites = collectDirectStyleWrites(module.code);
      for (const property of actualWrites) {
        if (!allowed.has(property)) failures.push(`${relativePath}: unregistered direct style write ${property}`);
      }
      for (const property of allowed) {
        if (!actualWrites.has(property)) failures.push(`css-governance-registry.json: stale inline permission ${relativePath}:${property}`);
      }
    }
  }
}

function isString(node, expected) {
  return staticString(node) === expected;
}

function collectStaticText(node) {
  const fragments = [];
  walk(node, child => {
    if (child.type === 'Literal' && typeof child.value === 'string') fragments.push(child.value);
    if (child.type === 'TemplateElement') fragments.push(child.value.cooked ?? '');
  });
  return fragments.join('\n');
}

function analyze(code, sourceType = 'script') {
  const result = {
    commandObject: false, commandObjectHelp: false,
    legacyCommand: false, legacyCommandHelp: false,
    backupDownload: false, legacyBackupDownload: false, styleElement: false,
    stringLiterals: new Set(), windowAssignments: new Set(),
    windowAssignmentCounts: new Map(), windowAssignmentText: new Map(), windowAssignmentSource: new Map(),
    functionSource: new Map(),
  };
  walk(parseJavaScript(code, sourceType), node => {
    if (node.type === 'FunctionDeclaration' && node.id?.name) result.functionSource.set(node.id.name, code.slice(node.start, node.end));
    const literal = staticString(node);
    if (literal !== null) result.stringLiterals.add(literal);
    if (node.type === 'AssignmentExpression' && node.operator === '=') {
      const target = node.left;
      if (target?.type === 'MemberExpression' && target.object?.type === 'Identifier' && target.object.name === 'window') {
        const name = memberName(target);
        if (name) {
          result.windowAssignments.add(name);
          result.windowAssignmentCounts.set(name, (result.windowAssignmentCounts.get(name) || 0) + 1);
          result.windowAssignmentText.set(name, collectStaticText(node.right));
          result.windowAssignmentSource.set(name, code.slice(node.right.start, node.right.end));
        }
      }
      if (memberName(target) === 'download') {
        const fragments = staticStringFragments(node.right);
        const staticText = fragments.join('');
        if (node.right?.type === 'TemplateLiteral' && node.right.expressions.length === 1
            && fragments[0] === 'TianyinXiaojian_Backup_' && fragments.at(-1) === '.json') {
          result.backupDownload = true;
        }
        if (staticText.includes('PhoneMode_Backup_')) result.legacyBackupDownload = true;
      }
    }
    if (node.type !== 'CallExpression') return;
    const calleeName = memberName(node.callee);
    if (calleeName === 'registerSlashCommand' && isString(node.arguments[0], 'phone')) {
      result.legacyCommand = true;
      if (isString(node.arguments[3], '打开天音小笺')) result.legacyCommandHelp = true;
    }
    if (calleeName === 'createElement' && isString(node.arguments[0], 'style')) result.styleElement = true;
    if (calleeName !== 'addCommandObject') return;
    const fromPropsCall = node.arguments[0];
    if (fromPropsCall?.type !== 'CallExpression' || memberName(fromPropsCall.callee) !== 'fromProps') return;
    const properties = fromPropsCall.arguments[0]?.type === 'ObjectExpression' ? fromPropsCall.arguments[0].properties : [];
    const nameProperty = properties.find(property => propertyName(property) === 'name');
    const callbackProperty = properties.find(property => propertyName(property) === 'callback');
    const helpProperty = properties.find(property => propertyName(property) === 'helpString');
    if (isString(nameProperty?.value, 'phone') && callbackProperty) {
      result.commandObject = true;
      if (isString(helpProperty?.value, '打开天音小笺')) result.commandObjectHelp = true;
    }
  });
  return result;
}

function collectNodesWithAncestors(node, predicate, ancestors = [], matches = []) {
  if (!node || typeof node !== 'object') return matches;
  if (typeof node.type === 'string' && predicate(node, ancestors)) matches.push({ node, ancestors });
  const nextAncestors = typeof node.type === 'string' ? [...ancestors, node] : ancestors;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) collectNodesWithAncestors(child, predicate, nextAncestors, matches);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      collectNodesWithAncestors(value, predicate, nextAncestors, matches);
    }
  }
  return matches;
}

function patternNames(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(patternNames);
  if (pattern.type === 'ObjectPattern') return pattern.properties.flatMap(property => patternNames(property.value));
  if (pattern.type === 'AssignmentPattern') return patternNames(pattern.left);
  if (pattern.type === 'RestElement') return patternNames(pattern.argument);
  return [];
}

function identifierIsReference(node, ancestors) {
  const parent = ancestors.at(-1);
  if (!parent) return true;
  const writeAssignment = [...ancestors].reverse().find(ancestor => ancestor.type === 'AssignmentExpression'
    && ancestor.operator === '='
    && ancestor.left?.start <= node.start && node.end <= ancestor.left?.end);
  if (writeAssignment) return false;
  if (parent.type === 'VariableDeclarator' && parent.id?.start <= node.start && node.end <= parent.id?.end) return false;
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type)) {
    if (parent.id === node || parent.params.some(param => param.start <= node.start && node.end <= param.end)) return false;
  }
  if (['ClassDeclaration', 'ClassExpression'].includes(parent.type) && parent.id === node) return false;
  if (parent.type === 'CatchClause' && parent.param?.start <= node.start && node.end <= parent.param?.end) return false;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
  if (parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) return false;
  if (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent.type) && parent.label === node) return false;
  return true;
}

function collectDirectExecutionNodes(node, visit, ancestors = [], isRoot = true, matches = []) {
  if (!node || typeof node !== 'object') return matches;
  if (typeof node.type === 'string') {
    if (visit(node, ancestors)) matches.push({ node, ancestors });
    if (!isRoot && [
      'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
      'ClassDeclaration', 'ClassExpression',
    ].includes(node.type)) return matches;
  }
  const nextAncestors = typeof node.type === 'string' ? [...ancestors, node] : ancestors;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) collectDirectExecutionNodes(child, visit, nextAncestors, false, matches);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      collectDirectExecutionNodes(value, visit, nextAncestors, false, matches);
    }
  }
  return matches;
}

function lexicalScopeRange(ancestors, callbackBody) {
  const scope = [...ancestors].reverse().find(node => [
    'BlockStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement',
  ].includes(node.type));
  return scope || callbackBody;
}

function callbackConsumesRequestBindings(callback, declarator, resultNames) {
  if (!callback || !['FunctionExpression', 'ArrowFunctionExpression'].includes(callback.type)) return false;
  const shadowScopes = callback.params.flatMap(param => patternNames(param).map(name => ({
    name, start: callback.body.start, end: callback.body.end,
  })));
  collectDirectExecutionNodes(callback.body, (node, ancestors) => {
    if (node.type === 'VariableDeclarator' && node !== declarator) {
      const declaration = ancestors.at(-1);
      const scope = declaration?.type === 'VariableDeclaration' && declaration.kind === 'var'
        ? callback.body : lexicalScopeRange(ancestors, callback.body);
      for (const name of patternNames(node.id)) shadowScopes.push({ name, start: scope.start, end: scope.end });
    }
    if (['FunctionDeclaration', 'ClassDeclaration'].includes(node.type) && node.id) {
      const scope = lexicalScopeRange(ancestors, callback.body);
      shadowScopes.push({ name: node.id.name, start: scope.start, end: scope.end });
    }
    if (node.type === 'CatchClause') {
      for (const name of patternNames(node.param)) {
        shadowScopes.push({ name, start: node.body.start, end: node.body.end });
      }
    }
    return false;
  });
  return resultNames.some(name => collectDirectExecutionNodes(callback.body, node => node.type === 'Identifier'
    && node.name === name).some(match => identifierIsReference(match.node, match.ancestors)
      && !shadowScopes.some(shadow => shadow.name === name
        && shadow.start <= match.node.start && match.node.end <= shadow.end)));
}

function guardedRequestOrderIssues(functionCode, requestKind) {
  if (!functionCode) return ['missing function'];
  const program = parseJavaScript(functionCode);
  const functionNode = program.body[0];
  if (functionNode?.type !== 'FunctionDeclaration') return ['expected a function declaration'];
  const isNestedCallback = ancestors => ancestors.some(node => [
    'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  ].includes(node.type));
  const guards = collectNodesWithAncestors(functionNode.body, (node, ancestors) => node.type === 'VariableDeclarator'
    && node.id?.name === 'isValid'
    && node.init?.type === 'CallExpression' && node.init.callee?.name === 'operationGuard'
    && !isNestedCallback(ancestors));
  const requests = collectNodesWithAncestors(functionNode.body, node => node.type === 'CallExpression'
    && node.callee?.name === 'request' && isString(node.arguments[0], requestKind));
  const commits = collectNodesWithAncestors(functionNode.body, node => node.type === 'CallExpression'
    && node.callee?.name === 'commit'
    && node.arguments[1]?.type === 'Identifier' && node.arguments[1].name === 'isValid');
  const issues = [];
  if (guards.length !== 1) issues.push(`expected one top-level isValid operationGuard, found ${guards.length}`);
  if (requests.length !== 1) issues.push(`expected one ${requestKind} request, found ${requests.length}`);
  if (commits.length !== 1) issues.push(`expected one commit guarded by isValid, found ${commits.length}`);
  if (issues.length) return issues;
  const guard = guards[0];
  const request = requests[0];
  const commit = commits[0];
  if (guard.node.start >= request.node.start) issues.push(`operation guard must be captured before ${requestKind} request`);
  const commitCallback = commit.node.arguments[0];
  const nearestRequestFunction = [...request.ancestors].reverse().find(node => [
    'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  ].includes(node.type));
  const requestInsideCommit = nearestRequestFunction === commitCallback;
  if (!requestInsideCommit && isNestedCallback(request.ancestors)) {
    issues.push(`${requestKind} request outside guarded commit must not be deferred in another callback`);
    return issues;
  }
  if (!requestInsideCommit && request.node.end > commit.node.start) {
    issues.push(`${requestKind} request must complete before guarded commit`);
  }
  const declarator = [...request.ancestors].reverse().find(node => node.type === 'VariableDeclarator' && node.init?.start <= request.node.start && request.node.end <= node.init?.end);
  const awaitedRequest = declarator?.init?.type === 'AwaitExpression' ? declarator.init.argument : null;
  if (awaitedRequest !== request.node) {
    issues.push(`${requestKind} request result must be assigned directly from await request`);
    return issues;
  }
  const resultNames = patternNames(declarator?.id);
  if (!resultNames.length) issues.push(`${requestKind} request result must be assigned before guarded commit`);
  const consumed = callbackConsumesRequestBindings(commitCallback, declarator, resultNames);
  if (resultNames.length && !consumed) issues.push(`${requestKind} request result must be consumed by guarded commit`);
  return issues;
}

function verifyGuardedRequestOrder(label, functionCode, requestKind) {
  for (const issue of guardedRequestOrderIssues(functionCode, requestKind)) failures.push(`${label}: ${issue}`);
}

function functionNodeFromSource(functionCode) {
  const statement = parseJavaScript(functionCode).body[0];
  if (statement?.type === 'FunctionDeclaration') return statement;
  if (statement?.type === 'ExpressionStatement' && [
    'FunctionExpression', 'ArrowFunctionExpression',
  ].includes(statement.expression?.type)) return statement.expression;
  return null;
}

function memberPath(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type !== 'MemberExpression' || node.computed || node.property?.type !== 'Identifier') return null;
  const owner = memberPath(node.object);
  return owner ? `${owner}.${node.property.name}` : null;
}

function unwrapChainExpression(node) {
  return node?.type === 'ChainExpression' ? node.expression : node;
}

function isWindowDescendantMember(node, rootName) {
  let current = unwrapChainExpression(node);
  let hasDescendant = false;
  while (current?.type === 'MemberExpression') {
    if (current.object?.type === 'Identifier' && current.object.name === 'window'
        && memberName(current) === rootName) return hasDescendant;
    hasDescendant = true;
    current = unwrapChainExpression(current.object);
  }
  return false;
}

function findWindowDescendantWrites(code, rootName) {
  const writes = [];
  walk(parseJavaScript(code, 'module'), node => {
    if (node.type === 'AssignmentExpression' && isWindowDescendantMember(node.left, rootName)) writes.push(node);
    if (node.type === 'UpdateExpression' && isWindowDescendantMember(node.argument, rootName)) writes.push(node);
    if (node.type === 'UnaryExpression' && node.operator === 'delete'
        && isWindowDescendantMember(node.argument, rootName)) writes.push(node);
    if (node.type === 'CallExpression') {
      const method = memberName(node.callee);
      if (['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'].includes(method)
          && isWindowDescendantMember(node.callee.object, rootName)) writes.push(node);
      if (node.callee?.type === 'MemberExpression' && node.callee.object?.type === 'Identifier'
          && node.callee.object.name === 'Object' && ['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf'].includes(memberName(node.callee))
          && isWindowDescendantMember(node.arguments[0], rootName)) writes.push(node);
    }
  });
  return writes;
}

function findDirectStatePropertyWrites(code, property) {
  const writes = [];
  walk(parseJavaScript(code, 'module'), node => {
    const isStateProperty = target => target?.type === 'MemberExpression'
      && target.object?.type === 'Identifier' && target.object.name === 'state'
      && memberName(target) === property;
    if (node.type === 'AssignmentExpression' && isStateProperty(node.left)) writes.push(node);
    if (node.type === 'UpdateExpression' && isStateProperty(node.argument)) writes.push(node);
    if (node.type === 'UnaryExpression' && node.operator === 'delete' && isStateProperty(node.argument)) writes.push(node);
    if (node.type === 'CallExpression') {
      const method = memberName(node.callee);
      if (['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'].includes(method)
          && isStateProperty(node.callee.object)) writes.push(node);
    }
  });
  return writes;
}

function isIdentifierCall(node, name, args = []) {
  return node?.type === 'CallExpression' && node.callee?.type === 'Identifier'
    && node.callee.name === name && args.every((expected, index) => expected(node.arguments[index]));
}

const isNamedIdentifier = name => node => node?.type === 'Identifier' && node.name === name;

function objectPropertyValue(node, name) {
  if (node?.type !== 'ObjectExpression') return null;
  return node.properties.find(property => propertyName(property) === name)?.value || null;
}

function findDirectIdentifierCalls(node, name, args = []) {
  return collectDirectExecutionNodes(node, candidate => isIdentifierCall(candidate, name, args));
}

function hasHistoryCommit(node, storageId, saveKey, historyPath) {
  return findDirectIdentifierCalls(node, 'replaceConversationHistory', [
    isNamedIdentifier(storageId), isNamedIdentifier(saveKey), candidate => memberPath(candidate) === historyPath,
  ]).length === 1;
}

function hasExactHistoryCommit(node, storageId, saveKey) {
  return hasHistoryCommit(node, storageId, saveKey, 'historyWindow.history');
}

function hasManualHistoryCommit(node, storageId, saveKey) {
  return findDirectIdentifierCalls(node, 'commitManualPokeHistory').some(({ node: call }) => {
    const request = call.arguments[0];
    return isNamedIdentifier(storageId)(objectPropertyValue(request, 'storageId'))
      && isNamedIdentifier(saveKey)(objectPropertyValue(request, 'saveKey'))
      && memberPath(objectPropertyValue(request, 'history')) === 'historyWindow.history';
  });
}

function findWindowEntryWrites(code, name) {
  const aliases = new Set(['window']);
  const writes = [];
  const ast = parseJavaScript(code, 'module');
  const isWindowTarget = node => (node?.type === 'Identifier' && aliases.has(node.name))
    || memberPath(node) === 'globalThis.window';
  walk(ast, node => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier'
        && isWindowTarget(node.init)) aliases.add(node.id.name);
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression'
        && isWindowTarget(node.left.object)
        && memberName(node.left) === name) writes.push(node);
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression'
        && node.callee.object?.type === 'Identifier' && node.callee.object.name === 'Object'
        && ['assign', 'defineProperty'].includes(memberName(node.callee))
        && isWindowTarget(node.arguments[0])) {
      if (memberName(node.callee) === 'defineProperty' && staticString(node.arguments[1]) === name) writes.push(node);
      if (memberName(node.callee) === 'assign'
          && node.arguments.slice(1).some(argument => objectPropertyValue(argument, name))) writes.push(node);
    }
  });
  return writes;
}

function expectWindowFunctionSignature(label, analysis, name, { async, params }) {
  const source = analysis.windowAssignmentSource.get(name) || '';
  const node = functionNodeFromSource(source);
  if (!node) {
    failures.push(`${label}: window.${name} must be assigned a function`);
    return null;
  }
  if (Boolean(node.async) !== async) failures.push(`${label}: window.${name} async signature changed`);
  if (node.params.length !== params.length) {
    failures.push(`${label}: window.${name} parameter count changed`);
    return node;
  }
  for (let index = 0; index < params.length; index += 1) {
    const expected = params[index];
    const actual = node.params[index];
    if (typeof expected === 'string') {
      if (actual?.type !== 'Identifier' || actual.name !== expected) {
        failures.push(`${label}: window.${name} parameter ${index + 1} must be ${expected}`);
      }
      continue;
    }
    const defaultIsLiteral = Object.hasOwn(expected, 'default');
    if (actual?.type !== 'AssignmentPattern' || actual.left?.type !== 'Identifier'
        || actual.left.name !== expected.name
        || (defaultIsLiteral && (actual.right?.type !== 'Literal' || actual.right.value !== expected.default))
        || (!defaultIsLiteral && actual.right?.type !== 'ObjectExpression')) {
      const defaultValue = defaultIsLiteral ? JSON.stringify(expected.default) : '{}';
      failures.push(`${label}: window.${name} parameter ${index + 1} must be ${expected.name} = ${defaultValue}`);
    }
  }
  return node;
}

function expectThinWindowDelegate(label, analysis, name, { params, callee }) {
  const handler = expectWindowFunctionSignature(label, analysis, name, { async: false, params });
  if ((analysis.windowAssignmentCounts.get(name) || 0) !== 1) {
    failures.push(`${label}: window.${name} must be assigned exactly once`);
  }
  if (!handler) return;
  const expression = handler.body?.type === 'CallExpression'
    ? handler.body
    : handler.body?.type === 'BlockStatement' && handler.body.body.length === 1
      && handler.body.body[0]?.type === 'ReturnStatement' ? handler.body.body[0].argument : null;
  if (expression?.type !== 'CallExpression' || memberPath(expression.callee) !== callee) {
    failures.push(`${label}: window.${name} must transparently return ${callee}(...)`);
    return;
  }
  const expectedArguments = params.filter(param => typeof param === 'string');
  if (expression.arguments.length !== expectedArguments.length
      || expression.arguments.some((argument, index) => argument?.type !== 'Identifier' || argument.name !== expectedArguments[index])) {
    failures.push(`${label}: window.${name} must transparently forward its parameters to ${callee}`);
  }
}

function controllerExposesMethod(code, method) {
  let exposed = false;
  walk(parseJavaScript(code, 'module'), node => {
    if (node.type !== 'ReturnStatement' || node.argument?.type !== 'ObjectExpression') return;
    if (node.argument.properties.some(property => propertyName(property) === method)) exposed = true;
  });
  return exposed;
}

function assertSettingsDelegate(analysis, name, params, callee, controllerCode, method) {
  expectThinWindowDelegate('settings-ui.js', analysis, name, { params, callee });
  if (!controllerExposesMethod(controllerCode, method)) {
    failures.push(`settings controller: ${callee} must be exposed by its owning controller`);
  }
}

function assertPokeHistoryAdapter(analysis, code) {
  const getHandler = name => expectWindowFunctionSignature('phone-chat-poke.js', analysis, name, {
    async: true, params: name === '__pmPokeGroup' ? [] : ['contactName'],
  });
  const autoPoke = getHandler('__pmAutoPoke');
  const poke = getHandler('__pmPoke');
  const pokeGroup = getHandler('__pmPokeGroup');
  for (const [name, handler] of [['__pmAutoPoke', autoPoke], ['__pmPoke', poke], ['__pmPokeGroup', pokeGroup]]) {
    if ((analysis.windowAssignmentCounts.get(name) || 0) !== 1) {
      failures.push(`phone-chat-poke.js: window.${name} must be assigned exactly once`);
    }
    if (!handler) continue;
  }
  if (!autoPoke || !poke || !pokeGroup) return;

  const automaticCommit = findDirectIdentifierCalls(autoPoke.body, 'commitAutomaticResult').find(({ node }) =>
    node.arguments[0]?.type === 'ObjectExpression')?.node;
  const applyHistory = objectPropertyValue(automaticCommit?.arguments[0], 'applyHistory');
  const restoreHistory = objectPropertyValue(automaticCommit?.arguments[0], 'restoreHistory');
  const persistHistory = objectPropertyValue(automaticCommit?.arguments[0], 'persistHistory');
  const hasAutoReplace = hasExactHistoryCommit(applyHistory?.body, 'id', 'contactName');
  const hasAutoRestore = findDirectIdentifierCalls(restoreHistory?.body, 'restoreConversationHistory', [
    isNamedIdentifier('id'), isNamedIdentifier('contactName'), isNamedIdentifier('previousHistory'),
  ]).length === 1;
  const hasStrictPersist = findDirectIdentifierCalls(persistHistory?.body, 'saveHistoriesStrict').length === 1;
  const previousHistoryCaptured = collectNodesWithAncestors(autoPoke.body, node => node.type === 'VariableDeclarator'
    && node.id?.type === 'Identifier' && node.id.name === 'previousHistory'
    && isWindowDescendantMember(node.init, '__pmHistories')).length === 1;
  if (!automaticCommit || !hasAutoReplace || !hasAutoRestore || !hasStrictPersist || !previousHistoryCaptured) {
    failures.push('phone-chat-poke.js __pmAutoPoke: commitAutomaticResult must bind adapter apply/restore and strict history persistence to captured previousHistory');
  }

  const manualCommit = functionNodeFromSource(analyze(code, 'module').functionSource.get('commitManualPokeHistory') || '');
  const manualRestoreHelper = collectNodesWithAncestors(manualCommit?.body, node => node.type === 'VariableDeclarator'
    && node.id?.type === 'Identifier' && node.id.name === 'restorePreviousHistory'
    && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.init?.type)).at(0)?.node.init;
  const hasManualReplace = hasHistoryCommit(manualCommit?.body, 'storageId', 'saveKey', 'history');
  const hasManualRestore = findDirectIdentifierCalls(manualRestoreHelper?.body, 'restoreConversationHistory', [
    isNamedIdentifier('storageId'), isNamedIdentifier('saveKey'), isNamedIdentifier('previousHistory'),
  ]).length === 1;
  const hasManualPrimaryPersist = findDirectIdentifierCalls(manualCommit?.body, 'saveHistoriesStrict').length === 1;
  const hasManualRollbackPersist = findDirectIdentifierCalls(manualRestoreHelper?.body, 'saveHistoriesStrict').length === 1;
  const hasManualRollbackCalls = findDirectIdentifierCalls(manualCommit?.body, 'restorePreviousHistory').length === 2;
  if (!manualCommit || !manualRestoreHelper || !hasManualReplace || !hasManualRestore
      || !hasManualPrimaryPersist || !hasManualRollbackPersist || !hasManualRollbackCalls) {
    failures.push('phone-chat-poke.js commitManualPokeHistory must strictly persist before rendering and restore the captured history through the persistence adapter on failure or cancellation');
  }

  const pokeLoops = collectDirectExecutionNodes(poke.body, node => node.type === 'ForOfStatement');
  if (!pokeLoops.some(({ node }) => hasManualHistoryCommit(node.body, 'storageId', 'saveKey'))) {
    failures.push('phone-chat-poke.js __pmPoke: each streamed sentence must use the strict manual history commit before rendering');
  }


  const groupLoops = collectDirectExecutionNodes(pokeGroup.body, node => node.type === 'ForOfStatement');
  if (!groupLoops.some(({ node }) => hasManualHistoryCommit(node.body, 'storageId', 'saveKey'))) {
    failures.push('phone-chat-poke.js __pmPokeGroup: each streamed sentence must use the strict manual history commit before rendering');
  }
}

function literalValue(expected) {
  return node => node?.type === 'Literal' && node.value === expected;
}

function identifierValue(expected) {
  return node => node?.type === 'Identifier' && node.name === expected;
}

function memberValue(expected) {
  return node => memberPath(node) === expected;
}

const unknownStaticValue = () => ({ known: false });

function staticValue(node) {
  if (node?.type === 'Literal') {
    if (!['undefined', 'boolean', 'number', 'string', 'bigint'].includes(typeof node.value) && node.value !== null) {
      return unknownStaticValue();
    }
    return { known: true, value: node.value };
  }
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return { known: true, value: node.quasis[0]?.value.cooked ?? '' };
  }
  if (node?.type === 'UnaryExpression') {
    if (node.operator === 'void') return { known: true, value: undefined };
    const argument = staticValue(node.argument);
    if (!argument.known) return unknownStaticValue();
    try {
      if (node.operator === '!') return { known: true, value: !argument.value };
      if (node.operator === '+') return { known: true, value: +argument.value };
      if (node.operator === '-') return { known: true, value: -argument.value };
      if (node.operator === '~') return { known: true, value: ~argument.value };
      if (node.operator === 'typeof') return { known: true, value: typeof argument.value };
    } catch (error) {
      return unknownStaticValue();
    }
    return unknownStaticValue();
  }
  if (node?.type === 'LogicalExpression') {
    const left = staticValue(node.left);
    if (!left.known) return unknownStaticValue();
    if (node.operator === '&&') return left.value ? staticValue(node.right) : left;
    if (node.operator === '||') return left.value ? left : staticValue(node.right);
    if (node.operator === '??') return left.value === null || left.value === undefined ? staticValue(node.right) : left;
    return unknownStaticValue();
  }
  if (node?.type !== 'BinaryExpression') return unknownStaticValue();
  const left = staticValue(node.left);
  const right = staticValue(node.right);
  if (!left.known || !right.known) return unknownStaticValue();
  const hasBigInt = typeof left.value === 'bigint' || typeof right.value === 'bigint';
  if (hasBigInt && !['===', '!==', '==', '!=', '<', '<=', '>', '>='].includes(node.operator)) {
    return unknownStaticValue();
  }
  if (node.operator === '**' && typeof left.value === 'bigint'
      && (typeof right.value !== 'bigint' || right.value < 0n || right.value > 1024n)) return unknownStaticValue();
  try {
    switch (node.operator) {
    case '===': return { known: true, value: left.value === right.value };
    case '!==': return { known: true, value: left.value !== right.value };
    case '==': return { known: true, value: left.value == right.value }; // eslint-disable-line eqeqeq
    case '!=': return { known: true, value: left.value != right.value }; // eslint-disable-line eqeqeq
    case '<': return { known: true, value: left.value < right.value };
    case '<=': return { known: true, value: left.value <= right.value };
    case '>': return { known: true, value: left.value > right.value };
    case '>=': return { known: true, value: left.value >= right.value };
    case '+': return { known: true, value: left.value + right.value };
    case '-': return { known: true, value: left.value - right.value };
    case '*': return { known: true, value: left.value * right.value };
    case '/': return { known: true, value: left.value / right.value };
    case '%': return { known: true, value: left.value % right.value };
    case '**': return { known: true, value: left.value ** right.value };
    case '|': return { known: true, value: left.value | right.value };
    case '&': return { known: true, value: left.value & right.value };
    case '^': return { known: true, value: left.value ^ right.value };
    case '<<': return { known: true, value: left.value << right.value };
    case '>>': return { known: true, value: left.value >> right.value };
    case '>>>': return { known: true, value: left.value >>> right.value };
    default: return unknownStaticValue();
    }
  } catch (error) {
    return unknownStaticValue();
  }
}

function staticTruthiness(node) {
  const result = staticValue(node);
  return result.known ? Boolean(result.value) : null;
}

function callIsStaticallyUnreachable(call) {
  return call.ancestors.some(ancestor => {
    if (['IfStatement', 'ConditionalExpression'].includes(ancestor.type)) {
      const truthiness = staticTruthiness(ancestor.test);
      if (truthiness === null) return false;
      const branch = ancestor.consequent?.start <= call.node.start && call.node.end <= ancestor.consequent?.end
        ? 'consequent'
        : ancestor.alternate?.start <= call.node.start && call.node.end <= ancestor.alternate?.end
          ? 'alternate' : null;
      if (!branch) return false;
      return branch === 'consequent' ? !truthiness : truthiness;
    }
    if (['WhileStatement', 'ForStatement'].includes(ancestor.type)) {
      return staticTruthiness(ancestor.test) === false
        && ancestor.body?.start <= call.node.start && call.node.end <= ancestor.body?.end;
    }
    if (ancestor.type === 'LogicalExpression') {
      const insideRight = ancestor.right?.start <= call.node.start && call.node.end <= ancestor.right?.end;
      if (!insideRight) return false;
      const left = staticValue(ancestor.left);
      if (!left.known) return false;
      return (ancestor.operator === '&&' && !left.value)
        || (ancestor.operator === '||' && !!left.value)
        || (ancestor.operator === '??' && left.value !== null && left.value !== undefined);
    }
    return false;
  });
}

function callAiIsLocallyShadowed(functionNode, call) {
  if (functionNode.params.some(param => patternNames(param).includes('callAI'))) return true;
  return collectDirectExecutionNodes(functionNode.body, (node, ancestors) => {
    if (node.type === 'CatchClause' && patternNames(node.param).includes('callAI')) {
      return call.ancestors.includes(node);
    }
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'callAI') {
      const scope = [...ancestors].reverse().find(ancestor => ancestor.type === 'BlockStatement');
      return !!scope && call.ancestors.includes(scope);
    }
    if (node.type !== 'VariableDeclarator' || !patternNames(node.id).includes('callAI')) return false;
    const declaration = ancestors.at(-1);
    if (declaration?.type !== 'VariableDeclaration') return false;
    if (declaration.kind === 'var') return true;
    const scope = [...ancestors].reverse().find(ancestor => [
      'BlockStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'CatchClause',
    ].includes(ancestor.type));
    return !!scope && call.ancestors.includes(scope);
  }).length > 0;
}

function callAiOptionsIssues(functionCode, expectedProperties) {
  if (!functionCode) return ['missing function'];
  const functionNode = functionNodeFromSource(functionCode);
  if (!functionNode) return ['expected a function declaration or function expression'];
  const calls = collectDirectExecutionNodes(functionNode.body, node => node.type === 'CallExpression'
    && node.callee?.type === 'Identifier' && node.callee.name === 'callAI');
  if (calls.length !== 1) return [`expected one direct callAI invocation, found ${calls.length}`];
  if (callIsStaticallyUnreachable(calls[0])) return ['callAI invocation must be statically reachable'];
  if (callAiIsLocallyShadowed(functionNode, calls[0])) return ['callAI reference must not be locally shadowed'];
  const options = calls[0].node.arguments[2];
  if (options?.type !== 'ObjectExpression') return ['callAI third argument must be an object literal'];
  const issues = [];
  for (const expectation of expectedProperties) {
    const properties = options.properties.filter(property => propertyName(property) === expectation.name);
    if (properties.length !== 1) {
      issues.push(`expected one ${expectation.name} option, found ${properties.length}`);
    } else if (!expectation.matches(properties[0].value)) {
      issues.push(`${expectation.name} option must be ${expectation.description}`);
    }
  }
  return issues;
}

function verifyCallAiOptions(label, functionCode, expectedProperties) {
  for (const issue of callAiOptionsIssues(functionCode, expectedProperties)) failures.push(`${label}: ${issue}`);
}

function verifyCallAiOptionsDetector() {
  const expected = [
    { name: 'maxTokens', description: '600', matches: literalValue(600) },
    { name: 'isolated', description: 'true', matches: literalValue(true) },
    { name: 'signal', description: 'task.signal', matches: memberValue('task.signal') },
  ];
  const valid = [
    `async function generate() { return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { do { return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); } while (false); }`,
  ];
  for (const sample of valid) {
    if (callAiOptionsIssues(sample, expected).length) failures.push('self-test: callAI options detector rejected valid sample');
  }
  const invalid = [
    `async function generate() { return callAI(system, user, { maxTokens: 900, isolated: true, signal: task.signal }); }`,
    `async function generate() { return callAI(system, user, { maxTokens: 600, isolated: false, signal: task.signal }); }`,
    `async function generate() { return callAI(system, user, { maxTokens: 600, isolated: true, signal: other.signal }); }`,
    `async function generate() { if (false) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { return false && callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { return true || callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { return 'ready' ?? callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { if (!true) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { if (1 === 2) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    "async function generate() { return `` && callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }",
    "async function generate() { return `ready` || callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }",
    `async function generate() { if ((2 * 3) < 5) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { if (!(1 + 1 === 2)) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { while (false) callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { for (; false;) callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate(callAI) { return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { const callAI = () => null; return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { function callAI() {} return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { async function nested() { return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); } return nested(); }`,
  ];
  const hostileConstants = [
    `async function generate() { if (+1n) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { if (1n + 1) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { if (1n / 0n) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { if (2n ** 100000n) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { if (1n << 1000000000n) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { if (999999999999999999999999999999999999n * 999999999999999999999999999999999999n) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
    `async function generate() { if (999999999999999999999999999999999999n ** 1024n) return callAI(system, user, { maxTokens: 600, isolated: true, signal: task.signal }); }`,
  ];
  for (const sample of hostileConstants) {
    try { callAiOptionsIssues(sample, expected); }
    catch (error) { failures.push(`self-test: static evaluator threw ${error.name} for hostile constant`); }
  }
  for (const sample of invalid) {
    if (!callAiOptionsIssues(sample, expected).length) failures.push('self-test: callAI options detector accepted invalid sample');
  }
}

function verifyGuardedRequestOrderDetector() {
  const valid = [
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); const items = await request('comment_batch'); await commit(() => use(items), isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, () => createdId); await commit(async () => { const [style] = await request('style_prompt'); use(style); }, isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); const items = await request('comment_batch'); await commit(() => { use(items); function helper(items) { use(items); } }, isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); const items = await request('comment_batch'); await commit(() => { use(items); if (condition) { const items = []; use(items); } }, isValid); }`,
  ];
  const invalid = [
    `async function sample() { const items = await request('comment_batch'); const isValid = operationGuard(scopeId, scene.id); await commit(() => use(items), isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); const first = await request('comment_batch'); const second = await request('comment_batch'); await commit(() => use(second), isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); queueMicrotask(async () => { await request('comment_batch'); }); await commit(() => {}, isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); const items = await request('comment_batch'); await commit(() => useOtherValue(), isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); await commit(() => {}, isValid); await request('comment_batch'); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); const items = await request('comment_batch'); await commit(items => use(items), isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); const items = await request('comment_batch'); await commit(() => { const items = []; use(items); }, isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); const items = await request('comment_batch'); await commit(() => { function nested(items) { use(items); } nested([]); }, isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); const items = (await request('comment_batch'), unrelatedValue); await commit(() => use(items), isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); let items = await request('comment_batch'); await commit(() => { items = unrelatedValue; }, isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); let items = await request('comment_batch'); await commit(() => { [items] = unrelatedValues; }, isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); async function deferred() { const items = await request('comment_batch'); await commit(() => use(items), isValid); } deferred(); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); await commit(() => { async function deferred() { const items = await request('comment_batch'); use(items); } deferred(); }, isValid); }`,
    `async function sample() { const isValid = operationGuard(scopeId, scene.id); const items = await request('comment_batch'); await commit(() => { function helper() { use(items); } helper(); }, isValid); }`,
  ];
  for (const sample of valid) {
    if (guardedRequestOrderIssues(sample, sample.includes('style_prompt') ? 'style_prompt' : 'comment_batch').length) {
      failures.push('self-test: guarded request order detector rejected valid sample');
    }
  }
  for (const sample of invalid) {
    if (!guardedRequestOrderIssues(sample, 'comment_batch').length) {
      failures.push('self-test: guarded request order detector accepted invalid sample');
    }
  }
}

function analyzeBackupContract(code, sourceType = 'module') {
  const result = { exportFields: new Set(), importFields: new Set(), importReadsFileName: false };
  walk(parseJavaScript(code, sourceType), node => {
    if (node.type === 'AssignmentExpression' && node.operator === '=') {
      const entry = memberName(node.left);
      if (node.left?.object?.name === 'window' && entry === '__pmImportData') {
        walk(node.right, child => {
          if (child.type === 'MemberExpression' && child.object?.name === 'file' && memberName(child) === 'name') {
            result.importReadsFileName = true;
          }
        });
      }
    }
    if (node.type === 'VariableDeclarator' && node.id?.name === 'data' && node.init?.type === 'ObjectExpression') {
      for (const property of node.init.properties) {
        const name = propertyName(property);
        if (name) result.exportFields.add(name);
      }
    }
    if (node.type === 'MemberExpression' && node.object?.name === 'file' && memberName(node) === 'name') result.importReadsFileName = true;
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'parseBackupData') {
      walk(node.body, child => {
        if (child.type !== 'CallExpression') return;
        if (memberName(child.callee) === 'hasOwn' && child.arguments[0]?.name === 'data') {
          const name = staticString(child.arguments[1]);
          if (name) result.importFields.add(name);
        }
        if (child.callee?.type === 'Identifier' && child.callee.name === 'applyCalendarBackupFields'
            && child.arguments[0]?.name === 'data') {
          for (const field of [
            'calendarStore', 'calendarOccasions', 'calendarHolidays', 'calendarWeather', 'calendarCycles', 'calendarRecipes', 'calendarOutfits',
          ]) result.importFields.add(field);
        }
      });
    }
  });
  return result;
}

function analyzeBackupModuleBinding(settingsUiCode, backupControllerCode, validatorCode) {
  const result = {
    importsValidatorParser: false,
    reexportsValidatorParser: false,
    prepareCallsValidatorParser: false,
    validatorExportsParserFunction: false,
  };
  const settingsAst = parseJavaScript(settingsUiCode, 'module');
  let parserLocalName = null;
  for (const statement of settingsAst.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== './settings-backup-validate.js') continue;
    const parserImport = statement.specifiers.find(specifier =>
      specifier.type === 'ImportSpecifier' && specifier.imported?.name === 'parseBackupData');
    if (parserImport?.local?.name) {
      parserLocalName = parserImport.local.name;
      result.importsValidatorParser = true;
    }
  }
  if (parserLocalName) {
    for (const statement of settingsAst.body) {
      if (statement.type !== 'ExportNamedDeclaration') continue;
      if ((statement.specifiers || []).some(specifier =>
        specifier.local?.name === parserLocalName && specifier.exported?.name === 'parseBackupData')) {
        result.reexportsValidatorParser = true;
      }
    }
    const controllerAst = parseJavaScript(backupControllerCode, 'module');
    let passesParser = false;
    walk(settingsAst, node => {
      if (node.type !== 'CallExpression' || node.callee?.type !== 'Identifier' || node.callee.name !== 'createBackupController') return;
      const options = node.arguments[0];
      if (options?.type !== 'ObjectExpression') return;
      const parser = options.properties.find(property => propertyName(property) === 'parseBackupData');
      if (parser?.value?.type === 'Identifier' && parser.value.name === parserLocalName) passesParser = true;
    });
    walk(controllerAst, node => {
      if (result.prepareCallsValidatorParser || node.type !== 'CallExpression'
          || node.callee?.type !== 'Identifier' || node.callee.name !== 'runBackupTransaction') return;
      const options = node.arguments[0];
      if (options?.type !== 'ObjectExpression') return;
      const prepare = options.properties.find(property => propertyName(property) === 'prepare');
      const callback = prepare?.value;
      if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(callback?.type)) return;
      const callbackParamNames = callback.params.flatMap(patternNames);
      let shadowsParser = callbackParamNames.includes(parserLocalName);
      let callsParser = false;
      walk(callback.body, child => {
        if (child.type === 'VariableDeclarator' && patternNames(child.id).includes(parserLocalName)) shadowsParser = true;
        if (child.type === 'FunctionDeclaration' && child.id?.name === parserLocalName) shadowsParser = true;
        if (child.type === 'CallExpression' && child.callee?.type === 'Identifier'
            && child.callee.name === parserLocalName) callsParser = true;
      });
      if (callsParser && !shadowsParser && passesParser) result.prepareCallsValidatorParser = true;
    });
  }

  const validatorAst = parseJavaScript(validatorCode, 'module');
  result.validatorExportsParserFunction = validatorAst.body.some(statement =>
    statement.type === 'ExportNamedDeclaration'
      && statement.declaration?.type === 'FunctionDeclaration'
      && statement.declaration.id?.name === 'parseBackupData');
  return result;
}

function backupModuleBindingIsComplete(result) {
  return Object.values(result).every(Boolean);
}

function verifyBackupModuleBindingDetector() {
  const validator = `export function parseBackupData(data, current) { return current; }`;
  const controller = `
    export function createBackupController({ parseBackupData, runBackupTransaction }) {
      runBackupTransaction({ prepare: current => parseBackupData(data, current) });
    }
  `;
  const validSettings = `
    import { parseBackupData } from './settings-backup-validate.js';
    export { parseBackupData };
    createBackupController({ parseBackupData });
  `;
  if (!backupModuleBindingIsComplete(analyzeBackupModuleBinding(validSettings, controller, validator))) {
    failures.push('self-test: backup module binding detector rejected valid wiring');
  }
  const invalidSettingsSamples = [
    `import { parseBackupData } from './wrong.js'; export { parseBackupData }; createBackupController({ parseBackupData });`,
    `import { parseBackupData } from './settings-backup-validate.js'; createBackupController({ parseBackupData });`,
    `import { parseBackupData } from './settings-backup-validate.js'; export { parseBackupData }; createBackupController({ otherParser });`,
    `import { parseBackupData } from './settings-backup-validate.js'; export { parseBackupData }; createBackupController({ parseBackupData: otherParser });`,
  ];
  for (const sample of invalidSettingsSamples) {
    if (backupModuleBindingIsComplete(analyzeBackupModuleBinding(sample, controller, validator))) {
      failures.push('self-test: backup module binding detector accepted invalid settings wiring');
    }
  }
  const invalidValidator = `export const parseBackupData = (data, current) => current;`;
  if (backupModuleBindingIsComplete(analyzeBackupModuleBinding(validSettings, controller, invalidValidator))) {
    failures.push('self-test: backup module binding detector accepted non-function-declaration validator export');
  }
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

function verifyWindowWriteDetectors() {
  const allowedHistoryRead = `window.__pmHistories[id]?.[key];`;
  if (findWindowDescendantWrites(allowedHistoryRead, '__pmHistories').length) {
    failures.push('self-test: history write detector rejected a read');
  }
  for (const forbidden of [
    `window.__pmHistories[id][key] = value;`,
    `window.__pmHistories[id][key] ||= [];`,
    `window.__pmHistories[id][key]++;`,
    `window.__pmHistories[id][key].push(value);`,
    `Object.assign(window.__pmHistories[id], { [key]: value });`,
    `Object.defineProperty(window.__pmHistories[id], key, { value });`,
  ]) {
    if (!findWindowDescendantWrites(forbidden, '__pmHistories').length) {
      failures.push(`self-test: history write detector accepted ${forbidden}`);
    }
  }
  for (const source of [
    `window.__pmSwitch = replacement;`,
    `const host = window; host.__pmSwitch = replacement;`,
    `Object.assign(window, { __pmSwitch: replacement });`,
    `const host = window; Object.assign(host, { __pmSwitch: replacement });`,
    `Object.defineProperty(window, '__pmSwitch', { value: replacement });`,
    `const host = window; Object.defineProperty(host, '__pmSwitch', { value: replacement });`,
    `Object.defineProperty(globalThis.window, '__pmSwitch', { value: replacement });`,
  ]) {
    if (findWindowEntryWrites(source, '__pmSwitch').length !== 1) {
      failures.push(`self-test: window entry write detector rejected ${source}`);
    }
  }
  for (const read of [
    `const host = window; host.__pmSwitch;`, `host.__pmSwitch();`,
    `Object.assign({}, { __pmSwitch: replacement });`,
    `Object.defineProperty({}, '__pmSwitch', { value: replacement });`,
  ]) if (findWindowEntryWrites(read, '__pmSwitch').length) {
    failures.push(`self-test: window entry write detector rejected read ${read}`);
  }
}

function verifyLegacyBackupDetector() {
  const positives = [
    "a.download = `PhoneMode_Backup_${Date.now()}.json`",
    "a.download = 'PhoneMode_Backup_' + Date.now() + '.json'",
  ];
  const negatives = [
    "a.download = `TianyinXiaojian_Backup_${Date.now()}.json`",
    `const fake = 'PhoneMode_Backup_'`,
  ];
  for (const sample of positives) {
    if (!analyze(sample).legacyBackupDownload) failures.push('self-test: legacy backup detector rejected active old prefix');
  }
  for (const sample of negatives) {
    if (analyze(sample).legacyBackupDownload) failures.push('self-test: legacy backup detector accepted non-download text');
  }
}

verifyDetector('command object help', 'commandObjectHelp', [
  `SCP.addCommandObject(SC.fromProps({ name: 'phone', callback: cb, helpString: '打开天音小笺' }))`,
], [
  `SCP.addCommandObject(SC.fromProps({ name: 'phone', callback: cb, helpString: '打开短信' }))`,
  `const fake = "打开天音小笺"`,
]);
verifyDetector('legacy command help', 'legacyCommandHelp', [
  `ctx.registerSlashCommand('phone', cb, [], '打开天音小笺')`,
], [
  `ctx.registerSlashCommand('phone', cb, [], '打开短信')`,
  `const fake = "打开天音小笺"`,
]);
verifyDetector('backup download', 'backupDownload', [
  "a.download = `TianyinXiaojian_Backup_${Date.now()}.json`",
], [
  `const fake = 'TianyinXiaojian_Backup_'`,
]);
verifyLegacyBackupDetector();
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
verifyWindowWriteDetectors();
verifyBackupModuleBindingDetector();
verifyGuardedRequestOrderDetector();
verifyCallAiOptionsDetector();

// CSS token migration is intentionally isolated from the concurrent scene-model split.
// Keep this exception file-specific: every other source module remains subject to the limit.
const MODULE_LINE_LIMIT_EXCEPTIONS = new Set(['src/interactive-scene-model.js']);
const MAX_SOURCE_MODULE_LINES = 800;
const sourceResult = {
  commandObject: false, commandObjectHelp: false,
  legacyCommand: false, legacyCommandHelp: false,
  backupDownload: false, legacyBackupDownload: false, styleElement: false,
  stringLiterals: new Set(), windowAssignments: new Set(),
};
for (const { file, code } of sourceModules) {
  const relativeFile = path.relative(root, file).replaceAll('\\', '/');
  const lineCount = code.split(/\r?\n/).length;
  if (lineCount >= MAX_SOURCE_MODULE_LINES && !MODULE_LINE_LIMIT_EXCEPTIONS.has(relativeFile)) {
    failures.push(`${relativeFile}: ${lineCount} lines; source modules must stay below ${MAX_SOURCE_MODULE_LINES} lines`);
  }

  let result;
  try {
    result = analyze(code, 'module');
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error.message}`);
    continue;
  }
  sourceResult.commandObject ||= result.commandObject;
  sourceResult.commandObjectHelp ||= result.commandObjectHelp;
  sourceResult.legacyCommand ||= result.legacyCommand;
  sourceResult.legacyCommandHelp ||= result.legacyCommandHelp;
  sourceResult.backupDownload ||= result.backupDownload;
  sourceResult.legacyBackupDownload ||= result.legacyBackupDownload;
  sourceResult.styleElement ||= result.styleElement;
  for (const literal of result.stringLiterals) sourceResult.stringLiterals.add(literal);
  for (const name of result.windowAssignments) sourceResult.windowAssignments.add(name);
}

const analyzedFiles = [['source', source, sourceResult], ['bundle', bundle, analyze(bundle)]];

for (const expected of ['PhoneModeDB', 'ST_SMS_DATA_V2', 'window.__pmOpen', 'installSettingsUi']) {
  for (const [label, text] of analyzedFiles) requireText(label, text, expected);
}
for (const [label, , result] of analyzedFiles) {
  if (!result.commandObject) failures.push(`${label}: missing SlashCommand.fromProps phone registration`);
  if (!result.commandObjectHelp) failures.push(`${label}: SlashCommand.fromProps help must be 打开天音小笺`);
  if (!result.legacyCommand) failures.push(`${label}: missing registerSlashCommand phone fallback`);
  if (!result.legacyCommandHelp) failures.push(`${label}: registerSlashCommand help must be 打开天音小笺`);
  if (!result.backupDownload) failures.push(`${label}: backup download template must use TianyinXiaojian_Backup_*.json`);
  if (result.legacyBackupDownload) failures.push(`${label}: active backup download must not use PhoneMode_Backup_`);
  if (result.styleElement) failures.push(`${label}: forbidden style element injection`);
}

// === Settings entry check ===
const SETTING_ENTRIES = [
  '__pmDeleteProfile', '__pmPickProfile', '__pmSetMode', '__pmToggleWordyLimit', '__pmToggleGalBubble',
  '__pmSetDarkMode', '__pmExportData', '__pmImportData', '__pmShowConfig',
  '__pmSetPreset', '__pmSetCustomAccent', '__pmSetCustomColor', '__pmClearCustomColor',
  '__pmSetBorderColor', '__pmSetCustomTitle', '__pmUploadBg', '__pmBgUrl',
  '__pmClearBg', '__pmTestApi', '__pmTestModel', '__pmSaveConfig', '__pmShowModelPicker',
  '__pmSaveBudgetConfig', '__pmResetBudgetConfig', '__pmClearAllData',
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
for (const entry of SETTING_ENTRIES) {
  let writeCount = 0;
  for (const { file, code } of sourceModules) {
    const fileName = path.basename(file);
    const writes = findWindowEntryWrites(code, entry).length;
    writeCount += writes;
    if (fileName !== 'settings-ui.js' && writes) {
      failures.push(`${fileName}: must not define window.${entry}; owner is settings-ui.js`);
    }
  }
  if (writeCount !== 1) {
    failures.push(`settings-ui.js: window.${entry} must have exactly one direct window assignment across source modules`);
  }
}

// === Composition-root and phone entry ownership checks ===
const LEGACY_WINDOW_ENTRIES = [
  '__pmAddEmojiImage', '__pmAddEmojiSet', '__pmAutoGenContacts', '__pmAutoPoke',
  '__pmBgGlobal', '__pmBgLocal', '__pmDesktopBg', '__pmBgUrl', '__pmBidirectional', '__pmClearBg', '__pmClearCustomColor',
  '__pmConfig', '__pmConfirmAddEmojiImage', '__pmConfirmAddEmojiSet', '__pmConfirmAutoGen',
  '__pmConfirmGroup', '__pmDel', '__pmDelGroup',
  '__pmDeleteEmojiImage', '__pmDeleteEmojiSet', '__pmDeleteProfile', '__pmDeleteSelected',
  '__pmEditGroup', '__pmEmojiSetDot', '__pmEmoFileRead',
  '__pmEmojis', '__pmEnd', '__pmExportData', '__pmClearAllData', '__pmGroupInputChanged', '__pmGroupMeta',
  '__pmHistories', '__pmImportData', '__pmIncrementCounters', '__pmOpen', '__pmPickProfile',
  '__pmPoke', '__pmPokeConfig', '__pmPokeGroup', '__pmProfiles',
  '__pmSaveAndCloseContactConfig', '__pmSaveAndCloseGroupEdit', '__pmSaveConfig',
  '__pmSaveBudgetConfig', '__pmResetBudgetConfig', '__pmSend',
  '__pmShowCharacterBehavior', '__pmShowConversationSettings',
  '__pmSetAmbientStatus', '__pmSetBorderColor', '__pmSetCustomColor', '__pmSetCustomTitle', '__pmSetDarkMode', '__pmSetMode',
  '__pmSetPreset', '__pmShowAddContact', '__pmShowConfig',
  '__pmShowEmojiPicker', '__pmShowGroupCreate', '__pmShowList', '__pmShowModelPicker',
  '__pmSwitch', '__pmSwitchContact', '__pmTempText', '__pmTestApi',
  '__pmTestModel', '__pmTheme', '__pmRenderEmojiSetList', '__pmInsertEmoji',
  '__pmToggleBidirectional', '__pmToggleMin',
  '__pmToggleSelect', '__pmToggleWordyLimit', '__pmToggleGalBubble', '__pmUploadBg', '__pmWordyLimit', '__pmGalBubbleEnabled',
];

const PHONE_ENTRY_OWNERS = {
  'phone-foundation.js': ['__pmToggleBidirectional', '__pmCloseOverlay'],
  'phone-chat.js': ['__pmSend', '__pmSubmitPending', '__pmIncrementCounters'],
  'phone-control-center.js': [
    '__pmRefreshControlCenter', '__pmReturnToControlCenter', '__pmShowAutoPokeSettings',
    '__pmToggleCurrentAutoPoke', '__pmSaveCurrentAutoPokeProbability', '__pmShowControlCenter', '__pmOpenSettingsTab',
    '__pmStartDeleteMode',
    '__pmEditPending', '__pmSavePendingEdit', '__pmCancelPendingEdit',
    '__pmDeletePending', '__pmClearPending', '__pmResetPendingEditor',
  ],
  'interactive-scenes.js': ['__pmReturnToCommunityDataSource', '__pmOpenForumMode'],
  'calendar.js': ['__pmReturnToCalendarDataSource'],
  'phone-directory.js': [
    '__pmToggleContactSwitcher', '__pmSaveAndCloseGroupEdit',
    '__pmShowGroupRandomNpcSettings', '__pmSaveGroupRandomNpcSettings',
    '__pmShowGroupCreate', '__pmGroupInputChanged',
    '__pmConfirmGroup', '__pmShowList', '__pmShowAddContact', '__pmDelGroup', '__pmDel',
  ],
  'phone-context-injection.js': [
    '__pmConversationInjectionSummary', '__pmCurrentConversationInjectionEnabled',
    '__pmConversationInjectionEnabled', '__pmToggleConversationInjection',
    '__pmToggleCurrentConversationInjection', '__pmShowConversationInjection', '__pmClearConversationInjection',
    '__pmSaveConversationInjection',
  ],
  'contact-generator.js': ['__pmConfirmAutoGen', '__pmAutoGenContacts'],
  'conversation.js': ['__pmSwitchContact', '__pmSwitch'],
  'phone-chat-poke.js': [
    '__pmAutoPoke', '__pmArmAutoPoke', '__pmSaveContactConfig', '__pmSaveAndCloseContactConfig',
    '__pmPoke', '__pmEditGroup', '__pmPokeCurrent', '__pmPokeGroup',
    '__pmShowCharacterBehavior', '__pmShowGroupMemberSettings', '__pmShowConversationSettings',
  ],
  'phone-lifecycle.js': [
    '__pmReturnToDesktop', '__pmSetAmbientStatus', '__pmToggleSelect', '__pmDeleteSelected', '__pmToggleMin', '__pmEnd', '__pmOpen',
    '__pmShowPhonePage', '__pmCancelGeneration',
  ],
  'emoji-ui.js': [
    '__pmShowEmojiManager', '__pmRenderEmojiSetList', '__pmAddEmojiSet', '__pmConfirmAddEmojiSet', '__pmDeleteEmojiSet',
    '__pmAddEmojiImage', '__pmEmoFileRead', '__pmConfirmAddEmojiImage', '__pmDeleteEmojiImage',
    '__pmShowEmojiPicker', '__pmEmojiSetDot', '__pmInsertEmoji', '__pmTempText',
  ],
};

// 这些入口承载运行期可变状态，不是一次性安装的函数桥；owner 仍唯一，
// 但 owner 内允许多次更新值。
const PHONE_STATE_SLOTS = new Set([
  '__pmConversationInjectionEnabled', '__pmCurrentConversationInjectionEnabled', '__pmTempText',
]);

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
  for (const [entry, expectedOwner] of phoneEntryOwnerByName) {
    const directAssignment = assignments.has(entry);
    const alternateWrites = findWindowEntryWrites(code, entry);
    const writeCount = alternateWrites.length;
    if (expectedOwner !== fileName && (directAssignment || writeCount)) {
      failures.push(`${fileName}: must not define window.${entry}; owner is ${expectedOwner}`);
    }
    if (expectedOwner === fileName && !PHONE_STATE_SLOTS.has(entry) && writeCount !== 1) {
      failures.push(`${fileName}: window.${entry} must have exactly one direct window assignment`);
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
    'installInteractiveScenes(state, deps)', 'installCalendar(state, deps)', 'installSettingsUi(deps)',
    'installPhoneChat(state, deps)', 'installPhoneContextInjection(state, deps)', 'installPhoneControlCenter(state, deps)', 'installPhoneDirectory(state, deps)',
    'installContactGenerator(state, deps)', 'installPhoneChatPoke(state, deps)',
    'installPhoneLifecycle(state, deps)', 'installDiagnosticApi(deps)', 'installTodayTrend(state, deps)', 'installTodayTrendPhoneUi(state, deps)',
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
    'installPhoneFoundation', 'installConversation', 'installEmojiUi', 'installInteractiveScenes', 'installCalendar',
    'installSettingsUi', 'installPhoneChat', 'installPhoneContextInjection', 'installPhoneControlCenter', 'installPhoneDirectory', 'installContactGenerator',
    'installPhoneChatPoke', 'installPhoneLifecycle', 'installDiagnosticApi', 'installTodayTrend', 'installTodayTrendPhoneUi',
  ];
  if (actualOrder.length !== expectedOrder.length
      || actualOrder.some((installer, index) => installer !== expectedOrder[index])) {
    failures.push(
      `main.js: installer order invalid; expected ${expectedOrder.join(' -> ')}, got ${actualOrder.join(' -> ')}`,
    );
  }
}

requireText('source', source, "import { installSettingsUi } from './settings-ui.js'");
requireText('main.js', mainFile?.code || '', 'installSettingsUi(deps)');
for (const expected of [
  'window.__pmHistories = window.__pmHistories || {};',
  "window.__pmConfig = window.__pmConfig || { apiUrl: '', apiKey: '', model: '', temperature: 1.2, useIndependent: false };",
  "preset: 'default'", "qrLabel: '天音'", 'phoneScale: 1',
  'window.__pmBudgetConfig = normalizeBudgetConfig(window.__pmBudgetConfig);',
  'window.__pmInjectionConfig = normalizeInjectionConfig(window.__pmInjectionConfig);',
  'window.__pmGalBubbleEnabled = window.__pmGalBubbleEnabled || false;',
]) requireText('phone-foundation.js', sourceModuleByName.get('phone-foundation.js')?.code || '', expected);
for (const expected of [
  'if (windowRef.__pmBeforeUnloadRegistered) return false;',
  "windowRef.__pmBeforeUnloadRegistered = true;",
  'windowRef.__pmPageSuspensionHandler = reason => handlePhonePageSuspension(',
]) requireText('phone-foundation.js', sourceModuleByName.get('phone-foundation.js')?.code || '', expected);
for (const expected of [
  '## 安装顺序与全局桥',
  '## 构建体积基线',
  'installPhoneFoundation → installConversation → installEmojiUi → installInteractiveScenes → installCalendar → installSettingsUi → installPhoneChat → installPhoneContextInjection → installPhoneControlCenter → installPhoneDirectory → installContactGenerator → installPhoneChatPoke → installPhoneLifecycle → installDiagnosticApi → installTodayTrend → installTodayTrendPhoneUi',
  '`window.__pmHistories`、`window.__pmConfig`、`window.__pmTheme`、`window.__pmInjectionConfig`、`window.__pmBudgetConfig`',
  '`window.__pmBeforeUnloadRegistered` 与 `window.__pmPageSuspensionHandler`',
  '`1240219` bytes', '`1488263` bytes',
]) requireText('docs/BASELINE.md', baselineText, expected);
for (const expected of [
  '`--pm-color-surface-elevated`', '`--pm-color-border-strong`',
]) requireText('docs/CSS-TOKENS.md', cssTokensText, expected);
for (const expected of [
  '## 页面级常驻监听', '## 窗口级资源',
  'installPhonePageSuspensionListeners', 'installPhoneCommandShortcutListeners',
  'runtime.hostEventRegistrations', 'runtime.visibilityTimer', 'createAmbientStatusController',
  'quoteHighlightTimer', 'state.generationTask', 'runtime.automaticTasks', 'runtime.historyLoadPromise',
  '## 缓存边界', 'runtime.pendingMessages', 'PENDING_MESSAGE_LIMIT = 50',
  'SAVE_LIMIT = 60', 'runtime.trackedExtensionPromptKeys',
  '真正关闭阶段 A 前仍须在 SillyTavern 验证',
]) requireText('docs/LIFECYCLE-RESOURCES.md', lifecycleResourcesText, expected);
requireText('behavior-config.js', sourceModuleByName.get('behavior-config.js')?.code || '', 'normalizeCharacterBehaviorStore');
for (const expected of [
  'normalizeGroupMetaStore', 'randomNpcEnabled: Boolean(source.randomNpcEnabled)',
  'groupNature: text(source.groupNature, 200)',
]) requireText('behavior-config.js', sourceModuleByName.get('behavior-config.js')?.code || '', expected);
requireText('constants.js', sourceModuleByName.get('constants.js')?.code || '', 'NONE: -1');
requireText('constants.js', sourceModuleByName.get('constants.js')?.code || '', 'IN_PROMPT: 0');
requireText('constants.js', sourceModuleByName.get('constants.js')?.code || '', 'IN_CHAT: 1');
requireText('constants.js', sourceModuleByName.get('constants.js')?.code || '', 'BEFORE_PROMPT: 2');
requireText('constants.js', sourceModuleByName.get('constants.js')?.code || '', 'MAX_INJECTION_DEPTH = 10000');
requireText('storage.js', sourceModuleByName.get('storage.js')?.code || '', 'saveCharacterBehavior');
requireText('storage.js', sourceModuleByName.get('storage.js')?.code || '', 'saveBudgetConfig');
requireText('budget.js', sourceModuleByName.get('budget.js')?.code || '', "BUDGET_CONFIG_KEY = 'ST_SMS_BUDGET_CONFIG'");
requireText('budget.js', sourceModuleByName.get('budget.js')?.code || '', 'DEFAULT_SAFE_INPUT_TOKENS');
requireText('permissions.js', sourceModuleByName.get('permissions.js')?.code || '', 'resolvePhoneSources');
requireText('permissions.js', sourceModuleByName.get('permissions.js')?.code || '', 'resolveCommunitySources');
requireText('phone-injection.js', sourceModuleByName.get('phone-injection.js')?.code || '', 'applyContextInjections');
requireText('settings-templates.js', sourceModuleByName.get('settings-templates.js')?.code || '', '控制本插件写入主提示词的内容量，不限制模型输出。');
for (const expected of [
  'pm-settings-home', "__pmShowConfig('api')", "__pmShowConfig('look')",
  "__pmShowConfig('backup')", "__pmShowConfig('budget')", "__pmShowConfig('quick-reply')",
  'pm-indep-profile-fields', 'pm-indep-config-fields', 'pm-independent-api-fields', 'pm-cfg-temperature',
  'renderQuickReplySettings', 'Quick Reply', '/phone', '手机开关', '创建或清除开关入口',
  '默认使用酒馆 API 预设', '范围 0–2；数值越高，回复越随机。默认 1.2。', 'BACK_ICON_SVG', 'pm-action-button is-danger',
]) requireText('settings-templates.js', sourceModuleByName.get('settings-templates.js')?.code || '', expected);
for (const expected of [
  'PHONE_QR_SET_NAME', 'PHONE_QR_AUTOMATION_ID', "PHONE_QR_MESSAGE = '/phone'", "PHONE_QR_LABEL_DEFAULT = '天音'",
  "PHONE_QR_AUTO_INIT_KEY = 'ST_SMS_PHONE_QR_INITIALIZED'", 'normalizePhoneQuickReplyLabel',
  'ensureInitialPhoneQuickReply', 'ensureInitialPhoneQuickReplyWithRetry',
  'createSet', 'deleteSet', 'createQuickReply', 'updateQuickReply', 'deleteQuickReply',
  'addGlobalSet', 'removeGlobalSet', 'listGlobalSets', '无法证明属于天音小笺',
]) requireText('quick-reply.js', sourceModuleByName.get('quick-reply.js')?.code || '', expected);
for (const expected of ['ensureInitialPhoneQuickReplyWithRetry', 'ensureInitialPhoneQuickReplyWithRetry().catch']) {
  requireText('main.js', sourceModuleByName.get('main.js')?.code || '', expected);
}
requireText('storage.js', sourceModuleByName.get('storage.js')?.code || '', "'ST_SMS_PHONE_QR_INITIALIZED'");
for (const expected of ['__pmEnsurePhoneQuickReply', '__pmClearPhoneQuickReply', 'installQuickReplySettings']) requireText('settings-quick-reply.js', sourceModuleByName.get('settings-quick-reply.js')?.code || '', expected);
requireText('runtime.js', sourceModuleByName.get('runtime.js')?.code || '', 'pendingMessages: new Map()');
requireText('pending-messages.js', sourceModuleByName.get('pending-messages.js')?.code || '', ".filter(item => item.status !== 'submitting')");
for (const expected of [
  'createMessageEntry', 'normalizeMessageHistory', 'normalizeQuoteSnapshot',
  'messageId', 'bubbleId', 'bubbles',
]) requireText('chat-message-model.js', sourceModuleByName.get('chat-message-model.js')?.code || '', expected);
for (const expected of [
  'createMessageEntry({', 'quote: combined.quote', 'formatQuoteContext(request.userHistoryEntry?.quote)',
  'messageId: assistantEntry.messageId', 'bubbleId: bubble?.bubbleId', 'if (combined.quoteConflict)',
]) requireText('phone-chat.js', sourceModuleByName.get('phone-chat.js')?.code || '', expected);
const chatPromptsCode = sourceModuleByName.get('chat-prompts.js')?.code || '';
const chatBlocksPromptCode = sourceModuleByName.get('blocks.js')?.code || '';
const chatGroupPromptCode = sourceModuleByName.get('group.js')?.code || '';
const chatSinglePromptCode = sourceModuleByName.get('single.js')?.code || '';
const groupContextPromptCode = sourceModuleByName.get('group-context.js')?.code || '';
for (const expected of [
  'formatQuoteContext', '【本轮回复关系】', 'buildGroupAdditionalContext',
  '群聊性质：${nature}', '允许不在固定成员名单上的路人群友',
]) requireText('chat prompts', `${chatPromptsCode}\n${chatBlocksPromptCode}\n${chatGroupPromptCode}\n${chatSinglePromptCode}\n${groupContextPromptCode}`, expected);
for (const expected of [
  'groupRandomNpcEnabled', 'groupNature',
  'allowUnknownSpeakers: groupRandomNpcEnabled === true',
]) requireText('phone-chat.js', sourceModuleByName.get('phone-chat.js')?.code || '', expected);
for (const expected of [
  'groupRandomNpcEnabled: groupMeta?.randomNpcEnabled', 'groupNature: groupMeta?.groupNature',
  'allowUnknownSpeakers: groupMeta.randomNpcEnabled === true',
  'allowUnknownSpeakers: groupRandomNpcEnabled === true',
]) requireText('phone-chat-poke.js', sourceModuleByName.get('phone-chat-poke.js')?.code || '', expected);
const messagingGroupParserCode = sourceModuleByName.get('messaging-group-parser.js')?.code || '';
for (const expected of ['allowUnknownSpeakers = false', 'resolveSpeaker', "if (!allowUnknownSpeakers || !normalized) return ''"]) {
  requireText('messaging-group-parser.js', messagingGroupParserCode, expected);
}
requireText('phone-injection.js', sourceModuleByName.get('phone-injection.js')?.code || '', 'formatQuoteContext(message.quote)');
for (const expected of [
  'dataset.messageId', 'dataset.bubbleId', 'pm-reply-card', 'locateQuotedBubble', 'setActiveQuote',
  'syncReplyCardAvailability', 'refreshReplyCardAvailability',
  "matchMedia?.('(prefers-reduced-motion: reduce)')", "reduceMotion ? 'auto' : 'smooth'",
]) requireText('phone quote controller', sourceModuleByName.get('phone-quote.js')?.code || '', expected);
for (const expected of [
  'pm-quote-preview', 'deleteSelectedMessages', 'refreshReplyCardAvailability?.()',
  'if (runtime.visibilityTimer !== null) { clearInterval(runtime.visibilityTimer); runtime.visibilityTimer = null; }',
  'if (runtime.visibilityTimer === null && state.phoneActive && state.phoneWindow) runtime.visibilityTimer = setInterval(ensureVisibility, 2000);',
]) requireText('phone-lifecycle.js', sourceModuleByName.get('phone-lifecycle.js')?.code || '', expected);
const lifecycleTimerCode = sourceModuleByName.get('phone-lifecycle.js')?.code || '';
for (const expected of [
  "Symbol.for('phone-mode.command-shortcut-listeners')", 'installPhoneCommandShortcutListeners',
  'if (windowRef[PHONE_COMMAND_SHORTCUT_LISTENER_KEY]) return false;', 'installPhoneCommandShortcutListeners();',
]) requireText('phone-lifecycle.js', lifecycleTimerCode, expected);
const visibilityTimerStart = lifecycleTimerCode.indexOf('runtime.visibilityTimer = setInterval(ensureVisibility, 2000)');
const phoneOpenStart = lifecycleTimerCode.indexOf('window.__pmOpen = async () => {');
const phoneActiveStart = lifecycleTimerCode.indexOf('state.phoneActive = true;', phoneOpenStart);
if (visibilityTimerStart < phoneActiveStart) {
  failures.push('phone-lifecycle.js: visibility timer must start only after phone initialization marks the window active');
}
if (lifecycleTimerCode.slice(0, phoneOpenStart).includes('runtime.visibilityTimer = setInterval(ensureVisibility, 2000)')) {
  failures.push('phone-lifecycle.js: plugin installation must not start the visibility timer while no phone window exists');
}
const lifecycleAst = parseJavaScript(lifecycleTimerCode, 'module');
const lifecycleExport = lifecycleAst.body.find(statement => statement.type === 'ExportNamedDeclaration'
  && statement.declaration?.type === 'FunctionDeclaration'
  && statement.declaration.id?.name === 'installPhoneLifecycle');
const lifecycleInstallStatements = lifecycleExport?.declaration?.body?.body || [];
const isDirectCall = (statement, name) => statement?.type === 'ExpressionStatement'
  && statement.expression?.type === 'CallExpression'
  && statement.expression.callee?.type === 'Identifier'
  && statement.expression.callee.name === name;
const directHostHookIndex = lifecycleInstallStatements.findIndex(statement => isDirectCall(statement, 'hookGenerationEvent'));
const initialGroupMetaIndex = lifecycleInstallStatements.findIndex(statement => statement.type === 'VariableDeclaration'
  && statement.declarations.some(declaration => declaration.id?.type === 'Identifier'
    && declaration.id.name === 'initialGroupMetaLoad'));
if (directHostHookIndex < 0 || initialGroupMetaIndex < 0 || directHostHookIndex > initialGroupMetaIndex) {
  failures.push('phone-lifecycle.js: host events must be hooked before initial local metadata recovery starts');
}
let delayedRetryCallback = null;
for (const statement of lifecycleInstallStatements) {
  walk(statement, node => {
    if (delayedRetryCallback || node.type !== 'CallExpression' || node.callee?.type !== 'Identifier' || node.callee.name !== 'setTimeout') return;
    const callback = node.arguments?.[0];
    if (callback?.type === 'ArrowFunctionExpression' && callback.body?.type === 'BlockStatement'
        && callback.body.body.some(candidate => isDirectCall(candidate, 'hookGenerationEvent'))) {
      delayedRetryCallback = callback;
    }
  });
}
const delayedRetryStatements = delayedRetryCallback?.type === 'ArrowFunctionExpression'
  && delayedRetryCallback.body?.type === 'BlockStatement'
  ? delayedRetryCallback.body.body : [];
const delayedDirectHookIndex = delayedRetryStatements.findIndex(statement => isDirectCall(statement, 'hookGenerationEvent'));
const delayedMetadataIndex = delayedRetryStatements.findIndex(statement => {
  let hasMetadataThen = false;
  walk(statement, node => {
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression'
        && node.callee.object?.type === 'Identifier' && node.callee.object.name === 'initialGroupMetaLoad'
        && memberName(node.callee) === 'then') hasMetadataThen = true;
  });
  return hasMetadataThen;
});
if (delayedDirectHookIndex < 0 || delayedMetadataIndex < 0 || delayedDirectHookIndex > delayedMetadataIndex) {
  failures.push('phone-lifecycle.js: delayed host-event retry must run before and independently from metadata success continuation');
}
for (const expected of [
  'commitEditedGroupUpdate', 'refreshEditedGroupRuntime', 'restoreConversationState', 'previousConversationContext',
  'persistRestored', "injectionFailure(rollbackResult, '补偿')",
  'let deleteTransactionActive = false', 'acquireDeleteTransaction', 'releaseDeleteTransaction',
  "document.querySelectorAll?.('.pm-entity-delete')", 'button.disabled = disabled',
  '已有删除操作正在进行，请等待完成后再试。',
  'const injectionResult = await applyBidirectionalInjection()',
  "injectionFailure(injectionResult, '删除清理', '联系人')",
  "injectionFailure(injectionResult, '删除清理', '群聊')",
  "injectionFailure(rollbackResult, '删除补偿', '联系人')",
  "injectionFailure(rollbackResult, '删除补偿', '群聊')",
  'groupMembers: state.groupMembers.slice()', 'window.__pmSwitch(state.currentGroupKey',
  'pm-modal-scroll pm-group-settings-scroll', 'id="pm-group-random-npc"',
  'id="pm-group-nature"', '允许路人群友随机出现', '群聊设置',
  'returnToControlCenter = false', 'window.__pmReturnToControlCenter()',
  "document.getElementById('pm-group-random-npc')", "document.getElementById('pm-group-nature')",
]) {
  requireText('phone-directory.js', sourceModuleByName.get('phone-directory.js')?.code || '', expected);
}
requireText('phone-chat-poke.js', sourceModuleByName.get('phone-chat-poke.js')?.code || '',
  'window.__pmShowGroupRandomNpcSettings?.({ returnToControlCenter: !returnToGroupSettings })');
for (const expected of [
  'commitConversationInjectionUpdate', '__pmShowConversationInjection', '__pmClearConversationInjection',
  '__pmSaveConversationInjection', 'clearBidirectionalInjection', 'injectionSettingsBusy',
  '__pmConversationInjectionSummary', '__pmToggleCurrentConversationInjection',
  '__pmConversationInjectionEnabled', '__pmToggleConversationInjection', 'explicitTarget', 'toggleTargetInjection',
  'enqueueToggle', 'injectionToggleQueue', '{ requireExisting: true }',
  'runConversationInjectionMutation: enqueueToggle',
  'normalizeInjectionConfig',
  'pm-conversation-injection-phone-position',
  'pm-conversation-injection-phone-depth',
  'pm-conversation-injection-phone-history-limit',
  'pm-conversation-injection-community-position',
  'pm-conversation-injection-community-depth',
  'pm-conversation-injection-calendar-position',
  'pm-conversation-injection-calendar-depth',
  'pm-conversation-injection-today-trend-position',
  'pm-conversation-injection-today-trend-depth',
  '正文注入',
  "onclick=\"window.__pmShowConfig('home')\"", '${BACK_ICON_SVG}',
]) requireText('phone-context-injection.js', sourceModuleByName.get('phone-context-injection.js')?.code || '', expected);
for (const expected of [
  "action.setAttribute('aria-label', `${enabled ? '关闭' : '开启'} ${label} 的正文注入`)",
  'finishDeletedConversation', '删除后切换剩余会话失败，进入空态',
  'runConversationInjectionMutation(async () =>',
]) requireText('phone-directory.js', sourceModuleByName.get('phone-directory.js')?.code || '', expected);
requireText('phone-chat.js', sourceModuleByName.get('phone-chat.js')?.code || '', 'removePendingBatch(runtime');
requireText('phone-chat.js', sourceModuleByName.get('phone-chat.js')?.code || '', 'rebaseRenderedHistory(historyWindow.trimmedCount)');
requireText('phone-chat-poke.js', sourceModuleByName.get('phone-chat-poke.js')?.code || '', 'rebaseRenderedHistory(historyWindow.trimmedCount)');
const controlCenterCode = sourceModuleByName.get('phone-control-center.js')?.code || '';
const directoryCode = sourceModuleByName.get('phone-directory.js')?.code || '';
for (const forbidden of ['pm-group-injection-position', 'pm-group-injection-depth', 'pm-group-injection-limit', '勾选会话可注入主楼']) {
  if (directoryCode.includes(forbidden)) failures.push(`phone-directory.js: legacy inline injection control remains: ${forbidden}`);
}
const contactCode = sourceModuleByName.get('contact-generator.js')?.code || '';
const interactiveCode = sourceModuleByName.get('interactive-scenes.js')?.code || '';
const interactiveUtilsCode = sourceModuleByName.get('interactive-scenes-utils.js')?.code || '';
const interactiveViewsCode = sourceModuleByName.get('interactive-scene-views.js')?.code || '';
const interactivePhoneCode = sourceModuleByName.get('interactive-scene-phone.js')?.code || '';
const interactiveSchedulerCode = sourceModuleByName.get('interactive-scene-scheduler.js')?.code || '';
const foundationCode = sourceModuleByName.get('phone-foundation.js')?.code || '';
const phoneGenerationCode = sourceModuleByName.get('phone-generation.js')?.code || '';
const phoneHostEventsCode = sourceModuleByName.get('phone-host-events.js')?.code || '';
const phoneInjectionControllerCode = sourceModuleByName.get('phone-injection-controller.js')?.code || '';
const phoneMessageRenderingCode = sourceModuleByName.get('phone-message-rendering.js')?.code || '';
const phoneOverlayCode = sourceModuleByName.get('phone-overlay.js')?.code || '';
const phoneThemeCode = sourceModuleByName.get('phone-theme.js')?.code || '';
const todayTrendWorldViewCode = sourceModuleByName.get('today-trend-world-view.js')?.code || '';
const todayTrendReputationViewCode = sourceModuleByName.get('today-trend-reputation-view.js')?.code || '';
const todayTrendFactionViewCode = sourceModuleByName.get('today-trend-faction-view.js')?.code || '';
const todayTrendDynamicsViewCode = sourceModuleByName.get('today-trend-dynamics-view.js')?.code || '';
const todayTrendActionsCode = sourceModuleByName.get('today-trend-actions.js')?.code || '';
const phoneQuoteCode = sourceModuleByName.get('phone-quote.js')?.code || '';
const calendarCode = sourceModuleByName.get('calendar.js')?.code || '';
const calendarWeatherControllerCode = sourceModuleByName.get('calendar-weather-controller.js')?.code || '';
const calendarPageViewCode = sourceModuleByName.get('calendar-page-view.js')?.code || '';
const calendarCommitCode = sourceModuleByName.get('calendar-commit.js')?.code || '';
const calendarDomCode = sourceModuleByName.get('calendar-dom.js')?.code || '';
const calendarRecipeControllerCode = sourceModuleByName.get('calendar-recipe-controller.js')?.code || '';
const calendarRecipeModelCode = sourceModuleByName.get('calendar-recipe-model.js')?.code || '';
const calendarOutfitControllerCode = sourceModuleByName.get('calendar-outfit-controller.js')?.code || '';
const calendarOutfitModelCode = sourceModuleByName.get('calendar-outfit-model.js')?.code || '';
const calendarOutfitRuntimeCode = sourceModuleByName.get('calendar-outfit-runtime.js')?.code || '';
const storageBackgroundCode = sourceModuleByName.get('storage-background.js')?.code || '';
const storagePrimitivesCode = sourceModuleByName.get('storage-primitives.js')?.code || '';
const storagePreferencesCode = sourceModuleByName.get('storage-preferences.js')?.code || '';
const storageHistoryCode = sourceModuleByName.get('storage-history.js')?.code || '';
const storageGroupMetaCode = sourceModuleByName.get('storage-group-meta.js')?.code || '';
const calendarModelCode = sourceModuleByName.get('calendar-model.js')?.code || '';
const calendarHolidayCode = sourceModuleByName.get('calendar-holiday.js')?.code || '';
const calendarViewCode = sourceModuleByName.get('calendar-view.js')?.code || '';
const hostContextCode = sourceModuleByName.get('host-context.js')?.code || '';
const interactivePhoneActionsCode = sourceModuleByName.get('interactive-scene-phone.js')?.code || '';
const aiCode = sourceModuleByName.get('ai.js')?.code || '';
const phoneChatPokeCodeForChecks = sourceModuleByName.get('phone-chat-poke.js')?.code || '';
const interactiveModelCode = sourceModuleByName.get('interactive-scene-model.js')?.code || '';
const interactiveAiCode = sourceModuleByName.get('interactive-scene-ai.js')?.code || '';
const interactivePromptCode = sourceModuleByName.get('interactive.js')?.code || '';
const todayTrendUiCode = sourceModuleByName.get('today-trend-ui.js')?.code || '';
const cropperSourceCode = sourceModuleByName.get('cropper.js')?.code || '';
const settingsUiCodeForInteractive = sourceModuleByName.get('settings-ui.js')?.code || '';
const settingsWordyControllerCode = sourceModuleByName.get('settings-wordy-controller.js')?.code || '';
const settingsBackupControllerCode = sourceModuleByName.get('settings-backup-controller.js')?.code || '';
const settingsBackupValidateCode = sourceModuleByName.get('settings-backup-validate.js')?.code || '';
const settingsBackupCode = sourceModuleByName.get('settings-backup.js')?.code || '';
const contactAnalysis = analyze(contactCode, 'module');
const calendarAnalysis = analyze(calendarCode, 'module');
const interactiveAnalysis = analyze(interactiveCode, 'module');
const interactiveInspection = inspectModule(interactiveCode);
const interactiveUtilsInspection = inspectModule(interactiveUtilsCode);
const calendarInspection = inspectModule(calendarCode);
const calendarCommitInspection = inspectModule(calendarCommitCode);
const calendarDomInspection = inspectModule(calendarDomCode);
const storageInspection = inspectModule(sourceModuleByName.get('storage.js')?.code || '');
const storageBackgroundInspection = inspectModule(storageBackgroundCode);
const storagePrimitivesInspection = inspectModule(storagePrimitivesCode);
const storagePreferencesInspection = inspectModule(storagePreferencesCode);
const storageHistoryInspection = inspectModule(storageHistoryCode);
const storageGroupMetaInspection = inspectModule(storageGroupMetaCode);
const INTERACTIVE_SCENE_UTIL_EXPORTS = [
  'createInteractiveCommitQueue', 'createInteractiveOperationGuard', 'createInteractiveStoreLoader',
  'migrateInteractiveStore', 'parseCommunityPostInput',
];
for (const name of INTERACTIVE_SCENE_UTIL_EXPORTS) {
  if (!interactiveUtilsInspection.exports.has(name)) failures.push(`interactive-scenes-utils.js: missing exported ${name}`);
  if (!interactiveInspection.exports.has(name)) failures.push(`interactive-scenes.js: must re-export ${name} for compatibility`);
  if (interactiveInspection.declarations.has(name)) failures.push(`interactive-scenes.js: ${name} implementation must remain owned by interactive-scenes-utils.js`);
}
requireNamedImports('interactive-scenes.js', interactiveInspection, './interactive-scenes-utils.js', [
  ...INTERACTIVE_SCENE_UTIL_EXPORTS, 'now', 'uid',
]);
requireNamedImports('calendar.js', calendarInspection, './calendar-commit.js', ['createCalendarCommitters']);
requireNamedImports('calendar.js', calendarInspection, './calendar-dom.js', [
  'fillCalendarEntryForm', 'readCalendarEntryForm', 'setCalendarEntryRepeat',
]);
if (!calendarInspection.calls.has('createCalendarCommitters')) failures.push('calendar.js: must call createCalendarCommitters');
for (const name of ['commitScope', 'injectionFailure']) {
  if (calendarInspection.functionDefinitions.has(name)) failures.push(`calendar.js: ${name} implementation must remain owned by calendar-commit.js`);
}
if (calendarInspection.declarations.has('scopeCommitQueue')) failures.push('calendar.js: scopeCommitQueue must remain owned by calendar-commit.js');
for (const name of ['createCalendarCommitters']) {
  if (!calendarCommitInspection.exports.has(name)) failures.push(`calendar-commit.js: missing exported ${name}`);
}
for (const name of ['fillCalendarEntryForm', 'readCalendarEntryForm', 'setCalendarEntryRepeat']) {
  if (!calendarDomInspection.exports.has(name)) failures.push(`calendar-dom.js: missing exported ${name}`);
}
for (const name of ['loadBgSettings', 'saveBgGlobal', 'saveBgLocal', 'saveDesktopBg']) {
  if (!storageBackgroundInspection.exports.has(name)) failures.push(`storage-background.js: missing exported ${name}`);
  if (storageInspection.exports.has(name) || storageInspection.declarations.has(name)) failures.push(`storage.js: ${name} must remain owned by storage-background.js`);
}
for (const name of ['DESKTOP_BG_KEY', 'isBigData', 'pmIDBDel', 'pmIDBGet', 'pmIDBSet']) {
  if (!storagePrimitivesInspection.exports.has(name)) failures.push(`storage-primitives.js: missing exported ${name}`);
}
requireNamedImports('storage-background.js', storageBackgroundInspection, './storage-primitives.js', [
  'DESKTOP_BG_KEY', 'isBigData', 'pmIDBDel', 'pmIDBGet', 'pmIDBSet',
]);
requireNamedImports('storage.js', storageInspection, './storage-primitives.js', [
  'DESKTOP_BG_KEY', 'isBigData', 'pmIDBDel', 'pmIDBGet', 'pmIDBKeys', 'pmIDBReadEntry', 'pmIDBSet', 'pmOpenIDB',
]);
requireNamedImports('storage.js', storageInspection, './storage-preferences.js', [
  'addOrUpdateProfile', 'loadGalBubbleEnabled', 'loadInjectionConfig', 'loadProfiles', 'loadTheme', 'loadWordyLimit',
  'loadWorldBookConfig', 'saveGalBubbleEnabled', 'saveInjectionConfig', 'saveProfiles', 'saveTheme', 'saveWordyLimit', 'saveWorldBookConfig',
]);
for (const name of ['addOrUpdateProfile', 'loadGalBubbleEnabled', 'loadInjectionConfig', 'loadProfiles', 'loadTheme', 'loadWordyLimit', 'loadWorldBookConfig', 'saveGalBubbleEnabled', 'saveInjectionConfig', 'saveProfiles', 'saveTheme', 'saveWordyLimit', 'saveWorldBookConfig']) {
  if (!storagePreferencesInspection.exports.has(name)) failures.push(`storage-preferences.js: missing exported ${name}`);
}
requireNamedImports('storage.js', storageInspection, './storage-history.js', [
  'loadHistoriesFromIDB', 'saveHistories', 'saveHistoriesBeforeUnload', 'saveHistoriesStrict',
]);
for (const name of ['loadHistoriesFromIDB', 'saveHistories', 'saveHistoriesBeforeUnload', 'saveHistoriesStrict']) {
  if (!storageHistoryInspection.exports.has(name)) failures.push(`storage-history.js: missing exported ${name}`);
}
requireNamedImports('storage.js', storageInspection, './storage-group-meta.js', ['loadGroupMeta', 'saveGroupMeta']);
for (const name of ['loadGroupMeta', 'saveGroupMeta']) {
  if (!storageGroupMetaInspection.exports.has(name)) failures.push(`storage-group-meta.js: missing exported ${name}`);
}
if (storageBackgroundInspection.imports.has('./storage.js')) failures.push('storage-background.js: must not import the compatibility facade');
if (storagePrimitivesInspection.imports.has('./storage.js')) failures.push('storage-primitives.js: must not import the compatibility facade');
if (storagePreferencesInspection.imports.has('./storage.js')) failures.push('storage-preferences.js: must not import the compatibility facade');
if (storageHistoryInspection.imports.has('./storage.js')) failures.push('storage-history.js: must not import the compatibility facade');
if (storageGroupMetaInspection.imports.has('./storage.js')) failures.push('storage-group-meta.js: must not import the compatibility facade');
if (storageInspection.imports.has('./storage-background.js')) failures.push('storage.js: must not import storage-background.js');
const backgroundConsumerImports = new Map([
  ['settings-ui.js', ['loadBgSettings', 'saveBgGlobal', 'saveBgLocal', 'saveDesktopBg']],
  ['settings-backup.js', ['saveBgGlobal', 'saveBgLocal', 'saveDesktopBg']],
  ['phone-lifecycle.js', ['loadBgSettings']],
  ['phone-directory.js', ['saveBgLocal']],
]);
for (const [fileName, names] of backgroundConsumerImports) {
  const code = sourceModuleByName.get(fileName)?.code || '';
  const inspection = inspectModule(code);
  requireNamedImports(fileName, inspection, './storage-background.js', names);
  forbidNamedImports(fileName, inspection, './storage.js', names);
}
const behaviorInspection = inspectModule(await readFile(path.join(root, 'scripts', 'check-behavior.mjs'), 'utf8'));
requireNamedImports('check-behavior.mjs', behaviorInspection, '../src/storage-background.js', [
  'loadBgSettings', 'saveBgGlobal', 'saveBgLocal', 'saveDesktopBg',
]);
forbidNamedImports('check-behavior.mjs', behaviorInspection, '../src/storage.js', [
  'loadBgSettings', 'saveBgGlobal', 'saveBgLocal', 'saveDesktopBg',
]);
verifyCallAiOptions('contact-generator.js: __pmAutoGenContacts', contactAnalysis.windowAssignmentSource.get('__pmAutoGenContacts') || '', [
  { name: 'isolated', description: 'true', matches: literalValue(true) },
  { name: 'signal', description: 'task.signal', matches: memberValue('task.signal') },
]);
verifyCallAiOptions('calendar.js: generate', calendarAnalysis.functionSource.get('generate') || '', [
  { name: 'isolated', description: 'true', matches: literalValue(true) },
  { name: 'signal', description: 'task.signal', matches: memberValue('task.signal') },
]);
verifyCallAiOptions('interactive-scenes.js: request', interactiveAnalysis.functionSource.get('request') || '', [
  { name: 'isolated', description: 'true', matches: literalValue(true) },
  { name: 'signal', description: 'controller.signal', matches: memberValue('controller.signal') },
]);
for (const functionName of ['createScene']) {
  const functionCode = interactiveAnalysis.functionSource.get(functionName) || '';
  if (!functionCode) failures.push(`interactive-scenes.js: missing ${functionName} for AI request path verification`);
  if (functionCode.includes("request('comment_batch'")) failures.push(`interactive-scenes.js: ${functionName} must not request comment_batch`);
}
const createSceneCode = interactiveAnalysis.functionSource.get('createScene') || '';
if (!createSceneCode.includes('communityRunner.generateFeed()')) {
  failures.push('interactive-scenes.js: createScene initial feed must use the shared community runner');
}
for (const expected of ["operationGuard(scopeId, () => createdSceneId)", "}, isValid, '创建社区')"]) {
  if (!createSceneCode.includes(expected)) failures.push(`interactive-scenes.js: createScene must retain invalidation-safe commit guard ${expected}`);
}
if (!createSceneCode.includes('if (runtime.openSceneId === createdSceneId) runtime.openSceneId = null')) {
  failures.push('interactive-scenes.js: stale createScene failures must not clear a newer open scene');
}
if (createSceneCode.includes("request('feed_batch'")) failures.push('interactive-scenes.js: createScene must not bypass the shared runner for initial feed');
if (/feed_batch[\s\S]*?current\(\)/.test(createSceneCode)) failures.push('interactive-scenes.js: createScene late feed must not reselect a target with current()');
verifyGuardedRequestOrder('interactive-scenes.js: createScene', createSceneCode, 'style_prompt');
const generateCommentsCode = interactiveAnalysis.functionSource.get('generateComments') || '';
if (!generateCommentsCode.includes("request('comment_batch'")) {
  failures.push('interactive-scenes.js: explicit generateComments path must retain comment_batch');
}
for (const expected of ["operationGuard(scopeId, scene.id)", "}, isValid, '生成评论')"]) {
  if (!generateCommentsCode.includes(expected)) failures.push(`interactive-scenes.js: generateComments must retain invalidation-safe commit guard ${expected}`);
}
verifyGuardedRequestOrder('interactive-scenes.js: generateComments', generateCommentsCode, 'comment_batch');
const regeneratePromptCode = interactiveAnalysis.functionSource.get('regeneratePrompt') || '';
for (const expected of ["operationGuard(scopeId, scene.id)", "}, isValid, '重新生成社区提示词')"]) {
  if (!regeneratePromptCode.includes(expected)) failures.push(`interactive-scenes.js: regeneratePrompt must retain invalidation-safe commit guard ${expected}`);
}
verifyGuardedRequestOrder('interactive-scenes.js: regeneratePrompt', regeneratePromptCode, 'style_prompt');
for (const expected of ['contextEpoch: 0', 'runtime.contextEpoch += 1', 'createInteractiveOperationGuard']) {
  requireText('interactive-scenes.js', interactiveCode, expected);
}
for (const expected of ['syncStore: () => deps.applyBidirectionalInjection?.()']) {
  requireText('interactive-scenes.js', interactiveCode, expected);
}
for (const expected of ['syncStore = null', 'await syncStore?.()', '补偿持久化或同步也失败', '文字直播']) {
  requireText('interactive-scenes-utils.js', interactiveUtilsCode, expected);
}
for (const expected of [
  'INTERACTIVE_STORE_VERSION = 2', 'authorId', 'authorNameSnapshot', 'shareCount', 'shared',
  'toggleScenePostLike', 'incrementScenePostShare',
  'if (post.shared === true) return false', 'post.shared = true',
  'assertV2Keys', 'appendScenePosts', 'deriveInteractiveActorId',
  'PHONE_UI_STATE_VERSION = 1', 'normalizePhoneUiState', 'normalizeAmbientStatus',
  'patchPhoneUiScope', 'toggleScenePin',
  "assertV2Keys(value, ['activeSceneId', 'sceneOrder', 'scenes', 'actors']",
]) requireText('interactive-scene-model.js', interactiveModelCode, expected);
for (const expected of ['ST_SMS_PHONE_UI_STATE', 'loadPhoneUiState', 'savePhoneUiState', 'savePhoneUiScope', 'const current = loadPhoneUiState(interactiveStore)']) requireText('storage.js', sourceModuleByName.get('storage.js')?.code || '', expected);
if ((source.match(/ST_SMS_PHONE_UI_STATE/g) || []).length !== 1) failures.push('source: phone UI state must retain exactly one storage-key definition');
for (const expected of [
  "['author', 'content', 'tags', 'comments']", 'cleanFeedComments',
  '不得返回 actorId、authorId 或任何内部标识', 'known_actor_names_data',
]) requireText('interactive scene AI', `${interactiveAiCode}\n${interactivePromptCode}`, expected);
for (const expected of [
  'parseFirstJsonObject', 'generationErrorMessage', 'getting extension version failed',
  '扩展仓库配置、GitHub 认证与网络',
]) requireText('ai.js', aiCode, expected);
if (interactiveAiCode.includes('function parseFirstJsonObject')) {
  failures.push('interactive-scene-ai.js: structured AI JSON extraction must stay owned by ai.js');
}
for (const expected of [
  'generationErrorMessage(error)', 'parseFirstJsonObject(', 'buildGeneratedDirectoryCandidates',
  'commitGeneratedDirectory', 'getDirectorySaveRevision', 'saveHistoriesStrict', 'saveGroupMeta',
  'shouldReportGeneratedDirectoryError', 'rollbackError', 'commitDirectory = commitGeneratedDirectory',
  'if (!committed || !isGenerationTaskActive(task)) return;', '已添加 ${resultParts.join',
]) requireText('contact-generator.js', sourceModuleByName.get('contact-generator.js')?.code || '', expected);
if ((sourceModuleByName.get('contact-generator.js')?.code || '').includes('saveHistories()')) {
  failures.push('contact-generator.js: generated directory transaction must not use the error-swallowing saveHistories wrapper');
}
requireText('storage-group-meta.js', storageGroupMetaCode, 'export async function saveGroupMeta(data)');
for (const expected of ['enqueueDirectorySave', 'getDirectorySaveRevision', 'marksGlobalSave']) {
  requireText('directory-save-coordinator.js', sourceModuleByName.get('directory-save-coordinator.js')?.code || '', expected);
}
for (const expected of [
  'INTERACTIVE_STORE_VERSION', 'assertInteractiveActor', 'authorId 未指向有效 actor', 'shareCount 必须是非负安全整数', 'shared 必须是布尔值',
  'deriveInteractiveActorId(scopeId, actor.type, actor.bindingKey)',
]) requireText('settings-backup-validate.js', settingsBackupValidateCode, expected);
for (const expected of [
  'schemaVersion: 15', 'desktopBg: snapshot.desktopBg', 'injectionConfig: snapshot.injectionConfig', 'budgetConfig: snapshot.budgetConfig',
  'galBubbleEnabled: snapshot.galBubbleEnabled',
  'calendarStore: snapshot.calendarStore', 'calendarCycles: snapshot.calendarCycles',
  'calendarRecipes: snapshot.calendarRecipes', 'calendarOutfits: snapshot.calendarOutfits', 'todayTrend: snapshot.todayTrend', 'branchLineage: snapshot.branchLineage',
]) requireText('settings-backup-controller.js', settingsBackupControllerCode, expected);
requireText('settings-backup-validate.js', settingsBackupValidateCode, 'applyCalendarBackupFields(data, result, objectValue, { includeRecipes: version >= 7, includeOutfits: version >= 12 })');
for (const expected of [
  'version > 15', '备份版本 13 缺少 budgetConfig', '备份版本 14 缺少 todayTrend', '备份版本 15 缺少 galBubbleEnabled',
  'result.budgetConfig = normalizeBudgetConfig(objectValue(data.budgetConfig, \'budgetConfig\'))',
]) requireText('settings-backup-validate.js', settingsBackupValidateCode, expected);
for (const expected of [
  'phoneUiState: loadPhoneUiState(interactiveScenes)', 'ambientStatus: normalizeAmbientStatus',
  'normalizePhoneUiState(state.phoneUiState, interactiveScenes)', 'savePhoneUiState(phoneUiState, interactiveScenes)',
  "beforeApply('apply')", "beforeApply('rollback')", "applied = await persist(nextState, 'apply')", "persist(snapshot, 'rollback', applied)", 'prepared = await prepare(snapshot)',
  "error.backupPhase = 'prepare'", "error.backupPhase = 'rolled-back'", "combined.backupPhase = 'rollback-failed'",
  'assertCanonicalCalendarField', 'assertCycleBackupInvariants',
  'loadCalendarHolidays()', 'loadCalendarRecipes()', 'loadCalendarOutfits()', 'saveCalendarCycles(state.calendarCycles)', 'saveCalendarRecipes(state.calendarRecipes)', 'saveCalendarOutfits(state.calendarOutfits)',
  'normalizeBudgetConfig(window.__pmBudgetConfig)', 'window.__pmBudgetConfig = normalizeBudgetConfig(state.budgetConfig)', 'saveBudgetConfig(state.budgetConfig)',
  'window.__pmGalBubbleEnabled = state.galBubbleEnabled === true', 'saveGalBubbleEnabled()',
  'loadBranchLineage()', 'saveBranchLineageForBackup(state.branchLineage || {})',
  'rollbackBranchLineageBackup(applied.branchLineageInserted)', 'completeBranchLineageBackup(applied.branchLineageInserted)', 'saveBranchLineage(state.branchLineage || {})',
]) requireText('settings-backup.js', settingsBackupCode, expected);
requireText('settings-backup-validate.js', settingsBackupValidateCode, 'const assertBranchLineage = value =>');
for (const expected of [
  'prepare: current => parseBackupData(data, current)', 'apply: async (snapshot, imported)',
  'reloadCalendarStore?.()', 'afterPersist: async reason => requireInjectionSuccess(',
  "reason === 'apply' ? '导入后的注入刷新失败' : '恢复原数据后的注入刷新失败'",
  "error.backupPhase === 'rolled-back'", "error.backupPhase === 'rollback-failed'", '导入失败，未修改现有数据',
  '数据导入成功，请重新打开界面生效',
  'cancelCalendarTasks?.(`backup-${reason}`)',
  "cancelCalendarTasks?.('plugin-data-clear')",
]) requireText('settings-backup-controller.js', settingsBackupControllerCode, expected);
for (const expected of [
  "tasks.begin(storageId, 'scan-context'", 'parentSignal', 'signal: task.signal',
  'isHolidayYearSupported', 'holidayYearRange', 'calendarGenerationCopy', 'calendar-holiday-country',
  '该国家在当前年代无外部节假日数据源',
  'calendar-month-jump', 'calendar-prev-month', 'calendar-next-month', 'calendar-today', 'rawLatestChatText || context.latestChatText',
  'goToReferenceDate', 'moveCalendarMonth', 'jumpToMonth', 'showEntryEditor',
  'calendar-toggle-detail-edit', 'calendar-edit-entry', 'calendar-delete-entry', 'removeEntry',
  'managementOpenByMode',
  'statusTimerByStorage', 'createCalendarRecipeController', 'getCalendarRecipeStore', 'createCalendarOutfitController', 'getCalendarOutfitStore',
  'setTimeoutImpl', 'clearTimeoutImpl', '{ persistent: true }', '{ duration: 10000 }',
]) requireText('calendar.js', calendarCode, expected);
for (const expected of [
  'createStoryWeatherEvent', 'weatherRefreshing: false', 'weatherRefreshTask: task', 'latestView.weatherRefreshTask === task', 'resetCache: true',
]) requireText('calendar-weather-controller.js', calendarWeatherControllerCode, expected);

for (const expected of [
  'calendarMonthCells', 'shiftCalendarMonth', 'BACK_ICON_SVG', 'FORWARD_ICON_SVG', 'HOME_ICON_SVG', 'CHEVRON_DOWN_ICON_SVG', 'RECIPE_ICON_SVG',
  'calendar-month-panel', 'pm-calendar-header-side is-left', 'pm-calendar-header-side is-right',
  'data-calendar-month-navigation tabindex="0"', 'calendar-prev-month', 'calendar-next-month',
  'pm-calendar-title-control', 'pm-calendar-title-chevron',
  'relativeCalendarLabel(today, selectedDate)', 'calendar-recipe-generate', 'recipeScope', 'calendarWindowDescription(today, 7)',
  '`AI 生成${recipeWindow.label}菜谱`',
  "container?.querySelector?.('[data-calendar-management]')", 'managementOpen: view.managementOpenByMode?.[viewMode]',
  "viewMode === 'weather' ? view.weatherRefreshing === true",
  "const statusBusy = viewMode === 'recipe'",
  "const headerIcon = ['schedule', 'recipe', 'outfit'].includes(viewMode) ? SPARKLES_ICON_SVG : REFRESH_ICON_SVG",
  "const statusClass = statusBusy ? 'pm-calendar-status is-generating' : 'pm-calendar-status'",
]) requireText('calendar-page-view.js', calendarPageViewCode, expected);
for (const expected of ['rawContent: removeProtectedBlocks(message.mes || \'\')', 'rawLatestChatText', 'mainChatText: mainChat.map(message => `${message.who}：${message.content}`).join(\'\\n\')', 'resolveOutfitTarget', 'outfitSubject = null', 'allowHostBindings: false']) requireText('host-context.js', hostContextCode, expected);
for (const expected of ['OUTFIT_SELF_SUBJECT = \'__self__\'', 'outfitSubjectLabel', 'targetProfile', 'environmentContext']) requireText('calendar-outfit-model.js', calendarOutfitModelCode, expected);
for (const expected of ['OUTFIT_SELF_SUBJECT', 'outfitSubjectLabel', 'button.value || OUTFIT_SELF_SUBJECT']) requireText('calendar-outfit-runtime.js', calendarOutfitRuntimeCode, expected);
for (const expected of ['outfitSubject: OUTFIT_SELF_SUBJECT']) requireText('calendar.js', calendarCode, expected);
for (const expected of [
  "outfitSubject: subject", 'structuredClone(getProfile(storageId, subject))', 'buildOutfitPrompts(context, profileSnapshot',
  '穿搭偏好或生成规则已在生成期间改变，请重新生成', '待覆盖穿搭已在生成期间改变，请重新确认后生成',
]) requireText('calendar-outfit-controller.js', calendarOutfitControllerCode, expected);
for (const expected of [
  "tasks.begin(storageId, 'recipe-generate'", 'isolated: true, signal: task.signal',
  'expectedRegion: requestedRegion, days: generationDays', 'replaceRecipeInWindow', 'commitRecipe',
  'generationDays = replaceWindow ? 1 : 7', 'hasExistingMeals', 'generationWindow.label', '覆盖当日所有餐食',
  'requestedWindowSnapshot', '待覆盖菜谱已在生成期间改变，请重新确认后生成',
  'calendar-recipe-region-save', 'calendar-recipe-generation-rule-save', '菜谱生成规则不能为空',
  'refreshInjection: false', 'calendar-recipe-add', 'calendar-recipe-edit', 'calendar-recipe-delete',
  'renderRecipeMealDialog', 'recipeGenerationTask === task',
]) requireText('calendar-recipe-controller.js', calendarRecipeControllerCode, expected);
for (const expected of ['commitGeneration', 'invalidateCommits', 'generation !== commitGeneration']) {
  requireText('calendar-commit.js', sourceModuleByName.get('calendar-commit.js')?.code || '', expected);
}
for (const expected of ["reason === 'plugin-data-clear'", "reason === 'backup-apply'", "reason === 'backup-rollback'", 'invalidateCommits();']) {
  requireText('calendar.js', calendarCode, expected);
}
for (const expected of ['calendar-generation-rule-save', '日程生成规则不能为空', 'refreshInjection: false', 'requestedGenerationRule = current.generationRule', 'extractContextFestivals(context)', 'buildCalendarPrompts(payload, existing, mode, requestedGenerationRule, generationDays)', 'generationDays = mode === \'regenerate\' ? 1 : 7', 'hasExistingEvents', 'generationWindow.label', '覆盖当日所有日程', 'requestedWindowSnapshot', '待覆盖日程已在生成期间改变，请重新确认后生成', '日程生成规则已在生成期间改变']) {
  requireText('calendar.js', calendarCode, expected);
}
for (const expected of [
  "RECIPE_MEAL_TYPES = Object.freeze(['breakfast', 'lunch', 'dinner', 'snack'])",
  'calendarDateRangeKeys(start, 0, days - 1)', 'calendarDateRangeKeys(start, -1, 1)',
  'calendarWindowDescription(start, days)',
  'appliedRegion', 'regionPreference', 'generationRule', 'lastGeneratedRegion',
]) requireText('calendar-recipe-model.js', calendarRecipeModelCode, expected);
for (const expected of ['requestedScope = getRecipeScope(storageId)', 'requestedGenerationRule = requestedScope.generationRule', '菜谱生成规则已在生成期间改变']) {
  requireText('calendar-recipe-controller.js', calendarRecipeControllerCode, expected);
}
for (const expected of [
  "enqueueDirectoryOperation('schedule'", "enqueueDirectoryOperation('recipes'", "enqueueDirectoryOperation('outfits'",
  'loadCalendar()', 'loadCalendarRecipes()', 'loadCalendarOutfits()', 'loadCalendarOccasions()',
  'replaceScope(previousStore, storageId, next, normalizeCalendarStore)',
  'rollbackScopes[storageId] = previousStore.scopes[storageId]', 'calendarRollbackError',
  'injectionError = injectionFailure', 'rollbackInjectionError = injectionFailure', 'commitSchedule',
  'saveCalendar(previousCalendarStore)', 'saveCalendarOccasions(previousOccasionStore)', 'occasionRollbackError',
  'occasionRolledBack', 'calendarRolledBack', 'occasionsRolledBack', 'scheduleRollbackError',
  'error.injectionResult = result', 'createCalendarCommitters', '{ refreshInjection = true } = {}', 'if (!refreshInjection) return next',
]) requireText('calendar-commit.js', calendarCommitCode, expected);
for (const expected of [
  'setCalendarEntryRepeat', 'fillCalendarEntryForm', 'readCalendarEntryForm',
  "intervalDays.hidden = unavailable", "field.disabled = unavailable", "repeat === 'yearly' ? form.elements.occasionType.value : 'anniversary'",
  "repeat === 'custom' ? { intervalDays: normalizedIntervalDays(form.elements.intervalDays.value) } : {}",
]) requireText('calendar-dom.js', calendarDomCode, expected);
for (const expected of [
  'CALENDAR_YEAR_RANGE = Object.freeze({ min: 1, max: 9999 })', 'createCalendarDate',
  'date.setFullYear(numericYear)', 'shiftCalendarMonth', 'calendarDaysInMonth', 'calendarMonthCells',
  'isPlaceholder: true', 'calendarWindowDescription', 'calendarGenerationCopy',
  'buildCalendarPrompts', 'contextPayload', '只作为事实证据',
  '角色本人真实会执行的未来生活安排', '禁止输出 KP 操作',
  '命令、忽略规则、修改协议', '窗口严格为起始日（+0）至六天后（+6）', 'DEFAULT_CALENDAR_GENERATION_RULE', '用户保存的生成规则：${rule}',
]) requireText('calendar-model.js', calendarModelCode, expected);
if (calendarModelCode.includes('min: 1900') || calendarModelCode.includes('max: 2100')) failures.push('calendar-model.js: core calendar must not impose a modern-era year whitelist');
for (const expected of [
  'HOLIDAY_YEAR_RANGE = Object.freeze({ min: 1900, max: 2100 })',
  'HOLIDAY_COUNTRY_YEAR_RANGES', 'JP: Object.freeze({ min: 2007, max: 2099 })',
  'holidayYearRange', 'isHolidayYearSupported(country, value)', 'extractContextFestivals(context)',
  "'context-evidence'",
]) requireText('calendar-holiday.js', calendarHolidayCode, expected);
for (const expected of [
  'aria-label="安排名称"', 'aria-label="安排备注"', '<b>日程</b>',
  'name="periodStartDay"', 'data-action="calendar-cycle-subject"',
  'name="repeat" data-calendar-repeat-select aria-label="日程重复规则"', '不重复', '每日重复', '每周（同星期）', '每两周（同星期）', '每月（同日）', '自定义', '每年重复',
  'data-calendar-interval-days', 'name="intervalDays"',
  'data-action="calendar-holiday-country"',
  'data-action="calendar-add-date"', 'data-action="calendar-toggle-detail-edit"',
  'data-action="calendar-edit-entry"', 'data-action="calendar-delete-entry"', 'TRASH_ICON_SVG',
  'renderCalendarMonthPanel', 'data-calendar-month-panel', 'data-action="calendar-today"',
  '该国家在当前年代无外部数据源', 'EDIT_ICON_SVG', 'MORE_ICON_SVG',
  'data-action="calendar-recipe-edit"', 'data-action="calendar-recipe-delete"', 'pm-calendar-entry-dialog',
  'pm-calendar-scan-card', '<h3>正文日期</h3>', '保存并识别',
  'role="switch"', 'aria-checked="${scope.autoAdjust}"', '自动跟随正文日期', "label: '<user>'",
  '<time datetime="${selectedDate}">${escapeHtml(detailDate.format(parsed))}</time>', 'detailWeekday.format(parsed)',
  "period: { label: '经期'", "ovulatory: { label: '易孕期'",
  'resolveWeatherForDate(weatherStore, date, {\n        storyWeatherEvent: scope.weatherEvent, storyWeatherEventEnabled: scope.weatherEventEnabled,\n    })',
  'CYCLE_PERIOD_ICON_SVG', 'CYCLE_FERTILE_ICON_SVG', 'WEATHER_ICON_SVG', 'LOCATION_ICON_SVG', 'WEATHER_PARTLY_CLOUDY_ICON_SVG',
  'weatherStatusIcon', 'statusCard', 'pm-calendar-status-card', 'pm-calendar-status-watermark', 'pm-calendar-panel-section',
  'pm-calendar-status-heading', 'pm-calendar-status-context', 'pm-calendar-status-relative', 'pm-calendar-status-weather-context', 'pm-calendar-status-cycle-context', 'pm-calendar-status-date', 'data-cycle-phase="${escapeAttr(phase)}"',
  'value: `${resolved.day.tempMin}°–${resolved.day.tempMax}°`', "'天气记录'", '每两周重复',
  'intervalDays = 1', 'occasionTypeLabel(occasion.type, occasion.repeat, occasion.intervalDays)',
  'relativeLabel, context, value, icon, parsed, date, kind, phase = \'\'',
  "? '是特殊的日子 &gt; &lt; ！要注意保重身体呀'",
  '当前故事日期', 'placeholder="例如 3726-08-17"', '可直接输入日期，或跳转月份后点击下方日期。',
  '开启后，角色回复时会参考当前会话中的相关信息。', '预报外日期使用气候推演', '无法推演',
  'DEFAULT_CALENDAR_GENERATION_RULE', 'DEFAULT_RECIPE_GENERATION_RULE', 'data-calendar-generation-rule', 'data-recipe-generation-rule',
  'calendar-generation-rule-save', 'calendar-recipe-generation-rule-save', 'escapeHtml(generationRule)',
  'name="repeat" data-calendar-repeat-select aria-label="日程重复规则"',
  'data-calendar-interval-days ${custom ? \'\' : \'hidden aria-hidden="true"\'}',
  '<b>OOTD</b>',
]) requireText('calendar-view.js', calendarViewCode, expected);
if (calendarViewCode.includes('${OUTFIT_ICON_SVG} OOTD')) failures.push('calendar-view.js: OOTD detail title must not render the outfit SVG');
if (!calendarPageViewCode.includes('data-action="calendar-mode-outfit"') || !calendarPageViewCode.includes('${OUTFIT_ICON_SVG}</button>')) {
  failures.push('calendar-page-view.js: outfit mode entry must retain the outfit SVG');
}
if (calendarViewCode.includes('<h3>上下文注入</h3>')) failures.push('calendar-view.js: calendar management cards must not repeat the context-injection heading');
if (!/<h3>正文日期<\/h3>[\s\S]*<h3>节假日数据<\/h3>[\s\S]*<h3>生成规则<\/h3>/.test(calendarViewCode)) {
  failures.push('calendar-view.js: schedule generation rule card must remain last');
}
for (const forbidden of ['<span>已选日期</span>', '>${escapeHtml(selectedDate)}</time>', '>编辑</button>', 'calendar-editor-kind', 'pm-calendar-editor-switch']) if (calendarViewCode.includes(forbidden)) failures.push(`calendar-view.js: calendar UI remains: ${forbidden}`);
for (const forbidden of ['storyInitialDate', 'calendar-story-initial', '故事初始日期', "luteal: { label: '安全期'"]) if (calendarViewCode.includes(forbidden)) failures.push(`calendar-view.js: removed calendar copy remains: ${forbidden}`);
for (const forbidden of ['value: `${resolved.day.tempMin} - ${resolved.day.tempMax} ℃`', '健康记录']) {
  if (calendarViewCode.includes(forbidden)) failures.push(`calendar-view.js: legacy status-card copy remains: ${forbidden}`);
}
if (calendarViewCode.includes('Weather data © Open-Meteo')) failures.push('calendar-view.js: weather attribution must not be rendered in the UI');
for (const forbidden of ['相对低风险期', '不能作为避孕依据', '预测仅供提醒', '不能用于避孕判断']) {
  if (calendarViewCode.includes(forbidden) || calendarCode.includes(forbidden)) {
    failures.push(`calendar modules: removed cycle copy remains: ${forbidden}`);
  }
}
for (const expected of [
  "addEventListener('change'", "input[data-action],select[data-action]", "button.tagName === 'SELECT' || button.tagName === 'INPUT'",
  'export function selectScenePreset', "button.dataset?.accent", "app.style?.setProperty?.('--scene-accent', accent)",
  'export function syncSceneAccentControls', 'export function handleSceneAccentAction', "action === 'scene-accent'", "action === 'scene-accent-custom'", "option.setAttribute('aria-pressed'",
]) {
  requireText('interactive-scene-phone.js', interactivePhoneActionsCode, expected);
}
for (const expected of [
  'DEFAULT_INDEPENDENT_API_TEMPERATURE = 1.2', 'normalizeIndependentApiTemperature',
  'temperature: normalizeIndependentApiTemperature(cfg.temperature)',
  'const signal = options.signal', 'signal,', 'throwIfAborted(signal)', 'readApiError(response, signal)',
]) requireText('ai.js', aiCode, expected);
for (const expected of ['pm-cfg-temperature', 'normalizeIndependentApiTemperature(profile.temperature)', 'addOrUpdateProfile({ apiUrl, apiKey, model, temperature })']) requireText('settings-api-controller.js', sourceModuleByName.get('settings-api-controller.js')?.code || '', expected);
for (const expected of ['beforeApply', 'closePhone(true)', 'clearPluginData']) requireText('settings-backup-controller.js', settingsBackupControllerCode, expected);
requireText('settings-ui.js', settingsUiCodeForInteractive, '__pmClearAllData');
for (const expected of ['if (!force)', 'persistCurrentHistory()', 'persistPhoneUiSnapshot?.()']) {
  requireText('phone-lifecycle.js', sourceModuleByName.get('phone-lifecycle.js')?.code || '', expected);
}
requireText('main.js', mainFile?.code || '', 'closePhone: force => window.__pmEnd(force)');
requireText('phone-control-center.js', controlCenterCode, 'updatePendingMessage(');
const controlCenterAnalysis = analyze(controlCenterCode, 'module');
const directoryAnalysis = analyze(directoryCode, 'module');
const controlCenterTemplate = controlCenterAnalysis.windowAssignmentText.get('__pmShowControlCenter') || '';
const directoryTemplate = directoryAnalysis.windowAssignmentText.get('__pmShowList') || '';
const directoryListSource = directoryAnalysis.windowAssignmentSource.get('__pmShowList') || '';
const forumCallPattern = /window\.__pmOpenForumMode\s*\(\s*\)/g;
if (controlCenterTemplate.includes('data-action="forum"') || controlCenterTemplate.includes('互动场景')) {
  failures.push('phone-control-center.js: compact control menu must not duplicate the desktop community entry');
}
if ((controlCenterCode.match(forumCallPattern) || []).length !== 0) {
  failures.push('phone-control-center.js: compact control menu must not dispatch the forum handler');
}
if ((directoryTemplate.match(forumCallPattern) || []).length !== 0) {
  failures.push('phone-directory.js: directory must not contain a forum entry call');
}
if (directoryTemplate.includes('pm-forum-entry') || directoryTemplate.includes('互动社区') || directoryTemplate.includes('论坛、社交与文字直播')) {
  failures.push('phone-directory.js: directory must not duplicate the desktop community entry');
}
if (controlCenterTemplate.includes('makeOverlay') || controlCenterTemplate.includes('<span')) {
  failures.push('phone-control-center.js: compact control menu must not use the full overlay or explanatory subtitles');
}
for (const title of ['编辑消息', '角色设置', '群聊设置', '自动发消息', '表情包管理', '日历', '删除消息']) {
  if (!controlCenterTemplate.includes(title)) failures.push(`phone-control-center.js: compact control menu missing title ${title}`);
}
for (const expected of [
  "action === 'character-settings'", "action === 'group-settings'", "action === 'auto-poke'", "action === 'calendar'", 'return window.__pmShowConversationSettings()',
  'return window.__pmShowAutoPokeSettings()', 'return showPhoneCalendarPage()',
  'runControlMenuAction', 'controlActionLabel', 'CALENDAR_ICON_SVG', 'EDIT_ICON_SVG', 'EMOJI_ICON_SVG', 'TRASH_ICON_SVG',
  'window.__pmShowAutoPokeSettings', 'window.__pmReturnToControlCenter', 'CHARACTER_ICON_SVG', 'SETTINGS_ICON_SVG', 'CHAT_ICON_SVG',
  'data-action="character-settings"', 'data-action="group-settings"', 'window.__pmShowGroupMemberSettings?.(true)',
  'window.__pmEditGroup?.()',
]) requireText('phone-control-center.js', controlCenterCode, expected);
for (const forbidden of [
  "action === 'contacts'", "action === 'session-behavior'", 'return window.__pmShowList()',
  'window.__pmShowConversationInjection', '正文注入', 'INJECTION_ICON_SVG',
  '__pmToggleSessionInjection', 'toggleConversationInjectionControl',
]) {
  if (controlCenterCode.includes(forbidden)) failures.push(`phone-control-center.js: flattened compact menu still contains ${forbidden}`);
}
if (controlCenterCode.includes('__pmShowSessionInjectionSettings') || controlCenterCode.includes('上下文注入规则')) failures.push('phone-control-center.js: split injection settings entry remains after merge');
if (controlCenterCode.includes("action === 'rearm'")) failures.push('phone-control-center.js: obsolete automatic-message rearm action remains');
for (const removedTitle of ['联系人', '会话行为', '删除信息']) {
  if (controlCenterTemplate.includes(removedTitle)) failures.push(`phone-control-center.js: compact control menu still contains removed title ${removedTitle}`);
}
for (const expected of ['required value="${autoPoke.probability}"', '请输入 0 到 100 之间的整数概率。']) {
  requireText('phone-control-center.js', controlCenterCode, expected);
}
if (controlCenterTemplate.includes('data-action="desktop"') || controlCenterTemplate.includes('返回桌面')) {
  failures.push('phone-control-center.js: compact control menu must not duplicate the chat navbar desktop action');
}
for (const title of ['API 设置', '主题颜色', '数据备份', '互动场景']) {
  if (controlCenterTemplate.includes(title)) failures.push(`phone-control-center.js: compact control menu must not contain removed shortcut ${title}`);
}
for (const expected of [
  'post-comment', 'delete-scene', 'delete-post', 'delete-comment', "action === 'post-actions'", "action === 'toggle-reply'", "action === 'share'", 'incrementScenePostShare(current().scene, button.dataset.postId)',
  "button.closest?.('.pm-scene-comment-composer')", "composer?.querySelector?.('input')", 'preserveFeedScroll',
  "document.querySelector('#pm-scene-app .pm-scene-feed')?.scrollTop", "rerender('feed', { preserveFeedScroll: true })",
]) {
  requireText('interactive-scenes.js', interactiveCode, expected);
}
if (interactiveCode.includes('document.getElementById(`pm-comment-input-${button.dataset.postId}`)')) failures.push('interactive-scenes.js: reply submission must stay scoped to the clicked composer');
for (const expected of [
  'HEART_ICON_SVG', 'SHARE_ICON_SVG', 'REPLY_ICON_SVG', 'SEND_ICON_SVG', 'CONTROL_ICON_SVG', 'COMMUNITY_ICON_SVG', 'EDIT_ICON_SVG', 'TRASH_ICON_SVG',
  'pm-scene-nav-actions', 'pm-header-icon-button pm-scene-title-poke', 'pm-header-icon-button pm-scene-exit', 'pm-scene-view-actions', 'pm-scene-title-tab', 'aria-label="子社区视图"',
  'class="pm-scene-home" data-action="desktop"', '<span>直播</span>',
  'style="--scene-accent:${escapeAttr(defaultAccent)}"', 'data-preset="${escapeAttr(key)}" data-accent="${escapeAttr(preset.accent)}"',
  'data-action="tab" data-tab="prompt"', '风格提示词', 'data-action="context-inject"', '上下文注入', 'pm-scene-post-more', 'data-action="post-actions"',
  'aria-label="拍一拍本帖，只生成本帖评论"', "class=\"pm-scene-share ${post.shared ? 'is-shared' : ''}\"", 'aria-pressed="${post.shared}"', "post.shared ? '已分享本帖' : '分享本帖'", "renderPostMetric(SHARE_ICON_SVG, shares, '转发', 'is-share')",
  'pm-scene-reply-toggle', 'data-action="toggle-reply"', 'aria-controls="pm-comment-composer-${escapeAttr(post.id)}"', 'aria-expanded="false"',
  "renderPostMetric(REPLY_ICON_SVG, post.comments.length, '回复', 'is-reply')", 'class="pm-scene-comment-content"', 'class="pm-scene-comment-composer" hidden', 'placeholder="发表你的想法吧"',
  'class="pm-control-menu pm-scene-menu" role="menu" aria-label="社区工具" hidden',
  'class="pm-scene-comment-actions" hidden', 'data-action="edit-comment"', 'aria-label="编辑评论"', 'data-action="delete-comment"', 'aria-label="删除评论"',
  'pm-scene-accent-options', 'data-action="scene-accent"', 'data-action="scene-accent-custom"', 'aria-pressed="${preset.accent === selectedAccent}"',
  'placeholder="分享此刻……"',
  "const liveState = ['idle', 'starting', 'active', 'error'].includes(state.liveState) ? state.liveState : 'idle'", 'const warmupStarted = liveState === \'active\' && scene.live.warmupStarted === true',
  'data-action="start-warmup"', '${PLAY_ICON_SVG}', 'aria-label="发送弹幕"', '设置社区内容的表达风格与氛围。',
  "isSubpage || tab === 'context-inject' ? ''", 'pm-live-stage', 'pm-live-details', 'data-live-state=', 'pm-danmaku-float',
  'data-action="toggle-danmaku-actions"', 'aria-pressed="false"', 'aria-label="修改弹幕"', '修改弹幕', 'data-action="edit-danmaku"', 'data-action="delete-danmaku"', 'placeholder="发个弹幕见证当下"',
]) requireText('interactive-scene-views.js', interactiveViewsCode, expected);
for (const expected of ['.pm-live-room{display:flex;flex-direction:column;gap:var(--pm-space-5)}', '.pm-live-play-btn{width:48px', '.pm-live-details{display:flex;flex-direction:column;gap:var(--pm-space-3)}', '.pm-danmaku-list{height:210px;overflow-y:auto;background:transparent;border:0', '.pm-danmaku-row{--pm-scene-danmaku-row-blue:#1769aa;--pm-scene-danmaku-row-pink:#a6265e;--pm-scene-danmaku-row-cyan:#0b6b6b;--pm-scene-danmaku-row-gold:#8a5a00;padding:var(--pm-space-3) var(--pm-space-1-5);border-bottom:1px solid var(--pm-color-border-subtle);font-size:11px;line-height:var(--pm-line-height-body)}', '.pm-danmaku-row .pm-scene-comment-actions[hidden]{display:none}']) {
  requireText('style.css', css, expected);
}
for (const forbidden of ['data-action="back"', 'pm-scene-back']) {
  if (interactiveViewsCode.includes(forbidden)) failures.push(`interactive-scene-views.js: removed community back control remains: ${forbidden}`);
}
for (const forbidden of ['.pm-scene-title-tab:first-child{flex:', '.pm-scene-title-tab.is-active::after{']) {
  if (css.includes(forbidden)) failures.push(`style.css: stretched community title underline remains: ${forbidden}`);
}
if (!/renderPostTime\(post\.createdAt,\s*now\)/.test(interactiveViewsCode)) failures.push('interactive-scene-views.js: post time must be rendered from post.createdAt');
if (!/<time class="pm-scene-post-time" datetime=/.test(interactiveViewsCode)) failures.push('interactive-scene-views.js: post time must expose a semantic time datetime attribute');
if (!/datetime="\$\{escapeAttr\(time\.datetime\)\}" title="\$\{escapeAttr\(time\.title\)\}"/.test(interactiveViewsCode)) failures.push('interactive-scene-views.js: valid post time must expose escaped datetime and title attributes');
if (/<(?:span|time) class="pm-scene-post-time"[^>]*>刚刚<\/(?:span|time)>/.test(interactiveViewsCode)) {
  failures.push('interactive-scene-views.js: post time must not be hardcoded as 刚刚');
}
if (interactiveViewsCode.includes('刚刚 · ${escapeHtml(scene.title)}')) failures.push('interactive-scene-views.js: post metadata must not repeat the community title');
if (interactiveViewsCode.includes('pm-scene-tabs')) failures.push('interactive-scene-views.js: obsolete wide community tab capsule remains');
for (const forbidden of ['生成更多评论', '>喜欢</button>', '>已喜欢</button>']) {
  if (interactiveViewsCode.includes(forbidden)) failures.push(`interactive-scene-views.js: obsolete community post action remains: ${forbidden}`);
}
for (const expected of [
  'persistSceneBudgetRemoval', 'deleteSceneAndFinalize', 'finalizeDeletedScene', 'bindPhonePageActions', 'runDeleteSceneAction', 'toggleSceneMenu', 'selectScenePreset', 'toggleSceneReplyComposer',
  'deleteScene: deleteInteractiveScene', 'persistSceneBudgetRemoval({',
  "['手机页面状态保存失败', persistPhoneUi]", "['运行时场景清理失败', clearOpenScene]",
  "['社区页面刷新失败', renderLauncher]", "dataset.sceneUiBound === 'true'", "event.key === 'ArrowLeft'", "event.key === 'Escape'",
  "addEventListener('touchstart'", "addEventListener('touchend'", 'Math.abs(dx) < 48',
  ".pm-scene-post-actions:not([hidden])", 'closePostActions', '[data-action="post-actions"]', 'postFocusTarget', 'menuFocusTarget',
  "closest?.('.pm-scene-post')?.querySelectorAll?.('.pm-scene-comment-actions')", 'commentActions.hidden = !opening',
  "app.querySelectorAll?.('.pm-scene-comment-composer')", "composers.find(composer => composer.id === targetId)", '[data-action="toggle-reply"]', 'toggleDanmakuActions', "app?.querySelector?.('.pm-danmaku-list')", "button.querySelector?.('span')?.replaceChildren?.(label)", "focus?.({ preventScroll: true })",
]) requireText('interactive-scene-phone.js', interactivePhoneCode, expected);
for (const expected of [
  'runDeleteSceneAction(scopeId, sceneId, {', 'clearOpenScene:', 'renderLauncher:',
]) {
  requireText('interactive-scenes.js', interactiveCode, expected);
}
for (const expected of ['handleSceneAccentAction(action, app, button)']) {
  requireText('interactive-scenes.js', interactiveCode, expected);
}
for (const expected of [
  "action === 'desktop-import-community-template'", "action === 'dismiss-community-template'", "action === 'publish-community-template' || action === 'unpublish-community-template'",
  'importCommunityTemplate', 'dismissCommunityTemplate', 'commitWithPhoneUi', 'removeCommunityTemplatesForSourceScene',
]) requireText('interactive-scenes.js', interactiveCode, expected);
for (const expected of [
  'createCommunityTemplateImportAction', 'scope.sceneOrder.length >= sceneLimit',
  '共享社区模板不存在或已取消发布', 'importedTemplateSceneIds',
  'commitWithPhoneUi(scopeId', 'await openScene(importedSceneId, \'feed\')',
]) requireText('interactive-scene-template-import.js', sourceModuleByName.get('interactive-scene-template-import.js')?.code || '', expected);
for (const expected of [
  'INTERACTIVE_LIMITS.scenes', 'createCommunityTemplateImportAction',
]) requireText('interactive-scenes.js', interactiveCode, expected);
for (const expected of [
  'COMMUNITY_TEMPLATE_ICON_SVG', 'pm-desktop-template', 'desktop-import-community-template',
  'dismiss-community-template', 'publish-community-template', 'unpublish-community-template', 'style="--scene-accent:${escapeAttr(sceneAccent(template))}"',
  'style="--scene-accent:${escapeAttr(accent)}"', '<b>${escapeHtml(template.title)}</b></button><button type="button" data-action="dismiss-community-template"',
]) requireText('interactive-scene-views.js', interactiveViewsCode, expected);
for (const forbidden of ['pm-desktop-template-icon', '<small>导入社区模板</small>']) {
  if (interactiveViewsCode.includes(forbidden)) failures.push(`interactive-scene-views.js: cross-window desktop pin still has divergent template markup: ${forbidden}`);
}
if (!css.includes('.pm-desktop-pin>button[data-action="unpin-scene"]')) failures.push('style.css: desktop pin remove styling must target the unpin action instead of button position');
if (!css.includes('.pm-desktop-pin>button[data-action="dismiss-community-template"]')) failures.push('style.css: cross-window template remove styling must target the dismiss action');
if (css.includes('.pm-desktop-pin>button:last-child')) failures.push('style.css: positional desktop pin remove selector still affects single-button cross-window templates');
for (const expected of [
  'export const COMMUNITY_TEMPLATE_ICON_SVG',
]) requireText('icons.js', sourceModuleByName.get('icons.js')?.code || '', expected);
for (const expected of [
  'publishCommunityTemplate', 'unpublishCommunityTemplate', 'dismissCommunityTemplate', 'removeCommunityTemplatesForSourceScene',
  'createSceneFromCommunityTemplate', 'importedTemplateSceneIds', 'dismissedCommunityTemplateIds', 'sharedCommunityTemplates',
]) requireText('interactive-scene-model.js', sourceModuleByName.get('interactive-scene-model.js')?.code || '', expected);
for (const expected of ['mergePhoneUiBranchScope', 'commitPhoneUiScopeCoordinated', 'sharedCommunityTemplates']) {
  requireText('branch-scope-inheritance.js', sourceModuleByName.get('branch-scope-inheritance.js')?.code || '', expected);
}
for (const forbidden of ['toggle-community-template', 'toggle-scene-share', 'desktop-open-shared-scene', 'SHARE_WINDOW_ICON_SVG']) {
  if (source.includes(forbidden)) failures.push(`src: removed cross-window community identifier remains: ${forbidden}`);
  if (bundle.includes(forbidden)) failures.push(`index.js: removed cross-window community identifier remains: ${forbidden}`);
}
for (const expected of [
  "isCurrent: () => isTargetActive(target) && phoneScope(target.storageId).lastTab === 'live'",
  "isTargetActive(target) && phoneScope(target.storageId).lastTab === 'live'",
]) requireText('interactive-scenes.js', interactiveCode, expected);
for (const expected of [
  'createCommunityTaskController', 'createCommunityGenerationRunner', "request('feed_batch', {}, target)", "request('danmaku_batch', {}, target)",
  'createCommunityTurnSnapshot(chat)', 'registerResolvedHostEvent', 'resolveHostEvent', 'runtime.communityTask', 'resetObservation',
]) requireText('interactive-scene-scheduler.js', interactiveSchedulerCode, expected);
requireText('interactive-scene-scheduler.js', interactiveSchedulerCode, "if (!isCurrent()) throw new Error('生成已取消')");
for (const expected of ['observeCommunityTurn', 'cancelCommunityGeneration', 'poke-scene']) requireText('interactive-scenes.js', interactiveCode, expected);
for (const stateField of [
  'communityGeneration', 'communityTaskPhase', 'communityReminder', 'communityBaselineAssistantCount',
]) {
  for (const module of sourceModules) {
    if (path.basename(module.file) !== 'interactive-scene-scheduler.js' && module.code.includes(stateField)) {
      failures.push(`${path.basename(module.file)}: runtime scheduler field ${stateField} must stay owned by interactive-scene-scheduler.js`);
    }
  }
}
for (const expected of [
  'resolveCommunityMessageEvents(eventTypes)', 'deps.observeCommunityTurn?.(currentContext?.chat || [])',
  "resolveHostEvent(eventTypes, 'MESSAGE_RECEIVED')", "resolveHostEvent(eventTypes, 'CHAT_CHANGED')",
  "registerOnce('resolved:MESSAGE_RECEIVED'", "registerOnce('resolved:CHAT_CHANGED'",
  'runtime.hostEventSource !== context.eventSource', 'runtime.hostEventRegistrations = new Set()',
  'runtime.eventHooked = results.every(Boolean)',
]) requireText('phone-host-events.js', phoneHostEventsCode, expected);
for (const expected of [
  'handleHostChatChanged({', "cancelCommunityGeneration?.('host-chat-changed')", "cancelCalendarTasks?.('host-chat-changed')",
  "cancelTodayTrendInitialization?.('host-chat-changed')", "cancelTodayTrendRuleRegeneration?.('host-chat-changed')",
  "disarmAutoPoke?.('host-chat-changed')", 'endPhone(true)',
]) requireText('phone-foundation.js', foundationCode, expected);
for (const expected of [
  'installPhonePageSuspensionListeners', 'updatePhonePageSuspensionHandler', '__pmPageSuspensionHandler',
  "__pmPageSuspensionHandler?.('beforeunload')", "__pmPageSuspensionHandler?.('document-hidden')",
]) requireText('phone-foundation.js', sourceModuleByName.get('phone-foundation.js')?.code || '', expected);
for (const expected of ['hostEventSource: null', 'hostEventRegistrations: new Set()']) requireText('runtime.js', sourceModuleByName.get('runtime.js')?.code || '', expected);
for (const expected of [
  'installDiagnosticApi(deps)', "globalThis.window?.__pmDiagEnabled !== true", 'window.__pmDiag = freeze({ snapshot, readLineage })',
  'Object.freeze(Array.from(pendingByTarget.keys()))', "reason: 'source-empty'", 'sourcePresence', 'targetPresence', 'force = false',
]) requireText('branch inheritance diagnostics', [
  sourceModuleByName.get('main.js')?.code || '', sourceModuleByName.get('diagnostic.js')?.code || '',
  sourceModuleByName.get('branch-scope-inheritance.js')?.code || '',
].join('\n'), expected);
for (const forbidden of ['messages:', 'swipes:', 'mes:']) {
  if ((sourceModuleByName.get('diagnostic.js')?.code || '').includes(forbidden)) failures.push(`diagnostic.js: diagnostic payload must not expose ${forbidden}`);
}
for (const forbidden of [
  "et.MESSAGE_RECEIVED || 'message_received'", "et.CHAT_CHANGED || 'chat_id_changed'",
  "et.MESSAGE_SENT || 'message_sent'", "et.MESSAGE_EDITED || 'message_edited'",
  "et.MESSAGE_DELETED || 'message_deleted'", "et.MESSAGE_SWIPED || 'message_swiped'",
]) {
  if (foundationCode.includes(forbidden)) failures.push(`phone-foundation.js: community observer must not guess host event ${forbidden}`);
}
for (const expected of [
  "cancelCommunityGeneration?.('phone-closed')",
  "cancelCalendarTasks?.('phone-closed')",
  "destroyTodayTrendPhoneUi?.()",
  "cancelTodayTrendInitialization?.('phone-closed')",
  "cancelTodayTrendRuleRegeneration?.('phone-closed')",
  "cancelTodayTrendGeneration?.('phone-closed', true)",
  'bindTodayTrendPhoneUi?.(state.phoneWindow)', 'data-phone-page="today-trend"',
]) {
  requireText('phone-lifecycle.js', sourceModuleByName.get('phone-lifecycle.js')?.code || '', expected);
}
for (const forbidden of [
  "cancelCommunityGeneration?.('phone-minimized')",
  "cancelCalendarTasks?.('phone-minimized')",
]) if ((sourceModuleByName.get('phone-lifecycle.js')?.code || '').includes(forbidden)) {
  failures.push(`phone-lifecycle.js: minimizing must not cancel active generation: ${forbidden}`);
}
for (const expected of [
  'renderPhoneDesktop', 'desktop-chat', 'desktop-directory', 'desktop-settings', 'desktop-calendar', 'desktop-today-trend', 'desktop-community',
  'desktop-exit', "__pmOpenSettingsTab?.('home')",
  'toggle-scene-pin', 'unpin-scene', 'loadPhoneUiState', 'savePhoneUiState',
  "showPhonePage('community')", 'runDesktopPageTransition', 'showPhoneDesktopPage',
  "showPhonePage('calendar')", 'showPhoneCalendarPage', 'handleCalendarAction',
  'refreshDesktop(scopeId, store)', 'restorePhoneUi', 'persistPhoneUiSnapshot',
]) requireText('interactive-scenes.js', interactiveCode, expected);
for (const expected of [
  'data-action="desktop"', 'data-action="exit"', 'class="pm-scene-card-actions"',
  'data-action="toggle-scene-pin"', 'data-action="delete-scene"', 'pm-desktop-app-icon',
  'class="pm-scene-pin-action"', 'aria-pressed="${pinned}"', 'aria-label="${pinLabel}"', 'aria-label="删除社区"', '${COMMUNITY_ICON_SVG}', '${TRASH_ICON_SVG}',
  'pm-desktop-app-label', 'data-app="chat"', 'data-app="directory"', 'data-app="settings"', 'data-app="calendar"', 'data-app="today-trend"', '${TREND_ICON_SVG}',
]) {
  requireText('interactive-scene-views.js', interactiveViewsCode, expected);
}
for (const forbidden of ['makeOverlay(', 'window.__pmCloseOverlay()']) {
  if (interactiveCode.includes(forbidden) || interactiveViewsCode.includes(forbidden)) failures.push(`phone community modules: must not use overlay path ${forbidden}`);
}
const phoneLifecycleCode = sourceModuleByName.get('phone-lifecycle.js')?.code || '';
for (const expected of [
  'pm-chat-page', 'pm-desktop-page', 'pm-community-page', 'pm-calendar-page',
  'createPhonePageController', 'data-phone-page', '__pmShowPhonePage',
  'POKE_ICON_SVG', 'HOME_ICON_SVG', '__pmReturnToDesktop', 'deps.showPhoneDesktopPage?.()', 'title="返回桌面"',
  "{ preservePage: true }", 'deps.restorePhoneUi?.()', 'deps.persistPhoneUiSnapshot?.()',
]) requireText('phone-lifecycle.js', phoneLifecycleCode, expected);
if (phoneLifecycleCode.includes('onclick="window.__pmShowList()"')) {
  failures.push('phone-lifecycle.js: chat navbar must not retain the contacts shortcut');
}
const conversationCodeForNavigation = sourceModuleByName.get('conversation.js')?.code || '';
for (const expected of ['options = {}', 'options.preservePage !== true', 'deps.showPhoneChatPage?.(id)']) {
  requireText('conversation.js', conversationCodeForNavigation, expected);
}
const conversationNavigationAnalysis = analyze(conversationCodeForNavigation, 'module');
for (const [name, signature] of [
  ['__pmSwitchContact', { async: true, params: ['key', { name: 'options' }] }],
  ['__pmSwitch', { async: false, params: ['name', '_prevSaveKey', '_prevStorageId', { name: 'options' }] }],
]) {
  expectWindowFunctionSignature('conversation.js', conversationNavigationAnalysis, name, signature);
  if ((conversationNavigationAnalysis.windowAssignmentCounts.get(name) || 0) !== 1) {
    failures.push(`conversation.js: window.${name} must be assigned exactly once`);
  }
}
for (const expected of [
  "makeOverlay(`\n<div class=\"pm-modal pm-pending-manager\">",
  'const maxLeft = Math.max(8, phone.clientWidth - menu.offsetWidth - 8)',
  "menu.style.left = `${Math.min(Math.max(8, desiredLeft), maxLeft)}px`",
  "menu.style.bottom = `${Math.max(8, phoneRect.bottom - anchorRect.top + 8)}px`",
  'menu.style.maxHeight = `${availableHeight}px`',
  "items.some(item => item.status === 'submitting')",
  "clear.disabled = count === 0 || hasSubmitting",
  "clear.title = hasSubmitting ? '提交中的暂存不能清空' : '清空当前会话暂存'",
  'Object.assign(deps, { closeControlCenter })',
]) requireText('phone-control-center.js', controlCenterCode, expected);
const forumHandlerAssignments = sourceModules.reduce((count, module) => {
  const analysis = analyze(module.code, 'module');
  return count + (analysis.windowAssignmentCounts.get('__pmOpenForumMode') || 0);
}, 0);
if (forumHandlerAssignments !== 1) failures.push(`source: expected exactly one __pmOpenForumMode assignment, got ${forumHandlerAssignments}`);
const settingsCode = sourceModuleByName.get('settings-ui.js')?.code || '';
const settingsApiControllerCodeForOwners = sourceModuleByName.get('settings-api-controller.js')?.code || '';
const settingsAppearanceControllerCode = sourceModuleByName.get('settings-appearance-controller.js')?.code || '';
const settingsBudgetControllerCodeForOwners = sourceModuleByName.get('settings-budget-controller.js')?.code || '';
const modelPickerCode = sourceModuleByName.get('settings-model-picker.js')?.code || '';
const foundationAnalysis = analyze(foundationCode, 'module');
const settingsAnalysis = analyze(settingsCode, 'module');
const modelPickerAnalysis = analyze(modelPickerCode, 'module');
const makeOverlaySource = analyze(phoneOverlayCode, 'module').functionSource.get('makeOverlay') || '';
const applyThemeSource = analyze(phoneThemeCode, 'module').functionSource.get('applyTheme') || '';
const setDarkModeSource = settingsAnalysis.windowAssignmentSource.get('__pmSetDarkMode') || '';
const showModelPickerSource = settingsAnalysis.windowAssignmentSource.get('__pmShowModelPicker') || '';
const modelPickerImplementation = modelPickerAnalysis.functionSource.get('showModelPicker') || '';

const overlayThemeDirectSyncPattern = /getElementById\(['"]pm-overlay['"]\)[\s\S]*?setAttribute\(['"]data-theme['"]/;
const overlayThemeHelperSyncPattern = /const\s+applyProperties\s*=\s*element\s*=>[\s\S]*?element\.setAttribute\(['"]data-theme['"][\s\S]*?applyProperties\(document\.getElementById\(['"]pm-overlay['"]\)\)/;
if (!/createElement\(['"]div['"]\)/.test(makeOverlaySource)
    || !/\.id\s*=\s*['"]pm-overlay['"]/.test(makeOverlaySource)
    || !/\.dataset\.theme\s*=/.test(makeOverlaySource)) {
  failures.push('phone-overlay.js: makeOverlay must initialize data-theme on the real pm-overlay root');
}
if (!overlayThemeDirectSyncPattern.test(applyThemeSource)
    && !overlayThemeHelperSyncPattern.test(applyThemeSource)) {
  failures.push('phone-theme.js: applyTheme must synchronize data-theme to an existing pm-overlay');
}
for (const expected of [
  "const rightText = theme.customRight || (theme.preset === 'custom' && customAccent) ? contrastText(rightBackground) : preset.rightText",
  "element.style.setProperty('--pm-r-txt', rightText)",
]) requireText('phone-theme.js right bubble foreground', applyThemeSource, expected);
for (const [name, code, cancelMarker, primaryMarker] of [
  ['world', todayTrendWorldViewCode, 'today-trend-cancel-world-editor', '<button type="submit">保存</button>'],
  ['reputation', todayTrendReputationViewCode, '${escapeAttr(cancelAction)}', '<button type="submit">保存</button>'],
  ['faction', todayTrendFactionViewCode, 'today-trend-cancel-editor', '<button type="submit">保存</button>'],
  ['dynamics', todayTrendDynamicsViewCode, 'today-trend-cancel-event-editor', '<button type="submit">${kind ==='],
]) {
  requireText(`today-trend ${name} action pair`, code, 'pm-today-trend-form-actions pm-action-pair');
  const pairStart = code.indexOf('pm-today-trend-form-actions pm-action-pair');
  const cancelIndex = code.indexOf(cancelMarker, pairStart);
  const primaryIndex = code.indexOf(primaryMarker, pairStart);
  if (pairStart < 0 || cancelIndex < pairStart || primaryIndex < cancelIndex) failures.push(`today-trend ${name}: secondary action must precede the primary action inside pm-action-pair`);
}
for (const expected of [
  'pm-today-trend-detail-row', 'pm-today-trend-detail-add', 'pm-today-trend-detail-remove',
  'name="detailLabel"', 'name="detailValue"', 'data-action="today-trend-add-detail"', 'data-action="today-trend-remove-detail"',
]) requireText('today-trend-faction-view.js detail controls', todayTrendFactionViewCode, expected);
for (const expected of [
  'pm-today-trend-detail-row', 'pm-today-trend-detail-remove',
  'name="detailLabel"', 'name="detailValue"', 'data-action="today-trend-remove-detail"',
]) {
  requireText('today-trend-actions.js inserted detail controls', todayTrendActionsCode, expected);
}
for (const forbidden of ['ST_SMS_THEME', 'ST_SMS_DATA_V2', 'PhoneModeDB', 'schemaVersion']) {
  if ([todayTrendWorldViewCode, todayTrendReputationViewCode, todayTrendFactionViewCode, todayTrendDynamicsViewCode, todayTrendActionsCode].some(code => code.includes(forbidden))) {
    failures.push(`today-trend UI modules must not own persistent storage contract: ${forbidden}`);
  }
}
if (!setDarkModeSource.includes('appearanceSettings.setDarkMode(mode)')
    || !settingsAppearanceControllerCode.includes('if (saveTheme()) { applyTheme(); syncControls(); return true; }')) {
  failures.push('settings appearance: __pmSetDarkMode must transparently delegate to appearance persistence and synchronized theme application');
}
if (!applyThemeSource.includes("applyProperties(document.getElementById('pm-model-dropdown'))")) {
  failures.push('phone-theme.js: applyTheme must synchronize data-theme to an existing body-level model dropdown');
}
if (!showModelPickerSource.includes('apiSettings.showModelPicker()')
    || !settingsApiControllerCodeForOwners.includes('showModelPicker: () => showModelPicker(runtime)')) {
  failures.push('settings API: __pmShowModelPicker must transparently delegate to the controller model picker with runtime state');
}
for (const [name, params, callee, controllerCode, method] of [
  ['__pmDeleteProfile', ['idx'], 'apiSettings.deleteProfile', settingsApiControllerCodeForOwners, 'deleteProfile'],
  ['__pmPickProfile', ['idx'], 'apiSettings.pickProfile', settingsApiControllerCodeForOwners, 'pickProfile'],
  ['__pmSetMode', ['value'], 'apiSettings.setMode', settingsApiControllerCodeForOwners, 'setMode'],
  ['__pmSaveConfig', [], 'apiSettings.saveConfig', settingsApiControllerCodeForOwners, 'saveConfig'],
  ['__pmTestApi', ['button'], 'apiSettings.testApi', settingsApiControllerCodeForOwners, 'testApi'],
  ['__pmTestModel', ['button'], 'apiSettings.testModel', settingsApiControllerCodeForOwners, 'testModel'],
  ['__pmShowModelPicker', [], 'apiSettings.showModelPicker', settingsApiControllerCodeForOwners, 'showModelPicker'],
  ['__pmSetDarkMode', ['mode'], 'appearanceSettings.setDarkMode', settingsAppearanceControllerCode, 'setDarkMode'],
  ['__pmSetPreset', ['preset'], 'appearanceSettings.setPreset', settingsAppearanceControllerCode, 'setPreset'],
  ['__pmSetCustomAccent', [], 'appearanceSettings.setCustomAccent', settingsAppearanceControllerCode, 'setCustomAccent'],
  ['__pmSetCustomColor', [], 'appearanceSettings.setCustomColor', settingsAppearanceControllerCode, 'setCustomColor'],
  ['__pmClearCustomColor', [], 'appearanceSettings.clearCustomColor', settingsAppearanceControllerCode, 'clearCustomColor'],
  ['__pmSetBorderColor', [], 'appearanceSettings.setBorderColor', settingsAppearanceControllerCode, 'setBorderColor'],
  ['__pmSetCustomTitle', [], 'appearanceSettings.setCustomTitle', settingsAppearanceControllerCode, 'setCustomTitle'],
  ['__pmUploadBg', ['input', 'scope'], 'appearanceSettings.uploadBackground', settingsAppearanceControllerCode, 'uploadBackground'],
  ['__pmBgUrl', ['scope'], 'appearanceSettings.setBackgroundUrl', settingsAppearanceControllerCode, 'setBackgroundUrl'],
  ['__pmClearBg', ['scope'], 'appearanceSettings.clearBackground', settingsAppearanceControllerCode, 'clearBackground'],
  ['__pmExportData', [], 'backupSettings.exportData', settingsBackupControllerCode, 'exportData'],
  ['__pmImportData', ['input'], 'backupSettings.importData', settingsBackupControllerCode, 'importData'],
  ['__pmClearAllData', [], 'backupSettings.clearAllData', settingsBackupControllerCode, 'clearAllData'],
  ['__pmSaveBudgetConfig', [], 'budgetSettings.save', settingsBudgetControllerCodeForOwners, 'save'],
  ['__pmResetBudgetConfig', [], 'budgetSettings.reset', settingsBudgetControllerCodeForOwners, 'reset'],
  ['__pmToggleWordyLimit', [], 'wordySettings.toggle', settingsWordyControllerCode, 'toggle'],
  ['__pmToggleGalBubble', [], 'galBubbleSettings.toggle', sourceModuleByName.get('settings-gal-bubble-controller.js')?.code || '', 'toggle'],
]) assertSettingsDelegate(settingsAnalysis, name, params, callee, controllerCode, method);
expectWindowFunctionSignature('settings-ui.js', settingsAnalysis, '__pmShowConfig', {
  async: true, params: [{ name: 'page', default: 'home' }],
});
if ((settingsAnalysis.windowAssignmentCounts.get('__pmShowConfig') || 0) !== 1) {
  failures.push('settings-ui.js: window.__pmShowConfig must be assigned exactly once');
}
const openSettingsTabSource = analyze(controlCenterCode, 'module').windowAssignmentSource.get('__pmOpenSettingsTab') || '';
if (openSettingsTabSource !== 'tab => window.__pmShowConfig(tab)') {
  failures.push('phone-control-center.js: __pmOpenSettingsTab must directly proxy __pmShowConfig(tab)');
}
for (const expected of [
  "const interfaceMode = theme.darkMode || 'light'",
  'dropdown.dataset.theme = interfaceMode',
  "dropdown.style.setProperty('--pm-color-accent', customAccent || preset.accent || preset.right)",
  "const uiTokens = interfaceMode === 'dark' ? preset.uiDark || {} : preset.ui || {}",
  'for (const [token, value] of Object.entries(uiTokens)) dropdown.style.setProperty(token, value)',
  '<button type="button" class="pm-model-opt"',
  'aria-pressed="${model === current}"',
  'aria-label="搜索模型"',
  'const closeDropdown = () =>',
  'dropdown.__pmCloseDropdown = closeDropdown',
  "document.removeEventListener('click', closer, true)",
  'if (closed) return',
  'closeDropdown();',
]) requireText('settings-model-picker.js showModelPicker', modelPickerImplementation, expected);
for (const expected of [
  '<button type="button" class="pm-theme-chip',
  'aria-label="使用${escapeAttr(preset.label)}界面主题"',
  'aria-pressed="${theme.preset === name}"',
  "element.setAttribute('aria-pressed', String(active))",
  "window.__pmTheme.preset = 'custom'", 'window.__pmTheme.customAccent = accent',
  "return mutateTheme(() => { window.__pmTheme.darkMode = mode; });",
]) requireText('settings-appearance-controller.js', settingsAppearanceControllerCode, expected);
for (const expected of [
  '#pm-iphone[data-theme="light"],', '#pm-overlay[data-theme="light"],', '#pm-overlay-sub[data-theme="light"],', '.pm-model-dropdown[data-theme="light"] {',
  '#pm-iphone[data-theme="dark"],', '#pm-overlay[data-theme="dark"],', '#pm-overlay-sub[data-theme="dark"],', '.pm-model-dropdown[data-theme="dark"] {',
  '--pm-color-text-primary:', '--pm-color-text-secondary:', '--pm-color-text-tertiary:', '--pm-color-text-placeholder:', '--pm-color-text-disabled:',
  '--pm-color-surface-page:', '--pm-color-surface-card:', '--pm-color-surface-elevated:', '--pm-color-surface-control:', '--pm-color-surface-input:', '--pm-color-surface-inverse:',
  '--pm-color-border-subtle:', '--pm-color-border-default:', '--pm-color-border-strong:', '--pm-color-control-off:',
  '--pm-color-accent:', '--pm-color-focus-ring:', '--pm-color-success:', '--pm-color-warning:', '--pm-color-danger:', '--pm-color-on-success:', '--pm-color-on-warning:', '--pm-color-on-danger:', '--pm-color-overlay:', '--pm-color-on-dark:', '--pm-color-on-light:',
  '.pm-settings-home button{min-height:var(--pm-size-control-default);border:1px solid var(--pm-color-border-default);border-radius:var(--pm-radius-card);background:var(--pm-color-surface-card);color:var(--pm-color-text-primary)',
  '.pm-global-setting{border:1px solid var(--pm-color-border-default);border-radius:14px;background:var(--pm-color-surface-card);color:var(--pm-color-text-primary)',
  '.pm-settings-home-hint{font-size:11px;line-height:var(--pm-line-height-body);color:var(--pm-color-text-tertiary)}',
  '.pm-settings-home button .pm-settings-home-hint{font-size:11px;line-height:var(--pm-line-height-body);color:var(--pm-color-text-tertiary)}',
  '.pm-scene-header{display:grid;grid-template-columns:var(--pm-size-control-default) 1fr var(--pm-size-control-default);align-items:center;padding:var(--pm-space-3) var(--pm-space-px-10);background:var(--pm-color-surface-card);border-bottom:0}',
  '.pm-scene-comments{margin-top:var(--pm-space-px-9);background:var(--pm-color-surface-elevated)',
  '.pm-scene-comment-composer input{flex:1;min-width:0;border:1px solid var(--pm-color-border-default);border-radius:10px;padding:var(--pm-space-2);background:var(--pm-color-surface-input);color:var(--pm-color-text-primary)}',
  '.pm-theme-chip:focus-visible{outline:2px solid var(--pm-color-focus-ring);outline-offset:2px;}',
  '#pm-model-arrow:focus-visible{outline:2px solid var(--pm-color-focus-ring);outline-offset:2px;}',
  '.pm-model-opt:focus-visible{position:relative;z-index:var(--pm-z-content);outline:2px solid var(--pm-color-focus-ring);outline-offset:-2px;}',
  '.pm-model-dropdown{position:fixed;z-index:var(--pm-z-host);background:var(--pm-color-surface-elevated) !important;border:1px solid var(--pm-color-border-default) !important;',
  '.pm-model-search{border:none !important;border-bottom:1px solid var(--pm-color-border-subtle) !important;',
  ':is(#pm-iphone,#pm-overlay,#pm-overlay-sub,#pm-model-dropdown) :where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="image"]),textarea,select,[contenteditable="true"]){min-width:0;max-width:100%;border:1px solid var(--pm-color-border-default) !important;',
  ':is(#pm-iphone,#pm-overlay,#pm-overlay-sub,#pm-model-dropdown) :where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="image"]),textarea,select,[contenteditable="true"]):focus{border-color:var(--pm-color-accent) !important;outline:var(--pm-space-0-5) solid var(--pm-color-accent) !important;outline-offset:var(--pm-space-px-1) !important;box-shadow:none !important;}',
  ':is(#pm-iphone,#pm-overlay,#pm-overlay-sub,#pm-model-dropdown) :where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="image"]),textarea,select,[contenteditable="true"]):focus-visible{border-color:var(--pm-color-accent) !important;outline:var(--pm-space-0-5) solid var(--pm-color-accent) !important;outline-offset:var(--pm-space-px-1) !important;box-shadow:none !important;}',
  ':is(#pm-iphone,#pm-overlay,#pm-overlay-sub,#pm-model-dropdown) :where(.pm-input,.pm-scene-composer textarea){border:0 !important;}',
  ':is(#pm-iphone,#pm-overlay,#pm-overlay-sub,#pm-model-dropdown) .pm-model-search{border:0 !important;border-bottom:1px solid var(--pm-color-border-subtle) !important;border-radius:0;}',
  ':is(#pm-iphone,#pm-overlay,#pm-overlay-sub,#pm-model-dropdown) :where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="image"]),textarea,select,[contenteditable="true"]):disabled{opacity:var(--pm-opacity-disabled) !important;cursor:not-allowed;}',
  ':-webkit-autofill{box-shadow:0 0 0 1000px var(--pm-color-surface-input) inset !important;',
  '#pm-iphone :is(.pm-scene-label textarea,.pm-scene-prompt :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="image"]),textarea),.pm-scene-composer textarea,.pm-calendar-management :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="image"]),textarea,select),.pm-calendar-entry-dialog :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="image"]),textarea,select),.pm-recipe-meal-dialog :is(textarea,select),.pm-scene-comment-composer input),:is(#pm-overlay,#pm-overlay-sub) .pm-cfg-input{box-sizing:border-box !important;border:1px solid var(--pm-color-border-default) !important;border-radius:10px !important;background-color:var(--pm-color-surface-input) !important;',
  '#pm-iphone .pm-scene-composer textarea{padding:var(--pm-space-2) var(--pm-space-px-14) !important;resize:none !important;}',
  '#pm-iphone .pm-calendar-generation-rule{padding:var(--pm-space-2) var(--pm-space-px-10) !important;resize:vertical !important;}',
  '#pm-iphone .pm-calendar-management :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="image"]),select){padding:var(--pm-space-2) !important;}',
  '--pm-space-1:4px;', '--pm-space-2:8px;', '--pm-space-3:12px;', '--pm-space-4:16px;', '--pm-size-control-default:44px;',
  '.pm-settings-section{display:flex;flex-direction:column;gap:var(--pm-space-2);padding:var(--pm-space-3) var(--pm-space-4);}',
  '.pm-settings-field{display:flex;flex-direction:column;gap:var(--pm-space-1);min-width:0;}',
  '.pm-cfg-input{box-sizing:border-box;width:100%;min-height:var(--pm-size-control-default);',
  'padding:var(--pm-space-0) var(--pm-space-3) !important;font-size:var(--pm-font-size-body) !important;',
  '.pm-action-button{min-height:var(--pm-size-control-default);',
  '.pm-contact-add-primary,.pm-contact-add-ai{border:0;border-radius:10px;background:var(--pm-color-accent);color:var(--pm-color-on-accent);min-height:var(--pm-size-control-default);',
  '.pm-cfg-label.pm-ambient-setting,.pm-cfg-label.pm-check-setting{flex-direction:row;gap:var(--pm-space-3);}',
  '.pm-contact-settings-save{flex:0 1 210px;min-height:var(--pm-size-control-default);',
  '.pm-calendar-entry-dialog form{padding:var(--pm-space-3) var(--pm-space-4) var(--pm-space-4);display:flex;flex-direction:column;gap:var(--pm-space-2)}',
  '#pm-overlay .pm-calendar-entry-dialog textarea[name="note"]{box-sizing:border-box!important;width:100%!important;min-height:72px!important;border:1px solid var(--pm-color-border-default)!important;border-radius:var(--pm-radius-control)!important;background:var(--pm-color-surface-control)!important;',
  '.pm-calendar-entry-actions button{min-height:var(--pm-size-control-default);border:0',
  '.pm-emoji-action{border:1px solid var(--pm-color-accent);border-radius:var(--pm-radius-control);background:color-mix(in srgb,var(--pm-color-accent) 10%,var(--pm-color-surface-elevated));color:var(--pm-color-accent);',
  '.pm-emoji-action:focus-visible,.pm-emoji-upload:focus-visible,.pm-emoji-image-delete:focus-visible{outline:2px solid var(--pm-color-focus-ring);outline-offset:2px;}',
  '.pm-model-opt{display:block;width:100%;padding:var(--pm-space-2) var(--pm-space-3);font:inherit;font-size:13px;text-align:left;background:var(--pm-color-surface-elevated);color:var(--pm-color-text-primary);',
  '.pm-model-empty{padding:var(--pm-space-4);text-align:center;font-size:var(--pm-font-size-label);color:var(--pm-color-text-tertiary);}',
]) requireText('style.css', css, expected);
for (const forbidden of [
  '#pm-overlay[data-theme="dark"] .pm-settings-home button',
  '.pm-model-dropdown[data-theme="dark"] .pm-model-search',
  '#pm-iphone[data-theme="dark"] .pm-scene-comment-composer input',
  ':where(#pm-iphone,#pm-overlay,#pm-overlay-sub,.pm-model-dropdown)',
  ':where(#pm-iphone,#pm-overlay,#pm-overlay-sub,#pm-model-dropdown)',
]) if (css.includes(forbidden)) failures.push(`style.css: obsolete dark-mode component override remains: ${forbidden}`);
if (css.includes('pm-forum-entry')) failures.push('style.css: removed directory community entry styles must not remain');
requireText('style.css', css, 'top:calc(18px + var(--lane)*31px + var(--offset))');
if (css.includes('translateY(var(--offset))')) failures.push('style.css: danmaku offset must not be applied twice');
requireText('style.css', css, '.pm-control-menu{position:absolute;left:var(--pm-space-3);');
requireText('style.css', css, '.pm-pending-manager{min-height:180px;}');
for (const expected of [
  '.pm-calendar-shell[data-calendar-view-mode="weather"] .pm-calendar-header-action.is-loading svg{animation:pm-spin var(--pm-motion-normal) var(--pm-motion-ease) infinite}',
  '.pm-calendar-shell[data-calendar-view-mode="schedule"] .pm-calendar-header-action.is-loading svg,.pm-calendar-shell[data-calendar-view-mode="recipe"] .pm-calendar-header-action.is-loading svg{animation:pm-calendar-sparkle-pulse var(--pm-motion-normal) var(--pm-motion-ease) infinite}',
  '@keyframes pm-calendar-sparkle-pulse{50%{opacity:.45}}',
  '.pm-calendar-cycle-input:checked+.pm-custom-check{background:var(--pm-calendar-accent)}',
  '.pm-calendar-cycle-input:focus-visible+.pm-custom-check{outline:2px solid var(--pm-color-focus-ring);outline-offset:2px}',
  '.pm-scene-topbar{position:relative;display:flex;align-items:center;gap:var(--pm-space-1);padding:var(--pm-space-1-5) var(--pm-space-px-9)}',
  '.pm-scene-home{color:var(--pm-color-text-placeholder) !important',
  '.pm-scene-pin-action{color:var(--pm-color-text-tertiary)}',
  '.pm-scene-pin-action[aria-pressed="true"],.pm-scene-pin-action[aria-pressed="true"]:hover,.pm-scene-pin-action[aria-pressed="true"]:focus-visible{background:transparent;color:var(--scene-accent)}',
  '.pm-scene-title{position:absolute;left:50%;top:6px;bottom:6px;transform:translateX(-50%);display:flex',
  '.pm-scene-title-tab.is-active span{text-decoration-line:underline;text-decoration-color:var(--scene-accent);text-decoration-thickness:2px;text-underline-offset:4px}',
  '.pm-scene-title-poke{position:relative;width:var(--pm-size-control-compact) !important;height:var(--pm-size-control-compact) !important;padding:var(--pm-space-2) !important',
  '.pm-scene-title-poke::before{content:',
  'width:var(--pm-size-icon-lg);height:var(--pm-size-icon-lg);border-radius:50%;background:transparent',
  '@media(max-width:320px){.pm-scene-topbar{padding-inline:var(--pm-space-px-5)}',
  '.pm-scene-view-actions{display:flex;align-items:center;justify-content:flex-end;gap:var(--pm-space-0-5);margin-left:var(--pm-space-auto)',
  '.pm-scene-bottom-bar{position:relative;z-index:var(--pm-z-menu)',
  '.pm-contact-switcher{position:absolute;left:50%;z-index:var(--pm-z-popover);width:min(300px,calc(100% - 20px));max-height:min(304px,calc(100% - 72px));display:flex',
  'transform:translateX(-50%)',
  '.pm-contact-switcher-row{display:grid;grid-template-columns:22px minmax(0,1fr) 40px 40px;align-items:center;column-gap:var(--pm-space-1)',
  '.pm-control-menu.pm-scene-menu{left:0;right:auto;top:auto;bottom:46px;z-index:var(--pm-z-menu);width:148px;max-height:none;overflow-y:visible',
  '.pm-control-menu.pm-scene-menu[hidden]{display:none}',
  '.pm-scene-composer textarea{height:var(--pm-size-control-compact);min-height:var(--pm-size-control-compact);max-height:88px;box-shadow:none !important;appearance:none}',
  '.pm-scene-title-poke:active{background:transparent !important;color:var(--pm-color-on-dark) !important;transition-duration:var(--pm-motion-fast)}',
  '.pm-scene-title-poke:active::before{background:var(--scene-accent);transition-duration:var(--pm-motion-fast)}',
  '.pm-scene-bottom-bar .pm-scene-more:hover,.pm-scene-bottom-bar .pm-scene-more:focus-visible,.pm-scene-bottom-bar .pm-scene-more[aria-expanded="true"]{background:transparent;outline:none;color:var(--pm-color-text-secondary)}',
  '.pm-scene-share.is-shared .pm-scene-post-metric,.pm-scene-share:active .pm-scene-post-metric{color:var(--pm-color-success)}',
  '.pm-scene-share.is-shared svg circle{fill:currentColor}',
  '.pm-scene-reply-toggle[aria-expanded="true"] .pm-scene-post-metric{color:var(--scene-accent)}',
  '.pm-scene-post-more:focus-visible{background:color-mix(in srgb,var(--pm-color-text-secondary) 10%,transparent);outline:2px solid var(--pm-color-text-secondary);outline-offset:2px}',
  '.pm-scene-post-actions-wrap{position:relative;display:flex;flex-direction:row-reverse',
  '.pm-scene-post-actions{display:flex;align-items:center;gap:var(--pm-space-0-5);margin-right:var(--pm-space-1)}',
  '.pm-scene-post-actions[hidden]{display:none}',
  '.pm-scene-post-author{min-width:0;flex:1;gap:var(--pm-space-0-5);padding-top:var(--pm-space-px-1)}',
  '.pm-scene-post footer{align-items:center;justify-content:center;gap:0;flex-wrap:nowrap}',
  '.pm-scene-post footer>*{flex:1 1 0;min-width:0;justify-content:center}',
  '.pm-scene-shell{--pm-scene-hero-title-size:25px;--pm-scene-topbar-height:38px;--pm-scene-body-letter-spacing:.01em;--pm-scene-post-body-font-size:var(--pm-font-size-compact);--pm-scene-post-body-letter-spacing:.03em;--pm-scene-comment-font-size:var(--pm-font-size-label);--pm-scene-comment-letter-spacing:.02em',
  '.pm-scene-post p{font-size:var(--pm-scene-post-body-font-size);font-weight:var(--pm-font-weight-medium);line-height:var(--pm-line-height-loose);letter-spacing:var(--pm-scene-post-body-letter-spacing)',
  '.pm-scene-comment>span:first-child{flex:1;min-width:0;word-break:break-word}',
  '.pm-scene-comment-content{letter-spacing:var(--pm-scene-comment-letter-spacing)}',
  '.pm-scene-comment-actions[hidden]{display:none}',
  '.pm-scene-comment-actions button{width:22px;height:22px;padding:var(--pm-space-1);display:grid;place-items:center;border-radius:50%}',
  '.pm-scene-comment-actions button svg{width:var(--pm-size-icon-sm);height:var(--pm-size-icon-sm)}',
  '.pm-scene-post-actions button:focus-visible{background:color-mix(in srgb,var(--pm-color-text-secondary) 10%,transparent);outline:2px solid var(--pm-color-text-secondary);outline-offset:2px}',
  '.pm-scene-like.is-liked svg{fill:currentColor}',
  '.pm-scene-composer .pm-scene-primary svg{width:var(--pm-size-icon-md);height:var(--pm-size-icon-md)}',
  '.pm-scene-title-poke svg,.pm-scene-exit svg{width:var(--pm-size-icon-md);height:var(--pm-size-icon-md)}',
  '.pm-reply-card{box-sizing:border-box;width:100%',
  '.pm-quote-preview{display:flex;align-items:center',
  '.pm-quote-target{animation:pm-quote-highlight',
  '@media(pointer:coarse){.pm-quote-action{min-width:42px;min-height:42px',
  '@media(prefers-reduced-motion:reduce){.pm-quote-target{animation:none',
  '@media(prefers-reduced-motion:reduce){.pm-quote-target{animation:none;outline:3px solid color-mix(in srgb,var(--pm-color-accent) 45%,transparent);outline-offset:0}.pm-quote-action{transition:none}.pm-bubble{animation:none}}',
  '@media(prefers-reduced-motion:reduce){.pm-name-trigger{transition:none}}',
  '@media(prefers-reduced-motion:reduce){.pm-typing-bubble span{animation:none}.pm-voice-wave i{animation:none}}',
  '@media(prefers-reduced-motion:reduce){.pm-director{animation:none}.pm-voice-card{transition:none}.pm-contact-switcher-icon{transition:none}}',
  '.pm-calendar-view-switch{display:flex;align-items:center;justify-content:space-between;gap:var(--pm-space-1-5);width:auto;margin:var(--pm-space-0) var(--pm-space-3) var(--pm-space-px-5)',
  '.pm-calendar-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--pm-space-2);padding:var(--pm-space-3) var(--pm-space-3)}',
  '.pm-calendar-header .pm-calendar-header-action{width:28px;height:28px;padding:var(--pm-space-1-5);background:transparent}',
  '.pm-calendar-header button[data-action="calendar-home"]{color:var(--pm-color-text-placeholder)',
  '.pm-calendar-header-action svg{width:15px;height:15px}',
  '.pm-calendar-title-row{display:flex;align-items:center;justify-content:center;min-width:0',
  '.pm-calendar-title-control{position:relative;display:flex;min-width:0;justify-content:center}',
  '.pm-calendar-title-chevron{position:absolute;left:100%;top:50%',
  '.pm-calendar-month-panel{margin:var(--pm-space-0) var(--pm-space-3) var(--pm-space-px-10);padding:var(--pm-space-3);border:1px solid var(--pm-color-border-subtle);border-radius:14px',
  '.pm-calendar-panel-section{display:flex;flex-direction:column;gap:var(--pm-space-1-5);padding:var(--pm-space-2) var(--pm-space-0)}',
  '.pm-calendar-month-panel-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--pm-space-2);padding-top:var(--pm-space-2)}',
  '.pm-calendar-shell>*{flex:0 0 auto}',
  '.pm-calendar-selected-detail.is-status-card{overflow:hidden;padding:var(--pm-space-0);background:color-mix(in srgb,var(--pm-calendar-accent) 8%,var(--pm-color-surface-card))}',
  '.pm-calendar-status-card{--pm-calendar-status-value-size:28px;--pm-calendar-status-value-offset:9.35px;position:relative;isolation:isolate;min-height:126px;padding:var(--pm-space-3) var(--pm-space-px-14);overflow:hidden}',
  '.pm-calendar-status-content{position:relative;z-index:var(--pm-z-content);display:flex;min-width:0;min-height:96px;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:var(--pm-space-1-5)}',
  '.pm-calendar-status-heading{display:flex;align-items:baseline;gap:var(--pm-space-2);min-width:0}',
  '.pm-calendar-status-relative{color:var(--pm-calendar-accent);font-size:17px;line-height:var(--pm-line-height-tight);font-weight:var(--pm-font-weight-semibold);white-space:nowrap}',
  '.pm-calendar-status-context{display:flex;align-items:center;gap:var(--pm-space-1);width:100%;min-width:0;margin-top:var(--pm-space-auto)}',
  '.pm-calendar-status-weather-context,.pm-calendar-status-cycle-context{color:var(--pm-color-text-secondary);font-size:13px;font-weight:500;line-height:var(--pm-line-height-tight);opacity:.86}',
  '.pm-calendar-status-context .pm-calendar-status-weather-context{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.pm-calendar-status-location{display:inline-grid;place-items:center;flex:0 0 auto;color:var(--pm-color-text-tertiary);opacity:.86}.pm-calendar-status-location svg{width:13px;height:13px}',
  '.pm-calendar-status-card-weather .pm-calendar-status-value,.pm-calendar-status-card-cycle .pm-calendar-status-value{color:color-mix(in srgb,var(--pm-calendar-accent) 82%,var(--pm-color-on-light));font-weight:600;letter-spacing:.01em}',
  '.pm-calendar-status-date time{color:var(--pm-color-text-primary);font-weight:var(--pm-font-weight-semibold)}',
  '.pm-calendar-status-date em{color:var(--pm-color-text-tertiary);font-style:normal;font-weight:500}',
  '.pm-calendar-status-watermark{position:absolute;z-index:var(--pm-z-base);top:50%;right:-64px;width:202px;height:173px',
  '.pm-calendar-status-watermark svg{width:173px;height:173px;stroke-width:1.55}',
  '.pm-calendar-status-card-cycle[data-cycle-phase="period"] .pm-calendar-status-watermark{top:50%;right:-72px;left:auto;width:190px;height:150px;opacity:.18;transform:translateY(-50%)',
  '.pm-calendar-status-card-cycle[data-cycle-phase="period"] .pm-calendar-status-watermark{top:50%;right:-72px;left:auto;width:190px;height:150px;opacity:.18;transform:translateY(-50%);-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 44%);mask-image:linear-gradient(90deg,transparent 0%,#000 44%)}',
  '-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 44%)',
  '.pm-calendar-shell[data-calendar-view-mode="recipe"]{--pm-calendar-accent:#C77A32}',
  '.pm-calendar-shell[data-calendar-view-mode="outfit"]{--pm-calendar-accent:#7563C6}',
  '#pm-iphone[data-theme="dark"] .pm-calendar-shell[data-calendar-view-mode="outfit"]{--pm-calendar-accent:#B8A8FF}',
  '.pm-calendar-day.has-recipe>span,.pm-calendar-day.has-outfit>span{color:var(--pm-calendar-accent)}',
  '.pm-calendar-event.is-recipe b,.pm-calendar-event.is-outfit b{color:var(--pm-calendar-accent)}',
  '.pm-navbar{position:relative;display:grid !important;grid-template-columns:var(--pm-size-control-compact) minmax(0,1fr) var(--pm-size-control-compact)',
  '.pm-name-wrap{position:relative !important;display:flex;align-items:center;justify-content:center',
  '.pm-calendar-status.is-generating{color:var(--pm-color-danger)}',
  '.pm-calendar-date-tags-row{grid-template-columns:minmax(0,1fr) auto}',
  '.pm-calendar-detail-date{display:flex!important;flex-direction:row!important;align-items:baseline',
  '.pm-calendar-detail-date>strong{color:var(--pm-calendar-accent);font-size:17px;line-height:var(--pm-line-height-tight);font-weight:var(--pm-font-weight-semibold)',
  '.pm-calendar-detail-date>span{display:flex;align-items:baseline;gap:0;min-width:0}',
  '.pm-calendar-detail-date time{color:var(--pm-color-text-primary);font-weight:var(--pm-font-weight-semibold)}',
  '.pm-calendar-detail-date em{color:var(--pm-color-text-tertiary);font-style:normal;font-weight:500}',
  '.pm-calendar-detail-actions{position:absolute;top:var(--pm-space-2);right:var(--pm-space-px-10)',
  '.pm-calendar-detail-more{display:grid;place-items:center;width:28px;height:28px;padding:var(--pm-space-1-5);border:0',
  '.pm-calendar-inline-actions button{display:grid;place-items:center;width:28px;height:28px;padding:var(--pm-space-1-5);border:0;border-radius:0;background:transparent',
  '.pm-calendar-detail-edit-actions{display:flex;align-items:center;justify-content:center;gap:var(--pm-space-2);margin-top:var(--pm-space-2);flex-wrap:wrap}',
  '.pm-calendar-inline-add,.pm-calendar-inline-regenerate{display:inline-flex;align-items:center;justify-content:center;gap:var(--pm-space-1-5);width:max-content;margin:var(--pm-space-0);padding:var(--pm-space-2) var(--pm-space-3);border:1px solid color-mix(in srgb,var(--pm-calendar-accent) 35%,transparent);border-radius:9px',
  '.pm-calendar-management:is([data-calendar-management="schedule"],[data-calendar-management="recipe"],[data-calendar-management="cycle"],[data-calendar-management="outfit"]) .pm-calendar-editor-actions .is-primary{background:var(--pm-calendar-accent)!important;border-color:var(--pm-calendar-accent)!important',
  '.pm-calendar-editor-actions .is-primary{background:var(--pm-calendar-accent, var(--pm-color-accent))!important;color:var(--pm-color-on-dark)!important;border-color:var(--pm-calendar-accent, var(--pm-color-accent))!important',
  '.pm-calendar-management .pm-calendar-data-tools h3{font-size:12px}',
  '.pm-calendar-injection-card .pm-calendar-auto-switch{padding:var(--pm-space-0-5) var(--pm-space-0)}',
  '#pm-iphone[data-theme="dark"] .pm-calendar-management[data-calendar-management="schedule"] .pm-calendar-scan-card .pm-calendar-auto-switch small,#pm-iphone[data-theme="dark"] .pm-calendar-management[data-calendar-management="weather"] .pm-calendar-attribution,#pm-iphone[data-theme="dark"] .pm-calendar-management[data-calendar-management="cycle"] .pm-calendar-cycle-editor small,#pm-iphone[data-theme="dark"] .pm-calendar-management[data-calendar-management="recipe"] .pm-calendar-attribution{color:var(--pm-color-text-secondary)}',
  '.pm-calendar-data-row select,.pm-calendar-data-row input,.pm-calendar-data-row button,.pm-calendar-database-card>button',
  '.pm-calendar-auto-switch{display:flex;align-items:center;justify-content:space-between',
  '.pm-calendar-entry-dialog [data-calendar-occasion-fields][hidden]{display:none!important}',
  '.pm-calendar-entry-dialog{width:min(330px,calc(100vw - 28px))}',
  '#pm-overlay .pm-calendar-entry-dialog textarea[name="note"]{box-sizing:border-box!important;width:100%!important;min-height:72px!important;border:1px solid var(--pm-color-border-default)!important;border-radius:var(--pm-radius-control)!important;background:var(--pm-color-surface-control)!important;color:var(--pm-color-text-primary)!important;font:var(--pm-font-weight-regular) var(--pm-font-size-body)/var(--pm-line-height-body) var(--pm-font-family-system)',
  '#pm-overlay .pm-calendar-entry-dialog textarea[name="note"]:focus-visible{border-color:var(--pm-color-accent)!important;outline:var(--pm-space-0-5) solid var(--pm-color-accent)!important;outline-offset:var(--pm-space-px-1)!important}',
  '.pm-calendar-entry-actions button{min-height:var(--pm-size-control-default);border:0',
  '.pm-calendar-view-switch button[aria-pressed="true"]{background:transparent;color:var(--pm-calendar-accent);box-shadow:inset 0 -2px 0 var(--pm-calendar-accent)',
  '@media(prefers-reduced-motion:reduce){.pm-calendar-shell[data-calendar-view-mode] .pm-calendar-header-action.is-loading svg{animation:none}}',
  '.pm-scene-preset>span{box-sizing:border-box;width:12px;height:12px;flex:0 0 12px;border-radius:50%',
  '.pm-scene-prompt .pm-scene-accent-option{box-sizing:border-box;width:30px;height:30px;min-width:30px;min-height:30px;aspect-ratio:1;flex:0 0 30px;padding:var(--pm-space-1) !important',
  '.pm-scene-accent-custom input[type="color"]{box-sizing:border-box;width:32px;height:28px;flex:0 0 32px;padding:var(--pm-space-0);border:1px solid var(--pm-color-border-default);border-radius:6px',
  '.pm-scene-accent-option[aria-pressed="true"]{border-color:var(--scene-accent-option)',
  '.pm-scene-accent-option:focus-visible{outline:2px solid var(--scene-accent-option)',
  '.pm-scene-comment-composer[hidden]{display:none}',
  '.pm-scene-comment-composer input{font-size:14px}',
  '.pm-scene-empty{font-size:12px;line-height:var(--pm-line-height-body)}',
]) requireText('style.css', css, expected);
for (const expected of [
  '--pm-size-icon-sm:14px', '--pm-size-icon-md:18px', '--pm-size-icon-lg:24px', '--pm-z-base:0',
  '.pm-today-trend-page{overflow:hidden;background:var(--pm-color-surface-page)}',
  '.pm-today-trend-header{position:sticky;top:0;z-index:var(--pm-z-base)',
  '.pm-today-trend-header button svg,.pm-today-trend-icon-button svg{width:var(--pm-size-icon-md);height:var(--pm-size-icon-md)',
]) requireText('style.css', css, expected);
if (css.includes('assets/today-trend/world/middle-repeat.svg') || css.includes('pm-today-trend-world-grid')) failures.push('style.css: world card layout must not retain the repeated grid background');
const removedTodayTrendAssetPattern = /assets\/today-trend\/(?:world|reputation|faction|dynamics)\/(?:top|bottom|top-glow|starlight[^/]*)\.svg/g;
const removedTodayTrendAssets = css.match(removedTodayTrendAssetPattern) || [];
if (removedTodayTrendAssets.length) {
  failures.push(`style.css: today-trend must not retain decoration assets: ${[...new Set(removedTodayTrendAssets)].join(', ')}`);
}
if (css.includes('--pm-letter-spacing-wide')) {
  failures.push('style.css: today-trend must not consume an unregistered letter-spacing token');
}
requireCssDeclarations(cssRules, '#pm-iphone', { color: 'var(--pm-color-text-primary) !important' });
requireCssDeclarations(cssRules, '.pm-scene-feed', { background: 'var(--pm-color-surface-card)' });
requireCssDeclarations(cssRules, '.pm-scene-post', {
  background: 'var(--pm-color-surface-page)',
  border: '0',
});
requireCssDeclarations(cssRules, '.pm-scene-post footer', { 'border-top': '1px solid var(--pm-color-border-subtle)' });
requireCssDeclarations(cssRules, '.pm-scene-post p', {
  'font-size': 'var(--pm-scene-post-body-font-size)',
  'font-weight': 'var(--pm-font-weight-medium)',
  'line-height': 'var(--pm-line-height-loose)',
  'letter-spacing': 'var(--pm-scene-post-body-letter-spacing)',
});
requireCssDeclarations(cssRules, '.pm-scene-comment-content', { 'letter-spacing': 'var(--pm-scene-comment-letter-spacing)' });
requireCssDeclarations(cssRules, '.pm-calendar-status-relative', {
  color: 'var(--pm-calendar-accent)', 'font-size': 'var(--pm-font-size-subtitle)', 'line-height': 'var(--pm-line-height-tight)', 'font-weight': 'var(--pm-font-weight-semibold)',
});
requireCssDeclarations(cssRules, '.pm-calendar-status-value', {
  'font-size': 'var(--pm-calendar-status-value-size)', 'line-height': '1', 'font-variant-numeric': 'tabular-nums',
});
requireCssDeclarations(cssRules, '.pm-calendar-status-date', {
  display: 'flex!important', 'align-items': 'baseline', gap: '0', 'min-width': '0',
});
requireCssDeclarations(cssRules, '.pm-calendar-status-context', {
  display: 'flex', 'align-items': 'center', gap: 'var(--pm-space-1)', width: '100%', 'min-width': '0', 'margin-top': 'var(--pm-space-auto)',
});
requireCssDeclarations(cssRules, '.pm-calendar-status-context .pm-calendar-status-weather-context', {
  'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
});
requireCssDeclarations(cssRules, '.pm-calendar-management>summary', {
  display: 'flex', gap: 'var(--pm-space-2)', 'min-height': 'var(--pm-size-control-default)',
});
requireCssDeclarations(cssRules, '.pm-calendar-management-chevron svg', {
  width: 'var(--pm-size-icon-sm)', height: 'var(--pm-size-icon-sm)',
  transition: 'transform var(--pm-motion-normal) var(--pm-motion-ease)',
});
requireCssDeclarations(cssRules, '.pm-calendar-management[open] .pm-calendar-management-chevron svg', {
  transform: 'rotate(180deg)',
});
requireCssDeclarations(cssRules, '.pm-calendar-management-content', {
  display: 'flex', 'flex-direction': 'column', 'padding-top': 'var(--pm-space-2)',
});
for (const selector of ['.pm-calendar-title-chevron svg', '.pm-calendar-management-chevron svg']) {
  const reducedMotionRule = cssRules.find(rule => rule.selectors.includes(selector) && rule.parent.includes('@media (prefers-reduced-motion:reduce)'));
  if (!reducedMotionRule || reducedMotionRule.declarations.get('transition') !== 'none') {
    failures.push(`style.css: ${selector} must disable transition under prefers-reduced-motion`);
  }
}
requireCssDeclarations(cssRules, '.pm-today-trend-content.is-minimal-ui .pm-today-trend-module-head:not(.is-expanded)', {
  'align-items': 'center', 'min-height': 'calc(var(--pm-size-control-default) + var(--pm-space-2))', 'padding-bottom': 'var(--pm-space-3)',
});
for (const selector of ['.pm-today-trend-content.is-world', '.pm-today-trend-content.is-reputation', '.pm-today-trend-content.is-faction', '.pm-today-trend-content.is-dynamics']) {
  requireCssDeclarations(cssRules, selector, { background: 'var(--pm-color-accent)' });
}
requireCssDeclarations(cssRules, '.pm-today-trend-content.is-minimal-ui .pm-today-trend-floor', { gap: 'var(--pm-space-0-5)' });
requireCssDeclarations(cssRules, '.pm-today-trend-header', {
  position: 'sticky', top: '0', display: 'flex', 'justify-content': 'space-between',
});
if (cssRules.some(rule => rule.selectors.includes('.pm-today-trend-header h2'))) {
  failures.push('style.css: today-trend global header must not restore the redundant page title');
}
for (const selector of [
  '.pm-today-trend-content.is-world .pm-today-trend-module-head.is-expanded',
  '.pm-today-trend-content.is-reputation .pm-today-trend-module-head.is-expanded',
  '.pm-today-trend-content.is-faction .pm-today-trend-module-head.is-expanded',
  '.pm-today-trend-content.is-dynamics .pm-today-trend-module-head.is-expanded',
]) requireCssDeclarations(cssRules, selector, {
  position: 'sticky', top: 'var(--pm-space-0)', 'z-index': 'var(--pm-z-content)',
  'flex-direction': 'column', padding: 'var(--pm-space-2) var(--pm-space-4) var(--pm-space-0)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-module-head.is-expanded .pm-today-trend-head-tools', {
  position: 'absolute', top: 'var(--pm-space-2)', right: 'var(--pm-space-4)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-module-head.is-expanded .pm-today-trend-floor', { 'align-items': 'flex-end' });
requireCssDeclarations(cssRules, '.pm-today-trend-module-actions', {
  display: 'flex', 'align-items': 'center', 'justify-content': 'center',
  gap: 'var(--pm-space-2)', transform: 'translateY(50%)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-module-actions .pm-today-trend-icon-button', {
  background: 'var(--pm-color-surface-page)', color: 'var(--pm-color-accent)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-module-actions .pm-today-trend-icon-button:not(.is-danger) svg', {
  color: 'var(--pm-color-accent)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-module-body>.pm-today-trend-world-signals', { display: 'contents' });
const todayTrendModuleHeadAccentRules = cssRules.filter(rule => (
  rule.declarations.has('background')
  && rule.declarations.has('color')
  && rule.declarations.has('border-radius')
));
for (const selector of [
  '.pm-today-trend-world>.pm-today-trend-module-head',
  '.pm-today-trend-reputation>.pm-today-trend-module-head',
  '.pm-today-trend-factions>.pm-today-trend-module-head',
  '.pm-today-trend-dynamics>.pm-today-trend-module-head',
]) requireCssDeclarations(todayTrendModuleHeadAccentRules, selector, {
  color: 'var(--pm-color-on-accent)',
  'border-radius': 'var(--pm-radius-none)',
});
for (const selector of ['.pm-today-trend-world>.pm-today-trend-module-head','.pm-today-trend-reputation>.pm-today-trend-module-head','.pm-today-trend-factions>.pm-today-trend-module-head','.pm-today-trend-dynamics>.pm-today-trend-module-head']) {
  const rule = todayTrendModuleHeadAccentRules.find(r => r.selectors.includes(selector)); if (!rule || !rule.declarations.get('background')?.includes('var(--pm-color-accent)')) failures.push(`style.css: ${selector} background must include var(--pm-color-accent) as base layer`);
}
for (const selector of [
  '.pm-today-trend-world>.pm-today-trend-module-head h2',
  '.pm-today-trend-reputation>.pm-today-trend-module-head h2',
  '.pm-today-trend-factions>.pm-today-trend-module-head h2',
  '.pm-today-trend-dynamics>.pm-today-trend-module-head h2',
]) requireCssDeclarations(cssRules, selector, { color: 'var(--pm-color-on-accent)' });
for (const selector of ['.pm-today-trend-module-head .pm-today-trend-meter', '.pm-today-trend-module-head .pm-today-trend-floor']) {
  requireCssDeclarations(cssRules, selector, { color: 'color-mix(in srgb,var(--pm-color-on-accent) 70%,transparent)' });
}
requireCssDeclarations(cssRules, '.pm-today-trend-module-head :is(.pm-today-trend-meter-v,.pm-today-trend-floor-value)', {
  color: 'var(--pm-color-on-accent)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-module-head .pm-today-trend-icon-button:not(.is-danger) svg', {
  color: 'var(--pm-color-on-accent)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-module-head .pm-today-trend-menu-close', {
  color: 'var(--pm-color-on-accent)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-module-head .pm-today-trend-icon-button:focus-visible', {
  'outline-color': 'var(--pm-color-on-accent)',
});
requireCssDeclarations(cssRules, '.pm-phone-screen:has(.pm-main-ui[data-page="today-trend"])', {
  'border-radius': 'var(--pm-phone-inner-radius)',
  background: 'var(--pm-color-accent)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-module-body', {
  background: 'var(--pm-color-surface-elevated)',
  'border-radius': 'var(--pm-radius-large) var(--pm-radius-large) var(--pm-radius-none) var(--pm-radius-none)',
  padding: 'calc(var(--pm-space-5) + var(--pm-size-control-compact) / 2) var(--pm-space-5) calc(var(--pm-space-5) + var(--pm-space-px-36))',
  display: 'flex',
  'flex-direction': 'column',
});
const todayTrendLayerRootRules = cssRules.filter(rule => (
  rule.declarations.has('gap') && rule.declarations.has('padding')
));
for (const selector of ['.pm-today-trend-world', '.pm-today-trend-reputation', '.pm-today-trend-factions', '.pm-today-trend-dynamics']) {
  requireCssDeclarations(todayTrendLayerRootRules, selector, {
    gap: 'var(--pm-space-0)',
    padding: 'var(--pm-space-0) var(--pm-space-0) var(--pm-space-0)',
  });
}
const todayTrendCompactBodyRule = cssRules.find(rule => (
  /@media\s*\(max-width:320px\)/.test(rule.parent)
  && rule.selectors.includes('.pm-today-trend-module-body')
));
if (todayTrendCompactBodyRule?.declarations.get('padding-inline') !== 'var(--pm-space-3)') {
  failures.push('style.css: 320px today-trend content layer must tighten padding-inline on .pm-today-trend-module-body');
}
for (const rule of cssRules) {
  if (!/@media\s*\(max-width:320px\)/.test(rule.parent)) continue;
  if (!rule.selectors.some(selector => [
    '.pm-today-trend-world', '.pm-today-trend-reputation', '.pm-today-trend-factions', '.pm-today-trend-dynamics', '.pm-today-trend-module-head',
  ].includes(selector))) continue;
  if (['padding-inline', 'padding-left', 'padding-right'].some(property => rule.declarations.has(property))) {
    failures.push(`style.css:${rule.line}: 320px today-trend module roots and heads must keep full-width horizontal boundaries`);
  }
}
const relationNodeTokenRule = cssRules.find(rule => rule.selectors.includes('.pm-today-trend-shell')
  && rule.declarations.get('--pm-today-trend-relation-node-size') === 'var(--pm-space-5)');
if (!relationNodeTokenRule) {
  failures.push('style.css: .pm-today-trend-shell must define --pm-today-trend-relation-node-size with --pm-space-5');
}
const relationStatusTokens = {
  hostile: { surface: '--pm-today-trend-relation-hostile', foreground: '--pm-today-trend-relation-hostile-foreground', expectedSurface: '#e8566c', expectedForeground: '#fff' },
  dislike: { surface: '--pm-today-trend-relation-dislike', foreground: '--pm-today-trend-relation-dislike-foreground', expectedSurface: '#cc7a42', expectedForeground: '#fff' },
  neutral: { surface: '--pm-today-trend-relation-neutral', foreground: '--pm-today-trend-relation-neutral-foreground', expectedSurface: 'var(--pm-color-surface-control)', expectedForeground: 'var(--pm-color-text-primary)' },
  like: { surface: '--pm-today-trend-relation-like', foreground: '--pm-today-trend-relation-like-foreground', expectedSurface: 'var(--pm-color-accent)', expectedForeground: 'var(--pm-color-on-accent)' },
  trust: { surface: '--pm-today-trend-relation-trust', foreground: '--pm-today-trend-relation-trust-foreground', expectedSurface: '#2d9e84', expectedForeground: '#fff' },
};
for (const [status, relation] of Object.entries(relationStatusTokens)) {
  if (normalizeCssValue(relationNodeTokenRule?.declarations.get(relation.surface)) !== relation.expectedSurface) {
    failures.push(`style.css: ${status} relation surface must remain ${relation.expectedSurface}`);
  }
  if (normalizeCssValue(relationNodeTokenRule?.declarations.get(relation.foreground)) !== relation.expectedForeground) {
    failures.push(`style.css: ${status} relation foreground must remain ${relation.expectedForeground}`);
  }
}
requireCssDeclarations(cssRules, '.pm-today-trend-home', { color: 'var(--pm-color-on-accent) !important' });
requireCssDeclarations(cssRules, '.pm-today-trend-tabs button', { color: 'var(--pm-color-text-tertiary)' });
requireCssDeclarations(cssRules, '.pm-today-trend-tabs button[aria-pressed="true"] svg', { color: 'var(--pm-color-accent)' });
for (const rule of cssRules) if (rule.selectors.some(selector => selector.includes('.pm-today-trend-tabs') && selector.includes('svg'))) {
  if (rule.declarations.has('stroke-width')) failures.push(`style.css:${rule.line}: today-trend tabs SVG must inherit the shared icon stroke width`);
  if (rule.declarations.has('transform')) failures.push(`style.css:${rule.line}: today-trend tabs SVG must not use an independent transform`);
}
requireCssDeclarations(cssRules, '.pm-today-trend-content.is-minimal-ui .pm-today-trend-faction-entry-head .pm-today-trend-relation-slot>.pm-today-trend-faction-node', {
  background: 'transparent', border: '0', 'box-shadow': 'none', color: 'inherit',
});
for (const selector of [
  '.pm-today-trend-world-signal-marker',
  '.pm-today-trend-content.is-minimal-ui .pm-today-trend-relation-symbol',
]) requireCssDeclarations(cssRules, selector, {
  width: 'var(--pm-today-trend-relation-node-size)',
  height: 'var(--pm-today-trend-relation-node-size)',
});
for (const selector of ['.pm-today-trend-relation-slot', '.pm-today-trend-reputation-mark']) {
  requireCssDeclarations(cssRules, selector, {
    width: 'var(--pm-today-trend-relation-node-size)',
    height: 'var(--pm-today-trend-relation-node-size)',
  });
}
for (const selector of ['.pm-today-trend-reputation', '.pm-today-trend-factions']) {
  requireCssDeclarations(cssRules, selector, { overflow: 'visible' });
}
const todayTrendEntryRail = 'var(--pm-today-trend-relation-node-size) var(--pm-space-2) minmax(0,1fr)';
for (const selector of ['.pm-today-trend-world-hero', '.pm-today-trend-world-brief']) {
  requireCssDeclarations(cssRules, selector, {
    display: 'grid',
    'grid-template-columns': todayTrendEntryRail,
    'row-gap': 'var(--pm-space-2)',
    padding: 'var(--pm-space-4)',
  });
}
for (const selector of ['.pm-today-trend-world-hero>.pm-today-trend-world-item-head', '.pm-today-trend-world-brief>.pm-today-trend-world-item-head']) {
  requireCssDeclarations(cssRules, selector, { 'grid-column': '1 / -1' });
}
for (const selector of ['.pm-today-trend-world-hero p', '.pm-today-trend-world-brief p']) {
  requireCssDeclarations(cssRules, selector, { 'grid-column': '3', margin: 'var(--pm-space-0)' });
}
for (const selector of ['.pm-today-trend-reputation-entry-body', '.pm-today-trend-faction-entry-body']) {
  requireCssDeclarations(cssRules, selector, {
    display: 'grid',
    'grid-template-columns': todayTrendEntryRail,
    'row-gap': 'var(--pm-space-2)',
  });
}
for (const selector of ['.pm-today-trend-reputation-entry-body>p', '.pm-today-trend-faction-summary']) {
  requireCssDeclarations(cssRules, selector, { 'grid-column': '3', margin: 'var(--pm-space-0)' });
}
for (const selector of ['.pm-today-trend-reputation-rating', '.pm-today-trend-faction-detail', '.pm-today-trend-faction-rating']) {
  requireCssDeclarations(cssRules, selector, { 'grid-column': '1 / -1' });
}
requireCssDeclarations(cssRules, '.pm-today-trend-content.is-minimal-ui .pm-today-trend-relation-slot> :is(.pm-today-trend-reputation-mark,.pm-today-trend-faction-node)', {
  position: 'absolute',
  width: 'var(--pm-size-control-default)', height: 'var(--pm-size-control-default)',
  'min-width': 'var(--pm-size-control-default)', 'min-height': 'var(--pm-size-control-default)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-world-signal-marker svg', {
  width: 'var(--pm-size-icon-md)', height: 'var(--pm-size-icon-md)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-event-marker svg', {
  width: 'var(--pm-size-icon-md)', height: 'var(--pm-size-icon-md)',
});
if (css.includes('.pm-today-trend-world-signal-marker>i')) {
  failures.push('style.css: world signal marker must render an SVG instead of the legacy <i> core');
}
for (const selector of [
  '.pm-today-trend-content.is-minimal-ui .pm-today-trend-reputation-entry',
  '.pm-today-trend-content.is-minimal-ui .pm-today-trend-faction-card',
  '.pm-today-trend-content.is-minimal-ui .pm-today-trend-event-body',
]) requireCssDeclarations(cssRules, selector, { 'row-gap': 'var(--pm-space-2)' });
for (const selector of [
  '.pm-today-trend-content.is-minimal-ui .pm-today-trend-world-hero p',
  '.pm-today-trend-content.is-minimal-ui .pm-today-trend-world-brief p',
]) requireCssDeclarations(cssRules, selector, {
  margin: 'var(--pm-space-0)',
});
requireCssDeclarations(cssRules, '.pm-today-trend-content.is-minimal-ui .pm-today-trend-event-facts', { 'margin-block-start': 'var(--pm-space-0)' });
for (const [status, relation] of Object.entries(relationStatusTokens)) {
  const colors = { background: `var(${relation.surface})`, color: `var(${relation.foreground})` };
  requireCssDeclarations(cssRules, `.pm-today-trend-content.is-minimal-ui :is(.pm-today-trend-reputation-mark,.pm-today-trend-faction-node)[data-status="${status}"] .pm-today-trend-relation-symbol`, colors);
  requireCssDeclarations(cssRules, `.pm-today-trend-content:not(.is-minimal-ui) :is(.pm-today-trend-reputation-mark,.pm-today-trend-faction-node)[data-status="${status}"]`, colors);
}
const relationVisualClasses = ['.pm-today-trend-reputation-mark', '.pm-today-trend-faction-node'];
for (const rule of cssRules) for (const selector of rule.selectors) {
  if (!relationVisualClasses.some(className => selector.includes(className))) continue;
  const status = selector.match(/\[data-status=["'](hostile|dislike|neutral|like|trust)["']\]/)?.[1];
  if (!status) continue;
  const relation = relationStatusTokens[status];
  for (const property of ['background', 'background-color']) {
    const value = rule.declarations.get(property);
    if (value && normalizeCssValue(value) !== `var(${relation.surface})`) {
      failures.push(`style.css:${rule.line}: ${selector} must use var(${relation.surface}) for ${property}`);
    }
  }
  const foreground = rule.declarations.get('color');
  if (foreground && normalizeCssValue(foreground) !== `var(${relation.foreground})`) {
    failures.push(`style.css:${rule.line}: ${selector} must use var(${relation.foreground}) instead of ${foreground}`);
  }
}
for (const rule of cssRules) if (rule.selectors.some(selector => selector.includes('.pm-today-trend-reputation-meter') || selector.includes('.pm-today-trend-faction-meter'))) {
  for (const [property, value] of rule.declarations) {
    if (value.includes('--pm-today-trend-relation-')) {
      failures.push(`style.css:${rule.line}: meter selector ${rule.selectors.join(', ')} must not consume relation token through ${property}`);
    }
  }
}
requireText('today-trend-ui.js relation icon', todayTrendUiCode, 'function trendRelationIcon(status)');
requireText('today-trend-ui.js relation icon', todayTrendUiCode, 'stroke="currentColor"');
for (const selector of [
  '.pm-calendar-status-heading',
  '.pm-calendar-status-value',
  '.pm-calendar-status-context',
]) if (cssRules.find(candidate => candidate.selectors.includes(selector))?.declarations.has('order')) {
  failures.push(`style.css: ${selector} must not use flex order to change status-card reading order`);
}
requireCssDeclarations(cssRules, '.pm-calendar-status-location svg', { width: '13px', height: '13px' });
requireCssDeclarations(cssRules, '.pm-calendar-status-card-weather .pm-calendar-status-value', {
  color: 'color-mix(in srgb,var(--pm-calendar-accent) 82%,var(--pm-color-on-light))', 'font-weight': '600', 'letter-spacing': '.01em',
});
requireCssDeclarations(cssRules, '.pm-calendar-status-card-cycle .pm-calendar-status-value', {
  color: 'color-mix(in srgb,var(--pm-calendar-accent) 82%,var(--pm-color-on-light))', 'font-weight': '600', 'letter-spacing': '.01em',
});
for (const forbidden of [
  '.pm-calendar-status-weather-context{color:var(--pm-color-text-primary);font-size:13px;font-weight:750;line-height:1.2}',
  '.pm-calendar-status-value{color:color-mix(in srgb,var(--pm-color-text-primary) 88%,var(--pm-color-text-secondary));font-size:30px;line-height:1;font-weight:700',
]) if (css.includes(forbidden)) failures.push(`style.css: legacy status-card typography remains: ${forbidden}`);
if (css.includes('.pm-calendar-selected-detail>header time{font-size:14px')) {
  failures.push('style.css: legacy detail time font size overrides the unified calendar detail typography');
}
if (css.includes('.pm-calendar-shell[data-calendar-view-mode="cycle"] .pm-calendar-cycle{color:var(--pm-calendar-accent)}')) {
  failures.push('style.css: cycle detail body must remain neutral instead of inheriting the calendar accent');
}

requireCssDeclarations(cssRules, '.pm-name-edit', {
  background: 'transparent !important', color: 'var(--pm-color-text-tertiary) !important',
  width: 'var(--pm-size-control-compact)', height: 'var(--pm-size-control-compact)', padding: 'var(--pm-space-2) !important', 'border-radius': 'var(--pm-radius-circle) !important', 'line-height': 'var(--pm-line-height-tight)',
});
requireCssDeclarations(cssRules, '.pm-name-edit:hover', {
  background: 'transparent !important', color: 'var(--pm-color-text-secondary) !important',
});
requireCssDeclarations(cssRules, '.pm-name-edit:active', {
  background: 'transparent !important', color: 'var(--pm-color-on-dark) !important',
});
requireCssDeclarations(cssRules, '.pm-name-edit:active svg', {
  color: 'var(--pm-color-on-dark) !important', stroke: 'currentColor',
});
requireCssDeclarations(cssRules, '.pm-name-edit::before', {
  width: 'var(--pm-size-icon-lg)', height: 'var(--pm-size-icon-lg)', 'border-radius': 'var(--pm-radius-circle)', background: 'transparent',
});
requireCssDeclarations(cssRules, '.pm-name-edit:active::before', { background: 'var(--pm-color-text-secondary)' });
requireCssDeclarations(cssRules, '.pm-name', {
  'max-width': '100%',
  'white-space': 'nowrap',
  overflow: 'hidden',
  'text-overflow': 'ellipsis',
  'text-align': 'center',
});
requireCssDeclarations(cssRules, '.pm-nav-btn', {
  background: 'none !important', color: 'var(--pm-color-text-placeholder) !important', padding: 'var(--pm-space-2) !important', 'line-height': 'var(--pm-line-height-tight)',
});
requireCssDeclarations(cssRules, '.pm-nav-btn.pm-nav-left-btn', {
  color: 'var(--pm-color-text-placeholder) !important',
});
requireCssDeclarations(cssRules, '.pm-up-btn', {
  width: 'var(--pm-size-control-compact) !important', height: 'var(--pm-size-control-compact) !important',
  background: 'var(--pm-color-auxiliary) !important', color: 'var(--pm-color-on-dark) !important',
});
requireCssDeclarations(cssRules, '.pm-expand-btn:hover', {
  color: 'var(--pm-color-text-secondary) !important',
});
requireCssDeclarations(cssRules, '.pm-expand-btn[aria-expanded="true"]', {
  color: 'var(--pm-color-text-secondary) !important',
});
requireCssDeclarations(cssRules, '.pm-message-select-check', {
  width: '22px', height: '22px', 'min-width': '22px', 'min-height': '22px',
  'border-radius': 'var(--pm-radius-circle)', background: 'transparent', color: 'var(--pm-color-on-dark)',
  border: '1.5px solid var(--pm-color-border-strong)',
  transition: 'background var(--pm-motion-fast) var(--pm-motion-ease),border-color var(--pm-motion-fast) var(--pm-motion-ease)',
});
requireCssDeclarations(cssRules, '.pm-message-select-check[data-checked="1"]', {
  'background-color': 'var(--pm-color-auxiliary)',
  'border-color': 'var(--pm-color-auxiliary)',
});
requireCssDeclarations(cssRules, '.pm-message-select-check[data-checked="1"]::after', {
  content: "'✓'", 'font-size': 'var(--pm-font-size-body)', 'font-weight': 'var(--pm-font-weight-semibold)', 'line-height': 'var(--pm-line-height-tight)',
});
requireCssDeclarations(cssRules, '.pm-message-select-check:focus-visible', {
  outline: '2px solid var(--pm-color-focus-ring)', 'outline-offset': '2px',
});
requireCssDeclarations(cssRules, '.pm-custom-check', {
  width: '38px !important', height: '22px !important',
  'min-width': '38px !important', 'min-height': '22px !important',
  'border-radius': 'var(--pm-radius-pill) !important',
  transition: 'background var(--pm-motion-normal) var(--pm-motion-ease)',
});
requireCssDeclarations(cssRules, '.pm-custom-check::after', {
  width: 'var(--pm-size-icon-md)', height: 'var(--pm-size-icon-md)', left: '2px', top: '2px', 'border-radius': 'var(--pm-radius-circle)',
  transition: 'transform var(--pm-motion-normal) var(--pm-motion-ease)',
});
requireCssDeclarations(cssRules, '.pm-custom-check[data-checked="1"]::after', {
  transform: 'translateX(16px)',
});
requireCssDeclarations(cssRules, '.pm-custom-check.is-checked::after', {
  transform: 'translateX(16px)',
});
requireCssDeclarations(cssRules, '.pm-control-toggle', {
  width: '28px', height: '16px', 'border-radius': 'var(--pm-radius-pill)',
});
requireCssDeclarations(cssRules, '.pm-control-toggle::after', {
  width: '12px', height: '12px', left: '2px', top: '2px', 'border-radius': 'var(--pm-radius-circle)',
  transition: 'transform var(--pm-motion-normal) var(--pm-motion-ease)',
});
requireCssDeclarations(cssRules, '#pm-iphone', {
  overflow: 'visible !important',
});
requireCssDeclarations(cssRules, '.pm-phone-screen', {
  width: '100%', height: '100%', display: 'flex', 'flex-direction': 'column',
  overflow: 'hidden', 'border-radius': 'var(--pm-phone-inner-radius)',
});
requireCssDeclarations(cssRules, '.pm-phone-resize-handle', {
  position: 'absolute', right: 'calc(-4px - var(--pm-phone-border-width))',
  bottom: 'calc(-4px - var(--pm-phone-border-width))', width: '40px', height: '40px', cursor: 'nwse-resize', 'touch-action': 'none', background: 'transparent',
});
requireCssDeclarations(cssRules, '.pm-phone-resize-handle::after', {
  content: '""', right: '2px', bottom: '2px', width: '8px', height: '8px',
  'border-right': '1.5px solid color-mix(in srgb,var(--pm-border) 34%,transparent)',
  'border-bottom': '1.5px solid color-mix(in srgb,var(--pm-border) 34%,transparent)',
  'pointer-events': 'none',
});
const resizeHandleRule = cssRules.find(rule => rule.selectors.includes('.pm-phone-resize-handle'));
if (resizeHandleRule?.declarations.get('background')?.includes('linear-gradient')) {
  failures.push('style.css: phone resize handle must not draw diagonal lines inside the phone frame');
}
if (css.includes('pm-scene-tabs')) failures.push('style.css: obsolete wide community tab capsule styles remain');
const lifecycleCode = sourceModuleByName.get('phone-lifecycle.js')?.code || '';
for (const expected of [
  'bindPressGesture(sendButton', 'delay: 550', 'getPendingMessages(runtime',
  'state.isGenerating', 'window.__pmSubmitPending()', 'unbindSendGesture?.()', 'unbindPhoneResize?.()',
  'createAmbientStatusController', 'ambientStatusEnabled === true', 'new Intl.DateTimeFormat',
  'applyPhoneScale(state.phoneWindow)', 'pm-phone-resize-handle', 'SIGNAL_ICON_SVG', 'ambientStatus.stop();',
  'placeholder="长按提交全部消息"',
  '${SIGNAL_ICON_SVG}</span><span>本地</span>',
  '<div class="pm-phone-screen">',
  '</div>\n<div class="pm-phone-resize-handle" role="separator"',
]) requireText('phone-lifecycle.js', lifecycleCode, expected);
if (lifecycleCode.includes('WIFI_ICON_SVG')) failures.push('phone-lifecycle.js: removed WiFi status icon remains');

if (/cb\.style\.cssText\s*=\s*['"][^'"]*border-radius\s*:\s*50%/.test(lifecycleCode)) failures.push('phone-lifecycle.js: message selection checkbox must not override the CSS-owned circle shape with an inline border radius');
for (const match of css.matchAll(/([^{}]+)\{/g)) {
  const selector = match[1];
  if (selector.includes('.pm-message-select-check') && selector.includes('.pm-custom-check')) failures.push('style.css: message selection checkbox and binary toggle must not share a selector');
}
requireText('package.json', packageText, 'npm run check:ambient');
requireText('package.json', packageText, '"check:emoji": "node scripts/check-emoji.mjs"');
requireText('package.json', packageText, 'npm run check:emoji');
requireText('package.json', packageText, '"check:calendar": "node scripts/check-calendar.mjs"');
requireText('package.json', packageText, 'npm run check:calendar');
requireText('settings-templates.js', sourceModuleByName.get('settings-templates.js')?.code || '', '仅显示设备本地时间。');
for (const expected of ['手机会话占比 (%)', '互动社区占比 (%)', '日历模块占比 (%)', '今日风向占比 (%)', '日历模块包含生活日历、菜谱和穿搭。', 'pm-custom-check', 'role="checkbox"', "event.key==='Enter'"]) {
  requireText('settings-templates.js', sourceModuleByName.get('settings-templates.js')?.code || '', expected);
}
const settingsApiControllerCode = sourceModuleByName.get('settings-api-controller.js')?.code || '';
const settingsBudgetControllerCode = sourceModuleByName.get('settings-budget-controller.js')?.code || '';
requireText('settings-api-controller.js', settingsApiControllerCode, 'extractAiResponseContent(await response.json())');
requireText('settings-budget-controller.js', settingsBudgetControllerCode, 'resolveBudgetPercentageInput');
for (const expected of [
  'createApiRequestController', 'createAppearanceController', 'createBackupController', 'createBudgetController',
  'window.__pmTestApi = button => apiSettings.testApi(button)', 'window.__pmTestModel = button => apiSettings.testModel(button)',
  'window.__pmSaveConfig = () => apiSettings.saveConfig()', 'window.__pmShowModelPicker = () => apiSettings.showModelPicker()',
  'window.__pmSetCustomAccent = () => appearanceSettings.setCustomAccent()',
  'window.__pmSaveBudgetConfig = () => budgetSettings.save()', 'window.__pmResetBudgetConfig = () => budgetSettings.reset()',
]) {
  requireText('settings-ui.js', settingsCode, expected);
}
for (const [owner, code, expected] of [
  ['phone-directory.js', directoryCode, ['role="checkbox"', 'tabindex="0"', 'aria-checked=', "event.key==='Enter'"]],
  ['phone-chat-poke.js', phoneChatPokeCodeForChecks, ['role="checkbox"', 'tabindex="0"', 'aria-checked=', "event.key==='Enter'", 'saveCharacterBehavior()', 'savePokeConfig()', 'behaviorSnapshot', 'pokeSnapshot']],
  ['phone-lifecycle.js', lifecycleCode, [
    "setAttribute('role', 'checkbox')", "setAttribute('aria-checked'", 'cb.tabIndex = 0',
    'toggleMessageSelection({ checkbox: cb, wrap, list })', 'handleMessageSelectionKey(event, cb)',
    "list.classList.add('is-selecting')", 'wrap.appendChild(b);', 'wrap.appendChild(cb);', "list.classList.remove('is-selecting')",
  ]],
  ['phone-foundation.js', foundationCode, [
    'window.__pmToggleBidirectional = name => {', 'const targetKey = String(name || \'\').trim();',
    'Object.hasOwn(window.__pmGroupMeta?.[id] || {}, targetKey)',
    'window.__pmToggleConversationInjection?.(id, targetKey, isGroup) || Promise.resolve(false)',
  ]],
  ['phone-scale.js', sourceModuleByName.get('phone-scale.js')?.code || '', [
    'export function phoneSizeForViewport(',
  ]],
  ['settings-wordy-controller.js', settingsWordyControllerCode, ['const previous = window.__pmWordyLimit === true', 'if (!saveWordyLimit())', "element.setAttribute('aria-checked'"]],
]) {
  for (const value of expected) requireText(owner, code, value);
}
if (/assertV2Keys\s*\(\s*raw\s*,\s*\[[^\]]*contentRating/.test(interactiveModelCode)) {
  failures.push('interactive-scene-model.js: v2 scene keys must not accept contentRating');
}
requireText('interactive-scene-model.js', interactiveModelCode, "assertV1Keys(raw, ['id', 'title', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent', 'contentRating'");
requireText('interactive-scene-model.js', interactiveModelCode, 'export function stripPersistedV2ContentRating(rawStore)');
requireText('interactive-scenes-utils.js', interactiveUtilsCode, 'stripPersistedV2ContentRating(rawStore)');
if (settingsCode.includes('stripPersistedV2ContentRating')) {
  failures.push('settings-ui.js: untrusted backup import must not use persisted V2 contentRating compatibility cleanup');
}
if (settingsBackupValidateCode.includes('stripPersistedV2ContentRating')) {
  failures.push('settings-backup-validate.js: untrusted backup import must not use persisted V2 contentRating compatibility cleanup');
}
requireText('settings-backup-controller.js', settingsBackupControllerCode, 'legacyBackupTheme(snapshot.theme)');
for (const expected of ['delete theme.ambientStatusEnabled', 'current.theme?.ambientStatusEnabled === true']) {
  requireText('settings-backup-validate.js', settingsBackupValidateCode, expected);
}
for (const forbidden of ['navigator.geolocation', 'getCurrentPosition(', 'watchPosition(']) {
  if (lifecycleCode.includes(forbidden)) failures.push(`phone-lifecycle.js: ambient status must not use ${forbidden}`);
}
for (const forbidden of ['AI 互动场景', 'AI 文字直播', 'AI ON AIR', 'AI PREVIEW', '模拟弹幕', 'AI 社交宇宙']) {
  if (directoryCode.includes(forbidden) || interactiveCode.includes(forbidden)) failures.push(`immersive UI: visible implementation label remains: ${forbidden}`);
}
const immersiveUiOwners = [
  'interactive-scenes.js', 'settings-templates.js', 'settings-ui.js', 'phone-directory.js',
  'phone-chat-poke.js', 'phone-control-center.js', 'emoji-ui.js', 'cropper.js',
];
for (const owner of immersiveUiOwners) {
  const code = sourceModuleByName.get(owner)?.code || '';
  for (const forbidden of ['🥰', '➕', '📁', '✕', '×']) {
    if (code.includes(forbidden)) failures.push(`${owner}: visible emoji or Unicode operation icon remains: ${forbidden}`);
  }
}
for (const forbidden of ['#7b3654', '#2c1a30', '#71334f']) {
  if (css.toLowerCase().includes(forbidden)) failures.push(`style.css: purple immersive background color remains: ${forbidden}`);
}
const pressGestureCode = sourceModuleByName.get('press-gesture.js')?.code || '';
for (const expected of [
  'setPointerCapture', "addEventListener('pointermove'", "addEventListener('pointercancel'",
  "addEventListener('lostpointercapture'", "eventTarget?.addEventListener('blur'", 'const isShortPress = timer !== null',
  'if (isShortPress) onPress?.()', 'Number(event?.detail) === 0', 'removeEventListener',
]) requireText('press-gesture.js', pressGestureCode, expected);
const conversationCode = sourceModuleByName.get('conversation.js')?.code || '';
const conversationStateCode = sourceModuleByName.get('conversation-state.js')?.code || '';
const conversationRenderingCode = sourceModuleByName.get('conversation-rendering.js')?.code || '';
requireText('conversation.js', conversationCode, 'deps.closeControlCenter?.()');
for (const expected of ['state.groupRandomNpcEnabled = groupMeta.randomNpcEnabled === true', 'state.groupNature = typeof groupMeta.groupNature']) {
  requireText('conversation-state.js', conversationStateCode, expected);
}
for (const expected of ['renderConversationHistory', 'snapshotConversationContext', 'applyConversationTarget']) {
  requireText('conversation.js', conversationCode, expected);
}
requireText('bundle', bundle, 'pm-settings-home');
if (bundle.includes('pm-forum-entry')) failures.push('bundle: removed directory community entry must not remain');
for (const iconName of [
  'MENU_ICON_SVG', 'CLOSE_ICON_SVG', 'HOME_ICON_SVG', 'CONTROL_ICON_SVG', 'SEND_ICON_SVG',
  'POKE_ICON_SVG', 'CHAT_ICON_SVG', 'CONTACTS_ICON_SVG', 'CHARACTER_ICON_SVG', 'SETTINGS_ICON_SVG', 'COMMUNITY_ICON_SVG',
  'EDIT_ICON_SVG', 'EMOJI_ICON_SVG', 'TRASH_ICON_SVG', 'REMOVE_ICON_SVG', 'RECIPE_ICON_SVG', 'MOON_ICON_SVG', 'CYCLE_PERIOD_ICON_SVG', 'BOOK_ICON_SVG', 'CYCLE_FERTILE_ICON_SVG',
]) {
  requireText('icons.js', sourceModuleByName.get('icons.js')?.code || '', `export const ${iconName}`);
}

const phoneChatCode = sourceModuleByName.get('phone-chat.js')?.code || '';
const phoneChatPokeCode = sourceModuleByName.get('phone-chat-poke.js')?.code || '';
const phoneChatPokeAnalysis = analyze(phoneChatPokeCode, 'module');
const showContactConfigSource = phoneChatPokeAnalysis.functionSource.get('showContactConfig') || '';
const saveContactConfigSource = phoneChatPokeAnalysis.windowAssignmentSource.get('__pmSaveContactConfig') || '';
const foundationInjectionSource = analyze(phoneInjectionControllerCode, 'module').functionSource.get('applyBidirectionalInjection') || '';
const preferenceCallCount = (phoneChatCode.match(/buildChatPreferencePrompt\s*\(/g) || []).length
  + (phoneChatPokeCode.match(/buildChatPreferencePrompt\s*\(/g) || []).length;
if (preferenceCallCount !== 4) {
  failures.push(`behavior prompt: expected 4 generation-path calls, found ${preferenceCallCount}`);
}
if (phoneChatCode.includes('buildCharacterBehaviorPrompt(')
    || phoneChatPokeCode.includes('buildCharacterBehaviorPrompt(')) {
  failures.push('behavior prompt: generation paths must use the unified preference assembler');
}
requireText('contact-generator.js', sourceModuleByName.get('contact-generator.js')?.code || '', 'installContactGenerator(state, deps)');
requireText('contact-generator.js', sourceModuleByName.get('contact-generator.js')?.code || '', '!state.generationTask');
for (const expected of [
  "window.__pmShowAddContact = (resultMessage = '', mode = 'all')", 'escapeHtml(resultMessage)',
  '<b>手动添加</b>', '<b>AI 生成</b>', 'id="pm-autogen-btn"',
  'pm-contact-add-manual', 'pm-contact-add-primary', 'pm-contact-add-ai', 'pm-contact-add-icon',
  '新建联系人', '新建群聊', '生成联系人与群聊',
  'pm-directory-actions', 'is-primary', 'is-wide',
  'SPARKLES_ICON_SVG', 'UNLINK_ICON_SVG', 'pm-entity-delete',
  '永久删除联系人', '永久删除群聊', '且无法恢复',
]) requireText('phone-directory.js', directoryCode, expected);
const contactDeleteButton = buttonContaining('phone-directory.js: contact delete button', directoryListSource, 'onclick="window.__pmDel(');
for (const expected of ['class="pm-entity-delete"', 'aria-label="永久删除联系人', 'title="永久删除联系人"', '${UNLINK_ICON_SVG}']) {
  requireText('phone-directory.js: contact delete button', contactDeleteButton, expected);
}
if (contactDeleteButton.includes('<span>') || contactDeleteButton.includes('TRASH_ICON_SVG') || contactDeleteButton.includes('REMOVE_ICON_SVG')) {
  failures.push('phone-directory.js: contact delete button must be SVG-only and use unlink semantics');
}
const groupDeleteButton = buttonContaining('phone-directory.js: group delete button', directoryListSource, 'onclick="window.__pmDelGroup(');
for (const expected of ['class="pm-entity-delete"', 'aria-label="永久删除群聊', 'title="永久删除群聊"', '${UNLINK_ICON_SVG}']) {
  requireText('phone-directory.js: group delete button', groupDeleteButton, expected);
}
if (groupDeleteButton.includes('<span>') || groupDeleteButton.includes('TRASH_ICON_SVG') || groupDeleteButton.includes('REMOVE_ICON_SVG')) {
  failures.push('phone-directory.js: group delete button must be SVG-only and use unlink semantics');
}
for (const [label, marker, accessibleName] of [
  ['community poke button', 'data-action="poke-scene"', 'aria-label="拍一拍社区"'],
  ['post comments poke button', 'data-action="comments"', 'aria-label="拍一拍本帖，只生成本帖评论"'],
]) {
  const button = buttonContaining(`interactive-scene-views.js: ${label}`, interactiveViewsCode, marker);
  requireText(`interactive-scene-views.js: ${label}`, button, accessibleName);
  requireText(`interactive-scene-views.js: ${label}`, button, '${POKE_ICON_SVG}');
  if (button.includes('SPARKLES_ICON_SVG')) failures.push(`interactive-scene-views.js: ${label} must preserve poke semantics instead of generic AI sparkles`);
}
const iconsCode = sourceModuleByName.get('icons.js')?.code || '';
for (const expected of ['REMOVE_ICON_SVG', 'UNLINK_ICON_SVG', 'SPARKLES_ICON_SVG', 'CHEVRON_DOWN_ICON_SVG', 'EYE_ICON_SVG', 'MOON_ICON_SVG', 'CYCLE_PERIOD_ICON_SVG', 'BOOK_ICON_SVG', 'CHECK_ICON_SVG']) requireText('icons.js', iconsCode, expected);
const storyOracleCode = sourceModuleByName.get('story-oracle.js')?.code || '';
for (const expected of [
  'CONTROL_ICON_SVG', 'BOOK_ICON_SVG', 'SEND_ICON_SVG', 'CLOSE_ICON_SVG', 'CHEVRON_DOWN_ICON_SVG',
  'class="pm-expand-btn pm-story-oracle-menu-toggle"',
  'class="pm-control-menu pm-story-oracle-menu"',
  'role="menu" aria-label="剧情助手工具"',
  'class="pm-name-trigger pm-story-oracle-mode-trigger"',
  'class="pm-control-menu pm-story-oracle-mode-menu"',
  'role="menuitemradio"',
  'class="pm-nav-btn pm-nav-left-btn"',
  'class="pm-header-icon-button pm-nav-btn pm-close-btn"',
  'class="pm-msg-list pm-story-oracle-message-list"',
]) requireText('story-oracle.js UI contract', storyOracleCode, expected);
for (const expected of [
  "import { escapeAttr, escapeHtml, renderBoldText } from './ui.js';",
  'renderBoldText(content)',
]) requireText('story-oracle.js bold renderer contract', storyOracleCode, expected);
if (storyOracleCode.includes('pm-scene-header')) failures.push('story-oracle.js: session UI must not retain the old scene header');
if (storyOracleCode.includes('data-story-oracle-mode-select') || storyOracleCode.includes('pm-story-oracle-mode-row')) failures.push('story-oracle.js: mode switching must use the compact title trigger, not a standalone select row');
if (!/<button type="button" class="pm-generation-cancel"[\s\S]*?<button type="submit" class="pm-up-btn"/.test(storyOracleCode)) {
  failures.push('story-oracle.js: cancel button must precede the icon send button');
}
if (!/class="pm-control-menu pm-story-oracle-menu"[\s\S]*data-story-oracle-action="world-books"/.test(storyOracleCode)) {
  failures.push('story-oracle.js: world-book entry must remain inside the magic-wand menu');
}
if (!/<form class="pm-input-bar pm-story-oracle-composer"[\s\S]*renderStoryOracleTools/.test(storyOracleCode)) {
  failures.push('story-oracle.js: magic-wand tools must be anchored in the composer');
}
if (!/class="pm-name-trigger pm-story-oracle-mode-trigger"[\s\S]*CHEVRON_DOWN_ICON_SVG/.test(storyOracleCode)) {
  failures.push('story-oracle.js: mode title must expose the compact chevron trigger');
}
requireCssDeclarations(cssRules, '.pm-story-oracle-shell', { height: '100%', 'min-height': '0', display: 'flex', 'flex-direction': 'column' });
requireCssDeclarations(cssRules, '.pm-story-oracle-menu', { left: '0', bottom: 'calc(100% + var(--pm-space-1))', 'box-shadow': 'var(--pm-shadow-floating)' });
requireCssDeclarations(cssRules, '.pm-story-oracle-mode-menu', { left: '50%', top: 'calc(100% - var(--pm-space-1))', transform: 'translateX(-50%)', 'box-shadow': 'var(--pm-shadow-floating)' });
requireCssDeclarations(cssRules, '.pm-story-oracle-message-list', { 'min-height': '0' });
for (const expected of [
  `export const EYE_ICON_SVG = icon('<path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5z"/><circle cx="12" cy="12" r="2.5"/>');`,
  `export const MOON_ICON_SVG = icon('<path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2z"/>');`,
  `export const CYCLE_PERIOD_ICON_SVG = icon('<circle cx="12" cy="7" r="3"/><circle cx="16.8" cy="10.5" r="3"/><circle cx="15" cy="16" r="3"/><circle cx="9" cy="16" r="3"/><circle cx="7.2" cy="10.5" r="3"/><circle cx="12" cy="12" r="2.2"/>');`,
]) requireText('icons.js geometry', iconsCode, expected);
for (const forbidden of ['୨ৎ', "M12 21c-4-2-8-7-8-12"]) {
  if (iconsCode.includes(forbidden) || calendarViewCode.includes(forbidden) || calendarPageViewCode.includes(forbidden)) {
    failures.push(`calendar icon migration: obsolete period marker remains ${forbidden}`);
  }
}
requireText('phone-directory.js injection button', directoryCode, 'class="pm-contact-switcher-icon pm-contact-switcher-injection ${enabled ? \'is-active\' : \'\'}"');
requireText('phone-directory.js injection button', directoryCode, '${EYE_ICON_SVG}</button>');
if ((directoryCode.match(/pm-contact-switcher-injection[\s\S]*?\$\{EYE_ICON_SVG\}/g) || []).length !== 1) {
  failures.push('phone-directory.js injection button: must render exactly one shared eye SVG');
}
if (!/pm-contact-switcher-current[\s\S]*?pm-contact-switcher-main[\s\S]*?pm-contact-switcher-injection[\s\S]*?pm-entity-delete/.test(directoryCode)) {
  failures.push('phone-directory.js: current-conversation checkmark must stay before the name and action buttons');
}
requireCssDeclarations(cssRules, '.pm-name-trigger[aria-expanded="true"]', { 'border-radius': 'var(--pm-radius-control) var(--pm-radius-control) var(--pm-radius-none) var(--pm-radius-none)', 'background': 'var(--pm-color-surface-card)' });
requireCssDeclarations(cssRules, '.pm-contact-switcher', {
  'border-top-left-radius': 'var(--pm-radius-none)', 'border-top-right-radius': 'var(--pm-radius-none)',
  'border-bottom-left-radius': 'var(--pm-radius-card)', 'border-bottom-right-radius': 'var(--pm-radius-card)',
});
requireCssDeclarations(cssRules, '.pm-name-trigger', { 'z-index': 'calc(var(--pm-z-popover) + 1)' });
requireCssDeclarations(cssRules, '.pm-contact-switcher', { 'z-index': 'var(--pm-z-popover)' });
requireCssDeclarations(cssRules, '.pm-contact-switcher', { left: '50%', transform: 'translateX(-50%)', 'max-height': 'min(304px,calc(100% - 72px))' });
requireText('phone-directory.js contact switcher positioning', directoryCode,
  'switcher.style.top = `${Math.max(0, triggerRect.bottom - phoneRect.top - 2)}px`;');
requireText('phone-directory.js contact switcher responsive positioning', directoryCode, 'contactSwitcherResizeObserver = new ResizeObserver');
requireText('style.css selection mode quote exclusion', css, '.pm-msg-list.is-selecting .pm-quote-action{display:none !important;}');
requireCssDeclarations(cssRules, '.pm-msg-list', {
  'overflow-x': 'hidden !important', 'overflow-y': 'auto !important',
});
requireCssDeclarations(cssRules, '.pm-quote-action', { right: 'calc(100% + 6px)' });
requireCssDeclarations(cssRules, '.pm-right>.pm-quote-action', {
  right: 'auto', left: 'calc(100% + 6px)',
});
requireCssDeclarations(cssRules, '.pm-bubble', {
  'max-width': '74% !important', padding: 'var(--pm-space-2) var(--pm-space-3)',
});
requireCssDeclarations(cssRules, '.pm-pending-entry', {
  position: 'relative', opacity: '.82',
});
for (const rule of cssRules) if (rule.selectors.some(selector => selector.includes('.pm-pending-entry')) && rule.declarations.has('padding-bottom')) {
  failures.push(`style.css: pending-message selector ${rule.selectors.join(', ')} must not increase bubble height with padding-bottom`);
}
requireCssDeclarations(cssRules, '.pm-pending-entry.pm-right::after', {
  content: "'待提交'", position: 'absolute', top: '50%',
  right: 'calc(100% + var(--pm-space-2))', transform: 'translateY(-50%)',
  color: 'var(--pm-color-text-tertiary)', 'font-size': 'var(--pm-font-size-helper)',
  'line-height': 'var(--pm-line-height-tight)', 'white-space': 'nowrap',
});
requireCssDeclarations(cssRules, '.pm-pending-entry[data-pending-status="submitting"].pm-right::after', {
  content: "'提交中'",
});
requireCssDeclarations(cssRules, '.pm-pending-entry[data-pending-status="failed"].pm-right::after', {
  content: "'提交失败'", color: 'var(--pm-color-danger)',
});
if (css.includes('left:calc(100% + var(--pm-space-2))')) failures.push('style.css: pending-message status must remain outside the bubble on its left without changing bubble size');
requireText('style.css title arrow isolation', css, '.pm-name-chevron{position:absolute;left:100%;top:50%');
requireCssDeclarations(cssRules, '.pm-contact-switcher', { 'box-shadow': 'none' });
requireCssDeclarations(cssRules, '.pm-contact-switcher-row', { 'grid-template-columns': '22px minmax(0,1fr) 40px 40px', 'column-gap': 'var(--pm-space-1)' });
requireCssDeclarations(cssRules, '.pm-contact-switcher-current', {
  'grid-column': '1', 'justify-self': 'center', transform: 'translate(6px,1.5px)',
});
const settingsTemplatesCode = sourceModuleByName.get('settings-templates.js')?.code || '';
requireText('settings-templates.js wordy-limit copy', settingsTemplatesCode, '除话痨人设外，每条消息不超过 35 字');
requireText('settings-templates.js shared settings-home hint class', settingsTemplatesCode, 'class="pm-settings-home-hint">日夜模式、气泡颜色与背景图</span>');
requireText('settings-templates.js wordy-limit shared settings-home hint class', settingsTemplatesCode, 'span class="pm-settings-home-hint">除话痨人设外，每条消息不超过 35 字</span>');
for (const expected of ['data-theme-mode="light"', 'data-theme-mode="dark"', 'id="pm-custom-accent"']) requireText('settings-templates.js theme synchronization controls', settingsTemplatesCode, expected);
requireText('settings-templates.js shared custom theme picker class', settingsTemplatesCode, 'id="pm-custom-accent" type="color"');
requireText('settings-templates.js shared custom theme picker class', settingsTemplatesCode, 'class="pm-color-pick" title="自定义主题色"');
for (const id of ['pm-custom-accent', 'pm-custom-right', 'pm-custom-left']) {
  const input = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(settingsTemplatesCode)?.[0] || '';
  if (!/\bclass="pm-color-pick"/.test(input)) {
    failures.push(`settings-templates.js: ${id} must use the shared pm-color-pick class`);
  }
}
requireCssDeclarations(cssRules, '.pm-color-pick', {
  width: '32px', height: '28px', border: '1px solid var(--pm-color-border-default)', 'border-radius': 'var(--pm-radius-compact)',
  'box-sizing': 'border-box', flex: '0 0 32px',
});
if (css.includes('.pm-theme-custom')) failures.push('style.css: obsolete theme-only color picker rule must not remain');
const worldBookConfigCode = sourceModuleByName.get('worldbook-config.js')?.code || '';
const worldBookModulesMatch = /WORLD_BOOK_MODULES\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(worldBookConfigCode);
const worldBookModuleCount = worldBookModulesMatch
  ? [...worldBookModulesMatch[1].matchAll(/['"]([^'"]+)['"]/g)].length : 0;
if (!worldBookModuleCount) failures.push('worldbook-config.js: WORLD_BOOK_MODULES must declare at least one module');
const worldBookModuleColumns = `minmax(0,1fr) repeat(${worldBookModuleCount},minmax(24px,34px))`;
const worldBookSettingsCode = sourceModuleByName.get('settings-worldbook.js')?.code || '';
requireText('settings-worldbook.js native entries use dedicated book container', worldBookSettingsCode, 'class="pm-worldbook-native-book" data-world-book-section');
requireText('settings-worldbook.js native entries use dedicated title row', worldBookSettingsCode, 'class="pm-li pm-worldbook-native-book-title"');
requireText('settings-worldbook.js native entries use dedicated entry row', worldBookSettingsCode, 'class="pm-li pm-worldbook-native-entry"');
if (buttonContaining('settings-worldbook.js restore default', worldBookSettingsCode, 'window.__pmResetWorldBookConfig()').includes('is-accent')) {
  failures.push('settings-worldbook.js: restore default must remain secondary, not accent');
}
for (const [label, marker] of [
  ['save columns', 'window.__pmSaveWorldBookColumns()'],
  ['save world-book settings', 'window.__pmSaveWorldBookConfig()'],
]) requireText(`settings-worldbook.js: ${label}`, buttonContaining(`settings-worldbook.js: ${label}`, worldBookSettingsCode, marker), 'class="pm-action-button is-accent"');
requireCssDeclarations(cssRules, '.pm-worldbook-content', { padding: 'var(--pm-space-0) var(--pm-space-3) var(--pm-space-3)' });
requireCssDeclarations(cssRules, '.pm-worldbook-matrix', {
  display: 'grid', 'grid-template-columns': worldBookModuleColumns, gap: 'var(--pm-space-1-5) var(--pm-space-1)',
});
requireCssDeclarations(cssRules, '.pm-worldbook-matrix .pm-worldbook-eye', {
  'box-sizing': 'border-box', width: '100%', 'min-width': '0',
});
requireCssDeclarations(cssRules, '.pm-worldbook-content.has-columns .pm-worldbook-native-list', { display: 'block', border: '0' });
requireCssDeclarations(cssRules, '.pm-worldbook-native-book', { border: '0' });
requireCssDeclarations(cssRules, '.pm-worldbook-native-book-title', { gap: 'var(--pm-space-1-5)', padding: 'var(--pm-space-2) var(--pm-space-0-5)' });
requireCssDeclarations(cssRules, '.pm-worldbook-native-entry', { gap: 'var(--pm-space-1-5)', padding: 'var(--pm-space-2) var(--pm-space-0-5)' });
requireCssDeclarations(cssRules, '.pm-worldbook-native-book-title>span', { 'font-size': 'var(--pm-font-size-compact)' });
requireCssDeclarations(cssRules, '.pm-worldbook-native-entry>span', { 'font-size': 'var(--pm-font-size-label)' });
requireCssDeclarations(cssRules, '.pm-worldbook-native-book .pm-worldbook-eye', { width: '34px', height: '30px', 'flex-basis': '34px' });
const settingsUiSaveCode = sourceModuleByName.get('settings-ui.js')?.code || '';
for (const [label, marker] of [
  ['save budget', 'window.__pmSaveBudgetConfig()'],
  ['save API settings', 'window.__pmSaveConfig()'],
]) requireText(`settings-ui.js: ${label}`, buttonContaining(`settings-ui.js: ${label}`, settingsUiSaveCode, marker), 'pm-action-button is-accent');
if (buttonContaining('settings-ui.js restore budget defaults', settingsUiSaveCode, 'window.__pmResetBudgetConfig()').includes('is-accent')) {
  failures.push('settings-ui.js: restore budget defaults must remain secondary, not accent');
}
const apiTestButton = buttonContaining('settings-templates.js API test button', settingsTemplatesCode, 'window.__pmTestModel(this)');
requireText('settings-templates.js API test button preserves dedicated class', apiTestButton, 'class="pm-action-button is-api-test"');
if (/\bis-(?:accent|primary)\b/.test(apiTestButton)) {
  failures.push('settings-templates.js: API test button must not use a save-action color class');
}
const directorySaveCode = sourceModuleByName.get('phone-directory.js')?.code || '';
for (const [label, marker] of [
  ['create group', 'window.__pmConfirmGroup('],
  ['save group', 'window.__pmSaveAndCloseGroupEdit()'],
  ['save random group members', 'window.__pmSaveGroupRandomNpcSettings('],
]) requireText(`phone-directory.js: ${label}`, buttonContaining(`phone-directory.js: ${label}`, directorySaveCode, marker), 'pm-action-button is-accent');
const injectionSaveCode = sourceModuleByName.get('phone-context-injection.js')?.code || '';
requireText('phone-context-injection.js: save injection', buttonContaining('phone-context-injection.js: save injection', injectionSaveCode, 'window.__pmSaveConversationInjection()'), 'class="pm-action-button is-accent"');
const injectionClearButton = buttonContaining('phone-context-injection.js: clear injection', injectionSaveCode, 'window.__pmClearConversationInjection()');
requireText('phone-context-injection.js: clear injection stays secondary', injectionClearButton, 'class="pm-action-button is-secondary"');
if (/\bis-(?:accent|danger)\b/.test(injectionClearButton)) {
  failures.push('phone-context-injection.js: clear injection must remain a reversible secondary action');
}
if (injectionSaveCode.indexOf('window.__pmClearConversationInjection()') > injectionSaveCode.indexOf('window.__pmSaveConversationInjection()')) {
  failures.push('phone-context-injection.js: clear injection button must precede save and apply');
}
requireCssDeclarations(cssRules, '.pm-contact-settings-save', { background: 'var(--pm-color-accent)!important', color: 'var(--pm-color-on-accent)!important', 'border-color': 'var(--pm-color-accent)!important' });
requireText('phone-chat-poke.js: save character settings uses dedicated save action', phoneChatPokeCode, 'class="pm-contact-settings-save" onclick="window.__pmSaveContactConfig');
for (const [label, marker] of [
  ['save recipe region', 'calendar-recipe-region-save'],
  ['save detected date', 'calendar-date-sync'],
]) requireText(`calendar-view.js: ${label}`, buttonContaining(`calendar-view.js: ${label}`, calendarViewCode, marker), 'class="is-primary"');
for (const marker of ['calendar-weather-search', 'calendar-weather-refresh', 'calendar-holiday-refresh', 'calendar-cycle-clear']) {
  if (buttonContaining(`calendar-view.js: ${marker}`, calendarViewCode, marker).includes('class="is-primary"')) {
    failures.push(`calendar-view.js: ${marker} must not be styled as a primary save action`);
  }
}
requireCssDeclarations(cssRules, '.pm-calendar-data-row .is-primary', { background: 'var(--pm-calendar-accent)!important', color: 'var(--pm-color-on-dark)!important', 'border-color': 'var(--pm-calendar-accent)!important' });
requireCssDeclarations(cssRules, '.pm-calendar-setting-hint', {
  color: 'var(--pm-color-text-tertiary)', 'font-size': 'var(--pm-font-size-helper)', 'line-height': 'var(--pm-line-height-body)',
});
requireText('calendar-weather.js refreshes climate estimates', sourceModuleByName.get('calendar-weather.js')?.code || '', 'current.climateRevision + (resetCache ? 1 : 0)');
requireText('calendar.js preserves calendar scroll position on rerender', sourceModuleByName.get('calendar.js')?.code || '', "const previousShell = container.querySelector?.('.pm-calendar-shell');");
requireText('calendar.js restores calendar scroll position on rerender', sourceModuleByName.get('calendar.js')?.code || '', 'if (Number.isFinite(scrollTop) && nextShell) nextShell.scrollTop = scrollTop;');
requireCssDeclarations(cssRules, '.pm-contact-settings-actions', { 'border-top': '0 !important' });
requireCssDeclarations(cssRules, '#pm-overlay .pm-contact-settings-scroll textarea.pm-cfg-input', {
  width: '100% !important', 'min-height': '58px !important', resize: 'vertical !important',
  'box-shadow': 'none !important', appearance: 'none !important',
});
requireCssDeclarations(cssRules, '#pm-overlay .pm-group-settings-scroll textarea.pm-cfg-input', {
  width: '100% !important', 'min-height': '58px !important', resize: 'vertical !important',
  'box-shadow': 'none !important', appearance: 'none !important',
});
for (const expected of [
  '.pm-action-button{', 'font-size:var(--pm-font-size-body)',
  '.pm-header-icon-button{box-sizing:border-box;width:var(--pm-size-control-compact);height:var(--pm-size-control-compact);min-width:var(--pm-size-control-compact);min-height:var(--pm-size-control-compact)',
  '.pm-action-button.is-success{background:var(--pm-color-success);color:var(--pm-color-on-success);border-color:var(--pm-color-success)}',
  '.pm-action-button.is-danger{background:var(--pm-color-danger);color:var(--pm-color-on-danger);border-color:var(--pm-color-danger)}',
  '.pm-confirm-btn{background:var(--pm-color-danger) !important;color:var(--pm-color-on-danger) !important',
  '.pm-prof-del:hover{background:var(--pm-color-danger) !important;color:var(--pm-color-on-danger) !important',
  '.pm-emoji-image-delete{position:absolute;top:-6px;right:-8px;border:0;background:var(--pm-color-danger);color:var(--pm-color-on-danger)',
  '.pm-quick-reply-actions button.is-danger{background:var(--pm-color-danger);color:var(--pm-color-on-danger)}',
  '.pm-contact-add-choices{',
  '.pm-calendar-view-switch button{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;padding:var(--pm-space-0);border:0;border-radius:50%',
  '.pm-calendar-header{position:sticky', 'grid-template-columns:72px minmax(0,1fr) 72px',
]) requireText('style.css', css, expected);
for (const forbidden of ['.pm-session-behavior-links', '.pm-session-auto-poke-interval', '.pm-injection-entry', '.pm-conversation-settings-injection']) {
  if (css.includes(forbidden)) failures.push(`style.css: obsolete flattened-menu selector remains ${forbidden}`);
}
for (const expected of [
  'onclick="window.__pmCloseOverlay()"', 'pm-contact-settings-title', 'pm-modal-add pm-contact-settings-actions',
  'onclick="window.__pmSaveContactConfig(',
  'window.__pmSaveAndCloseContactConfig = contactName => window.__pmSaveContactConfig(contactName)',
  'BACK_ICON_SVG', 'function showContactConfig(contactName, returnToMembers = false, returnMembersToControlCenter = false)',
  'window.__pmShowGroupMemberSettings = (returnToControlCenter = false) =>', '<b>成员角色设置</b>',
  "window.__pmShowCharacterBehavior('${safeJS(name)}', ${returnToControlCenter})",
  'window.__pmShowGroupMemberSettings(${returnMembersToControlCenter})',
  'window.__pmShowGroupRandomNpcSettings?.({ returnToControlCenter: !returnToGroupSettings })',
  '__pmShowConversationSettings = (returnToGroupSettings = false)',
]) requireText('phone-chat-poke.js', phoneChatPokeCode, expected);
for (const expected of [
  'BACK_ICON_SVG', 'const closeAction = "window.__pmShowList()";',
  'title="返回列表" aria-label="返回列表">${BACK_ICON_SVG}</button>',
  'onclick="window.__pmShowGroupMemberSettings()"',
]) requireText('phone-directory.js group settings back action', directoryCode, expected);
requireText('conversation-rendering.js quote sender attribution', sourceModuleByName.get('conversation-rendering.js')?.code || '',
  "sender: bubble.sender || (message.role === 'user' ? '我' : state.currentPersona)");
requireText('phone-message-rendering.js quote sender snapshot', phoneMessageRenderingCode,
  "sender: String(senderName || metadata.sender || '我')");
if (!/pm-contact-settings-scroll[\s\S]*pm-modal-add pm-contact-settings-actions[\s\S]*保存角色设置[\s\S]*<\/div>\s*<\/div>\s*<\/div>`/.test(showContactConfigSource)) {
  failures.push('phone-chat-poke.js: character settings save action must remain inside the scroll content');
}
if (!showContactConfigSource || !saveContactConfigSource) {
  failures.push('phone-chat-poke.js: character settings render/save functions must remain statically analyzable');
} else {
  if (/__pmSave(?:AndClose)?ContactConfig/.test(showContactConfigSource.match(/pm-modal-header[\s\S]*?<\/div>/)?.[0] || '')) {
    failures.push('phone-chat-poke.js: character settings header close action must not save');
  }
  if (/__pmCloseOverlay|closeOverlay|pm-overlay['"]\)\?\.remove/.test(saveContactConfigSource)) {
    failures.push('phone-chat-poke.js: saving character settings must not close the overlay');
  }
}
for (const expected of [
  'calendarWeather', "getCalendarData('getCalendarWeatherStore')",
  'calendarCycles', "getCalendarData('getCalendarCycleStore')",
]) requireText('phone-injection-controller.js', foundationInjectionSource, expected);
for (const expected of [
  'class="pm-calendar-cycle-input" name="enabled" type="checkbox"',
  'class="pm-custom-check" aria-hidden="true"', 'pm-calendar-status-card', 'pm-calendar-status-watermark',
]) requireText('calendar-view.js', calendarViewCode, expected);
for (const forbidden of ['pm-calendar-base-menu', 'TIME_ORIGIN_ICON_SVG', 'calendar-base-edit', 'pm-calendar-base-dialog']) {
  if (calendarCode.includes(forbidden)) failures.push(`calendar.js: obsolete title control remains: ${forbidden}`);
}
for (const forbidden of ['calendar-base-edit', 'pm-calendar-base-dialog', 'pm-calendar-base-actions']) {
  if (css.includes(forbidden)) failures.push(`style.css: obsolete calendar title control remains: ${forbidden}`);
}
const phoneInjectionCode = sourceModuleByName.get('phone-injection.js')?.code || '';
const phoneInjectionAnalysis = analyze(phoneInjectionCode, 'module');
const renderCalendarInjectionSource = phoneInjectionAnalysis.functionSource.get('renderCalendarContextInjection') || '';
const buildContextInjectionSource = phoneInjectionAnalysis.functionSource.get('buildContextInjectionPrompts') || '';
if (!renderCalendarInjectionSource) failures.push('phone-injection.js: missing renderCalendarContextInjection');
if (!buildContextInjectionSource) failures.push('phone-injection.js: missing buildContextInjectionPrompts');
for (const expected of [
  'weatherStore',
  'resolveWeatherForDate(weatherStore, date, {\n                storyWeatherEvent: calendarScope.weatherEvent, storyWeatherEventEnabled: calendarScope.weatherEventEnabled,\n            })',
  '天气：${weatherCodeLabel(weather.day.weatherCode)}',
]) requireText('phone-injection.js', renderCalendarInjectionSource, expected);
for (const expected of ['calendarWeather', 'weatherStore: calendarWeather']) requireText('phone-injection.js', buildContextInjectionSource, expected);
for (const expected of [
  'key: OUTFIT_SELF_SUBJECT, label: OUTFIT_SELF_SUBJECT',
  'outfitScopeFor(calendarOutfits, currentStorageId, subject)',
  'start: calendarReferenceDate(calendarScope), subject: label',
  'contentPrefix: `[角色穿搭]\\n${subjectLine}\\n`',
  "contentSuffix: '\\n[结束]'", 'completeLines: true',
]) requireText('phone-injection.js', buildContextInjectionSource, expected);
for (const expected of [
  'calendarDateRangeKeys(windowStart, -3, 6)', 'days: 60', 'calendarCycles',
  'usesExtendedOccasionWindow', 'days: 10', 'Number(occasion.intervalDays) >= 30',
  'cycleSubjectKeys', 'predictCycleRange', 'relativeCalendarLabel', "facts.join('；')", 'resolveWeatherForDate',
]) requireText('phone-injection.js', phoneInjectionCode, expected);
for (const expected of [
  "period: '经期'", "follicular: ''", "ovulatory: '易孕期'", "luteal: ''",
]) requireText('calendar-page-view.js', calendarPageViewCode, expected);
for (const expected of [
  "period: '经期'", "follicular: '相对安全期'", "ovulatory: '易孕期'", "luteal: '安全期'", 'fitCompleteLines',
]) requireText('phone-injection.js', phoneInjectionCode, expected);
const cycleInjectionLabelsSource = phoneInjectionCode.match(/const CYCLE_INJECTION_LABELS\s*=\s*Object\.freeze\(\{[\s\S]*?\}\);/)?.[0] || '';
if (!cycleInjectionLabelsSource) failures.push('phone-injection.js: missing CYCLE_INJECTION_LABELS');
requireText('phone-injection.js', cycleInjectionLabelsSource, "period: '经期', follicular: '相对安全期', ovulatory: '易孕期', luteal: '安全期'");
if (renderCalendarInjectionSource.includes('生理周期规则：')) failures.push('phone-injection.js: dated cycle labels must replace the removed default-rule sentence');
for (const forbidden of ['calendar-story-initial', 'saveStoryInitialDate', 'clearStoryInitialDate']) if (calendarCode.includes(forbidden)) failures.push(`calendar.js: removed story initial date path remains: ${forbidden}`);
requireText('calendar-model.js', calendarModelCode, 'if (parseCalendarDate(source.storyInitialDate)) normalized.storyInitialDate = source.storyInitialDate');
requireText('interactive-scenes.js', interactiveCode, 'generationErrorMessage(error)');
requireText('interactive-scene-scheduler.js', sourceModuleByName.get('interactive-scene-scheduler.js')?.code || '', 'generationErrorMessage(error)');

const uiCode = sourceModuleByName.get('ui.js')?.code || '';
const emojiMediaCode = sourceModuleByName.get('emoji-media.js')?.code || '';
const emojiUiCode = sourceModuleByName.get('emoji-ui.js')?.code || '';
const messagingCode = sourceModuleByName.get('messaging.js')?.code || '';
for (const expected of [
  'export function renderBoldText(value)',
  "return escapeHtml(value).replace(/\\*\\*(?![\\s*])([\\s\\S]*?\\S)\\*\\*/g, '<strong>$1</strong>');",
]) requireText('ui.js bold renderer contract', uiCode, expected);
for (const expected of ['renderBoldText', 'return renderBoldText(display);']) {
  requireText('messaging.js bold renderer contract', messagingCode, expected);
}
for (const expected of [
  'MAX_EMOJI_FILE_BYTES', 'MAX_EMOJI_INLINE_LIBRARY_BYTES', 'cloneEmojiLibrary',
  'emojiFileError', 'emojiSourceError', 'createEmojiRenderBudget', 'isRenderableEmojiSource',
]) requireText('emoji-media.js', emojiMediaCode, expected);
for (const expected of [
  'applySubOverlayTheme(overlay)',
  "overlay.style.setProperty('--pm-r-bg', rightBackground)",
  "overlay.style.setProperty('--pm-r-txt', rightText)",
  "overlay.style.setProperty('--pm-l-bg', theme.customLeft || defaultLeft)",
  "overlay.style.setProperty('--pm-l-txt', theme.customLeft ? contrastText(theme.customLeft) : interfaceMode === 'dark' ? preset.leftTextDark || preset.leftText : preset.leftText)",
  "overlay.style.setProperty('--pm-border', theme.borderColor || '#1a1a1a')",
  'loading="lazy"', 'decoding="async"', 'emojiFileError(file)', 'emojiSourceError(url, window.__pmEmojis)',
]) {
  requireText('emoji-ui.js', emojiUiCode, expected);
}
for (const [label, marker, expected] of [
  ['new-set trigger', 'window.__pmAddEmojiSet()', 'class="pm-emoji-action is-full"'],
  ['add-image trigger', 'window.__pmAddEmojiImage(${setIndex})', 'class="pm-emoji-action is-compact"'],
  ['delete-set trigger', 'window.__pmDeleteEmojiSet(${setIndex})', 'class="pm-emoji-action is-compact is-danger"'],
  ['delete-image trigger', 'window.__pmDeleteEmojiImage(${setIndex},${imageIndex})', 'class="pm-emoji-image-delete"'],
  ['upload trigger', "document.getElementById('pm-emo-file').click()", 'class="pm-emoji-upload"'],
  ['new-set confirmation', 'window.__pmConfirmAddEmojiSet()', 'class="pm-action-button is-accent"'],
  ['add-image confirmation', 'window.__pmConfirmAddEmojiImage(${setIndex})', 'class="pm-action-button is-accent"'],
]) requireText(`emoji-ui.js: ${label}`, buttonContaining(`emoji-ui.js: ${label}`, emojiUiCode, marker), expected);
requireText(
  'emoji-ui.js: delete-image accessible name',
  buttonContaining('emoji-ui.js: delete-image accessible name', emojiUiCode, 'window.__pmDeleteEmojiImage(${setIndex},${imageIndex})'),
  'aria-label="删除图片 ${escapeAttr(image.desc)}"',
);
requireCssDeclarations(cssRules, '.pm-emoji-action', {
  border: '1px solid var(--pm-color-accent)', background: 'color-mix(in srgb,var(--pm-color-accent) 10%,var(--pm-color-surface-elevated))', color: 'var(--pm-color-accent)',
});
requireCssDeclarations(cssRules, '.pm-emoji-upload', {
  border: '1px solid var(--pm-color-accent)', background: 'color-mix(in srgb,var(--pm-color-accent) 10%,var(--pm-color-surface-elevated))', color: 'var(--pm-color-accent)', 'min-height': 'var(--pm-size-control-default)',
});
requireCssDeclarations(cssRules, '.pm-emoji-action.is-full', { width: '100%', 'margin-top': 'var(--pm-space-2)' });
requireCssDeclarations(cssRules, '.pm-emoji-action.is-compact', { padding: 'var(--pm-space-1) var(--pm-space-3)', 'font-size': 'var(--pm-font-size-helper)' });
requireCssDeclarations(cssRules, '.pm-emoji-action.is-danger', {
  'border-color': 'var(--pm-color-danger)', background: 'color-mix(in srgb,var(--pm-color-danger) 10%,var(--pm-color-surface-elevated))', color: 'var(--pm-color-danger)',
});
requireCssDeclarations(cssRules, '.pm-emoji-image-delete', { background: 'var(--pm-color-danger)', color: 'var(--pm-color-on-danger)' });
requireCssDeclarations(cssRules, '.pm-emoji-action:focus-visible', { outline: '2px solid var(--pm-color-focus-ring)', 'outline-offset': '2px' });
requireCssDeclarations(cssRules, '.pm-emoji-upload:focus-visible', { outline: '2px solid var(--pm-color-focus-ring)', 'outline-offset': '2px' });
requireCssDeclarations(cssRules, '.pm-emoji-image-delete:focus-visible', { outline: '2px solid var(--pm-color-focus-ring)', 'outline-offset': '2px' });
requireCssDeclarations(cssRules, '.pm-action-button', { border: '1px solid var(--pm-color-border-default)', 'border-radius': 'var(--pm-radius-control)', background: 'var(--pm-color-surface-elevated)', color: 'var(--pm-color-text-primary)', padding: 'var(--pm-space-2) var(--pm-space-3)', 'font-size': 'var(--pm-font-size-body)', 'font-weight': 'var(--pm-font-weight-semibold)', 'line-height': 'var(--pm-line-height-tight)' });
requireCssDeclarations(cssRules, '.pm-action-button:focus-visible', { outline: '2px solid var(--pm-color-focus-ring)', 'outline-offset': '2px' });
requireCssDeclarations(cssRules, '.pm-action-button:disabled', { cursor: 'not-allowed', opacity: 'var(--pm-opacity-disabled)' });
requireCssDeclarations(cssRules, '.pm-action-button.is-secondary', { background: 'var(--pm-color-surface-elevated)', color: 'var(--pm-color-text-primary)', 'border-color': 'var(--pm-color-border-default)' });
requireCssDeclarations(cssRules, '.pm-action-button.is-success', { background: 'var(--pm-color-success)', color: 'var(--pm-color-on-success)', 'border-color': 'var(--pm-color-success)' });
requireCssDeclarations(cssRules, '.pm-action-button.is-accent', { background: 'var(--pm-color-accent)', color: 'var(--pm-color-on-accent)', 'border-color': 'var(--pm-color-accent)' });
requireCssDeclarations(cssRules, '.pm-action-button.is-danger', { background: 'var(--pm-color-danger)', color: 'var(--pm-color-on-danger)', 'border-color': 'var(--pm-color-danger)' });
requireCssDeclarations(cssRules, '.pm-action-pair', { display: 'grid', 'grid-template-columns': 'repeat(2,minmax(0,1fr))', gap: 'var(--pm-space-2)', width: '100%', 'min-width': '0' });
requireCssDeclarations(cssRules, '.pm-action-pair>button', { 'min-width': '0' });
const exactTwoButtonContainers = [
  '.pm-action-row', '.pm-modal-add', '.pm-calendar-editor-actions', '.pm-calendar-detail-edit-actions',
  '.pm-calendar-entry-actions', '.pm-scene-injection-toolbar', '.pm-scene-injection-actions',
  '.pm-scene-prompt-actions', '.pm-quick-reply-actions', '.pm-today-trend-form-actions',
];
for (const container of exactTwoButtonContainers) {
  requireCssDeclarations(cssRules, `${container}:has(>button:nth-of-type(2):last-of-type)`, {
    display: 'grid', 'grid-template-columns': 'repeat(2,minmax(0,1fr))', width: '100%', 'align-items': 'stretch', gap: 'var(--pm-space-2)',
  });
  requireCssDeclarations(cssRules, `${container}:has(>button:nth-of-type(2):last-of-type)>button`, {
    'box-sizing': 'border-box', width: '100%', 'min-width': '0',
  });
}
for (const [label, fragment, expected] of [
  ['single direct button', '<div><button></button></div>', 1],
  ['two direct buttons with non-button sibling', '<div><span></span><button></button><button></button></div>', 2],
  ['three direct buttons', '<div><button></button><button></button><button></button></div>', 3],
  ['nested button is not direct', '<div><span><button></button></span><button></button></div>', 1],
]) {
  if (countDirectButtons(fragment) !== expected) failures.push(`self-test: ${label} count must be ${expected}`);
}
const exactTwoButtonTemplateContracts = [
  ['settings API actions', settingsTemplatesCode, 'pm-action-row', 'window.__pmTestModel(this)', ['window.__pmTestApi(this)', 'window.__pmTestModel(this)']],
  ['settings backup actions', settingsTemplatesCode, 'pm-action-row', 'window.__pmImportData(this)', ['window.__pmExportData()', "document.getElementById('pm-import-file').click()"]],
  ['quick reply actions', settingsTemplatesCode, 'pm-quick-reply-actions', 'window.__pmClearPhoneQuickReply()', ['window.__pmEnsurePhoneQuickReply()', 'window.__pmClearPhoneQuickReply()']],
  ['worldbook config actions', worldBookSettingsCode, 'pm-modal-add pm-worldbook-actions', 'window.__pmSaveWorldBookConfig()', ['window.__pmResetWorldBookConfig()', 'window.__pmSaveWorldBookConfig()']],
  ['cropper actions', cropperSourceCode, 'pm-modal-add pm-crop-actions', 'pm-crop-confirm', ['pm-crop-cancel', 'pm-crop-confirm']],
  ['calendar cycle actions', calendarViewCode, 'pm-calendar-editor-actions', 'calendar-cycle-save', ['calendar-cycle-clear', 'calendar-cycle-save']],
  ['calendar detail actions', calendarViewCode, 'pm-calendar-detail-edit-actions', 'calendar-outfit-regenerate', ['calendar-outfit-edit', 'calendar-outfit-regenerate']],
  ['calendar repeat delete actions', calendarViewCode, 'pm-calendar-entry-actions', 'data-calendar-repeat-delete="all"', ['data-calendar-repeat-delete="day"', 'data-calendar-repeat-delete="all"']],
  ['scene injection toolbar', interactiveViewsCode, 'pm-scene-injection-toolbar', 'context-clear', ['context-select-all', 'context-clear']],
  ['scene injection actions', interactiveViewsCode, 'pm-scene-injection-actions', 'context-save', ['context-cancel', 'context-save']],
  ['scene prompt actions', interactiveViewsCode, 'pm-scene-prompt-actions', 'save-prompt', ['regenerate-prompt', 'save-prompt']],
  ['conversation injection actions', injectionSaveCode, 'pm-modal-add pm-conversation-injection-actions', 'window.__pmSaveConversationInjection()', ['window.__pmClearConversationInjection()', 'window.__pmSaveConversationInjection()']],
  ['today trend rule actions', todayTrendUiCode, 'pm-today-trend-form-actions pm-action-pair', 'today-trend-cancel-rule-editor', ['today-trend-cancel-rule-editor', 'type="submit"']],
  ['today trend world actions', todayTrendWorldViewCode, 'pm-today-trend-form-actions pm-action-pair', 'today-trend-cancel-world-editor', ['today-trend-cancel-world-editor', 'type="submit"']],
];
for (const [label, text, className, marker, orderedMarkers] of exactTwoButtonTemplateContracts) {
  requireExactTwoButtonContainer(label, text, className, marker, orderedMarkers);
}
requireDirectButtonCount('calendar single-button generation action', calendarViewCode, 'pm-calendar-editor-actions', 'calendar-generation-rule-save', 1);
requireDirectButtonCount('calendar three-button month actions', calendarViewCode, 'pm-calendar-month-panel-actions', 'calendar-base-save', 3);
for (const rule of cssRules.filter(candidate => candidate.selectors.some(selector => exactTwoButtonContainers.some(container => selector.startsWith(`${container}:has(`))))) {
  if (rule.declarations.has('order')) failures.push(`style.css:${rule.line}: exact-two-button layout must not reorder DOM controls`);
}
requireDirectButtonCount('contact switcher has three entry buttons', directoryCode, 'pm-contact-switcher-actions', 'window.__pmShowAddContact', 3);
requireDirectButtonCount('directory footer has three entry buttons', directoryCode, 'pm-modal-add pm-directory-actions', 'window.__pmShowAddContact', 3);
const accentSaveRule = cssRules.find(rule => rule.selectors.includes(':is(#pm-iphone,#pm-overlay,#pm-overlay-sub) button:is([data-action*="save"],[onclick*="__pmSave"])'));
if (!accentSaveRule
  || accentSaveRule.declarations.get('background') !== 'var(--pm-color-accent) !important'
  || accentSaveRule.declarations.get('color') !== 'var(--pm-color-on-dark) !important'
  || accentSaveRule.declarations.get('border-color') !== 'var(--pm-color-accent) !important') {
  failures.push('style.css: theme-accent save buttons must keep the existing accent background and use white on-dark text');
}
for (const selector of [
  ':is(#pm-iphone,#pm-overlay,#pm-overlay-sub) button:is(.is-accent,.is-api-test,.pm-contact-add-primary,.pm-contact-add-ai,.pm-contact-settings-save,.pm-scene-primary)',
  '#pm-iphone :is(.pm-contact-switcher-actions button.is-primary,.pm-quick-reply-actions button:not(.is-danger),.pm-desktop-community-dock button,.pm-today-trend-form-actions button[type="submit"],.pm-today-trend-mode-switch button[aria-pressed="true"],.pm-today-trend-primary-action,.pm-calendar-editor-actions .is-primary)',
]) requireCssDeclarations(cssRules, selector, { color: 'var(--pm-color-on-dark) !important' });
requireCssDeclarations(cssRules, '.pm-scene-primary', { background: 'var(--scene-accent) !important', color: 'var(--pm-color-on-dark) !important' });
requireCssDeclarations(cssRules, '.pm-scene-comment-composer button', { background: 'var(--scene-accent)', color: 'var(--pm-color-on-dark)' });
requireCssDeclarations(cssRules, '.pm-calendar-editor-actions .is-primary', { color: 'var(--pm-color-on-dark) !important' });
requireCssDeclarations(cssRules, '.pm-calendar-month-panel-actions .is-primary', { background: 'var(--pm-calendar-accent)', color: 'var(--pm-color-on-dark)' });
requireCssDeclarations(cssRules, '.pm-calendar-entry-actions .is-primary', { background: 'var(--pm-calendar-accent)', color: 'var(--pm-color-on-dark)' });
requireCssDeclarations(cssRules, '.pm-calendar-data-row .is-primary', { background: 'var(--pm-calendar-accent) !important', color: 'var(--pm-color-on-dark) !important' });
requireCssDeclarations(cssRules, '.pm-modal-add .pm-action-button.is-success', { color: 'var(--pm-color-on-success) !important' });
requireCssDeclarations(cssRules, '.pm-modal-add .pm-action-button.is-danger', { color: 'var(--pm-color-on-danger) !important' });
requireCssDeclarations(cssRules, '.pm-quick-reply-actions button.is-danger', { background: 'var(--pm-color-danger)', color: 'var(--pm-color-on-danger)' });
const editableFocusRules = cssRules.filter(rule => rule.selectors.some(selector => selector.includes('[contenteditable="true"]') && /:focus(?:-visible)?$/.test(selector)));
for (const state of [':focus', ':focus-visible']) {
  const rule = editableFocusRules.find(candidate => candidate.selectors.some(selector => selector.endsWith(state)));
  if (!rule
    || rule.declarations.get('border-color') !== 'var(--pm-color-accent) !important'
    || rule.declarations.get('outline') !== 'var(--pm-space-0-5) solid var(--pm-color-accent) !important'
    || rule.declarations.get('outline-offset') !== 'var(--pm-space-px-1) !important') {
    failures.push(`style.css: editable controls ${state} must use the thick theme-accent border and outline`);
  }
}
for (const selector of [
  '#pm-overlay .pm-contact-settings-scroll textarea.pm-cfg-input',
  '#pm-overlay .pm-group-settings-scroll textarea.pm-cfg-input',
]) {
  const rule = cssRules.find(candidate => candidate.selectors.includes(selector));
  if (rule?.declarations.get('outline') === 'none !important') failures.push(`style.css: ${selector} must not suppress the shared accent focus outline`);
}
for (const selector of [
  ':is(#pm-overlay .pm-contact-settings-scroll textarea.pm-cfg-input,#pm-overlay .pm-group-settings-scroll textarea.pm-cfg-input):focus',
  ':is(#pm-overlay .pm-contact-settings-scroll textarea.pm-cfg-input,#pm-overlay .pm-group-settings-scroll textarea.pm-cfg-input):focus-visible',
]) requireCssDeclarations(cssRules, selector, {
  'border-color': 'var(--pm-color-accent) !important',
  outline: 'var(--pm-space-0-5) solid var(--pm-color-accent) !important',
  'outline-offset': 'var(--pm-space-px-1) !important',
});
requireCssDeclarations(cssRules, '#pm-overlay .pm-calendar-entry-dialog textarea[name="note"]:focus-visible', {
  'border-color': 'var(--pm-color-accent) !important',
  outline: 'var(--pm-space-0-5) solid var(--pm-color-accent) !important',
  'outline-offset': 'var(--pm-space-px-1) !important',
});
requireCssDeclarations(cssRules, ':is(#pm-iphone,#pm-overlay,#pm-overlay-sub) :is(#pm-behavior-private,#pm-behavior-group,#pm-group-random-npc-prompt,#pm-scene-style,#pm-scene-prompt,.pm-calendar-generation-rule,.pm-today-trend-rule-editor textarea)', {
  'font-size': 'var(--pm-font-size-compact) !important',
});
requireCssDeclarations(cssRules, '.pm-contact-switcher-actions button', { 'font-weight': 'var(--pm-font-weight-regular)' });
requireCssDeclarations(cssRules, '.pm-directory-actions>button', { 'font-weight': 'var(--pm-font-weight-regular) !important' });
for (const [label, text, expected] of [
  ['private style prompt', phoneChatPokeCodeForChecks, 'id="pm-behavior-private"'],
  ['group style prompt', phoneChatPokeCodeForChecks, 'id="pm-behavior-group"'],
  ['group NPC prompt', directoryCode, 'id="pm-group-random-npc-prompt"'],
  ['scene custom style prompt', interactiveViewsCode, 'id="pm-scene-style"'],
  ['scene generated prompt', interactiveViewsCode, 'id="pm-scene-prompt"'],
  ['calendar generation prompt', calendarViewCode, 'class="pm-calendar-generation-rule"'],
  ['today trend rule prompt', todayTrendUiCode, 'class="pm-today-trend-input" name="text"'],
]) requireText(`prompt typography source: ${label}`, text, expected);
requireCssDeclarations(cssRules, '.pm-today-trend-detail-row', { display: 'grid', 'grid-template-columns': 'repeat(2,minmax(0,1fr))', gap: 'var(--pm-space-2)', 'margin-bottom': 'var(--pm-space-2)' });
for (const selector of ['.pm-today-trend-detail-add', '.pm-today-trend-detail-remove']) {
  requireCssDeclarations(cssRules, selector, {
    'box-sizing': 'border-box',
    'min-height': 'var(--pm-size-control-default)',
    border: '1px solid var(--pm-color-border-default)',
    'border-radius': 'var(--pm-radius-control)',
    background: 'var(--pm-color-surface-control)',
    padding: 'var(--pm-space-0) var(--pm-space-3)',
    cursor: 'pointer',
  });
}
const detailAddWidthRule = cssRules.find(rule => rule.selectors.includes('.pm-today-trend-detail-add')
  && rule.declarations.get('width') === '100%');
if (!detailAddWidthRule) failures.push('style.css: .pm-today-trend-detail-add must use full available width');
const detailRemoveSemanticRule = cssRules.find(rule => rule.selectors.includes('.pm-today-trend-detail-remove')
  && rule.declarations.get('color') === 'var(--pm-color-danger)');
if (!detailRemoveSemanticRule || detailRemoveSemanticRule.declarations.get('grid-column') !== '1 / -1') {
  failures.push('style.css: .pm-today-trend-detail-remove must use secondary danger text and span the detail row');
}
for (const selector of ['.pm-today-trend-detail-add:focus-visible', '.pm-today-trend-detail-remove:focus-visible']) {
  requireCssDeclarations(cssRules, selector, { outline: 'var(--pm-today-trend-focus-offset) solid var(--pm-color-focus-ring)', 'outline-offset': 'var(--pm-today-trend-focus-offset)' });
}
requireCssDeclarations(cssRules, '.pm-today-trend-content button:disabled', { opacity: 'var(--pm-opacity-disabled)', cursor: 'not-allowed' });
const compactActionPairRule = cssRules.find(rule => /@media\s*\(max-width:320px\)/.test(rule.parent) && rule.selectors.includes('.pm-action-pair'));
if (compactActionPairRule?.declarations.get('grid-template-columns') !== 'repeat(2,minmax(0,1fr))') failures.push('style.css: 320px pm-action-pair must preserve two equal columns');
const compactDetailRowRule = cssRules.find(rule => /@media\s*\(max-width:320px\)/.test(rule.parent) && rule.selectors.includes('.pm-today-trend-detail-row'));
if (compactDetailRowRule?.declarations.get('grid-template-columns') !== 'minmax(0,1fr)') failures.push('style.css: 320px detail editor rows must collapse to one safe column');
requireCssDeclarations(cssRules, '.pm-modal-add button', { border: '1px solid var(--pm-color-border-default)', 'border-radius': 'var(--pm-radius-control)', background: 'var(--pm-color-surface-elevated) !important', color: 'var(--pm-color-text-primary) !important' });
requireCssDeclarations(cssRules, '.pm-modal-add .pm-action-button.is-success', { background: 'var(--pm-color-success) !important', color: 'var(--pm-color-on-success) !important', 'border-color': 'var(--pm-color-success) !important' });
requireCssDeclarations(cssRules, '.pm-modal-add .pm-action-button.is-accent', { background: 'var(--pm-color-accent) !important', color: 'var(--pm-color-on-accent) !important', 'border-color': 'var(--pm-color-accent) !important' });
requireCssDeclarations(cssRules, '.pm-modal-add .pm-action-button.is-danger', { background: 'var(--pm-color-danger) !important', color: 'var(--pm-color-on-danger) !important', 'border-color': 'var(--pm-color-danger) !important' });
requireCssDeclarations(cssRules, '.pm-btn-group', { border: '1px solid var(--pm-color-border-default) !important', 'border-radius': 'var(--pm-radius-control) !important', background: 'var(--pm-color-surface-elevated) !important', color: 'var(--pm-color-text-primary) !important' });
requireCssDeclarations(cssRules, '.pm-btn-add', { border: '1px solid var(--pm-color-border-default) !important', 'border-radius': 'var(--pm-radius-control) !important', background: 'var(--pm-color-surface-elevated) !important', color: 'var(--pm-color-text-primary) !important' });
for (const [state, token] of [['error', '--pm-color-danger'], ['warning', '--pm-color-warning'], ['success', '--pm-color-success'], ['info', '--pm-color-accent']]) {
  requireCssDeclarations(cssRules, `.pm-api-status[data-state="${state}"]`, { color: `var(${token})` });
}
for (const expected of ['isRenderableEmojiSource(url)', "typeof emojiBudget === 'function'", '!emojiBudget(url)', 'loading="lazy"', 'decoding="async"', 'class="pm-emoji-image"']) {
  requireText('messaging.js', messagingCode, expected);
}
for (const expected of ['createEmojiRenderBudget()', 'emojiBudget: emojiRenderBudget', 'resetEmojiRenderBudget']) {
  requireText('phone-message-rendering.js', phoneMessageRenderingCode, expected);
}
for (const expected of ['resetEmojiRenderBudget()', "list.innerHTML = ''"]) {
  requireText('conversation-rendering.js', conversationRenderingCode, expected);
}
requireText('conversation-rendering.js', conversationRenderingCode, 'nameEl.textContent = state.isGroupChat ? state.groupDisplayName || name : name');
for (const forbidden of ['arr.length > 5', "arr.slice(0, 5).join('') + '...'"]) {
  if (conversationRenderingCode.includes(forbidden)) failures.push(`conversation-rendering.js: chat title must preserve full text: ${forbidden}`);
}

const runtimeCode = sourceModuleByName.get('runtime.js')?.code || '';
for (const expected of [
  'autoPokeArmed: false', 'automaticEpoch: 0', 'automaticTasks: new Map()',
  'createAutomaticTaskController', 'const taskKey = `${storageId}\\u0000${contactName}`',
  'getStorageId() !== storageId', 'advanceAutoPokeCounters',
  'runAutoPokeCounterCycle', 'await run(contactName)', 'commitAutomaticResult', 'await persistHistory()', 'persistCounter()',
]) requireText('runtime.js', runtimeCode, expected);
for (const expected of [
  'PENDING_MESSAGE_LIMIT = 50', 'isPendingMessageLimitReached',
  'if (isPendingMessageLimitReached(runtime, storageId, saveKey)) return null;',
]) requireText('pending-messages.js', sourceModuleByName.get('pending-messages.js')?.code || '', expected);
requireText('phone-chat.js', phoneChatCode, '当前会话暂存最多保留 ${PENDING_MESSAGE_LIMIT} 条');
for (const expected of [
  'hasCompletedAssistantMessage && isAutoPokeAllowed()',
]) requireText('phone-host-events.js', phoneHostEventsCode, expected);
for (const expected of ["disarmAutoPoke?.('host-chat-changed')", 'updatePhonePageSuspensionHandler(window, deps, disarmAutoPoke)', 'createAutomaticTaskController', 'automaticTasks.begin', 'automaticTasks.isActive', 'automaticTasks.finish']) {
  requireText('phone-foundation.js', foundationCode, expected);
}
for (const expected of [
  "disarmAutoPoke('phone-minimized')", "disarmAutoPoke('phone-closed')",
]) requireText('phone-lifecycle.js', lifecycleCode, expected);
for (const expected of [
  'runAutoPokeCounterCycle({',
  'run: contactName => window.__pmAutoPoke(contactName)',
  "'这次会自动发一条。'", "'这次没有自动发消息。'",
]) requireText('phone-chat.js', phoneChatCode, expected);
if (phoneChatCode.includes('config.autoPoke.counter = 0')) {
  failures.push('phone-chat.js: threshold detection must not clear auto-poke counters before a successful commit');
}
for (const expected of [
  'if (state.isGenerating || !isAutoPokeAllowed()) return false;',
  'const automaticTask = beginAutomaticTask(id, contactName);',
  'if (!isAutomaticRequestActive()) return false;',
  'await commitAutomaticResult({',
  'persistHistory: () => saveHistoriesStrict()',
  'applyBidirectionalInjection();',
  'window.__pmArmAutoPoke',
  'resetAutoPokeCounter(id, contactName)',
  'resetAutoPokeCounter(storageId, saveKey)',
]) requireText('phone-chat-poke.js', phoneChatPokeCode, expected);
for (const expected of [
  'replaceConversationHistory', 'restoreConversationHistory',
]) requireText('phone-chat-poke.js history adapter', phoneChatPokeCode, expected);
assertPokeHistoryAdapter(phoneChatPokeAnalysis, phoneChatPokeCode);
for (const write of findWindowDescendantWrites(phoneChatPokeCode, '__pmHistories')) {
  failures.push(`phone-chat-poke.js: history write must use conversation persistence adapter: ${phoneChatPokeCode.slice(write.start, write.end)}`);
}
for (const expected of [
  'export function resetAutoPokeCounter', 'probability: 30', 'migrateIntervalToProbability',
  "if (nextAutoPoke.enabled && patch?.enabled === true) nextAutoPoke.counter = 0",
]) requireText('auto-poke-config.js', sourceModuleByName.get('auto-poke-config.js')?.code || '', expected);
for (const expected of [
  'advanceAutoPokeCounters(configs, persist, rng = Math.random)',
  'if (roll < probability)', 'autoPoke.counter = 1',
]) requireText('runtime.js probability auto-poke', runtimeCode, expected);
for (const expected of [
  'pm-session-auto-poke-probability', '__pmSaveCurrentAutoPokeProbability',
  '每次有', '几率自动发消息',
]) requireText('phone-control-center.js probability auto-poke', controlCenterCode, expected);
for (const code of [phoneChatPokeCode, directoryCode]) {
  if (code.includes('Math.min(oldCounter, interval - 1)')) failures.push('auto-poke settings: failed threshold must not be truncated while saving settings');
}

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


for (const expected of [
  '#pm-iphone', '#pm-overlay', '.pm-model-options', '--pm-model-visible-rows', '--pm-font-family-system', '--pm-font-family-mono',
  '@media(max-width:500px),(max-height:700px)', '@media(max-width:600px)', '@media(max-width:320px)',
  '@media(pointer:coarse) and (max-height:500px)', '#pm-iphone .pm-scene-shell',
]) {
  requireText('css', css, expected);
}
for (const expected of [
  '.pm-msg-list', '.pm-input', '.pm-confirm-bar', '.pm-modal', '.pm-cfg-tab',
  '.pm-phone-page', '.pm-desktop-grid', '.pm-desktop-app', '.pm-desktop-app-icon', '.pm-desktop-app-label',
  '.pm-desktop-pin', '.pm-community-page', '.pm-independent-api-fields[hidden]', '[data-calendar-management="weather"]',
]) {
  requireText('css', css, expected);
}
requireCssDeclarations(cssRules, '.pm-desktop-app-icon', {
  background: 'var(--pm-color-accent)',
  color: 'var(--pm-color-on-accent)',
});
requireCssDeclarations(cssRules, '.pm-quick-reply-actions button', {
  background: 'var(--pm-color-accent)',
  color: 'var(--pm-color-on-accent)',
});
requireCssDeclarations(cssRules, '.pm-desktop-community-dock button', {
  background: 'var(--pm-color-accent)',
  color: 'var(--pm-color-on-accent)',
});
const sceneSendActionContracts = [
  {
    action: 'publish',
    container: '<div class="pm-scene-composer"><textarea id="pm-scene-post-input" maxlength="4082" placeholder="分享此刻……"></textarea>',
    selector: '.pm-scene-composer .pm-scene-primary',
    buttonParts: ['class="pm-scene-primary"', 'aria-label="发布"', 'title="发布"'],
  },
  {
    action: 'send-danmaku',
    container: '<div class="pm-scene-composer pm-danmaku-input"><textarea id="pm-danmaku-input" rows="1" maxlength="200" placeholder="发个弹幕见证当下"></textarea>',
    selector: '.pm-scene-composer .pm-scene-primary',
    buttonParts: ['class="pm-scene-primary"', 'aria-label="发送弹幕"', 'title="发送弹幕"'],
  },
  {
    action: 'post-comment',
    container: '<div id="pm-comment-composer-${escapeAttr(post.id)}" class="pm-scene-comment-composer" hidden><input id="pm-comment-input-${escapeAttr(post.id)}" maxlength="1082" placeholder="发表你的想法吧">',
    selector: '.pm-scene-comment-composer button',
    buttonParts: ['aria-label="发送回复"', 'title="发送回复"'],
  },
];
for (const { action, container, selector, buttonParts } of sceneSendActionContracts) {
  const button = buttonContaining(`interactive-scene-views.js: ${action} action`, interactiveViewsCode, `data-action="${action}"`);
  for (const part of buttonParts) requireText(`interactive-scene-views.js: ${action} action`, button, part);
  requireText(`interactive-scene-views.js: ${action} composer`, interactiveViewsCode, `${container}${button}</div>`);
  const selectorRule = cssRules.find(rule => rule.selectors.includes(selector)
    && rule.declarations.get('background')?.startsWith('var(--scene-accent)')
    && rule.declarations.get('color')?.startsWith('var(--pm-color-on-dark)'));
  if (!selectorRule) failures.push(`style.css: ${action} must remain bound to a scene-accent send selector`);
}
const sceneSendSelectors = [
  '.pm-scene-composer .pm-scene-primary',
  '.pm-scene-comment-composer button',
];
for (const selector of sceneSendSelectors) {
  const sceneSendRule = cssRules.find(rule => rule.selectors.includes(selector)
    && rule.declarations.get('background')?.startsWith('var(--scene-accent)'));
  if (!sceneSendRule) failures.push(`style.css: ${selector} must consume --scene-accent for its background`);
  const sceneSendColorRule = cssRules.find(rule => rule.selectors.includes(selector)
    && rule.declarations.get('color')?.startsWith('var(--pm-color-on-dark)'));
  if (!sceneSendColorRule) failures.push(`style.css: ${selector} must consume --pm-color-on-dark for its foreground`);
  for (const rule of cssRules.filter(candidate => candidate.selectors.includes(selector))) {
    for (const property of ['background', 'background-color', 'color', 'border-color']) {
      const value = rule.declarations.get(property) || '';
      if (value.includes('var(--pm-color-accent)') || value.includes('var(--pm-color-auxiliary)')) {
        failures.push(`style.css: ${selector} must not leak global accent tokens through ${property}`);
      }
    }
  }
}
for (const selector of [
  '.pm-scene-shell :is(.pm-scene-composer .pm-scene-primary,.pm-scene-comment-composer button):focus-visible',
  '.pm-scene-shell :is(.pm-scene-composer .pm-scene-primary,.pm-scene-comment-composer button):disabled',
]) if (!cssRules.some(rule => rule.selectors.includes(selector))) failures.push(`style.css: missing community send state ${selector}`);
const cssTokenContract = {
  '--pm-font-family-system': "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif",
  '--pm-font-family-mono': 'ui-monospace,SFMono-Regular,Consolas,monospace',
  '--pm-line-height-loose': '1.75',
  '--pm-radius-pill': '999px',
  '--pm-shadow-floating': '0 8px 24px rgba(0,0,0,.14)',
  '--pm-shadow-modal': '0 16px 48px rgba(0,0,0,.18)',
  '--pm-z-base': '0',
  '--pm-z-menu': '20',
  '--pm-z-popover': '30',
  '--pm-z-modal': '40',
  '--pm-z-host': '2147483647',
  '--pm-opacity-disabled': '.45',
  '--pm-opacity-muted': '.62',
  '--pm-motion-fast': '120ms',
  '--pm-motion-normal': '180ms',
  '--pm-motion-ease': 'cubic-bezier(.2,.8,.2,1)',
};
requireCssDeclarations(cssRules, ':root', cssTokenContract);
for (const [token, value] of Object.entries(cssTokenContract)) {
  requireText('docs/CSS-TOKENS.md', cssTokensText, `\`${token}:${value}\``);
}
for (const expected of [
  'export function createPhoneQuoteController(state)', 'function clearQuoteHighlight()', 'clearTimeout(quoteHighlightTimer)',
  'quoteHighlightTimer = null;', 'quoteHighlightTarget = null;',
]) requireText('phone-quote.js', phoneQuoteCode, expected);
for (const expected of [
  "import { createPhoneQuoteController } from './phone-quote.js';",
  'const quote = createPhoneQuoteController(state);',
  'refreshReplyCardAvailability, clearQuoteHighlight',
]) requireText('phone-foundation.js', foundationCode, expected);
for (const forbidden of [
  'let quoteHighlightTimer', 'let quoteHighlightTarget',
  'function renderActiveQuote()', 'function clearActiveQuote()', 'function setActiveQuote(quote)',
  'function findQuotedBubble(quote)', 'function syncReplyCardAvailability(card)',
  'function refreshReplyCardAvailability()', 'function locateQuotedBubble(quote)',
]) {
  if (foundationCode.includes(forbidden)) failures.push(`phone-foundation.js: quote controller responsibility must stay in phone-quote.js (${forbidden})`);
}
if (findDirectStatePropertyWrites(foundationCode, 'activeQuote').length) {
  failures.push('phone-foundation.js: activeQuote mutations must stay in phone-quote.js');
}
const phoneEndStart = lifecycleCode.indexOf('window.__pmEnd = (force = false) => {');
const phoneWindowRemoval = lifecycleCode.indexOf('state.phoneWindow.remove()', phoneEndStart);
const quoteHighlightCleanup = lifecycleCode.indexOf('deps.clearQuoteHighlight?.();', phoneEndStart);
if (quoteHighlightCleanup < 0 || quoteHighlightCleanup > phoneWindowRemoval) {
  failures.push('phone-lifecycle.js: quote highlight must be cleared before the phone window is removed');
}
if (css.includes('prefers-color-scheme')) failures.push('css: theme selection must remain explicit and must not use prefers-color-scheme');
if (/\btransition\s*:\s*all\b/i.test(css)) failures.push('css: transition:all is forbidden; list the properties that actually animate');
if (/\b(?:transition|transitionProperty)\s*(?:=|:)\s*['\"]all\b/i.test(source)) failures.push('source: inline transition:all is forbidden; list the properties that actually animate');
if (source.includes('pm-css')) failures.push('source: inline CSS injector id still present');
if (css.includes('${')) failures.push('css: JavaScript template expression remains');
if (manifest.name !== 'phone_mode') failures.push('manifest: internal extension id must remain phone_mode');
if (manifest.display_name !== '天音小笺') failures.push('manifest: display_name must be 天音小笺');
if (/\p{Extended_Pictographic}/u.test(manifest.display_name || '')) failures.push('manifest: display_name must not contain emoji');
if (!/个人.*自用|自用.*个人/.test(manifest.description || '')) failures.push('manifest: description must identify the project as personal use');
if (/SillyTavern|酒馆/i.test(manifest.description || '')) failures.push('manifest: description must not contain host platform keywords');
if (manifest.js !== 'index.js') failures.push('manifest: js entry must remain index.js');
if (manifest.css !== 'style.css') failures.push('manifest: css entry must be style.css');

if (packageJson.name !== 'tianyin-xiaojian-st') failures.push('package: name must be tianyin-xiaojian-st');
if (manifest.version !== packageJson.version) failures.push('version: manifest.json and package.json must match');
if (packageJson.private !== true) failures.push('package: private must remain true');
if (!/personal/i.test(packageJson.description || '')) failures.push('package: description must identify personal use');
if (/SillyTavern|酒馆|TauriTavern/i.test(packageJson.description || '')) failures.push('package: description must not contain host platform keywords');
if (packageLock.name !== packageJson.name || packageLock.packages?.['']?.name !== packageJson.name) {
  failures.push('package-lock: root package name must match package.json');
}
if (packageLock.version !== packageJson.version
    || packageLock.packages?.['']?.version !== packageJson.version) {
  failures.push('version: package-lock.json root versions must match package.json');
}
if (packageJson.version !== '1.5.0') failures.push('version: expected release version 1.5.0');

const readmeLines = readme.split(/\r?\n/);
if (readmeLines[0] !== '# 天音小笺') failures.push('README: title must be 天音小笺');
const readmeIntro = readmeLines[2] || '';
if (readmeIntro !== '个人自用项目，基于 [K20070831/sillytavern-phone-mode-1](https://github.com/K20070831/sillytavern-phone-mode-1) 的二次创作。') {
  failures.push('README: introduction must use the approved personal derivative-project wording');
}
for (const expected of [
  'K20070831/sillytavern-phone-mode-1',
  'https://github.com/K20070831/sillytavern-phone-mode-1',
  '打开 SillyTavern 的扩展管理页面。',
  '安装后输入 `/phone` 启动。',
  '可以在设置页面固定 `/phone`，方便后续启动。',
  '仅用于个人自用维护。',
  '当前维护者已取得上游作者许可。',
  '备份可能包含 API Key 和聊天数据，请勿公开。',
]) requireText('README', readme, expected);
for (const forbidden of [
  '这是个人自用的手机聊天界面维护项目',
  '不作为上游原版发行',
  '本仓库保留上游提交历史',
  '上游当前未提供公开 LICENSE',
  '不将上游代码冒充为原创',
  '`/phone` 是为兼容旧用法保留的命令',
  '## 开发',
  'npm run build',
]) {
  if (readme.includes(forbidden)) failures.push(`README: removed internal wording remains: ${forbidden}`);
}

const settingsUiCode = sourceModuleByName.get('settings-ui.js')?.code || '';
const settingsBackupControllerForContract = sourceModuleByName.get('settings-backup-controller.js')?.code || '';
const backupModuleBinding = analyzeBackupModuleBinding(settingsUiCode, settingsBackupControllerForContract, settingsBackupValidateCode);
for (const [field, message] of Object.entries({
  importsValidatorParser: 'settings-ui.js: must import parseBackupData from ./settings-backup-validate.js',
  reexportsValidatorParser: 'settings-ui.js: must re-export the imported parseBackupData binding',
  prepareCallsValidatorParser: 'settings-ui.js: backup prepare callback must call the imported parseBackupData binding',
  validatorExportsParserFunction: 'settings-backup-validate.js: must export parseBackupData as a function declaration',
})) {
  if (!backupModuleBinding[field]) failures.push(message);
}
const settingsUiBackupContract = analyzeBackupContract(settingsUiCode);
const settingsBackupControllerContract = analyzeBackupContract(settingsBackupControllerForContract);
const settingsBackupValidateContract = analyzeBackupContract(settingsBackupValidateCode);
const sourceBackupContract = {
  exportFields: new Set([...settingsUiBackupContract.exportFields, ...settingsBackupControllerContract.exportFields, ...settingsBackupValidateContract.exportFields]),
  importFields: new Set([...settingsUiBackupContract.importFields, ...settingsBackupValidateContract.importFields]),
  importReadsFileName: settingsUiBackupContract.importReadsFileName || settingsBackupControllerContract.importReadsFileName || settingsBackupValidateContract.importReadsFileName,
};
const backupMetadataFields = new Set(['schemaVersion']);
const backupFields = [
  'histories', 'config', 'theme', 'profiles', 'groupMeta',
  'pokeConfig', 'bidirectional', 'emojis', 'characterBehavior',
  'wordyLimit', 'galBubbleEnabled', 'desktopBg', 'bgGlobal', 'bgLocal', 'interactiveScenes', 'phoneUiState', 'ambientStatus', 'budgetConfig', 'todayTrend',
];
for (const [label, contract] of [
  ['source backup modules', sourceBackupContract],
  ['bundle', analyzeBackupContract(bundle, 'script')],
]) {
  for (const field of backupFields) {
    if (!contract.exportFields.has(field)) failures.push(`${label}: backup export field missing ${field}`);
    if (!contract.importFields.has(field)) failures.push(`${label}: backup import field missing ${field}`);
  }
  const exportOnly = [...contract.exportFields]
    .filter(field => !backupMetadataFields.has(field) && !contract.importFields.has(field)).sort();
  const importOnly = [...contract.importFields]
    .filter(field => !contract.exportFields.has(field)).sort();
  if (exportOnly.length) failures.push(`${label}: backup fields exported but not imported: ${exportOnly.join(', ')}`);
  if (importOnly.length) failures.push(`${label}: backup fields imported but not exported: ${importOnly.join(', ')}`);
  if (contract.importReadsFileName) failures.push(`${label}: backup import must not depend on file.name`);
}
for (const expected of [
  'PLUGIN_LOCAL_STORAGE_KEYS', 'PLUGIN_IDB_STATIC_KEYS', 'PLUGIN_IDB_DYNAMIC_PREFIXES',
  'clearPluginData', 'pmIDBKeys', "Object.freeze(['ST_SMS_BG_LOCAL_'])",
]) requireText('storage.js', sourceModuleByName.get('storage.js')?.code || '', expected);
requireText('storage-primitives.js', storagePrimitivesCode, "DESKTOP_BG_KEY = 'ST_SMS_BG_DESKTOP'");
const storageCodeForCleanup = sourceModuleByName.get('storage.js')?.code || '';
for (const expected of ['CALENDAR_OUTFIT_STORAGE_KEY', 'ST_SMS_PHONE_QR_INITIALIZED']) {
  requireText('storage.js', storageCodeForCleanup, expected);
}
if (!storageCodeForCleanup.includes('CALENDAR_RECIPE_STORAGE_KEY, CALENDAR_OUTFIT_STORAGE_KEY')) {
  failures.push('storage.js: plugin localStorage cleanup ledger must include calendar outfits after recipes');
}
if (storageCodeForCleanup.includes("'ST_SMS_MIGRATED_V3'")) {
  failures.push('storage.js: migration sentinel must remain outside the plugin cleanup ledger');
}
for (const expected of [
  'loadBgSettings', 'saveBgGlobal', 'saveBgLocal', 'saveDesktopBg', "label: '桌面背景'",
  'restoreBackgroundMutations', 'combinedBackgroundError', "LOCAL_BG_PREFIX = 'ST_SMS_BG_LOCAL_'",
]) requireText('storage-background.js', storageBackgroundCode, expected);
if (storageCodeForCleanup.includes("PLUGIN_LOCAL_STORAGE_KEYS = Object.freeze(['ST_SMS_MIGRATED_V3'")) {
  failures.push('storage.js: migration marker must not be cleared or legacy host histories can be reimported');
}

const asymmetricBackupSample = analyzeBackupContract(`
  window.__pmExportData = () => { const data = { histories: {}, newField: {} }; return data; };
  function parseBackupData(data) { if (Object.hasOwn(data, 'histories')) return data.histories; }
`);
if (![...asymmetricBackupSample.exportFields].some(field => !asymmetricBackupSample.importFields.has(field))) {
  failures.push('self-test: backup symmetry detector missed export-only field');
}
const symmetricBackupSample = analyzeBackupContract(`
  window.__pmExportData = () => { const data = { histories: {} }; return data; };
  function parseBackupData(data) { if (Object.hasOwn(data, 'histories')) return data.histories; }
`);
if (!symmetricBackupSample.importFields.has('histories')) failures.push('self-test: parseBackupData import detector missed field');

const compatibilityStrings = [
  'PhoneModeDB', 'kv', 'PHONE_SMS_MEMORY',
  'ST_SMS_DATA_V2', 'ST_SMS_CONFIG', 'ST_SMS_THEME', 'ST_SMS_POKE_CONFIG',
  'ST_SMS_BIDIRECTIONAL', 'ST_SMS_CHARACTER_BEHAVIOR', 'ST_SMS_EMOJIS',
  'ST_SMS_GROUP_META', 'ST_SMS_API_PROFILES', 'ST_SMS_BG_GLOBAL', 'ST_SMS_BG_LOCAL',
  'ST_SMS_BUDGET_CONFIG',
];
for (const [label, , result] of analyzedFiles) {
  for (const expected of compatibilityStrings) {
    if (!result.stringLiterals.has(expected)) failures.push(`${label}: compatibility string missing ${expected}`);
  }
  if (result.stringLiterals.has('📱 Phone Mode')) failures.push(`${label}: legacy visible title remains`);
}

const entries = await readdir(root, { recursive: true });
for (const entry of entries) {
  const normalized = entry.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.includes('.git') || segments.includes('node_modules')) continue;
  if (/(?:PhoneMode|TianyinXiaojian).*Backup.*\.json$/i.test(normalized)) failures.push(`sensitive backup file present: ${normalized}`);
  if (/(^|\/)\.env(?:\.|$)/.test(normalized) && path.posix.basename(normalized) !== '.env.example') failures.push(`environment file present: ${normalized}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Static contracts verified.');
