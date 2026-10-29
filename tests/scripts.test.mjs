import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(script, args) {
  return spawnSync(process.execPath, [path.join(skill, 'scripts', script), ...args], { encoding: 'utf8' });
}
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function generate(root, platform = 'app', mode = 'prototype', document = 'page') {
  const output = path.join(root, `${platform}-${mode}-${document}.html`);
  const result = run('scaffold_page.mjs', ['--output', output, '--platform', platform, '--mode', mode, '--document', document, '--title', '测试 <页面> & "标题"']);
  assert.equal(result.status, 0, result.stderr);
  return output;
}
function validate(root, strict = false) {
  return run('validate_project.mjs', [root, ...(strict ? ['--strict'] : [])]);
}
function completedPage(root) {
  const file = generate(root);
  const html = fs.readFileSync(file, 'utf8').replaceAll(' class="placeholder"', '')
    .replaceAll('待补充', '已说明');
  fs.writeFileSync(file, html);
  return file;
}

test('all 12 scaffold combinations preserve mode and escape the title', t => {
  const root = workspace(t);
  for (const platform of ['app', 'web']) for (const mode of ['prototype', 'requirements']) for (const document of ['page', 'rules', 'overview']) {
    const html = fs.readFileSync(generate(root, platform, mode, document), 'utf8');
    assert.ok(!html.includes('{{'));
    assert.ok(html.includes('测试 &lt;页面&gt; &amp; &quot;标题&quot;'));
    assert.equal(html.includes('id="prototype-root"'), mode === 'prototype');
  }
  assert.equal(validate(root).status, 0);
});

test('scaffolding refuses overwriting and invalid modes', t => {
  const root = workspace(t);
  const file = generate(root);
  const before = fs.readFileSync(file, 'utf8');
  for (const mode of ['prototype', 'invalid']) {
    assert.notEqual(run('scaffold_page.mjs', ['--output', file, '--platform', 'app', '--mode', mode, '--document', 'page', '--title', 'new']).status, 0);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

for (const [name, html, message] of [
  ['duplicate IDs', '<div id="a"></div><div id="a"></div>', /duplicate id/],
  ['missing file', '<a href="absent.html">link</a>', /missing local target/],
  ['classic syntax', '<script>const = ;</script>', /inline script/],
  ['module syntax', '<script type="module">const = ;</script>', /inline module/],
  ['same-page anchor', '<a href="#absent">link</a>', /missing local anchor/],
  ['cross-page anchor', '<a href="other.html#absent">link</a>', /missing local anchor/]
]) {
  test(`validator rejects ${name}`, t => {
    const root = workspace(t);
    fs.writeFileSync(path.join(root, 'index.html'), `<title>test</title>${html}`);
    fs.writeFileSync(path.join(root, 'other.html'), '<title>other</title><div id="present"></div>');
    const result = validate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });
}

test('valid anchors and module imports pass without executing code', t => {
  const root = workspace(t);
  fs.writeFileSync(path.join(root, 'index.html'), `<title>test</title><div id="目标"></div>
    <a href="#%E7%9B%AE%E6%A0%87">local</a><a href="other.html?q=1#present">other</a>
    <a href="#">top</a><a href="https://example.com/#absent">external</a>
    <script type="module">import x from './not-resolved.js'; await x(); throw new Error('never run');</script>
    <script type="application/json">{"not": "JavaScript"}</script>`);
  fs.writeFileSync(path.join(root, 'other.html'), '<title>other</title><div id="present"></div>');
  const result = validate(root);
  assert.equal(result.status, 0, result.stderr);
});

test('strict delivery rejects scaffolds but normal validation allows drafting', t => {
  const root = workspace(t);
  generate(root);
  assert.equal(validate(root).status, 0);
  const result = validate(root, true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /placeholder/);
});

test('strict structural checks accept completed template structure', t => {
  const root = workspace(t);
  completedPage(root);
  const result = validate(root, true);
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, change, message] of [
  ['missing chapter', html => html.replace('<h2>二、用户目标</h2>', '<h2>用户目标</h2>'), /nine sections/],
  ['invalid number', html => html.replace('F-LOGIN-01', 'F-LOGIN-1'), /invalid requirement number/],
  ['duplicate number', html => html.replace('<td>F-LOGIN-01</td>', '<td>F-LOGIN-01</td></tr><tr><td>F-LOGIN-01</td>'), /duplicate requirement number/],
  ['unresolved token', html => html.replace('已说明', '{{CONTENT}}'), /placeholder/]
]) {
  test(`strict checks reject ${name}`, t => {
    const root = workspace(t);
    const file = completedPage(root);
    const html = fs.readFileSync(file, 'utf8').replace('<h2>三、功能说明</h2>', '<h2>三、功能说明</h2><table><tbody><tr><td>F-LOGIN-01</td><td>提交后进入首页</td></tr></tbody></table>');
    fs.writeFileSync(file, change(html));
    const result = validate(root, true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  });
}

test('column dragging and window resizing preserve all desktop minimum widths', async t => {
  const { default: vm } = await import('node:vm');
  const root = workspace(t);
  const html = fs.readFileSync(generate(root), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const widths = { '--nav-width': '220px', '--spec-width': '520px' };
  const classList = { add() {}, remove() {} };
  const handles = ['left', 'right'].map(side => ({
    events: {}, classList, getAttribute: () => side, setPointerCapture() {},
    addEventListener(name, fn) { this.events[name] = fn; },
    removeEventListener(name) { delete this.events[name]; }
  }));
  const element = { clientWidth: 1440, style: { setProperty(name, value) { widths[name] = value; } } };
  const window = { addEventListener(name, fn) { this[name] = fn; } };
  vm.runInNewContext(script, {
    document: { documentElement: element, body: { classList }, querySelectorAll: () => handles },
    window, getComputedStyle: () => ({ getPropertyValue: name => widths[name] })
  });
  function assertFits() {
    const nav = parseFloat(widths['--nav-width']);
    const spec = parseFloat(widths['--spec-width']);
    assert.ok(nav >= 180);
    assert.ok(spec >= 360);
    assert.ok(element.clientWidth - nav - spec - 12 >= 380);
  }
  for (const handle of handles) for (const delta of [-10000, 10000]) {
    handle.events.pointerdown({ clientX: 0, pointerId: 1 });
    handle.events.pointermove({ clientX: delta });
    assertFits();
    handle.events.pointerup();
    assert.equal(handle.events.pointermove, undefined);
  }
  for (const width of [1132, 1440, 1200, 1132]) {
    element.clientWidth = width;
    window.resize();
    assertFits();
  }
  element.clientWidth = 375;
  window.resize();
  element.clientWidth = 1132;
  window.resize();
  assertFits();
});

test('strict mode does not impose page chapters on rule, overview or legacy documents', t => {
  const root = workspace(t);
  for (const document of ['rules', 'overview']) {
    const file = generate(root, 'web', 'requirements', document);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll(' class="placeholder"', '').replaceAll('待补充', '已说明'));
  }
  fs.writeFileSync(path.join(root, 'legacy.html'), '<title>Existing project</title><p>Existing document format</p>');
  const result = validate(root, true);
  assert.equal(result.status, 0, result.stderr);
});

test('navigation separates the requirement title, grouped page and persistent dates', t => {
  const root = workspace(t);
  const file = path.join(root, 'login.html');
  const result = run('scaffold_page.mjs', ['--output', file, '--platform', 'app', '--mode', 'requirements', '--document', 'page', '--title', '登录页面', '--project-title', '账号 <改版>', '--created-at', '2026-10-16', '--updated-at', '2026-10-28']);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(file, 'utf8');
  const nav = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.match(nav, /<h1[^>]*>账号 &lt;改版&gt;<\/h1>/);
  assert.match(nav, /<h2[^>]*>需求页面<\/h2>[\s\S]*<a[^>]*aria-current="page"[^>]*>登录页面<\/a>/);
  assert.match(nav, /创建时间[\s\S]*datetime="2026-10-16">2026-10-16/);
  assert.match(nav, /更新时间[\s\S]*datetime="2026-10-28">2026-10-28/);
  assert.match(html, /<title>登录页面<\/title>/);
  assert.equal(validate(root).status, 0);
});

test('new standalone pages initialize both dates once at generation', t => {
  const root = workspace(t);
  const html = fs.readFileSync(generate(root), 'utf8');
  const dates = [...html.matchAll(/<time datetime="([^"]+)"/g)].map(match => match[1]);
  assert.equal(dates.length, 2);
  assert.match(dates[0], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(dates[0], dates[1]);
});

test('navigation dates reject invalid dates and reverse chronology', t => {
  const root = workspace(t);
  for (const [created, updated] of [['2026-02-30', '2026-10-28'], ['2026-10-28', '2026-10-16']]) {
    const result = run('scaffold_page.mjs', ['--output', path.join(root, 'page.html'), '--platform', 'app', '--mode', 'requirements', '--document', 'page', '--title', '页面', '--created-at', created, '--updated-at', updated]);
    assert.notEqual(result.status, 0);
    assert.ok(!fs.existsSync(path.join(root, 'page.html')));
  }
});

test('prototype presentation separates the review toolbar from the empty product viewport', t => {
  const root = workspace(t);
  for (const platform of ['app', 'web']) {
    const html = fs.readFileSync(generate(root, platform), 'utf8');
    const middle = html.match(/<section class="prd-workspace"[^>]*>([\s\S]*?)<\/section>/)[1];
    assert.match(middle, /<header class="prototype-toolbar">[\s\S]*测试 &lt;页面&gt; &amp; &quot;标题&quot;[\s\S]*<\/header>\s*<div class="prototype-canvas">/);
    assert.match(middle, /id="prototype-root"><\/div>/);
    assert.ok(!middle.includes('<button'), 'no fabricated state controls or business UI');
    assert.match(middle, new RegExp(`class="prototype-frame ${platform}-frame"`));
    const empty = fs.readFileSync(generate(root, platform, 'requirements'), 'utf8')
      .match(/<section class="prd-workspace"[^>]*>([\s\S]*?)<\/section>/)[1];
    assert.ok(!/prototype-toolbar|prototype-frame|<header/.test(empty));
  }
});

test('preview fitting scales the frame without changing its product viewport', async t => {
  const vm = await import('node:vm');
  const root = workspace(t);
  const html = fs.readFileSync(generate(root), 'utf8');
  const script = html.match(/<script id="prototype-preview">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'preview fitting script is present');
  for (const [width, height] of [[375, 812], [1200, 760]]) {
    const frame = { offsetWidth: width, offsetHeight: height, style: {} };
    const viewport = { style: {} };
    const canvas = { clientWidth: 324 };
    let resize;
    vm.runInNewContext(script, {
      document: { querySelector: selector => ({ '.prototype-frame': frame, '.prototype-viewport': viewport, '.prototype-canvas': canvas })[selector] },
      ResizeObserver: class { constructor(callback) { resize = callback; } observe(target) { assert.equal(target, canvas); } }
    });
    for (const available of [324, 358, 640, 1400]) {
      canvas.clientWidth = available;
      resize();
      const scale = Math.min(1, available / width);
      assert.equal(frame.style.transform, `scale(${scale})`);
      assert.equal(parseFloat(viewport.style.width), width * scale);
      assert.equal(parseFloat(viewport.style.height), height * scale);
      assert.equal(frame.offsetWidth, width);
      assert.equal(frame.offsetHeight, height);
    }
  }
  vm.runInNewContext(script, { document: { querySelector: () => null } });
});

function changePage(root, headings) {
  const file = path.join(root, 'change.html');
  const result = run('scaffold_page.mjs', ['--output', file, '--platform', 'web', '--mode', 'requirements', '--document', 'page', '--page-type', 'change', '--title', '登录页面']);
  assert.equal(result.status, 0, result.stderr);
  let html = fs.readFileSync(file, 'utf8').replaceAll(' class="placeholder"', '').replace('待补充一句话变更摘要。', '增加短信登录入口。');
  html = html.replace('</aside>', headings.map(heading => `<section class="spec-section"><h2>${heading}</h2><p>点击短信登录，进入验证码页面；返回时保留手机号。</p></section>`).join('') + '</aside>');
  fs.writeFileSync(file, html);
  return file;
}

test('change pages accept only changed sections without filling unchanged chapters', t => {
  const root = workspace(t);
  const baseline = completedPage(root);
  const before = fs.readFileSync(baseline, 'utf8');
  const file = changePage(root, ['三、功能说明', '六、交互与跳转']);
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /data-page-type="change"/);
  assert.match(html, /页面修改/);
  assert.ok(!html.includes('一、页面概述'));
  assert.equal(validate(root, true).status, 0);
  assert.equal(fs.readFileSync(baseline, 'utf8'), before);
});

for (const headings of [[], ['六、交互与跳转', '三、功能说明'], ['三、功能说明', '三、功能说明'], ['十、其他'], ['功能说明']]) {
  test(`change pages reject empty or invalid chapter order: ${JSON.stringify(headings)}`, t => {
    const root = workspace(t);
    changePage(root, headings);
    const result = validate(root, true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /changed sections in original numbered order/);
  });
}

test('new pages and legacy page markers retain the complete nine-section requirement', t => {
  const root = workspace(t);
  const file = completedPage(root);
  let html = fs.readFileSync(file, 'utf8');
  assert.match(html, /data-page-type="new"/);
  assert.ok(!html.includes('<table>'), 'lists and short prose need no mandatory tables or IDs');
  html = html.replace(' data-page-type="new"', '');
  fs.writeFileSync(file, html);
  assert.equal(validate(root, true).status, 0);
  fs.writeFileSync(file, html.replace(/<section class="spec-section">[\s\S]*?<\/section>/, ''));
  assert.match(validate(root, true).stderr, /nine sections/);
});

test('optional comparison tables work and sparse change sections still validate supplied rule IDs', t => {
  const root = workspace(t);
  const file = changePage(root, ['五、业务规则']);
  const html = fs.readFileSync(file, 'utf8').replace('<h2>五、业务规则</h2>', '<h2>五、业务规则</h2><table><tr><td>普通用户</td><td>每日一次</td></tr><tr><td>R-LOGIN-01</td><td>每日一次</td></tr></table>');
  fs.writeFileSync(file, html);
  assert.equal(validate(root, true).status, 0);
  fs.writeFileSync(file, html.replace('R-LOGIN-01', 'R-LOGIN-1'));
  assert.match(validate(root, true).stderr, /invalid requirement number/);
});

test('page type options reject invalid values and non-page usage', t => {
  const root = workspace(t);
  for (const [document, pageType] of [['page', 'unknown'], ['rules', 'change'], ['overview', 'new']]) {
    const file = path.join(root, 'invalid.html');
    const result = run('scaffold_page.mjs', ['--output', file, '--platform', 'app', '--mode', 'requirements', '--document', document, '--page-type', pageType, '--title', '页面']);
    assert.notEqual(result.status, 0);
    assert.ok(!fs.existsSync(file));
  }
  const file = completedPage(root);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('data-page-type="new"', 'data-page-type="unknown"'));
  assert.match(validate(root, true).stderr, /invalid page type/);
});
