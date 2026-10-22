import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const languages = JSON.parse(fs.readFileSync(path.join(root, 'src/languages.json'), 'utf8'));
const keys = new Set(Object.values(languages).flatMap(({ translations }) => Object.keys(translations)));
const errors = [];
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
for (const key of keys) {
  for (const [language, { translations }] of Object.entries(languages)) {
    if (typeof translations[key] !== 'string' || !translations[key].trim()) errors.push(`${language}: missing ${key}`);
    else if (placeholders(translations[key]) !== placeholders(languages.pt.translations[key] ?? key)) errors.push(`${language}: invalid placeholders for ${key}`);
  }
}

const brandedText = new Set(['Orchestra', 'Space', 'ORCHESTRA SPACE']);
const untranslatedValues = new Set(['sinfonietta-vidin']);
function requireKey(key, filename) { if (key && !keys.has(key)) errors.push(`${filename}: unknown translation key ${key}`); }
function readLiteralKeys(node, filename) {
  if (ts.isStringLiteral(node)) requireKey(node.text, filename);
  else if (ts.isConditionalExpression(node)) { readLiteralKeys(node.whenTrue, filename); readLiteralKeys(node.whenFalse, filename); }
  else if (ts.isParenthesizedExpression(node)) readLiteralKeys(node.expression, filename);
}
function checkVisibleExpression(node, filename) {
  if (ts.isStringLiteral(node) && /\p{L}/u.test(node.text) && !brandedText.has(node.text.trim())) errors.push(`${filename}: untranslated expression ${node.text}`);
  else if (ts.isConditionalExpression(node)) { checkVisibleExpression(node.whenTrue, filename); checkVisibleExpression(node.whenFalse, filename); }
  else if (ts.isParenthesizedExpression(node)) checkVisibleExpression(node.expression, filename);
}
for (const entry of fs.readdirSync(path.join(root, 'src'))) {
  if (!entry.endsWith('.tsx') && entry !== 'i18n.ts') continue;
  const source = ts.createSourceFile(entry, fs.readFileSync(path.join(root, 'src', entry), 'utf8'), ts.ScriptTarget.Latest, true, entry.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isJsxText(node) && /\p{L}/u.test(node.text) && !brandedText.has(node.text.trim())) errors.push(`${entry}: untranslated text ${node.text.trim()}`);
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) checkVisibleExpression(node.expression, entry);
    if (ts.isJsxAttribute(node) && ['label', 'title', 'text', 'placeholder', 'alt', 'aria-label', 'aria-description'].includes(node.name.text) && node.initializer && ts.isStringLiteral(node.initializer) && !untranslatedValues.has(node.initializer.text)) errors.push(`${entry}: untranslated ${node.name.text} ${node.initializer.text}`);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['t', 'setError'].includes(node.expression.text) && node.arguments[0]) readLiteralKeys(node.arguments[0], entry);
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'key' && ts.isStringLiteral(node.initializer)) requireKey(node.initializer.text, entry);
    if (entry === 'i18n.ts' && ts.isStringLiteral(node) && /^(error|validation)\./.test(node.text)) requireKey(node.text, entry);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const schema = fs.readFileSync(path.join(root, '../api/prisma/schema.prisma'), 'utf8');
for (const match of schema.matchAll(/enum \w+\s*\{([^}]+)\}/g)) {
  for (const value of match[1].trim().split(/\s+/)) requireKey(value, 'Prisma enums');
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`${keys.size} translation keys verified across ${Object.keys(languages).length} languages; frontend text and enums covered.`);
