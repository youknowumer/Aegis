const test = require('node:test'), assert = require('node:assert'), vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

// ---------- extension tools with a fake chrome API
const W = require(path.join(root, 'extension', 'tools.js'));
function fakeChrome(tabs, pageResults = {}) {
  const calls = [];
  const chrome = {
    tabs: {
      query: async () => tabs, get: async (id) => tabs.find((t) => t.id === id),
      create: async ({ url }) => { const t = { id: 100 + tabs.length, windowId: 1, index: tabs.length, url, title: 'New', status: 'complete', active: true }; tabs.push(t); calls.push(['create', url]); return t; },
      update: async (id, p) => { const t = tabs.find((x) => x.id === id); Object.assign(t, p.url ? { url: p.url } : {}); calls.push(['update', id, p]); return t; },
      remove: async (id) => { calls.push(['remove', id]); }, reload: async () => {}, goBack: async () => {}, goForward: async () => {},
    },
    windows: { update: async () => {} },
    scripting: { executeScript: async ({ func, args }) => { calls.push(['script', func.name, args]); const f = pageResults[func.name]; return [{ result: typeof f === 'function' ? f(...args) : f }]; } },
    downloads: { download: async (o) => { calls.push(['download', o.filename]); } },
  };
  return { chrome, calls };
}
const tabsList = () => [
  { id: 1, windowId: 1, index: 0, url: 'https://example.com/', title: 'Example', status: 'complete', active: true },
  { id: 2, windowId: 1, index: 1, url: 'https://news.test/', title: 'News', status: 'complete', active: false },
];

test('only http(s) urls open', () => {
  assert.equal(W.allowedUrl('example.com'), 'https://example.com/');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', 'data:text/html,x', 'chrome-extension://x/a']) assert.throws(() => W.allowedUrl(bad), bad);
});

test('chrome_tabs lists, chrome_open opens a new tab, chrome_switch finds by title', async () => {
  const { chrome, calls } = fakeChrome(tabsList());
  const h = W.createTools(chrome).handle;
  assert.match(await h('chrome_tabs', {}), /1\* Example[\s\S]*2 {2}News/);
  assert.match(await h('chrome_open', { url: 'github.com' }), /Opened in a new tab/);
  assert.deepEqual(calls[0], ['create', 'https://github.com/']);
  assert.match(await h('chrome_switch', { tab: 'news' }), /Switched to: News/);
  assert.match(await h('chrome_open', { url: 'javascript:1' }), /^Error: only http/);
  assert.match(await h('pc_open_app', {}), /only run chrome_\* tools/);
});

test('risky clicks need approval, passwords are never typed', async () => {
  const { chrome } = fakeChrome(tabsList(), {
    resolve: (q) => (q.index === 1 ? { tag: 'BUTTON', type: 'submit', label: 'Place order', form: '/pay' } : q.index === 2 ? { tag: 'INPUT', type: 'password', label: 'Password' } : { tag: 'A', type: '', label: 'About us' }),
    click: { ok: true },
  });
  const h = W.createTools(chrome).handle;
  assert.match(await h('chrome_click', { index: 1 }), /^NEEDS_APPROVAL/);
  assert.match(await h('chrome_click', { index: 1, approved: true }), /^Clicked "Place order"/);
  assert.match(await h('chrome_click', { index: 3 }), /^Clicked "About us"/);
  assert.match(await h('chrome_type', { index: 2, text: 'secret' }), /never type into password/);
});

test('read pages, scroll and find use the page functions', async () => {
  const { chrome } = fakeChrome(tabsList(), {
    text: { title: 'Example', url: 'https://example.com/', text: 'Hello world' },
    scroll: { pct: 50, atEnd: false }, find: { count: 1, out: ['say hello there'] },
  });
  const h = W.createTools(chrome).handle;
  assert.match(await h('chrome_read', {}), /Hello world/);
  assert.match(await h('chrome_scroll', { direction: 'down' }), /50% down/);
  assert.match(await h('chrome_find', { text: 'hello' }), /Found 1 match/);
});

test('protected pages give a friendly error', async () => {
  const { chrome } = fakeChrome(tabsList());
  chrome.scripting.executeScript = async () => { throw new Error('Cannot access a chrome:// URL'); };
  assert.match(await W.createTools(chrome).handle('chrome_read', {}), /cannot be controlled/);
});

test('every extension file is valid and the manifest is MV3', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  for (const f of [m.background.service_worker, m.action.default_popup, ...Object.values(m.icons)]) assert.ok(fs.existsSync(path.join(root, 'extension', f)), f);
  const popup = fs.readFileSync(path.join(root, 'extension', 'popup.js'), 'utf8');
  assert.ok(popup.includes('parseCode'));
});

// ---------- webctl voice commands against the real commands.js
function load() {
  const ctx = { window: {}, document: { getElementById: () => null, readyState: 'complete', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }, navigator: {}, localStorage: { getItem: () => null, setItem() {} }, console, addEventListener() {}, getSelection: () => '', getComputedStyle: () => ({}) };
  ctx.window = ctx; ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'commands.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'webctl.js'), 'utf8'), ctx);
  return ctx.AegisCommands;
}
const A = load();
const cases = [
  ['scroll down', 'wc-scroll'], ['scroll up', 'wc-scroll'], ['neeche scroll karo', 'wc-scroll'], ['page down', 'wc-scroll'],
  ['scroll to the top', 'wc-edge'], ['bottom', 'wc-edge'], ['go back', 'wc-back'], ['wapas jao', 'wc-back'], ['reload the page', 'wc-reload'],
  ['zoom in', 'wc-zoom'], ['zoom out', 'wc-zoom'], ['reset zoom', 'wc-zoom'], ['show numbers', 'wc-numbers'], ['hide numbers', 'wc-numbers-off'],
  ['click 3', 'wc-click-num'], ['click five', 'wc-click-num'], ['click settings', 'wc-click'], ['press the send button', 'wc-click'], ['memory tab dabao', 'wc-click'],
  ['type hello there', 'wc-type'], ['press enter', 'wc-key'], ['clear the field', 'wc-clear'], ['read selected text', 'wc-read-selection'], ['what can i click', 'wc-read-screen'],
  ['copy page link', 'wc-copy-link'], ['download my memory', 'wc-export-memory'], ['save this chat', 'wc-save-chat'], ['print this page', 'wc-print'],
  // must still reach the AI or the older commands
  ['open youtube', 'open'], ['what is the capital of france', null], ['tell me a joke', null], ['click', null], ['scroll through my emails and summarize them', null],
];
test('web voice commands route correctly and do not steal normal requests', () => {
  for (const [text, want] of cases) {
    const m = A.match(text, { online: true });
    assert.equal(m ? m.name : null, want, text);
  }
});
