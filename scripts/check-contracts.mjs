import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import { build } from 'esbuild';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const [srcEntries, bundle, css, manifestText, packageText, lockText, readme] = await Promise.all([
  readdir(srcRoot, { recursive: true }),
  readFile(path.join(root, 'index.js'), 'utf8'),
  readFile(path.join(root, 'style.css'), 'utf8'),
  readFile(path.join(root, 'manifest.json'), 'utf8'),
  readFile(path.join(root, 'package.json'), 'utf8'),
  readFile(path.join(root, 'package-lock.json'), 'utf8'),
  readFile(path.join(root, 'README.md'), 'utf8'),
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
const packageJson = JSON.parse(packageText);
const packageLock = JSON.parse(lockText);
const failures = [];
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

const normalizeLineEndings = value => String(value).replace(/\r\n?/g, '\n');
function requireText(label, text, expected) {
  if (!normalizeLineEndings(text).includes(normalizeLineEndings(expected))) failures.push(`${label}: missing ${expected}`);
}

function parseCssRules(cssText) {
  const rules = [];
  for (const match of normalizeLineEndings(cssText).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map(selector => selector.trim()).filter(Boolean);
    const declarations = new Map();
    for (const declaration of match[2].split(';')) {
      const separator = declaration.indexOf(':');
      if (separator < 0) continue;
      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      if (property) declarations.set(property, value);
    }
    rules.push({ selectors, declarations });
  }
  return rules;
}

function requireCssDeclarations(rules, selector, expected) {
  const rule = rules.find(candidate => candidate.selectors.includes(selector));
  if (!rule) {
    failures.push(`style.css: missing selector ${selector}`);
    return;
  }
  for (const [property, value] of Object.entries(expected)) {
    const actual = rule.declarations.get(property);
    if (actual !== value) failures.push(`style.css: ${selector} expected ${property}:${value}, received ${actual ?? '<missing>'}`);
  }
}

const cssRules = parseCssRules(css);

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
      if (node.left?.object?.name === 'window' && entry === '__pmExportData') {
        walk(node.right, child => {
          if (child.type !== 'VariableDeclarator' || child.id?.name !== 'data' || child.init?.type !== 'ObjectExpression') return;
          for (const property of child.init.properties) {
            const name = propertyName(property);
            if (name) result.exportFields.add(name);
          }
        });
      }
      if (node.left?.object?.name === 'window' && entry === '__pmImportData') {
        walk(node.right, child => {
          if (child.type === 'MemberExpression' && child.object?.name === 'file' && memberName(child) === 'name') {
            result.importReadsFileName = true;
          }
        });
      }
    }
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
            'calendarStore', 'calendarOccasions', 'calendarHolidays', 'calendarWeather', 'calendarCycles',
          ]) result.importFields.add(field);
        }
      });
    }
  });
  return result;
}

function analyzeBackupModuleBinding(settingsUiCode, validatorCode) {
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
    walk(settingsAst, node => {
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
      if (callsParser && !shadowsParser) result.prepareCallsValidatorParser = true;
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
  const valid = `
    import { parseBackupData } from './settings-backup-validate.js';
    export { parseBackupData };
    runBackupTransaction({ prepare: current => parseBackupData(data, current) });
  `;
  if (!backupModuleBindingIsComplete(analyzeBackupModuleBinding(valid, validator))) {
    failures.push('self-test: backup module binding detector rejected valid wiring');
  }
  const invalidSettingsSamples = [
    `import { parseBackupData } from './wrong.js'; export { parseBackupData }; runBackupTransaction({ prepare: current => parseBackupData(data, current) });`,
    `import { parseBackupData } from './settings-backup-validate.js'; runBackupTransaction({ prepare: current => parseBackupData(data, current) });`,
    `import { parseBackupData } from './settings-backup-validate.js'; export { parseBackupData }; runBackupTransaction({ prepare: current => otherParser(data, current) });`,
    `import { parseBackupData } from './settings-backup-validate.js'; export { parseBackupData }; runBackupTransaction({ prepare: parseBackupData => parseBackupData(data) });`,
  ];
  for (const sample of invalidSettingsSamples) {
    if (backupModuleBindingIsComplete(analyzeBackupModuleBinding(sample, validator))) {
      failures.push('self-test: backup module binding detector accepted invalid settings wiring');
    }
  }
  const invalidValidator = `export const parseBackupData = (data, current) => current;`;
  if (backupModuleBindingIsComplete(analyzeBackupModuleBinding(valid, invalidValidator))) {
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
verifyBackupModuleBindingDetector();
verifyGuardedRequestOrderDetector();
verifyCallAiOptionsDetector();

const sourceResult = {
  commandObject: false, commandObjectHelp: false,
  legacyCommand: false, legacyCommandHelp: false,
  backupDownload: false, legacyBackupDownload: false, styleElement: false,
  stringLiterals: new Set(), windowAssignments: new Set(),
};
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
  '__pmDeleteProfile', '__pmPickProfile', '__pmSetMode', '__pmToggleWordyLimit',
  '__pmSetDarkMode', '__pmExportData', '__pmImportData', '__pmShowConfig',
  '__pmSetPreset', '__pmSetCustomColor', '__pmClearCustomColor',
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
  '__pmToggleAutoPoke', '__pmToggleAutoPokeGroup', '__pmToggleBidirectional', '__pmToggleMin',
  '__pmToggleSelect', '__pmToggleWordyLimit', '__pmUploadBg', '__pmWordyLimit',
];

const PHONE_ENTRY_OWNERS = {
  'phone-foundation.js': ['__pmToggleBidirectional', '__pmCloseOverlay'],
  'phone-chat.js': ['__pmSend', '__pmSubmitPending', '__pmIncrementCounters'],
  'phone-control-center.js': [
    '__pmShowControlCenter', '__pmOpenSettingsTab',
    '__pmStartDeleteMode', '__pmRefreshControlCenter',
    '__pmEditPending', '__pmSavePendingEdit', '__pmCancelPendingEdit',
    '__pmDeletePending', '__pmClearPending', '__pmResetPendingEditor',
  ],
  'interactive-scenes.js': ['__pmOpenForumMode'],
  'phone-directory.js': [
    '__pmSaveAndCloseGroupEdit', '__pmShowGroupCreate', '__pmGroupInputChanged',
    '__pmConfirmGroup', '__pmShowList', '__pmShowAddContact', '__pmDelGroup', '__pmDel',
  ],
  'contact-generator.js': ['__pmConfirmAutoGen', '__pmAutoGenContacts'],
  'conversation.js': ['__pmSwitchContact', '__pmSwitch'],
  'phone-chat-poke.js': [
    '__pmAutoPoke', '__pmSaveAndCloseContactConfig', '__pmToggleAutoPoke',
    '__pmPoke', '__pmEditGroup', '__pmToggleAutoPokeGroup', '__pmPokeGroup',
    '__pmShowCharacterBehavior', '__pmShowConversationSettings',
  ],
  'phone-lifecycle.js': [
    '__pmSetAmbientStatus', '__pmToggleSelect', '__pmDeleteSelected', '__pmToggleMin', '__pmEnd', '__pmOpen',
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
    'installInteractiveScenes(state, deps)', 'installCalendar(state, deps)', 'installSettingsUi(deps)',
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
    'installPhoneFoundation', 'installConversation', 'installEmojiUi', 'installInteractiveScenes', 'installCalendar',
    'installSettingsUi', 'installPhoneChat', 'installPhoneControlCenter', 'installPhoneDirectory', 'installContactGenerator',
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
requireText('main.js', mainFile?.code || '', 'installSettingsUi(deps)');
requireText('behavior-config.js', sourceModuleByName.get('behavior-config.js')?.code || '', 'normalizeCharacterBehaviorStore');
requireText('behavior-config.js', sourceModuleByName.get('behavior-config.js')?.code || '', 'normalizeGroupMetaStore');
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
  'pm-indep-profile-fields', 'pm-indep-config-fields', 'pm-independent-api-fields',
  'renderQuickReplySettings', 'Quick Reply', '/phone', '手机开关', '创建或清除开关入口',
  '默认使用酒馆 API 预设', 'BACK_ICON_SVG', 'pm-action-button is-danger',
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
  'createMessageEntry({', 'quote: state.isGroupChat ? combined.quote : null',
  'messageId: assistantEntry.messageId', 'bubbleId: bubble?.bubbleId',
]) requireText('phone-chat.js', sourceModuleByName.get('phone-chat.js')?.code || '', expected);
for (const expected of [
  'dataset.messageId', 'dataset.bubbleId', 'pm-reply-card', 'locateQuotedBubble', 'setActiveQuote',
  'syncReplyCardAvailability', 'refreshReplyCardAvailability',
  "matchMedia?.('(prefers-reduced-motion: reduce)')", "reduceMotion ? 'auto' : 'smooth'",
]) requireText('phone-foundation.js', sourceModuleByName.get('phone-foundation.js')?.code || '', expected);
for (const expected of [
  'pm-quote-preview', 'deleteSelectedMessages', 'refreshReplyCardAvailability?.()',
]) requireText('phone-lifecycle.js', sourceModuleByName.get('phone-lifecycle.js')?.code || '', expected);
for (const expected of [
  'commitEditedGroupUpdate', 'refreshEditedGroupRuntime', 'restoreConversationState', 'previousConversationContext',
  'persistRestored', "injectionFailure(rollbackResult, '补偿')",
  'groupMembers: state.groupMembers.slice()', 'window.__pmSwitch(state.currentGroupKey',
]) {
  requireText('phone-directory.js', sourceModuleByName.get('phone-directory.js')?.code || '', expected);
}
requireText('phone-chat.js', sourceModuleByName.get('phone-chat.js')?.code || '', 'removePendingBatch(runtime');
requireText('phone-chat.js', sourceModuleByName.get('phone-chat.js')?.code || '', 'rebaseRenderedHistory(historyWindow.trimmedCount)');
requireText('phone-chat-poke.js', sourceModuleByName.get('phone-chat-poke.js')?.code || '', 'rebaseRenderedHistory(historyWindow.trimmedCount)');
const controlCenterCode = sourceModuleByName.get('phone-control-center.js')?.code || '';
const directoryCode = sourceModuleByName.get('phone-directory.js')?.code || '';
const contactCode = sourceModuleByName.get('contact-generator.js')?.code || '';
const interactiveCode = sourceModuleByName.get('interactive-scenes.js')?.code || '';
const interactiveViewsCode = sourceModuleByName.get('interactive-scene-views.js')?.code || '';
const interactivePhoneCode = sourceModuleByName.get('interactive-scene-phone.js')?.code || '';
const interactiveSchedulerCode = sourceModuleByName.get('interactive-scene-scheduler.js')?.code || '';
const foundationCode = sourceModuleByName.get('phone-foundation.js')?.code || '';
const calendarCode = sourceModuleByName.get('calendar.js')?.code || '';
const calendarCommitCode = sourceModuleByName.get('calendar-commit.js')?.code || '';
const calendarDomCode = sourceModuleByName.get('calendar-dom.js')?.code || '';
const storageBackgroundCode = sourceModuleByName.get('storage-background.js')?.code || '';
const calendarModelCode = sourceModuleByName.get('calendar-model.js')?.code || '';
const calendarHolidayCode = sourceModuleByName.get('calendar-holiday.js')?.code || '';
const calendarViewCode = sourceModuleByName.get('calendar-view.js')?.code || '';
const interactivePhoneActionsCode = sourceModuleByName.get('interactive-scene-phone.js')?.code || '';
const aiCode = sourceModuleByName.get('ai.js')?.code || '';
const phoneChatPokeCodeForChecks = sourceModuleByName.get('phone-chat-poke.js')?.code || '';
const interactiveModelCode = sourceModuleByName.get('interactive-scene-model.js')?.code || '';
const interactiveAiCode = sourceModuleByName.get('interactive-scene-ai.js')?.code || '';
const settingsUiCodeForInteractive = sourceModuleByName.get('settings-ui.js')?.code || '';
const settingsBackupValidateCode = sourceModuleByName.get('settings-backup-validate.js')?.code || '';
const settingsBackupCode = sourceModuleByName.get('settings-backup.js')?.code || '';
const contactAnalysis = analyze(contactCode, 'module');
const calendarAnalysis = analyze(calendarCode, 'module');
const interactiveAnalysis = analyze(interactiveCode, 'module');
const calendarInspection = inspectModule(calendarCode);
const calendarCommitInspection = inspectModule(calendarCommitCode);
const calendarDomInspection = inspectModule(calendarDomCode);
const storageInspection = inspectModule(sourceModuleByName.get('storage.js')?.code || '');
const storageBackgroundInspection = inspectModule(storageBackgroundCode);
requireNamedImports('calendar.js', calendarInspection, './calendar-commit.js', ['createCalendarCommitters']);
requireNamedImports('calendar.js', calendarInspection, './calendar-dom.js', [
  'activateCalendarEditorKind', 'calendarEditor', 'calendarOccasionEditor', 'clearCalendarEditor',
  'clearCalendarOccasionEditor', 'fillCalendarEditor', 'fillCalendarOccasionEditor',
]);
if (!calendarInspection.calls.has('createCalendarCommitters')) failures.push('calendar.js: must call createCalendarCommitters');
for (const name of ['commitScope', 'injectionFailure']) {
  if (calendarInspection.functionDefinitions.has(name)) failures.push(`calendar.js: ${name} implementation must remain owned by calendar-commit.js`);
}
if (calendarInspection.declarations.has('scopeCommitQueue')) failures.push('calendar.js: scopeCommitQueue must remain owned by calendar-commit.js');
for (const name of ['createCalendarCommitters']) {
  if (!calendarCommitInspection.exports.has(name)) failures.push(`calendar-commit.js: missing exported ${name}`);
}
for (const name of ['calendarEditor', 'calendarOccasionEditor', 'activateCalendarEditorKind', 'clearCalendarEditor',
  'clearCalendarOccasionEditor', 'fillCalendarEditor', 'fillCalendarOccasionEditor']) {
  if (!calendarDomInspection.exports.has(name)) failures.push(`calendar-dom.js: missing exported ${name}`);
}
for (const name of ['loadBgSettings', 'saveBgGlobal', 'saveBgLocal', 'saveDesktopBg']) {
  if (!storageBackgroundInspection.exports.has(name)) failures.push(`storage-background.js: missing exported ${name}`);
  if (storageInspection.exports.has(name) || storageInspection.declarations.has(name)) failures.push(`storage.js: ${name} must remain owned by storage-background.js`);
}
requireNamedImports('storage-background.js', storageBackgroundInspection, './storage.js', [
  'DESKTOP_BG_KEY', 'isBigData', 'pmIDBDel', 'pmIDBGet', 'pmIDBSet',
]);
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
for (const expected of ['syncStore = null', 'await syncStore?.()', '补偿持久化或同步也失败', 'syncStore: () => deps.applyBidirectionalInjection?.()']) {
  requireText('interactive-scenes.js', interactiveCode, expected);
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
for (const expected of ['ST_SMS_PHONE_UI_STATE', 'loadPhoneUiState', 'savePhoneUiState']) requireText('storage.js', sourceModuleByName.get('storage.js')?.code || '', expected);
if ((source.match(/ST_SMS_PHONE_UI_STATE/g) || []).length !== 1) failures.push('source: phone UI state must retain exactly one storage-key definition');
for (const expected of [
  "['author', 'content', 'tags', 'comments']", 'cleanFeedComments',
  '不得返回 actorId、authorId 或任何内部标识', 'known_actor_names_data',
]) requireText('interactive-scene-ai.js', interactiveAiCode, expected);
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
requireText('storage.js', sourceModuleByName.get('storage.js')?.code || '', 'export async function saveGroupMeta(data)');
for (const expected of ['enqueueDirectorySave', 'getDirectorySaveRevision', 'marksGlobalSave']) {
  requireText('directory-save-coordinator.js', sourceModuleByName.get('directory-save-coordinator.js')?.code || '', expected);
}
for (const expected of [
  'INTERACTIVE_STORE_VERSION', 'assertInteractiveActor', 'authorId 未指向有效 actor', 'shareCount 必须是非负安全整数', 'shared 必须是布尔值',
  'deriveInteractiveActorId(scopeId, actor.type, actor.bindingKey)',
]) requireText('settings-backup-validate.js', settingsBackupValidateCode, expected);
for (const expected of [
  'schemaVersion: 6', 'desktopBg: snapshot.desktopBg',
  'calendarStore: snapshot.calendarStore', 'calendarCycles: snapshot.calendarCycles',
]) requireText('settings-ui.js', settingsUiCodeForInteractive, expected);
requireText('settings-backup-validate.js', settingsBackupValidateCode, 'applyCalendarBackupFields(data, result, objectValue)');
for (const expected of [
  'phoneUiState: loadPhoneUiState(interactiveScenes)', 'ambientStatus: normalizeAmbientStatus',
  'normalizePhoneUiState(state.phoneUiState, interactiveScenes)', 'savePhoneUiState(phoneUiState, interactiveScenes)',
  "beforeApply('apply')", "beforeApply('rollback')", 'prepared = await prepare(snapshot)',
  "error.backupPhase = 'prepare'", "error.backupPhase = 'rolled-back'", "combined.backupPhase = 'rollback-failed'",
  'assertCanonicalCalendarField', 'assertCycleBackupInvariants',
  'loadCalendarHolidays()', 'saveCalendarCycles(state.calendarCycles)',
]) requireText('settings-backup.js', settingsBackupCode, expected);
for (const expected of [
  'prepare: current => parseBackupData(data, current)', 'apply: async (snapshot, imported)',
  "err.backupPhase === 'rolled-back'", "err.backupPhase === 'rollback-failed'", '导入失败，未修改现有数据',
  'postImportError = injectionFailure', '数据已导入，但注入刷新失败',
]) requireText('settings-ui.js', settingsUiCodeForInteractive, expected);
for (const expected of [
  "tasks.begin(storageId, 'scan-context'", 'parentSignal', 'signal: task.signal', 'calendarMonthCells',
  'isHolidayYearSupported', 'holidayYearRange', 'calendarGenerationCopy', 'calendar-holiday-country',
  '该国家在当前年代无外部节假日数据源', 'EDIT_ICON_SVG', 'HOME_ICON_SVG', 'calendar-base-edit',
  'showBaseDateEditor', 'pm-calendar-base-dialog', 'data-calendar-base-error',
  'pm-calendar-header-side is-left', 'pm-calendar-header-side is-right', 'statusTimerByStorage',
  'setTimeoutImpl', 'clearTimeoutImpl', '{ persistent: true }', '{ duration: 10000 }',
  'pm-modal-add pm-calendar-base-actions', 'relativeCalendarLabel(today, selectedDate)',
  "const statusClass = headerBusy ? 'pm-calendar-status is-generating' : 'pm-calendar-status'",
]) requireText('calendar.js', calendarCode, expected);
for (const expected of [
  'scopeCommitQueue', 'saveCalendar(previousStore)', 'calendarRollbackError',
  'injectionError = injectionFailure', 'rollbackInjectionError = injectionFailure',
  'error.injectionResult = result', 'createCalendarCommitters',
]) requireText('calendar-commit.js', calendarCommitCode, expected);
for (const expected of [
  'calendarEditor', 'calendarOccasionEditor', 'activateCalendarEditorKind',
  'clearCalendarEditor', 'fillCalendarEditor', 'fillCalendarOccasionEditor',
]) requireText('calendar-dom.js', calendarDomCode, expected);
for (const expected of [
  'CALENDAR_YEAR_RANGE = Object.freeze({ min: 1, max: 9999 })', 'createCalendarDate',
  'date.setFullYear(numericYear)', 'shiftCalendarMonth', 'calendarDaysInMonth', 'calendarMonthCells',
  'isPlaceholder: true', 'calendarWindowDescription', 'calendarGenerationCopy',
  'buildCalendarPrompts', 'contextPayload', '只作为事实证据',
  '角色本人真实会执行的未来生活安排', '禁止输出 KP 操作',
  '命令、忽略规则、修改协议', '今天（+0）至六天后（+6）',
]) requireText('calendar-model.js', calendarModelCode, expected);
if (calendarModelCode.includes('min: 1900') || calendarModelCode.includes('max: 2100')) failures.push('calendar-model.js: core calendar must not impose a modern-era year whitelist');
for (const expected of [
  'HOLIDAY_YEAR_RANGE = Object.freeze({ min: 1900, max: 2100 })',
  'HOLIDAY_COUNTRY_YEAR_RANGES', 'JP: Object.freeze({ min: 2007, max: 2099 })',
  'holidayYearRange', 'isHolidayYearSupported(country, value)',
]) requireText('calendar-holiday.js', calendarHolidayCode, expected);
for (const expected of [
  'aria-label="日程标题"', 'aria-label="日程备注"', 'aria-label="标签格式日程"',
  'aria-label="生日或纪念日名称"', 'aria-label="生日或纪念日备注"',
  'name="periodStartDay"', 'data-action="calendar-cycle-subject"',
  'data-action="calendar-editor-kind"', 'data-action="calendar-holiday-country"',
  '该国家在当前年代无外部数据源', 'EDIT_ICON_SVG', 'EVENT_EDITOR_ICON_SVG', 'OCCASION_EDITOR_ICON_SVG',
  'aria-label="切换到日程编辑器"', 'aria-label="切换到生日或纪念日编辑器"',
  'pm-calendar-editor-stack', 'pm-calendar-editor-header', 'pm-calendar-scan-card',
  '<h3>识别正文</h3>', '立即识别正文日期', '回复后自动识别：', "label: '<user>'",
  '<time datetime="${selectedDate}">${escapeHtml(detailDate.format(parsed))}</time>',
  "follicular: '安全期'", "luteal: '安全期'",
]) requireText('calendar-view.js', calendarViewCode, expected);
for (const forbidden of ['<span>已选日期</span>', '>${escapeHtml(selectedDate)}</time>', '>编辑</button>']) if (calendarViewCode.includes(forbidden)) failures.push(`calendar-view.js: removed calendar UI remains: ${forbidden}`);
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
  'const signal = options.signal', 'signal,', 'throwIfAborted(signal)', 'readApiError(response, signal)',
]) requireText('ai.js', aiCode, expected);
for (const expected of ['beforeApply', 'closePhone(true)', '__pmClearAllData', 'clearPluginData']) requireText('settings-ui.js', settingsUiCodeForInteractive, expected);
for (const expected of ['if (!force)', 'persistCurrentHistory()', 'persistPhoneUiSnapshot?.()']) {
  requireText('phone-lifecycle.js', sourceModuleByName.get('phone-lifecycle.js')?.code || '', expected);
}
requireText('main.js', mainFile?.code || '', 'closePhone: force => window.__pmEnd(force)');
requireText('phone-control-center.js', controlCenterCode, 'updatePendingMessage(');
const controlCenterAnalysis = analyze(controlCenterCode, 'module');
const directoryAnalysis = analyze(directoryCode, 'module');
const controlCenterTemplate = controlCenterAnalysis.windowAssignmentText.get('__pmShowControlCenter') || '';
const directoryTemplate = directoryAnalysis.windowAssignmentText.get('__pmShowList') || '';
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
for (const title of ['编辑消息', '联系人', '角色设置', '表情包管理', '日历', '删除信息']) {
  if (!controlCenterTemplate.includes(title)) failures.push(`phone-control-center.js: compact control menu missing title ${title}`);
}
for (const expected of [
  "action === 'contacts'", "action === 'calendar'", 'return window.__pmShowList()', 'return showPhoneCalendarPage()',
  'runControlMenuAction', 'controlActionLabel', 'CALENDAR_ICON_SVG', 'EDIT_ICON_SVG', 'EMOJI_ICON_SVG', 'TRASH_ICON_SVG',
]) requireText('phone-control-center.js', controlCenterCode, expected);
if (controlCenterCode.includes("action === 'rearm'") || controlCenterTemplate.includes('自动消息')) failures.push('phone-control-center.js: removed automatic-message rearm entry remains');
if (controlCenterTemplate.includes('data-action="desktop"') || controlCenterTemplate.includes('返回桌面')) {
  failures.push('phone-control-center.js: compact control menu must not duplicate the chat navbar desktop action');
}
for (const title of ['API 设置', '主题颜色', '数据备份', '互动场景']) {
  if (controlCenterTemplate.includes(title)) failures.push(`phone-control-center.js: compact control menu must not contain removed shortcut ${title}`);
}
for (const expected of [
  'post-comment', 'delete-scene', 'delete-post', 'delete-comment', "action === 'post-actions'", "action === 'toggle-reply'", "action === 'share'", 'incrementScenePostShare(current().scene, button.dataset.postId)', '文字直播',
  "button.closest?.('.pm-scene-comment-composer')", "composer?.querySelector?.('input')", 'preserveFeedScroll',
  "document.querySelector('#pm-scene-app .pm-scene-feed')?.scrollTop", "rerender('feed', { preserveFeedScroll: true })",
]) {
  requireText('interactive-scenes.js', interactiveCode, expected);
}
if (interactiveCode.includes('document.getElementById(`pm-comment-input-${button.dataset.postId}`)')) failures.push('interactive-scenes.js: reply submission must stay scoped to the clicked composer');
for (const expected of [
  'HEART_ICON_SVG', 'SHARE_ICON_SVG', 'REPLY_ICON_SVG', 'SEND_ICON_SVG', 'CONTROL_ICON_SVG', 'COMMUNITY_ICON_SVG', 'EDIT_ICON_SVG', 'TRASH_ICON_SVG',
  'pm-scene-nav-actions', 'pm-scene-title-poke', 'pm-scene-view-actions', 'pm-scene-title-tab', 'aria-label="子社区视图"',
  'class="pm-scene-home" data-action="desktop"', '<span>直播</span>',
  'style="--scene-accent:${escapeAttr(defaultAccent)}"', 'data-preset="${escapeAttr(key)}" data-accent="${escapeAttr(preset.accent)}"',
  'data-action="tab" data-tab="prompt"', '风格提示词', 'data-action="context-inject"', '上下文注入', 'pm-scene-post-more', 'data-action="post-actions"',
  'aria-label="拍一拍本帖，只生成本帖评论"', "class=\"pm-scene-share ${post.shared ? 'is-shared' : ''}\"", 'aria-pressed="${post.shared}"', "post.shared ? '已分享本帖' : '分享本帖'", "renderPostMetric(SHARE_ICON_SVG, shares, '转发', 'is-share')",
  'pm-scene-reply-toggle', 'data-action="toggle-reply"', 'aria-controls="pm-comment-composer-${escapeAttr(post.id)}"', 'aria-expanded="false"',
  "renderPostMetric(REPLY_ICON_SVG, post.comments.length, '回复', 'is-reply')", 'class="pm-scene-comment-composer" hidden', 'placeholder="发表你的想法吧"',
  'class="pm-control-menu pm-scene-menu" role="menu" aria-label="社区工具" hidden',
  'class="pm-scene-comment-actions" hidden', 'data-action="edit-comment"', 'aria-label="编辑评论"', 'data-action="delete-comment"', 'aria-label="删除评论"',
  'pm-scene-accent-options', 'data-action="scene-accent"', 'data-action="scene-accent-custom"', 'aria-pressed="${preset.accent === selectedAccent}"',
  'placeholder="分享此刻……"', '<span class="pm-scene-post-time">刚刚</span>',
  "hasDanmaku ? '直播中' : '未开播'", 'aria-label="发送弹幕"', '设置社区内容的表达风格与氛围。',
  "isPrompt || tab === 'live' || tab === 'context-inject' ? ''", 'pm-live-stage', 'pm-danmaku-float',
]) requireText('interactive-scene-views.js', interactiveViewsCode, expected);
for (const forbidden of ['data-action="back"', 'pm-scene-back']) {
  if (interactiveViewsCode.includes(forbidden)) failures.push(`interactive-scene-views.js: removed community back control remains: ${forbidden}`);
}
for (const forbidden of ['.pm-scene-title-tab:first-child{flex:', '.pm-scene-title-tab.is-active::after{']) {
  if (css.includes(forbidden)) failures.push(`style.css: stretched community title underline remains: ${forbidden}`);
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
  "['社区页面刷新失败', renderLauncher]", "dataset.sceneUiBound === 'true'", "event.key !== 'Escape'", ".pm-scene-menu:not([hidden])",
  ".pm-scene-post-actions:not([hidden])", 'closePostActions', '[data-action="post-actions"]', 'postFocusTarget', 'menuFocusTarget',
  "closest?.('.pm-scene-post')?.querySelectorAll?.('.pm-scene-comment-actions')", 'commentActions.hidden = !opening',
  "app.querySelectorAll?.('.pm-scene-comment-composer')", "composers.find(composer => composer.id === targetId)", '[data-action="toggle-reply"]', "focus?.({ preventScroll: true })",
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
  'createCommunityTaskController', 'createCommunityGenerationRunner', "request('feed_batch', {}, target)",
  'createCommunityTurnSnapshot(chat)', 'registerResolvedHostEvent', 'resolveHostEvent', 'runtime.communityTask', 'resetObservation',
]) requireText('interactive-scene-scheduler.js', interactiveSchedulerCode, expected);
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
  'resolveCommunityMessageEvents(et)', 'deps.observeCommunityTurn?.(c.chat || [])',
  "registerResolvedHostEvent(c.eventSource, et, 'MESSAGE_RECEIVED'", "registerResolvedHostEvent(c.eventSource, et, 'CHAT_CHANGED'",
  'handleHostChatChanged({', "cancelCommunityGeneration?.('host-chat-changed')", "cancelCalendarTasks?.('host-chat-changed')",
  "disarmAutoPoke?.('host-chat-changed')", 'endPhone(true)',
  'installPhonePageSuspensionListeners', 'updatePhonePageSuspensionHandler', '__pmPageSuspensionHandler',
  "__pmPageSuspensionHandler?.('beforeunload')", "__pmPageSuspensionHandler?.('document-hidden')",
]) requireText('phone-foundation.js', sourceModuleByName.get('phone-foundation.js')?.code || '', expected);
for (const forbidden of [
  "et.MESSAGE_RECEIVED || 'message_received'", "et.CHAT_CHANGED || 'chat_id_changed'",
  "et.MESSAGE_SENT || 'message_sent'", "et.MESSAGE_EDITED || 'message_edited'",
  "et.MESSAGE_DELETED || 'message_deleted'", "et.MESSAGE_SWIPED || 'message_swiped'",
]) {
  if (foundationCode.includes(forbidden)) failures.push(`phone-foundation.js: community observer must not guess host event ${forbidden}`);
}
for (const expected of [
  "cancelCommunityGeneration?.('phone-minimized')", "cancelCommunityGeneration?.('phone-closed')",
  "cancelCalendarTasks?.('phone-minimized')", "cancelCalendarTasks?.('phone-closed')",
]) {
  requireText('phone-lifecycle.js', sourceModuleByName.get('phone-lifecycle.js')?.code || '', expected);
}
for (const expected of [
  'renderPhoneDesktop', 'desktop-chat', 'desktop-directory', 'desktop-settings', 'desktop-calendar', 'desktop-community',
  'desktop-exit', "__pmOpenSettingsTab?.('home')",
  'toggle-scene-pin', 'unpin-scene', 'loadPhoneUiState', 'savePhoneUiState',
  "showPhonePage('community')", 'runDesktopPageTransition', 'showPhoneDesktopPage',
  "showPhonePage('calendar')", 'showPhoneCalendarPage', 'handleCalendarAction',
  'refreshDesktop(scopeId, store)', 'restorePhoneUi', 'persistPhoneUiSnapshot',
]) requireText('interactive-scenes.js', interactiveCode, expected);
for (const expected of [
  'data-action="desktop"', 'data-action="exit"', 'class="pm-scene-card-actions"',
  'data-action="toggle-scene-pin"', 'data-action="delete-scene"', 'pm-desktop-app-icon',
  'const pinAccent = scene.themeAccent || presets[scene.preset]?.accent || defaultAccent',
  'class="pm-scene-pin-action"', 'style="--scene-pin-accent:${escapeAttr(pinAccent)}"', 'aria-pressed="${pinned}"', 'aria-label="${pinLabel}"', 'aria-label="删除社区"', '${COMMUNITY_ICON_SVG}', '${TRASH_ICON_SVG}',
  'pm-desktop-app-label', 'data-app="chat"', 'data-app="directory"', 'data-app="settings"', 'data-app="calendar"',
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
const modelPickerCode = sourceModuleByName.get('settings-model-picker.js')?.code || '';
const foundationAnalysis = analyze(foundationCode, 'module');
const settingsAnalysis = analyze(settingsCode, 'module');
const modelPickerAnalysis = analyze(modelPickerCode, 'module');
const makeOverlaySource = foundationAnalysis.functionSource.get('makeOverlay') || '';
const applyThemeSource = foundationAnalysis.functionSource.get('applyTheme') || '';
const setDarkModeSource = settingsAnalysis.windowAssignmentSource.get('__pmSetDarkMode') || '';
const showModelPickerSource = settingsAnalysis.windowAssignmentSource.get('__pmShowModelPicker') || '';
const modelPickerImplementation = modelPickerAnalysis.functionSource.get('showModelPicker') || '';
const persistThemeMutationSource = settingsCode.match(/const persistThemeMutation\s*=\s*[\s\S]*?\n\s*};/)?.[0] || '';
const overlayThemeDirectSyncPattern = /getElementById\(['"]pm-overlay['"]\)[\s\S]*?setAttribute\(['"]data-theme['"]/;
const overlayThemeHelperSyncPattern = /const\s+applyProperties\s*=\s*element\s*=>[\s\S]*?element\.setAttribute\(['"]data-theme['"][\s\S]*?applyProperties\(document\.getElementById\(['"]pm-overlay['"]\)\)/;
if (!/createElement\(['"]div['"]\)/.test(makeOverlaySource)
    || !/\.id\s*=\s*['"]pm-overlay['"]/.test(makeOverlaySource)
    || !/\.dataset\.theme\s*=/.test(makeOverlaySource)) {
  failures.push('phone-foundation.js: makeOverlay must initialize data-theme on the real pm-overlay root');
}
if (!overlayThemeDirectSyncPattern.test(applyThemeSource)
    && !overlayThemeHelperSyncPattern.test(applyThemeSource)) {
  failures.push('phone-foundation.js: applyTheme must synchronize data-theme to an existing pm-overlay');
}
if (!setDarkModeSource.includes('persistThemeMutation') || !persistThemeMutationSource.includes('applyTheme()')) {
  failures.push('settings-ui.js: __pmSetDarkMode must persist the mutation and apply the synchronized theme');
}
if (!applyThemeSource.includes("applyProperties(document.getElementById('pm-model-dropdown'))")) {
  failures.push('phone-foundation.js: applyTheme must synchronize data-theme to an existing body-level model dropdown');
}
if (!showModelPickerSource.includes('showModelPicker(runtime)')) {
  failures.push('settings-ui.js: __pmShowModelPicker must delegate to the settings model picker with runtime state');
}
for (const expected of [
  "dropdown.dataset.theme = window.__pmTheme?.darkMode || 'light'",
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
  'aria-label="使用${escapeAttr(v.label)}气泡主题"',
  'aria-pressed="${t.preset === k}"',
  "el.setAttribute('aria-pressed', String(active))",
]) requireText('settings-ui.js', settingsCode, expected);
for (const expected of [
  '#pm-overlay[data-theme="dark"] .pm-settings-home button{background:#2c2c2e;color:#eee;border-color:#3a3a3c}',
  '#pm-overlay[data-theme="dark"] .pm-scene-comments,#pm-iphone[data-theme="dark"] .pm-scene-comments{background:#2c2c2e;color:#ddd}',
  '#pm-overlay[data-theme="dark"] .pm-scene-comments b,#pm-iphone[data-theme="dark"] .pm-scene-comments b{color:color-mix(in srgb,var(--scene-accent) 30%,#fff)}',
  '#pm-overlay[data-theme="dark"] .pm-scene-post footer,#pm-iphone[data-theme="dark"] .pm-scene-post footer{border-top-color:#3a3a3c}',
  '#pm-overlay[data-theme="dark"] .pm-scene-comment-actions button,#pm-iphone[data-theme="dark"] .pm-scene-comment-actions button{color:#aaa}',
  '#pm-overlay[data-theme="dark"] .pm-scene-comment-actions .pm-scene-danger,#pm-iphone[data-theme="dark"] .pm-scene-comment-actions .pm-scene-danger{color:#ff8a80 !important}',
  '#pm-overlay[data-theme="dark"] .pm-scene-comment-composer input{background:#202025;color:#eee;border-color:#414149}',
  '#pm-iphone[data-theme="dark"] .pm-scene-comment-composer input{background:#202025;color:#eee;border-color:#414149}',
  '#pm-iphone[data-theme="dark"] .pm-scene-header{background:#242429;color:#eee;border-color:#393940}',
  '.pm-theme-chip:focus-visible{outline:2px solid #007aff;outline-offset:2px;}',
  '#pm-model-arrow:focus-visible{outline:2px solid #007aff;outline-offset:2px;}',
  '.pm-model-opt:focus-visible{position:relative;z-index:1;outline:2px solid #007aff;outline-offset:-2px;}',
  '.pm-model-dropdown[data-theme="dark"] .pm-model-opt:focus-visible{outline-color:#64a8ff;}',
  '.pm-model-dropdown[data-theme="dark"]{background:#252527 !important;border-color:#48484a !important;color:#eee !important;',
  '.pm-model-dropdown[data-theme="dark"] .pm-model-search{background:#1c1c1e !important;color:#eee !important;',
  '.pm-model-dropdown[data-theme="dark"] .pm-model-opt{background:#252527;color:#ddd;border-bottom-color:#38383a;}',
  '.pm-model-dropdown[data-theme="dark"] .pm-model-empty{color:#aaa;}',
  '#pm-overlay[data-theme="dark"] .pm-global-setting{background:#2c2c2e;color:#eee;border-color:#48484a;}',
  '#pm-overlay[data-theme="dark"] .pm-global-setting small,#pm-overlay[data-theme="dark"] .pm-quick-reply-settings section p,#pm-overlay[data-theme="dark"] .pm-calendar-base-content p{color:#aaa;}',
]) requireText('style.css', css, expected);
if (css.includes('pm-forum-entry')) failures.push('style.css: removed directory community entry styles must not remain');
requireText('style.css', css, 'top:calc(18px + var(--lane)*31px + var(--offset))');
if (css.includes('translateY(var(--offset))')) failures.push('style.css: danmaku offset must not be applied twice');
requireText('style.css', css, '.pm-control-menu{position:absolute;');
requireText('style.css', css, '#pm-iphone[data-theme="dark"] .pm-control-menu');
requireText('style.css', css, '.pm-pending-manager{min-height:180px;}');
for (const expected of [
  '.pm-calendar-header-action.is-loading svg{animation:pm-spin .8s linear infinite}',
  '.pm-calendar-cycle-input:checked+.pm-custom-check{background:#34c759 !important}',
  '.pm-calendar-cycle-input:focus-visible+.pm-custom-check{outline:2px solid #007aff;outline-offset:2px}',
  '.pm-scene-topbar{position:relative;display:flex;align-items:center;gap:4px;padding:6px 9px}',
  '.pm-scene-home{color:#888 !important}',
  '.pm-scene-pin-action{color:#8a8a8f}',
  '.pm-scene-pin-action[aria-pressed="true"]{background:color-mix(in srgb,var(--scene-pin-accent) 12%,transparent);color:var(--scene-pin-accent)}',
  '.pm-scene-title{position:absolute;left:50%;top:6px;bottom:6px;transform:translateX(-50%);display:flex',
  '.pm-scene-title-tab.is-active span::after{content:',
  '.pm-scene-title-poke{position:relative;width:34px !important;height:34px !important;padding:7px !important',
  '.pm-scene-title-poke::before{content:',
  'width:24px;height:24px;border-radius:50%;background:transparent',
  '@media(max-width:320px){.pm-scene-topbar{padding-inline:5px}',
  '.pm-scene-view-actions{display:flex;align-items:center;justify-content:flex-end;gap:2px;margin-left:auto',
  '.pm-scene-bottom-bar{position:relative;z-index:20',
  '.pm-control-menu.pm-scene-menu{left:0;right:auto;top:auto;bottom:46px;z-index:20;width:148px;max-height:none;overflow-y:visible',
  '.pm-control-menu.pm-scene-menu[hidden]{display:none}',
  '.pm-scene-composer textarea{height:36px;min-height:36px;max-height:88px;box-shadow:none !important;appearance:none}',
  '.pm-scene-title-poke:active{background:transparent !important;color:#fff !important}',
  '.pm-scene-title-poke:active::before{background:var(--scene-accent)}',
  '#pm-iphone[data-theme="dark"] .pm-scene-bottom-bar .pm-scene-more{background:transparent;border-color:transparent;color:#aaa}',
  '.pm-scene-bottom-bar .pm-scene-more[aria-expanded="true"]{background:transparent;outline:none;color:var(--scene-accent)}',
  '.pm-scene-share.is-shared .pm-scene-post-metric,.pm-scene-share:active .pm-scene-post-metric{color:#22a06b}',
  '#pm-iphone[data-theme="dark"] .pm-scene-share.is-shared .pm-scene-post-metric{color:#57d99a}',
  '.pm-scene-share.is-shared svg circle{fill:currentColor}',
  '.pm-scene-reply-toggle[aria-expanded="true"] .pm-scene-post-metric{color:var(--scene-accent)}',
  '.pm-scene-post-more:focus-visible{background:color-mix(in srgb,var(--scene-accent) 10%,transparent);outline:2px solid var(--scene-accent);outline-offset:2px}',
  '.pm-scene-post-actions-wrap{position:relative;display:flex;flex-direction:row-reverse',
  '.pm-scene-post-actions{display:flex;align-items:center;gap:2px;margin-right:4px}',
  '.pm-scene-post-actions[hidden]{display:none}',
  '.pm-scene-post-author{min-width:0;flex:1;gap:2px;padding-top:1px}',
  '.pm-scene-post footer{align-items:center;justify-content:center;gap:0;flex-wrap:nowrap}',
  '.pm-scene-post footer>*{flex:1 1 0;min-width:0;justify-content:center}',
  '.pm-scene-comment>span:first-child{flex:1;min-width:0;word-break:break-word}',
  '.pm-scene-comment-actions[hidden]{display:none}',
  '.pm-scene-comment-actions button{width:22px;height:22px;padding:4px;display:grid;place-items:center;border-radius:50%}',
  '.pm-scene-comment-actions button svg{width:14px;height:14px}',
  '.pm-scene-post-actions button:focus-visible{background:color-mix(in srgb,var(--scene-accent) 10%,transparent);outline:2px solid var(--scene-accent);outline-offset:2px}',
  '.pm-scene-like.is-liked svg{fill:currentColor}',
  '.pm-danmaku-input button svg{width:18px;height:18px}',
  '.pm-scene-title-poke svg,.pm-scene-exit svg{width:18px;height:18px}',
  '.pm-reply-card{box-sizing:border-box;width:100%',
  '.pm-quote-preview{display:flex;align-items:center',
  '.pm-quote-target{animation:pm-quote-highlight',
  '@media(pointer:coarse){.pm-quote-action{min-width:42px;min-height:42px',
  '@media(prefers-reduced-motion:reduce){.pm-quote-target{animation:none',
  '.pm-calendar-view-switch{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;background:transparent}',
  '.pm-calendar-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:10px 12px}',
  '.pm-calendar-header .pm-calendar-header-action{width:28px;height:28px;padding:5px}',
  '.pm-calendar-header-action svg{width:15px;height:15px}',
  '.pm-calendar-title-row{display:flex;align-items:center;justify-content:center;gap:3px',
  '.pm-calendar-header .pm-calendar-base-edit{position:static;transform:none;width:26px;height:26px',
  '.pm-calendar-status.is-generating{color:#ff3b30}',
  '.pm-calendar-date-tags-row{grid-template-columns:minmax(0,1fr) auto}',
  '.pm-calendar-editor[hidden]{display:none}',
  '.pm-calendar-editor-header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px}',
  '.pm-calendar-editor-switch{display:flex;flex:0 0 auto;gap:4px}',
  '.pm-calendar-event-actions button{display:grid;place-items:center;width:26px;height:26px',
  '.pm-calendar-selected-detail>header time{font-size:14px;font-weight:700}',
  '.pm-calendar-editor-switch button{display:grid;place-items:center;width:30px;height:30px;padding:6px;border:0;border-radius:50%',
  '#pm-iphone[data-theme="dark"] .pm-calendar-view-switch button[aria-pressed="true"],#pm-iphone[data-theme="dark"] .pm-calendar-editor-switch button[aria-pressed="true"]{background:color-mix(in srgb,var(--pm-calendar-accent) 20%,transparent);color:var(--pm-calendar-accent);box-shadow:none}',
  '@media (prefers-reduced-motion:reduce){.pm-calendar-header-action.is-loading svg{animation:none}}',
  '.pm-scene-preset>span{box-sizing:border-box;width:12px;height:12px;flex:0 0 12px;border-radius:50%',
  '.pm-scene-prompt .pm-scene-accent-option{box-sizing:border-box;width:30px;height:30px;min-width:30px;min-height:30px;aspect-ratio:1;flex:0 0 30px;padding:4px !important',
  '.pm-scene-accent-custom input[type="color"]{box-sizing:border-box;width:32px;height:28px;flex:0 0 32px;padding:0;border:1px solid #ddd;border-radius:6px',
  '.pm-scene-accent-option[aria-pressed="true"]{border-color:var(--scene-accent-option)',
  '.pm-scene-accent-option:focus-visible{outline:2px solid var(--scene-accent-option)',
  '.pm-scene-comment-composer[hidden]{display:none}',
  '.pm-scene-comment-composer input{font-size:14px}',
  '.pm-scene-empty{font-size:12px;line-height:1.55}',
]) requireText('style.css', css, expected);
requireCssDeclarations(cssRules, '.pm-name-edit', {
  background: 'transparent !important', color: '#888 !important',
  width: '24px', height: '24px', 'border-radius': '50% !important',
});
requireCssDeclarations(cssRules, '.pm-name-edit:hover', {
  background: 'transparent !important', color: 'var(--pm-r-bg,#007aff) !important',
});
requireCssDeclarations(cssRules, '.pm-name-edit:active', {
  background: 'var(--pm-r-bg,#007aff) !important', color: 'var(--pm-r-txt,#fff) !important',
});
requireCssDeclarations(cssRules, '.pm-nav-btn', {
  background: 'none !important', color: 'var(--pm-r-bg,#007aff) !important',
});
requireCssDeclarations(cssRules, '.pm-up-btn', {
  width: '32px !important', height: '32px !important',
  background: 'var(--pm-r-bg,#007aff) !important', color: 'var(--pm-r-txt,#fff) !important',
});
requireCssDeclarations(cssRules, '.pm-expand-btn:hover', {
  color: 'var(--pm-r-bg,#007aff) !important',
});
requireCssDeclarations(cssRules, '.pm-expand-btn[aria-expanded="true"]', {
  color: 'var(--pm-r-bg,#007aff) !important',
});
requireCssDeclarations(cssRules, '#pm-iphone[data-theme="dark"] .pm-expand-btn[aria-expanded="true"]', {
  color: 'var(--pm-r-bg,#0a84ff) !important',
});
requireCssDeclarations(cssRules, '.pm-message-select-check', {
  width: '22px', height: '22px', 'min-width': '22px', 'min-height': '22px',
  'border-radius': '50%', background: 'transparent', color: '#fff',
});
requireCssDeclarations(cssRules, '.pm-message-select-check[data-checked="1"]', {
  'background-color': '#007aff',
  'background-image': 'linear-gradient(var(--pm-r-bg,#007aff),var(--pm-r-bg,#007aff))',
  'border-color': 'var(--pm-r-bg,#007aff)',
});
requireCssDeclarations(cssRules, '.pm-message-select-check[data-checked="1"]::after', {
  content: "'✓'", 'font-size': '15px', 'font-weight': '800',
});
requireCssDeclarations(cssRules, '.pm-message-select-check:focus-visible', {
  outline: '2px solid #007aff', 'outline-offset': '2px',
});
requireCssDeclarations(cssRules, '#pm-iphone[data-theme="dark"] .pm-message-select-check', {
  background: 'transparent', 'border-color': '#8e8e93',
});
requireCssDeclarations(cssRules, '#pm-iphone[data-theme="dark"] .pm-message-select-check[data-checked="1"]', {
  'background-color': '#0a84ff',
  'background-image': 'linear-gradient(var(--pm-r-bg,#0a84ff),var(--pm-r-bg,#0a84ff))',
  'border-color': 'var(--pm-r-bg,#0a84ff)',
});
requireCssDeclarations(cssRules, '#pm-iphone[data-theme="dark"] .pm-message-select-check:focus-visible', {
  'outline-color': '#64a8ff',
});
requireCssDeclarations(cssRules, '.pm-custom-check', {
  width: '38px !important', height: '22px !important',
  'min-width': '38px !important', 'min-height': '22px !important',
  'border-radius': '999px !important',
});
requireCssDeclarations(cssRules, '.pm-custom-check::after', {
  width: '18px', height: '18px', left: '2px', top: '2px', 'border-radius': '50%',
});
requireCssDeclarations(cssRules, '.pm-custom-check[data-checked="1"]::after', {
  transform: 'translateX(16px)',
});
requireCssDeclarations(cssRules, '.pm-custom-check.is-checked::after', {
  transform: 'translateX(16px)',
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
for (const expected of ['手机会话占比 (%)', '互动社区占比 (%)', '日历占比 (%)', 'pm-budget-calendar-enabled', 'pm-custom-check', 'role="checkbox"', "event.key==='Enter'"]) {
  requireText('settings-templates.js', sourceModuleByName.get('settings-templates.js')?.code || '', expected);
}
for (const expected of [".pm-budget-scene.is-checked", 'pm-budget-selection-mode', 'communitySelectionsByStorage']) {
  requireText('settings-templates.js', sourceModuleByName.get('settings-templates.js')?.code || '', expected);
}
for (const expected of ["classList.contains('is-checked') === true", 'extractAiResponseContent(j)', 'resolveBudgetPercentageInput', 'collectBudgetCommunityFields']) {
  requireText('settings-ui.js', settingsCode, expected);
}
for (const [owner, code, expected] of [
  ['phone-directory.js', directoryCode, ['role="checkbox"', 'tabindex="0"', 'aria-checked=', "event.key==='Enter'"]],
  ['phone-chat-poke.js', phoneChatPokeCodeForChecks, ['role="checkbox"', 'tabindex="0"', 'aria-checked=', "event.key==='Enter'", 'saveCharacterBehavior()', 'savePokeConfig()', 'behaviorSnapshot', 'pokeSnapshot']],
  ['phone-lifecycle.js', lifecycleCode, [
    "setAttribute('role', 'checkbox')", "setAttribute('aria-checked'", 'cb.tabIndex = 0',
    'toggleMessageSelection({ checkbox: cb, wrap, list })', 'handleMessageSelectionKey(event, cb)',
  ]],
  ['phone-foundation.js', foundationCode, [
    'const previous = [...(window.__pmBidirectional[id] || [])]', 'if (!saveBidirectional())', 'window.__pmBidirectional[id] = previous',
    "handle.addEventListener('lostpointercapture', finish)", "window.addEventListener('blur', finish)",
    "handle.removeEventListener('lostpointercapture', finish)", "window.removeEventListener('blur', finish)", 'finish();',
    'export function phoneSizeForViewport(', 'const visualViewport = window.visualViewport;',
    "visualViewport?.addEventListener('resize', onViewportResize)", "visualViewport?.removeEventListener('resize', onViewportResize)",
  ]],
  ['settings-ui.js', settingsCode, ['const previous = window.__pmWordyLimit === true', 'if (!saveWordyLimit())', "el.setAttribute('aria-checked'"]],
]) {
  for (const value of expected) requireText(owner, code, value);
}
if (/assertV2Keys\s*\(\s*raw\s*,\s*\[[^\]]*contentRating/.test(interactiveModelCode)) {
  failures.push('interactive-scene-model.js: v2 scene keys must not accept contentRating');
}
requireText('interactive-scene-model.js', interactiveModelCode, "assertV1Keys(raw, ['id', 'title', 'preset', 'styleInput', 'generatedPrompt', 'themeAccent', 'contentRating'");
requireText('interactive-scene-model.js', interactiveModelCode, 'export function stripPersistedV2ContentRating(rawStore)');
requireText('interactive-scenes.js', interactiveCode, 'stripPersistedV2ContentRating(rawStore)');
if (settingsCode.includes('stripPersistedV2ContentRating')) {
  failures.push('settings-ui.js: untrusted backup import must not use persisted V2 contentRating compatibility cleanup');
}
if (settingsBackupValidateCode.includes('stripPersistedV2ContentRating')) {
  failures.push('settings-backup-validate.js: untrusted backup import must not use persisted V2 contentRating compatibility cleanup');
}
requireText('settings-ui.js', settingsCode, 'legacyBackupTheme(snapshot.theme)');
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
requireText('conversation.js', conversationCode, 'deps.closeControlCenter?.()');
requireText('bundle', bundle, 'pm-settings-home');
if (bundle.includes('pm-forum-entry')) failures.push('bundle: removed directory community entry must not remain');
for (const iconName of [
  'MENU_ICON_SVG', 'CLOSE_ICON_SVG', 'HOME_ICON_SVG', 'CONTROL_ICON_SVG', 'SEND_ICON_SVG',
  'POKE_ICON_SVG', 'CHAT_ICON_SVG', 'CONTACTS_ICON_SVG', 'SETTINGS_ICON_SVG', 'COMMUNITY_ICON_SVG',
  'EDIT_ICON_SVG', 'EMOJI_ICON_SVG', 'TRASH_ICON_SVG',
]) {
  requireText('icons.js', sourceModuleByName.get('icons.js')?.code || '', `export const ${iconName}`);
}

const phoneChatCode = sourceModuleByName.get('phone-chat.js')?.code || '';
const phoneChatPokeCode = sourceModuleByName.get('phone-chat-poke.js')?.code || '';
const phoneChatPokeAnalysis = analyze(phoneChatPokeCode, 'module');
const showContactConfigSource = phoneChatPokeAnalysis.functionSource.get('showContactConfig') || '';
const saveContactConfigSource = phoneChatPokeAnalysis.windowAssignmentSource.get('__pmSaveContactConfig') || '';
const foundationInjectionSource = foundationAnalysis.functionSource.get('applyBidirectionalInjection') || '';
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
  "window.__pmShowAddContact = (resultMessage = '')", 'escapeHtml(resultMessage)',
  '<b>手动添加</b>', '<b>AI 生成</b>', 'id="pm-autogen-btn"',
  'pm-contact-add-manual', 'pm-contact-add-primary', 'pm-contact-add-ai', 'pm-contact-add-icon',
]) requireText('phone-directory.js', directoryCode, expected);
for (const expected of [
  '.pm-action-button{', 'font-size:13px', 'background:var(--pm-r-bg,#007aff)',
  '.pm-action-button.is-danger{background:#ff3b30;color:#fff}',
  '.pm-contact-add-choices{', '.pm-calendar-base-dialog{width:290px}',
  '.pm-calendar-view-switch button{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;padding:0;border-radius:50%',
  '.pm-calendar-header{position:sticky', 'grid-template-columns:72px minmax(0,1fr) 72px',
]) requireText('style.css', css, expected);
for (const expected of [
  'onclick="window.__pmCloseOverlay()"', 'pm-contact-settings-title', 'pm-modal-add pm-contact-settings-actions',
  'onclick="window.__pmSaveContactConfig(',
  'window.__pmSaveAndCloseContactConfig = contactName => window.__pmSaveContactConfig(contactName)',
]) requireText('phone-chat-poke.js', phoneChatPokeCode, expected);
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
for (const forbidden of ['calendarWeather', 'getCalendarWeatherStore']) {
  if (foundationInjectionSource.includes(forbidden)) failures.push(`phone-foundation.js: prompt injection path must not read or pass ${forbidden}`);
}
for (const expected of ['calendarCycles', "getCalendarData('getCalendarCycleStore')"]) requireText('phone-foundation.js', foundationInjectionSource, expected);
for (const expected of [
  'class="pm-calendar-cycle-input" name="enabled" type="checkbox"',
  'class="pm-custom-check" aria-hidden="true"', '安全期',
]) requireText('calendar-view.js', calendarViewCode, expected);
for (const forbidden of ['pm-calendar-base-menu', 'TIME_ORIGIN_ICON_SVG']) {
  if (calendarCode.includes(forbidden)) failures.push(`calendar.js: obsolete title control remains: ${forbidden}`);
}
const phoneInjectionCode = sourceModuleByName.get('phone-injection.js')?.code || '';
const phoneInjectionAnalysis = analyze(phoneInjectionCode, 'module');
for (const functionName of ['renderCalendarContextInjection', 'buildContextInjectionPrompts']) {
  const source = phoneInjectionAnalysis.functionSource.get(functionName) || '';
  if (!source) failures.push(`phone-injection.js: missing ${functionName}`);
  for (const forbidden of ['weatherStore', 'calendarWeather']) {
    if (source.includes(forbidden)) failures.push(`phone-injection.js: ${functionName} must not accept or read ${forbidden}`);
  }
}
for (const expected of [
  'calendarDateRangeKeys(windowStart, -3, 6)', 'days: 60', 'calendarCycles',
  'cycleSubjectKeys', 'predictCycleRange', 'relativeCalendarLabel', "facts.join('；')",
]) requireText('phone-injection.js', phoneInjectionCode, expected);
requireText('interactive-scenes.js', interactiveCode, 'generationErrorMessage(error)');
requireText('interactive-scene-scheduler.js', sourceModuleByName.get('interactive-scene-scheduler.js')?.code || '', 'generationErrorMessage(error)');

const emojiMediaCode = sourceModuleByName.get('emoji-media.js')?.code || '';
const emojiUiCode = sourceModuleByName.get('emoji-ui.js')?.code || '';
const messagingCode = sourceModuleByName.get('messaging.js')?.code || '';
for (const expected of [
  'MAX_EMOJI_FILE_BYTES', 'MAX_EMOJI_INLINE_LIBRARY_BYTES', 'cloneEmojiLibrary',
  'emojiFileError', 'emojiSourceError', 'createEmojiRenderBudget', 'isRenderableEmojiSource',
]) requireText('emoji-media.js', emojiMediaCode, expected);
for (const expected of ['loading="lazy"', 'decoding="async"', 'emojiFileError(file)', 'emojiSourceError(url, window.__pmEmojis)']) {
  requireText('emoji-ui.js', emojiUiCode, expected);
}
for (const expected of ['isRenderableEmojiSource(url)', "typeof emojiBudget === 'function'", '!emojiBudget(url)', 'loading="lazy"', 'decoding="async"', 'object-fit:contain']) {
  requireText('messaging.js', messagingCode, expected);
}
for (const expected of ['createEmojiRenderBudget()', 'emojiBudget: emojiRenderBudget', 'resetEmojiRenderBudget']) {
  requireText('phone-foundation.js', foundationCode, expected);
}
for (const expected of ['resetEmojiRenderBudget()', "list.innerHTML = ''"]) {
  requireText('conversation.js', conversationCode, expected);
}

const runtimeCode = sourceModuleByName.get('runtime.js')?.code || '';
for (const expected of [
  'autoPokeArmed: false', 'automaticEpoch: 0', 'automaticTasks: new Map()',
  'createAutomaticTaskController', 'const taskKey = `${storageId}\\u0000${contactName}`',
  'getStorageId() !== storageId', 'advanceAutoPokeCounters',
  'runAutoPokeCounterCycle', 'await run(contactName)', 'commitAutomaticResult', 'await persistHistory()', 'persistCounter()',
]) requireText('runtime.js', runtimeCode, expected);
for (const expected of [
  'updatePhonePageSuspensionHandler(window, deps, disarmAutoPoke)', "disarmAutoPoke?.('host-chat-changed')",
  'hasCompletedAssistantMessage && isAutoPokeAllowed()',
  'createAutomaticTaskController', 'automaticTasks.begin', 'automaticTasks.isActive', 'automaticTasks.finish',
]) requireText('phone-foundation.js', foundationCode, expected);
for (const expected of [
  "disarmAutoPoke('phone-minimized')", "disarmAutoPoke('phone-closed')",
]) requireText('phone-lifecycle.js', lifecycleCode, expected);
for (const expected of [
  'runAutoPokeCounterCycle({',
  'run: contactName => window.__pmAutoPoke(contactName)',
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
]) requireText('phone-chat-poke.js', phoneChatPokeCode, expected);
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
  '#pm-iphone', '#pm-overlay', '.pm-model-options', '--pm-model-visible-rows',
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
if (css.includes('prefers-color-scheme')) failures.push('css: theme selection must remain explicit and must not use prefers-color-scheme');
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
if (packageJson.version !== '1.4.0') failures.push('version: expected release version 1.4.0');

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
const backupModuleBinding = analyzeBackupModuleBinding(settingsUiCode, settingsBackupValidateCode);
for (const [field, message] of Object.entries({
  importsValidatorParser: 'settings-ui.js: must import parseBackupData from ./settings-backup-validate.js',
  reexportsValidatorParser: 'settings-ui.js: must re-export the imported parseBackupData binding',
  prepareCallsValidatorParser: 'settings-ui.js: backup prepare callback must call the imported parseBackupData binding',
  validatorExportsParserFunction: 'settings-backup-validate.js: must export parseBackupData as a function declaration',
})) {
  if (!backupModuleBinding[field]) failures.push(message);
}
const settingsUiBackupContract = analyzeBackupContract(settingsUiCode);
const settingsBackupValidateContract = analyzeBackupContract(settingsBackupValidateCode);
const sourceBackupContract = {
  exportFields: new Set([...settingsUiBackupContract.exportFields, ...settingsBackupValidateContract.exportFields]),
  importFields: new Set([...settingsUiBackupContract.importFields, ...settingsBackupValidateContract.importFields]),
  importReadsFileName: settingsUiBackupContract.importReadsFileName || settingsBackupValidateContract.importReadsFileName,
};
const backupMetadataFields = new Set(['schemaVersion']);
const backupFields = [
  'histories', 'config', 'theme', 'profiles', 'groupMeta',
  'pokeConfig', 'bidirectional', 'emojis', 'characterBehavior',
  'wordyLimit', 'desktopBg', 'bgGlobal', 'bgLocal', 'interactiveScenes', 'phoneUiState', 'ambientStatus',
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
  if (contract.exportFields.has('budgetConfig')) failures.push(`${label}: budgetConfig must remain outside schemaVersion 4 backup export`);
  if (contract.importFields.has('budgetConfig')) failures.push(`${label}: budgetConfig must remain outside schemaVersion 4 backup import`);
  if (contract.importReadsFileName) failures.push(`${label}: backup import must not depend on file.name`);
}
for (const expected of [
  'PLUGIN_LOCAL_STORAGE_KEYS', 'PLUGIN_IDB_STATIC_KEYS', 'PLUGIN_IDB_DYNAMIC_PREFIXES',
  'clearPluginData', 'pmIDBKeys', "Object.freeze(['ST_SMS_BG_LOCAL_'])", "DESKTOP_BG_KEY = 'ST_SMS_BG_DESKTOP'",
]) requireText('storage.js', sourceModuleByName.get('storage.js')?.code || '', expected);
for (const expected of [
  'loadBgSettings', 'saveBgGlobal', 'saveBgLocal', 'saveDesktopBg', "label: '桌面背景'",
  'restoreBackgroundMutations', 'combinedBackgroundError', "LOCAL_BG_PREFIX = 'ST_SMS_BG_LOCAL_'",
]) requireText('storage-background.js', storageBackgroundCode, expected);
if ((sourceModuleByName.get('storage.js')?.code || '').includes("PLUGIN_LOCAL_STORAGE_KEYS = Object.freeze(['ST_SMS_MIGRATED_V3'")) {
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
