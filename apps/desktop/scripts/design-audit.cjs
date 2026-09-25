const { _electron: electron } = require('playwright-core');
const electronPath = require('electron');
const { cp, mkdir, mkdtemp, rm, writeFile, readFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

// Evaluate the DOM's actual composited foreground/background, not screenshots.
// Canvas labels and syntax tokens receive separate palette checks below.
function inspect() {
  const rgba = (v) => { const n = v.match(/[\d.]+/g)?.map(Number); return n && n.length >= 3 ? [n[0], n[1], n[2], n[3] ?? 1] : [0, 0, 0, 0]; };
  const over = (a, b) => [...a.slice(0, 3).map((x, i) => x * a[3] + b[i] * (1 - a[3])), 1];
  const lum = (a) => a.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((n, x, i) => n + x * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
  const bg = (e) => { const chain = []; for (let p = e; p; p = p.parentElement) chain.unshift(p); return chain.reduce((b, p) => over(rgba(getComputedStyle(p).backgroundColor), b), [16, 18, 24, 1]); };
  const visible = (e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false; for (let p = e; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; } return true; };
  const contrast = [], overflow = [], occluded = [], boundaries = []; let checked = 0, lowest = 21;
  for (const e of document.querySelectorAll('body *')) {
    if (!visible(e) || e.closest('.monaco-editor,svg') || e.matches('option') || e.closest('button:disabled') || e.matches(':disabled')) continue;
    const style = getComputedStyle(e), rect = e.getBoundingClientRect();
    const ownText = Array.from(e.childNodes).some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if ((ownText || e.matches('input,select,textarea')) && parseFloat(style.fontSize) > 0) {
      const background = bg(e); const check = (foreground, name) => { const value = ratio(over(rgba(foreground), background), background); checked++; lowest = Math.min(lowest, value); if (value < 4.5) contrast.push({ text: (name || e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 65), selector: e.className, ratio: +value.toFixed(3), color: foreground, background }); };
      check(style.color);
      if (e.matches('input,textarea') && e.getAttribute('placeholder')) check(getComputedStyle(e, '::placeholder').color, e.getAttribute('placeholder'));
    }
    if (e.matches('input:not([type="checkbox"]),select,textarea') && parseFloat(style.borderTopWidth) > 0) { const value = ratio(over(rgba(style.borderTopColor), bg(e.parentElement)), bg(e.parentElement)); if (value < 3) boundaries.push({ label: e.getAttribute('aria-label'), ratio: value }); }
    // Scrolling panes and intentional ellipsis are allowed. Undeclared clipping is not.
    if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 2 && style.overflowX === 'visible' && !e.matches('input,textarea') && !e.closest('.graph-canvas')) overflow.push({ selector: e.className || e.tagName, width: e.clientWidth, scroll: e.scrollWidth });
    if (e.matches('button,input,select,textarea') && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth) {
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      let clipped = false; for (let p = e.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p), r = p.getBoundingClientRect(); if (s.overflowY !== 'visible' && (y < r.top || y > r.bottom)) clipped = true; }
      if (!clipped) { const hit = document.elementFromPoint(x,y); if (hit && !e.contains(hit) && !hit.contains(e)) occluded.push({ text: e.textContent.slice(0,40), hit: hit.className }); }
    }
  }
  return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, checked, lowest, contrast, overflow, occluded, boundaries, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
}

async function paletteAudit() {
  const rgb = hex => hex.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
  const lum = hex => rgb(hex).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
  const ratio = (a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
  const graph = await readFile(resolve(__dirname,'../../ui/src/components/GraphCanvas.tsx'),'utf8');
  const source = await readFile(resolve(__dirname,'../../ui/src/components/SourceViewer.tsx'),'utf8');
  const fills = [...graph.matchAll(/"background-color": "(#[0-9a-f]{6})"/gi)].map(x=>x[1]);
  const texts = [...graph.matchAll(/\bcolor: "(#[0-9a-f]{6})"/gi)].map(x=>x[1]);
  const lines = [...graph.matchAll(/"(?:line-color|border-color)": "(#[0-9a-f]{6})"/gi)].map(x=>x[1]);
  const tokens = [...source.matchAll(/foreground: "([0-9a-f]{6})"/gi)].map(x=>'#'+x[1]);
  const pairs = [];
  for(const text of texts) for(const background of fills) pairs.push({kind:'graph text',text,background,ratio:ratio(text,background),target:4.5});
  for(const text of lines) pairs.push({kind:'graph boundary',text,background:'#101218',ratio:ratio(text,'#101218'),target:3});
  for(const text of tokens) for(const background of ['#111218','#353149','#2b2c3c']) pairs.push({kind:'syntax token',text,background,ratio:ratio(text,background),target:4.5});
  assert.ok(fills.length && texts.length && lines.length && tokens.length, 'palette extraction');
  assert.deepEqual(pairs.filter(x=>x.ratio<x.target), [], 'palette contrast failures');
  return pairs;
}

async function main() {
  const palettes = await paletteAudit();
  const base = await mkdtemp(join(tmpdir(), 'xray-design-audit-'));
  const fixture = join(base, 'project'), userData = join(base, 'user-data');
  const output = resolve(__dirname, '../../../docs/screenshots/final-design');
  await cp(resolve(__dirname, '../../../test-fixtures/e2e-project'), fixture, { recursive: true }); await mkdir(userData); await mkdir(output, { recursive: true });
  await writeFile(join(fixture, 'src', 'module-context-'.repeat(9) + 'long-file.ts'), 'export const longReadableSymbolNameForLayoutValidation = 42;\n');
  const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'pipe' });
  git('init'); git('config','user.email','design@example.test'); git('config','user.name','Design audit'); git('add','.'); git('commit','-m','fixture');
  await writeFile(join(fixture, 'src/validation.ts'), 'export function validate(token: string): boolean {\n  return token.length > 5;\n}\n');
  const app = await electron.launch({ executablePath: electronPath, args: [resolve(__dirname, '..')], env: { ...process.env, XRAY_E2E: '1', XRAY_E2E_USER_DATA: userData } });
  const results = []; const errors = [];
  try {
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('textbox', { name: '测试项目路径' }).fill(fixture); await page.getByRole('button', { name: '导入测试项目' }).click(); await page.getByText('不可变证据快照').waitFor({ timeout: 30000 });
    const pages = ['项目概览','架构地图','调用 / 数据流','功能解释','Git 变更','所有权模式'];
    for (const name of pages) {
      await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(800,600); w.webContents.setZoomFactor(1); w.setBounds({ x: 0, y: 0, width: 1440, height: 900 }); });
      await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
      if (await page.getByRole('button', { name: '关闭源码', exact:true }).count()) await page.getByRole('button', { name: '关闭源码', exact:true }).click();
      if (name === '架构地图') await page.getByTestId('graph-canvas').waitFor();
      if (name === '调用 / 数据流') { await page.getByLabel('搜索符号').fill('login'); await page.getByRole('button', { name: '搜索', exact: true }).click(); await page.getByLabel('选择符号').locator('option').filter({ hasText: 'login' }).first().waitFor({ state: 'attached' }); await page.getByRole('button', { name: '查询关系' }).click(); await page.locator('.relation-list button').first().waitFor(); }
      if (name === '功能解释') { await page.getByLabel('需要解释的功能').fill('login'); await page.getByRole('button', { name: '开始追踪' }).click(); await page.locator('.explanation').waitFor(); }
      if (name === 'Git 变更') { await page.getByRole('button', { name: '生成比较报告' }).click(); await page.getByTestId('comparison-identities').waitFor({ timeout: 30000 }); await page.locator('.change-file').first().click(); }
      if (name === '所有权模式') { await page.getByRole('button', { name: '生成结构化题目' }).click(); await page.locator('.ownership-quiz').waitFor(); }
      for (const [width,height,zoom] of [[1920,1080,1],[1440,900,1],[1280,800,1],[1024,768,1],[1280,800,1.25]]) {
        await app.evaluate(({ BrowserWindow }, bounds) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height }); w.webContents.setZoomFactor(bounds.zoom); }, { width,height,zoom });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const state = await page.evaluate(inspect); results.push({ page: name, window: [width,height], zoom, ...state });
        if (width === 1440 || width === 1024) await page.screenshot({ path: join(output, `${pages.indexOf(name)+1}-${width}.png`) });
      }
      if (name === '项目概览') {
        await page.locator('.coverage-details summary').click();
        results.push({ page:name+'/coverage', zoom:1.25, ...await page.evaluate(inspect) });
        await page.locator('.coverage-details summary').click();
      }
      if (name === '调用 / 数据流') {
        await page.getByLabel('关系视图').selectOption('data');
        await page.getByText('查询条件已修改。', {exact:false}).waitFor();
        results.push({ page:name+'/changed-query', zoom:1.25, ...await page.evaluate(inspect) });
        await page.getByLabel('关系视图').selectOption('call');
        await page.locator('.query-options summary').click();
        await page.getByLabel('查询深度').fill('0');
        assert.ok(await page.getByRole('button', {name:'查询关系',exact:true}).isDisabled());
        results.push({ page:name+'/invalid-options', zoom:1.25, ...await page.evaluate(inspect) });
        await page.getByLabel('查询深度').fill('3');
        results.push({ page:name+'/options', zoom:1.25, ...await page.evaluate(inspect) });
        await page.locator('.query-options summary').click();
        await page.getByRole('button', { name:'节点列表', exact:true }).click();
        await page.getByLabel('筛选图谱节点').fill('login');
        await page.getByLabel('筛选节点类型').selectOption('function');
        await page.locator('.graph-node-rows button').first().scrollIntoViewIfNeeded();
        const listBounds = await page.locator('.graph-node-rows button').first().evaluate(e => { const r=e.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}; });
        assert.ok(listBounds.left >= 0 && listBounds.right <= listBounds.width && listBounds.top >= 0 && listBounds.bottom <= listBounds.height, 'filtered node is readable inside the viewport');
        results.push({ page:name+'/node-list', zoom:1.25, ...await page.evaluate(inspect) });
        // Electron screenshots at fractional page zoom can crop on this Windows display.
        // Keep the zoomed DOM audit, but capture the review image at native page zoom.
        await app.evaluate(({ BrowserWindow }) => { const w=BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(1); w.setBounds({x:0,y:0,width:1440,height:900}); });
        await page.locator('.graph-panel').evaluate(e => { e.scrollTop=0; });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.screenshot({ path:join(output,'node-list.png') });
        await page.locator('.graph-node-rows button').first().click();
        await page.getByTestId('source-viewer').waitFor();
        await page.locator('.monaco-editor').waitFor();
        await page.getByRole('button', {name:'关闭源码',exact:true}).click();
        await page.getByRole('button', { name:'画布', exact:true }).click();
      }
      if (name === '调用 / 数据流' || name === '功能解释' || name === '所有权模式') {
        await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(1); w.setBounds({ x:0,y:0,width:1440,height:900 }); });
        if (name === '调用 / 数据流') await page.locator('.relation-list button').first().click();
        if (name === '功能解释') await page.locator('.steps button:not(:disabled)').first().click();
        if (name === '所有权模式') await page.locator('.ownership-files > button').first().click();
        await page.getByTestId('source-viewer').waitFor(); await page.locator('.monaco-editor').waitFor();
        for (const width of [1440, 1024]) {
          await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ x:0,y:0,width,height:900 }),width);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const state = await page.evaluate(inspect); results.push({ page: name + '/source', window:[width,900], zoom:1, ...state });
          await page.screenshot({ path:join(output, (pages.indexOf(name)+1) + '-source-' + width + '.png') });
        }
      }
    }
    await writeFile(join(output, 'audit.json'), JSON.stringify({ errors, palettes, results }, null, 2));
    const failed = results.filter(r => r.contrast.length || r.overflow.length || r.occluded.length || r.boundaries.length || r.pageOverflow);
    console.log(JSON.stringify({ cases: results.length, failed: failed.map(r => ({ page:r.page, width:r.width, zoom:r.zoom, contrast:r.contrast, overflow:r.overflow, occluded:r.occluded, boundaries:r.boundaries })), errors, output }));
    assert.equal(failed.length, 0, 'visual audit failures'); assert.equal(errors.length, 0, 'renderer errors');
  } finally { await app.close(); if (!resolve(base).startsWith(resolve(tmpdir()) + require('node:path').sep)) throw new Error('unsafe temp path'); await rm(base, { recursive:true, force:true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
