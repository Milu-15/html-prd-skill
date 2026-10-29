#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--force') {
      values.force = true;
      continue;
    }
    if (!item.startsWith('--')) fail(`Unknown argument: ${item}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for ${item}`);
    values[item.slice(2)] = value;
    index += 1;
  }
  return values;
}

function readAsset(name) {
  return fs.readFileSync(path.join(skillDir, 'assets', name), 'utf8').trimEnd();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

const args = parseArgs(process.argv.slice(2));
const platform = args.platform;
const mode = args.mode;
const documentType = args.document;
const pageType = args['page-type'] || 'new';
const output = args.output ? path.resolve(args.output) : '';
const title = args.title ? args.title.trim() : '';
const projectTitle = args['project-title'] === undefined ? title : args['project-title'].trim();
const now = new Date();
const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
const createdAt = args['created-at'] || today;
const updatedAt = args['updated-at'] || today;


if (!output) fail('Provide --output with a target HTML path.');
if (!title) fail('Provide --title.');
if (!projectTitle) fail('--project-title must not be empty.');
for (const [name, value] of [['created-at', createdAt], ['updated-at', updatedAt]]) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    fail(`--${name} must be a valid YYYY-MM-DD date.`);
  }
}
if (updatedAt < createdAt) fail('--updated-at must not precede --created-at.');
if (!['app', 'web'].includes(platform)) fail('--platform must be app or web.');
if (!['prototype', 'requirements'].includes(mode)) fail('--mode must be prototype or requirements.');
if (!['page', 'rules', 'overview'].includes(documentType)) fail('--document must be page, rules, or overview.');
if (!['new', 'change'].includes(pageType)) fail('--page-type must be new or change.');
if (args['page-type'] !== undefined && documentType !== 'page') fail('--page-type only applies to --document page.');
if (path.extname(output).toLowerCase() !== '.html') fail('--output must end in .html.');
if (fs.existsSync(output) && !args.force) fail(`Target already exists: ${output}. Use --force only after reviewing the target.`);

const middleAsset = mode === 'requirements'
  ? 'middle-empty.html'
  : platform === 'app' ? 'middle-app.html' : 'middle-web.html';
const specAsset = documentType === 'page' && pageType === 'change' ? 'spec-page-change.html' : `spec-${documentType}.html`;
const escapedTitle = escapeHtml(title);

let page = readAsset('page-shell.html');
page = page
  .replaceAll('{{PROJECT_TITLE}}', () => escapeHtml(projectTitle))
  .replaceAll('{{NAV_GROUP}}', { page: '需求页面', rules: '业务规则', overview: '需求总览' }[documentType])
  .replaceAll('{{CREATED_AT}}', createdAt)
  .replaceAll('{{UPDATED_AT}}', updatedAt)
  .replaceAll('{{TITLE}}', escapedTitle)
  .replaceAll('{{PLATFORM}}', platform)
  .replaceAll('{{MODE}}', mode)
  .replaceAll('{{DOCUMENT}}', documentType)
  .replaceAll('{{PAGE_TYPE_ATTRIBUTE}}', documentType === 'page' ? ` data-page-type="${pageType}"` : '')
  .replace('{{MIDDLE}}', () => readAsset(middleAsset).replaceAll('{{TITLE}}', () => escapedTitle))
  .replace('{{SPEC}}', readAsset(specAsset).replaceAll('{{TITLE}}', escapedTitle));

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${page}\n`, 'utf8');
process.stdout.write(`Created ${output}\n`);
