#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const ignoredDirectories = new Set(['.git', '.playwright-cli', 'node_modules', 'output', 'dist', 'build']);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) files.push(target);
  }
  return files;
}

function lineFor(content, offset) {
  return content.slice(0, offset).split('\n').length;
}

function stripTarget(value) {
  const withoutHash = value.split('#', 1)[0];
  return withoutHash.split('?', 1)[0];
}

function isExternal(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|\{\{)/i.test(value);
}

function blankEmbeddedCode(content) {
  return content.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => block.replace(/[^\n]/g, ' '));
}

function validateFile(file, projectRoot, strict) {
  const content = fs.readFileSync(file, 'utf8');
  const markup = blankEmbeddedCode(content);
  const relative = path.relative(projectRoot, file);
  const errors = [];
  const warnings = [];
  const ids = new Map();

  for (const match of markup.matchAll(/(?:^|\s)id\s*=\s*(["'])([^"']+)\1/gi)) {
    const id = match[2];
    if (ids.has(id)) errors.push(`${relative}:${lineFor(content, match.index)} duplicate id "${id}"`);
    else ids.set(id, match.index);
  }

  for (const match of markup.matchAll(/(?:^|\s)(?:href|src|action)\s*=\s*(["'])([^"']+)\1/gi)) {
    const rawTarget = match[2].trim();
    if (!rawTarget || isExternal(rawTarget)) continue;
    const stripped = stripTarget(rawTarget);
    let decoded;
    try { decoded = decodeURIComponent(stripped); }
    catch { decoded = stripped; }
    const target = decoded.startsWith('/')
      ? path.join(projectRoot, decoded.slice(1))
      : decoded ? path.resolve(path.dirname(file), decoded) : file;
    if (!fs.existsSync(target)) {
      errors.push(`${relative}:${lineFor(content, match.index)} missing local target "${rawTarget}"`);
      continue;
    }
    const hashIndex = rawTarget.indexOf('#');
    if (hashIndex >= 0 && /\.html?$/i.test(target) && fs.statSync(target).isFile()) {
      let anchor = rawTarget.slice(hashIndex + 1);
      try { anchor = decodeURIComponent(anchor); } catch { /* Keep literal malformed escapes. */ }
      // Empty fragments and text fragments do not refer to element IDs.
      anchor = anchor.split(':~:text=')[0];
      if (anchor) {
        const targetMarkup = target === file ? markup : blankEmbeddedCode(fs.readFileSync(target, 'utf8'));
        const anchors = [...targetMarkup.matchAll(/(?:^|\s)(?:id|name)\s*=\s*(["'])([^"']+)\1/gi)].map(item => item[2]);
        if (!anchors.includes(anchor) && anchor.toLowerCase() !== 'top') {
          errors.push(`${relative}:${lineFor(content, match.index)} missing local anchor "${rawTarget}"`);
        }
      }
    }
  }

  for (const match of content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1];
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const typeMatch = attributes.match(/\btype\s*=\s*(["'])([^"']+)\1/i);
    const type = typeMatch ? typeMatch[2].trim().toLowerCase() : '';
    if (!['', 'text/javascript', 'application/javascript', 'module'].includes(type)) continue;
    const script = match[2].trim();
    if (!script) continue;
    if (type === 'module') {
      const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: script, encoding: 'utf8' });
      if (result.status !== 0) errors.push(`${relative}:${lineFor(content, match.index)} inline module: ${result.error?.message || result.stderr.trim()}`);
      continue;
    }
    try { new vm.Script(script, { filename: relative }); }
    catch (error) { errors.push(`${relative}:${lineFor(content, match.index)} inline script: ${error.message}`); }
  }

  if (/\bdata-prd-page\b/.test(content)) {
    const bodyAttributes = (content.match(/<body\b([^>]*)>/i) || [])[1] || '';
    if (!/class=["'][^"']*\bprd-layout\b/.test(content)) errors.push(`${relative}: missing .prd-layout`);
    if (!/class=["'][^"']*\bprd-nav\b/.test(content)) errors.push(`${relative}: missing .prd-nav`);
    if (!/class=["'][^"']*\bprd-workspace\b/.test(content)) errors.push(`${relative}: missing .prd-workspace`);
    if (!/class=["'][^"']*\bprd-spec\b/.test(content)) errors.push(`${relative}: missing .prd-spec`);
    if (/data-mode=["']requirements["']/.test(bodyAttributes) && /\bid=["']prototype-root["']/.test(content)) {
      errors.push(`${relative}: requirements-only page contains a prototype root`);
    }
  }

  if (strict && /\bdata-prd-page\b/.test(markup)) {
    if (/\{\{[^}]+\}\}|class=["'][^"']*\bplaceholder\b|>\s*待补充[^<]*</.test(markup)) {
      errors.push(`${relative}: unresolved template placeholder`);
    }
    const body = (markup.match(/<body\b([^>]*)>/i) || [])[1] || '';
    if (/data-document=["']page["']/.test(body)) {
      const spec = (markup.match(/<aside\b[^>]*\bid=["']spec["'][^>]*>([\s\S]*?)<\/aside>/i) || [])[1] || '';
      const sections = [...spec.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)].map(item => item[1]);
      const headings = sections.map(section => ((section.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || '').replace(/<[^>]*>/g, '').trim());
      const numbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
      const pageType = (body.match(/data-page-type=["']([^"']*)["']/) || [])[1] ?? 'new';
      const chapterIndexes = headings.map(heading => numbers.findIndex(number => heading.startsWith(`${number}、`)));
      if (!['new', 'change'].includes(pageType)) {
        errors.push(`${relative}: invalid page type "${pageType}"`);
      } else if (pageType === 'new' && (headings.length !== 9 || chapterIndexes.some((chapter, index) => chapter !== index))) {
        errors.push(`${relative}: page document must contain nine sections in order`);
      } else if (pageType === 'change' && (!headings.length || chapterIndexes.some((chapter, index) => chapter < 0 || (index > 0 && chapter <= chapterIndexes[index - 1])))) {
        errors.push(`${relative}: change page must contain changed sections in original numbered order`);
      }
      for (const [chapter, prefix] of [[2, 'F'], [4, 'R']]) {
        const index = chapterIndexes.indexOf(chapter);
        const seen = new Set();
        const rows = [...(sections[index] || '').matchAll(/<tr\b[^>]*>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
        for (const row of rows) {
          const number = row[1].replace(/<[^>]*>/g, '').trim();
          if (!number.startsWith(`${prefix}-`)) continue;
          if (!new RegExp(`^${prefix}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-[0-9]{2}$`).test(number) || /-XX-|-[0]{2}$/.test(number)) {
            errors.push(`${relative}: invalid requirement number "${number}"`);
          }
          if (seen.has(number)) errors.push(`${relative}: duplicate requirement number "${number}"`);
          seen.add(number);
        }
      }
    }
  }

  if (!/<title>[^<]+<\/title>/i.test(content)) warnings.push(`${relative}: missing non-empty title`);
  return { errors, warnings };
}

const requestedRoot = process.argv[2];
if (!requestedRoot || process.argv.slice(3).some(argument => argument !== '--strict')) {
  process.stderr.write('Usage: node validate_project.mjs /absolute/path/to/project [--strict]\n');
  process.exit(1);
}

const projectRoot = path.resolve(requestedRoot);
if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
  process.stderr.write(`Project directory not found: ${projectRoot}\n`);
  process.exit(1);
}

const files = walk(projectRoot);
const errors = [];
const warnings = [];
for (const file of files) {
  const result = validateFile(file, projectRoot, process.argv.includes('--strict'));
  errors.push(...result.errors);
  warnings.push(...result.warnings);
}

for (const warning of warnings) process.stdout.write(`WARN ${warning}\n`);
for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
process.stdout.write(`Checked ${files.length} HTML files: ${errors.length} error(s), ${warnings.length} warning(s).\n`);
process.exit(errors.length ? 1 : 0);
