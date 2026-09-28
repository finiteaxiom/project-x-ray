const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { join, resolve, sep } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

async function launch(userData) {
  const app = await electron.launch({ executablePath: electronPath, args: [resolve(__dirname, "..")], env: { ...process.env, XRAY_E2E: "1", XRAY_E2E_USER_DATA: userData } });
  return { app, page: await app.firstWindow() };
}
async function resizeContent(app, page, width, height) {
  if (page.viewportSize()) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction((expected) => window.innerWidth === expected.width && window.innerHeight === expected.height, { width, height }, { timeout: 10_000 });
    return "renderer-viewport-emulation";
  }
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("missing Electron window while resizing the UI fixture");
    // The 1920px viewport is wider than this Windows display's 1707px CSS work area;
    // leave the maximized state and restore an on-screen origin before resizing back down.
    if (window.isMaximized()) window.unmaximize();
    window.setPosition(0, 0);
    window.setContentSize(bounds.width, bounds.height);
  }, { width, height });
  try {
    await page.waitForFunction((expected) => window.innerWidth === expected.width && window.innerHeight === expected.height, { width, height }, { timeout: 10_000 });
  } catch (error) {
    const actual = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio }));
    const bounds = await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; return window ? { ...window.getBounds(), maximized: window.isMaximized() } : null; });
    if (actual.width !== width || actual.height !== height) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction((expected) => window.innerWidth === expected.width && window.innerHeight === expected.height, { width, height }, { timeout: 10_000 });
      return "renderer-viewport-emulation";
    }
    if (!bounds) throw new Error(`Electron fixture resize lost its window; viewport=${JSON.stringify(actual)}; ${error.message}`);
    return "electron-window";
  }
  return "electron-window";
}
async function captureElectronWindow(app, page, outputPath) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("missing Electron window while capturing the UI fixture");
    return (await window.webContents.capturePage()).toPNG().toString("base64");
  });
  await writeFile(outputPath, Buffer.from(image, "base64"));
}
async function verifyExplanationDisabledFeedback(app, page, screenshots, mode) {
  if (!mode) return null;
  const captureMode = await resizeContent(app, page, 1440, 900);
  const zoomFactor = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 1);
  const button = page.locator(".explanation-steps button.button.secondary").first();
  await button.waitFor({ state: "visible" });
  const box = await button.boundingBox(); assert.ok(box, "feature explanation evidence button must have a visible hit target");
  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };

  // Hold the real registered IPC response in this test process; keep the immutable contextBridge API untouched.
  await app.evaluate(({ ipcMain }) => {
    const channel = "evidence:get";
    const handlers = ipcMain._invokeHandlers;
    const original = handlers.get(channel);
    if (!original) throw new Error("evidence:get IPC handler is not registered");
    const state = { calls: 0, hold: true, pending: false, release: null };
    handlers.set(channel, (event, input) => {
      state.calls += 1;
      if (!state.hold) return original(event, input);
      state.pending = true;
      return new Promise((resolve, reject) => {
        state.release = async (succeed) => {
          state.pending = false;
          if (!succeed) { reject(new Error("受控证据读取失败")); return; }
          try { resolve(await original(event, input)); } catch (error) { reject(error); }
        };
      });
    });
    ipcMain._xrayExplanationEvidenceAudit = state;
  });
  const readAudit = () => app.evaluate(({ ipcMain }) => ({ calls: ipcMain._xrayExplanationEvidenceAudit.calls, pending: ipcMain._xrayExplanationEvidenceAudit.pending }));
  const releaseEvidence = () => app.evaluate(({ ipcMain }) => ipcMain._xrayExplanationEvidenceAudit.release(true));

  const sample = () => button.evaluate((element) => {
    const style = getComputedStyle(element);
    const ancestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const computed = getComputedStyle(parent);
      const rect = parent.getBoundingClientRect();
      ancestors.push({ tag: parent.tagName.toLowerCase(), className: typeof parent.className === "string" ? parent.className : "", opacity: computed.opacity, backgroundColor: computed.backgroundColor, backgroundImage: computed.backgroundImage, rect: { width: Math.round(rect.width), height: Math.round(rect.height) } });
    }
    const root = getComputedStyle(document.documentElement);
    const variables = Object.fromEntries(["--text-disabled", "--surface-disabled", "--border", "--raised", "--control-border"].map((name) => [name, root.getPropertyValue(name).trim()]));
    const parseRgb = (color) => { const match = color.match(/rgba?\((\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)(?:[, /]+\s*(\d+(?:\.\d+)?))?\)/); return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null; };
    const luminance = (color) => { const linear = color.slice(0, 3).map((channel) => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }); return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]; };
    const foreground = parseRgb(style.color); const background = parseRgb(style.backgroundColor);
    const compositedContrast = element.disabled && Number(style.opacity) === 1 && foreground?.[3] === 1 && background?.[3] === 1 && ancestors.every((ancestor) => Number(ancestor.opacity) === 1)
      ? { ratio: Math.round(((Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05)) * 100) / 100, foreground: style.color, background: style.backgroundColor, ancestorOpacity: ancestors.map((ancestor) => Number(ancestor.opacity)).reduce((product, opacity) => product * opacity, 1), method: "opaque control colors; verified all ancestor opacity values are 1" }
      : null;
    const rect = element.getBoundingClientRect();
    return { disabled: element.disabled, hovered: element.matches(":hover"), focused: document.activeElement === element, rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, values: { cursor: style.cursor, color: style.color, backgroundColor: style.backgroundColor, borderColor: style.borderColor, opacity: style.opacity, boxShadow: style.boxShadow, transform: style.transform }, compositedContrast, variables, ancestors };
  });
  const capture = async (name) => captureElectronWindow(app, page, join(screenshots, `explanation-evidence-${mode}-${name}.png`));
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio, visualViewportScale: window.visualViewport?.scale ?? null, electronVersion: navigator.userAgent.match(/Electron\/([^ ]+)/)?.[1] ?? null }));
  const states = { captureMode, zoomFactor, viewport, pageState: "功能解释 · 已完成的登录查询 · 第一步源码证据按钮", pointerPositionByState: { availableDefault: { x: 2, y: 2 }, availableHover: point, pendingHover: point, pendingPointerOutside: { x: 2, y: 2 }, pendingHoverAgain: point }, captureMethod: "Electron BrowserWindow.webContents.capturePage()" };

  await page.mouse.move(2, 2); states.availableDefault = await sample(); await capture("available-default");
  await page.mouse.move(point.x, point.y); states.availableHover = await sample(); await capture("available-hover");
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector(".explanation-steps button.button.secondary")?.disabled === true);
  assert.deepEqual(await readAudit(), { calls: 1, pending: true });
  states.pendingHover = await sample(); await capture("pending-hover");
  await page.mouse.move(2, 2); states.pendingPointerOutside = await sample();
  await page.mouse.move(point.x, point.y); states.pendingHoverAgain = await sample();
  await page.mouse.click(point.x, point.y);
  states.callsDuringPendingRepeat = (await readAudit()).calls;
  assert.equal(states.callsDuringPendingRepeat, 1, "a raw mouse click while natively disabled must not start a second evidence read");
  if (mode === "final") {
    assert.equal(states.availableHover.values.cursor, "pointer");
    assert.notEqual(states.availableHover.values.borderColor, states.availableDefault.values.borderColor, "available hover must retain its intended border feedback");
    assert.equal(states.pendingHover.values.cursor, "not-allowed");
    assert.equal(states.pendingHover.disabled, true);
    assert.equal(states.pendingHover.hovered, true);
    assert.equal(states.pendingPointerOutside.hovered, false);
    assert.equal(states.pendingHoverAgain.hovered, true);
    assert.equal(states.pendingHover.values.opacity, "1");
    assert.equal(states.pendingHover.values.color, "rgb(150, 156, 175)");
    assert.equal(states.pendingHover.values.backgroundColor, "rgb(29, 32, 43)");
    assert.equal(states.pendingHover.values.borderColor, "rgb(69, 75, 96)");
    assert.ok(states.pendingHover.compositedContrast?.ratio >= 4.5, `disabled evidence text contrast must meet the project 4.5:1 target: ${JSON.stringify(states.pendingHover.compositedContrast)}`);
    for (const state of [states.pendingPointerOutside, states.pendingHoverAgain]) {
      for (const field of ["cursor", "color", "backgroundColor", "borderColor", "opacity", "boxShadow", "transform"]) assert.equal(state.values[field], states.pendingHover.values[field], `disabled hover must not change ${field}`);
    }
  }
  await releaseEvidence();
  const sourceViewer = page.getByTestId("source-viewer");
  await sourceViewer.waitFor({ timeout: 30_000 });
  const currentProject = await page.evaluate(() => window.xray.getCurrentProject());
  await page.waitForFunction((snapshotId) => { const viewer = document.querySelector('[data-testid="source-viewer"]'); return viewer?.getAttribute("data-snapshot-id") === snapshotId && Boolean(viewer.getAttribute("data-source-file")) && Boolean(viewer.getAttribute("data-evidence-id")); }, currentProject.snapshotId);
  states.sourceLocation = await sourceViewer.evaluate((element) => ({ filePath: element.getAttribute("data-source-file"), snapshotId: element.getAttribute("data-snapshot-id"), evidenceId: element.getAttribute("data-evidence-id") }));
  await page.waitForFunction(() => document.querySelector(".explanation-steps button.button.secondary")?.disabled === false);
  states.callsAfterSuccess = (await readAudit()).calls;
  assert.equal(states.callsAfterSuccess, 1); states.afterSuccess = await sample();
  const restoredBox = await button.boundingBox(); assert.ok(restoredBox);
  const restoredPoint = { x: Math.round(restoredBox.x + restoredBox.width / 2), y: Math.round(restoredBox.y + restoredBox.height / 2) };
  states.pointerPositionByState.successHover = restoredPoint;
  await page.mouse.move(restoredPoint.x, restoredPoint.y); states.successHover = await sample();
  assert.equal(states.successHover.values.cursor, "pointer");
  assert.equal(states.successHover.hovered, true, "available hover should work again after successful navigation");
  await writeFile(join(screenshots, `explanation-evidence-${mode}-styles.json`), JSON.stringify(states, null, 2) + "\n", "utf8");
  return states;
}
async function importFixture(page, fixture) {
  await page.getByRole("textbox", { name: "测试项目路径" }).fill(fixture);
  await page.getByRole("button", { name: "导入测试项目" }).click();
  try { await page.getByText("不可变证据快照").waitFor({ timeout: Number(process.env.XRAY_E2E_IMPORT_TIMEOUT ?? 180_000) }); }
  catch (error) {
    const state = await page.evaluate(async () => {
      let project = null; try { project = await window.xray.getCurrentProject(); } catch { /* diagnostic only */ }
      return { project: project ? { repositoryId: project.repositoryId, snapshotId: project.snapshotId } : null, task: document.querySelector(".task-status b")?.textContent ?? null, errorTitle: document.querySelector(".error-banner b")?.textContent ?? null, errorMessage: document.querySelector(".error-banner span")?.textContent?.replace(/[A-Z]:\\[^\s]+/g, "<path>").slice(0, 180) ?? null, snapshotLabel: document.querySelector(".snapshot span")?.textContent ?? null, welcomeVisible: Boolean(document.querySelector(".welcome-grid")) };
    });
    throw new Error(`fixture import did not activate: ${JSON.stringify(state)}; ${error.message}`);
  }
}
async function openOwnership(page) {
  await page.getByRole("button", { name: /所有权模式/ }).click();
  await page.getByRole("heading", { name: "选择学习范围", exact: true }).waitFor({ timeout: 30_000 });
}
async function capturePolishScene(app, page, screenshots, mode, scene, width, height) {
  if (!mode) return null;
  const captureMode = await resizeContent(app, page, width, height);
  const zoomFactor = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? 1);
  const viewport = await page.evaluate((requested) => {
    const styleFields = [
      "color", "backgroundColor", "backgroundImage", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderTopWidth", "borderRadius", "opacity",
      "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "gap",
      "outlineStyle", "outlineColor", "outlineWidth", "outlineOffset", "display", "position", "boxSizing", "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
      "gridTemplateColumns", "gridTemplateRows", "flexDirection", "alignItems", "justifyContent", "overflowX", "overflowY", "cursor", "pointerEvents", "filter", "mixBlendMode", "isolation",
    ];
    const selectors = {
      shell: ".app-shell", sidebar: ".sidebar", navigation: ".sidebar nav", navigationButton: ".sidebar nav button:not(:disabled)", disabledNavigationButton: ".sidebar nav button:disabled",
      primaryButton: ".button.primary", secondaryButton: ".button.secondary", disabledButton: "button:disabled:not(.graph-toolbar button):not(.sidebar nav button)",
      graphToolbar: ".graph-toolbar", graphToolbarButton: ".graph-toolbar button:not(:disabled)", disabledGraphToolbarButton: ".graph-toolbar button:disabled",
      formControl: "input:not([type=hidden]), select, textarea", panel: ".panel", sourcePanel: ".source-panel", sourceToolbar: ".source-toolbar",
      evidenceWorkspace: ".evidence-workspace", workspaceNavigation: ".workspace-navigation", workspaceSource: ".workspace-source", architectureStage: ".architecture-stage",
      ownershipQuiz: ".ownership-quiz", changeLayout: ".change-layout", comparisonSources: ".comparison-sources", explanationPanel: ".explanation-panel",
    };
    const visible = (element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== "none"; };
    const snapshot = (element, selector) => {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      const ancestors = []; let parent = element.parentElement;
      for (let depth = 0; parent && depth < 5; depth += 1, parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent); const parentRect = parent.getBoundingClientRect();
        ancestors.push({ tag: parent.tagName.toLowerCase(), id: parent.id || undefined, className: typeof parent.className === "string" ? parent.className : undefined, opacity: parentStyle.opacity, backgroundColor: parentStyle.backgroundColor, backgroundImage: parentStyle.backgroundImage, filter: parentStyle.filter, mixBlendMode: parentStyle.mixBlendMode, isolation: parentStyle.isolation, rect: { width: Math.round(parentRect.width), height: Math.round(parentRect.height) } });
      }
      const parseColor = (value) => { const match = value.match(/rgba?\((\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)(?:[, /]+\s*(\d+(?:\.\d+)?))?\)/); return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null; };
      const blend = (front, back, alpha = front[3]) => [0, 1, 2].map(index => Math.round(front[index] * alpha + back[index] * (1 - alpha)));
      const luminance = (rgb) => { const linear = rgb.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }); return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2]; };
      const foreground = parseColor(style.color); const background = parseColor(style.backgroundColor); const elementOpacity = Number(style.opacity);
      const needsBackdrop = elementOpacity < 1 || !background || background[3] < 1 || !foreground || foreground[3] < 1;
      let backdrop = null; let compositionComplete = true;
      for (let node = element.parentElement; node; node = node.parentElement) {
        const parentStyle = getComputedStyle(node); const parentColor = parseColor(parentStyle.backgroundColor);
        if (Number(parentStyle.opacity) < 1 || (needsBackdrop && parentStyle.backgroundImage !== "none")) compositionComplete = false;
        if (parentColor && parentColor[3] >= 1) { backdrop = parentColor; break; }
      }
      let compositedContrast = null;
      const fullyOpaqueControl = foreground && foreground[3] >= 1 && background && background[3] >= 1 && elementOpacity === 1;
      if (element.matches(":disabled") && foreground && background && compositionComplete && (fullyOpaqueControl || backdrop)) {
        const effectiveForeground = fullyOpaqueControl ? foreground.slice(0, 3) : blend(foreground, backdrop, foreground[3] * elementOpacity);
        const effectiveBackground = fullyOpaqueControl ? background.slice(0, 3) : blend(background, backdrop, background[3] * elementOpacity);
        const high = Math.max(luminance(effectiveForeground), luminance(effectiveBackground)); const low = Math.min(luminance(effectiveForeground), luminance(effectiveBackground));
        compositedContrast = { ratio: Math.round(((high + .05) / (low + .05)) * 100) / 100, foreground: `rgb(${effectiveForeground.join(", ")})`, background: `rgb(${effectiveBackground.join(", ")})`, backdrop: `rgb(${backdrop.slice(0, 3).join(", ")})`, ancestorOpacity: ancestors.map(item => Number(item.opacity)).reduce((value, opacity) => value * opacity, 1), method: "Computed solid colors composited over nearest opaque ancestor; excluded if an ancestor adds opacity or an image." };
      }
      return { selector, tag: element.tagName.toLowerCase(), className: typeof element.className === "string" ? element.className : undefined,
        disabled: "disabled" in element ? element.disabled : undefined, ariaDisabled: element.getAttribute("aria-disabled"), focused: document.activeElement === element, focusVisible: element.matches(":focus-visible"),
        values: Object.fromEntries(styleFields.map(field => [field, style[field]])), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, ancestors, compositedContrast };
    };
    const computed = {};
    for (const [name, selector] of Object.entries(selectors)) {
      const element = [...document.querySelectorAll(selector)].find(visible);
      if (element) computed[name] = snapshot(element, selector);
    }
    const containers = {};
    for (const [name, selector] of Object.entries({ pageBody: ".page-body", evidenceWorkspace: ".evidence-workspace", workspaceNavigation: ".workspace-navigation", workspaceSource: ".workspace-source", graphSurface: ".graph-surface", sourceEditor: ".source-editor-frame", panel: ".panel", sourcePanel: ".source-panel", comparisonSources: ".comparison-sources", architectureStage: ".architecture-stage" })) {
      const element = [...document.querySelectorAll(selector)].find(visible);
      if (element) { const rect = element.getBoundingClientRect(); containers[name] = { selector, width: Math.round(rect.width), height: Math.round(rect.height), scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, clientWidth: element.clientWidth, clientHeight: element.clientHeight }; }
    }
    return { requestedWindow: requested, window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight, documentWidth: document.documentElement.clientWidth, documentHeight: document.documentElement.clientHeight, devicePixelRatio: window.devicePixelRatio, visualViewportScale: window.visualViewport?.scale ?? null }, containers, computed };
  }, { width, height });
  viewport.captureMode = captureMode;
  viewport.zoomFactor = zoomFactor;
  const projectPath = await page.locator(".overview-hero p").textContent().catch(() => null);
  if (projectPath !== null) await page.locator(".overview-hero p").evaluate(element => { element.textContent = "C:\\xray-fixture\\workspace"; });
  try {
    // capturePage may read the last composited frame; wait for the sanitized
    // fixture label to paint before capturing any screenshot.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error("missing Electron window while capturing the UI fixture");
      return (await window.webContents.capturePage()).toPNG().toString("base64");
    });
    await writeFile(join(screenshots, `ui-polish-${mode}-${scene}.png`), Buffer.from(image, "base64"));
  } finally { if (projectPath !== null) await page.locator(".overview-hero p").evaluate((element, value) => { element.textContent = value; }, projectPath); }
  const stateStyles = {};
  const sample = async (name, locator) => {
    if (!await locator.count().catch(() => 0)) return;
    const target = locator.first();
    if (!await target.isVisible().catch(() => false)) return;
    stateStyles[name] = await target.evaluate((element) => {
      const style = getComputedStyle(element); const fields = ["color", "backgroundColor", "borderColor", "opacity", "fontFamily", "fontSize", "fontWeight", "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "outlineStyle", "outlineColor", "outlineWidth", "outlineOffset", "boxShadow", "transform", "cursor"];
      return { tag: element.tagName.toLowerCase(), className: typeof element.className === "string" ? element.className : undefined, disabled: "disabled" in element ? element.disabled : undefined, focusVisible: element.matches(":focus-visible"), values: Object.fromEntries(fields.map(field => [field, style[field]])) };
    });
  };
  await sample("primaryButton", page.locator(".button.primary:not(:disabled)"));
  const primary = page.locator(".button.primary:not(:disabled)");
  if (await primary.count()) { await primary.first().hover().catch(() => undefined); await sample("primaryButtonHover", primary); await page.mouse.move(1, 1); }
  const secondary = page.locator(".button.secondary:not(:disabled)");
  await sample("secondaryButton", secondary);
  if (await secondary.count()) { await secondary.first().hover().catch(() => undefined); await sample("secondaryButtonHover", secondary); await page.mouse.move(1, 1); }
  const keyboardTarget = page.locator(".button.primary:not(:disabled), .button.secondary:not(:disabled), .graph-toolbar button:not(:disabled), input:not([type=hidden]), select").first();
  if (await keyboardTarget.count()) {
    await page.keyboard.press("Tab").catch(() => undefined);
    await keyboardTarget.focus().catch(() => undefined);
    await sample("keyboardFocusedControl", keyboardTarget);
    await keyboardTarget.evaluate(element => element.blur()).catch(() => undefined);
  }
  await sample("disabledGraphToolbarButton", page.locator(".graph-toolbar button:disabled"));
  const hoverDisabled = async (name, locator) => {
    if (!await locator.count()) return;
    const target = locator.first(); const box = await target.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sample(`${name}Hover`, target);
    await page.mouse.move(1, 1);
  };
  await hoverDisabled("disabledGraphToolbarButton", page.locator(".graph-toolbar button:disabled"));
  await sample("disabledButton", page.locator("button:disabled:not(.graph-toolbar button):not(.sidebar nav button)"));
  await hoverDisabled("disabledButton", page.locator("button:disabled:not(.graph-toolbar button):not(.sidebar nav button)"));
  await sample("disabledNavigationButton", page.locator(".sidebar nav button:disabled"));
  await hoverDisabled("disabledNavigationButton", page.locator(".sidebar nav button:disabled"));
  if (mode === "final") {
    if (scene === "architecture-source-1440x900") {
      const graphDisabled = viewport.computed.disabledGraphToolbarButton;
      if (!graphDisabled || graphDisabled.disabled !== true || !graphDisabled.compositedContrast) throw new Error("the architecture source scene must expose a compositable native-disabled graph toolbar button");
      if (graphDisabled.compositedContrast.ratio < 4.5) throw new Error(`graph toolbar disabled text contrast ${graphDisabled.compositedContrast.ratio}:1 is below the project 4.5:1 target`);
    }
    for (const [name, state] of Object.entries(viewport.computed)) {
      if (state.disabled !== true) continue;
      if (state.values.opacity !== "1") throw new Error(`${name} has disabled opacity ${state.values.opacity}; disabled controls must preserve text opacity`);
      if (state.compositedContrast && state.compositedContrast.ratio < 4.5) throw new Error(`${name} disabled text contrast ${state.compositedContrast.ratio}:1 is below the project 4.5:1 target (${state.compositedContrast.foreground} on ${state.compositedContrast.background})`);
      const before = stateStyles[name]?.values;
      const hovered = stateStyles[`${name}Hover`]?.values;
      if (before && hovered && ["color", "backgroundColor", "borderColor", "opacity", "boxShadow", "transform"].some((field) => before[field] !== hovered[field])) throw new Error(`${name} changed visual state when hovered while disabled`);
    }
  }
  process.stdout.write(`ui-polish-viewport ${JSON.stringify({ scene, requestedWindow: `${width}x${height}`, ...viewport })}\n`);
  return { scene, requestedWindow: `${width}x${height}`, ...viewport, stateStyles };
}
async function auditWindowBreakpoints(app, page) {
  const windowSamples = [];
  for (const threshold of [1500, 1250, 1180, 1100, 900, 800, 740, 620]) {
    for (const width of [threshold - 1, threshold, threshold + 1]) {
      const expected = width <= 900 ? 64 : width <= 1180 ? 192 : width <= 1250 ? 220 : 224;
      const captureMode = await resizeContent(app, page, width, 800);
      const sample = await page.evaluate((conditions) => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
        sidebarColumn: Number.parseFloat(getComputedStyle(document.querySelector(".app-shell")).gridTemplateColumns),
        media: Object.fromEntries(conditions.map((value) => [value, matchMedia(`(max-width: ${value}px)`).matches])),
      }), [1500, 1250, 1180, 1100, 900, 800, 740, 620]);
      assert.equal(sample.width, width, `window breakpoint audit must use the CSS viewport width ${width}`);
      assert.equal(sample.sidebarColumn, expected, `app shell column at ${width}px CSS viewport`);
      for (const thresholdValue of [1500, 1250, 1180, 1100, 900, 800, 740, 620]) {
        assert.equal(sample.media[thresholdValue], width <= thresholdValue, `window max-width ${thresholdValue}px at ${width}px CSS viewport`);
      }
      windowSamples.push({ ...sample, expectedSidebarColumn: expected, captureMode });
    }
  }
  // Window media queries can otherwise mask the component container query being probed.
  await resizeContent(app, page, 1440, 900);
  const containerSamples = await page.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-2000px;top:0;visibility:hidden;pointer-events:none";
    host.innerHTML = `<div class="architecture-workbench"><div class="architecture-stage"><div class="overview-graph"><div></div><aside class="overview-inspector"></aside></div></div></div><section class="graph-node-browser"><div class="node-browser-search"><label>a</label><label>b</label><label>c</label><button>d</button></div></section>`;
    document.body.append(host);
    const architectureStage = host.querySelector(".architecture-stage");
    const nodeBrowser = host.querySelector(".graph-node-browser");
    const overviewGraph = host.querySelector(".overview-graph");
    const nodeSearch = host.querySelector(".node-browser-search");
    const readArchitecture = (width) => { architectureStage.style.width = `${width}px`; return getComputedStyle(overviewGraph).gridTemplateColumns.trim().split(/\s+/).length; };
    // .graph-node-browser has 16px inline padding on each side and border-box sizing.
    // Probe the container query's content-box width, not the outer border-box width.
    const readNodeSearch = (contentWidth) => { nodeBrowser.style.width = `${contentWidth + 32}px`; return getComputedStyle(nodeSearch).gridTemplateColumns.trim().split(/\s+/).length; };
    const result = {
      architecture: { width740Columns: readArchitecture(740), width741Columns: readArchitecture(741) },
      nodeSearch: { width650Columns: readNodeSearch(650), width651Columns: readNodeSearch(651) },
    };
    host.remove();
    return result;
  });
  assert.equal(containerSamples.architecture.width740Columns, 1, "architecture stage container query at 740 CSS px");
  assert.ok(containerSamples.architecture.width741Columns > 1, `architecture stage container query above 740 CSS px: ${JSON.stringify(containerSamples.architecture)}`);
  assert.equal(containerSamples.nodeSearch.width650Columns, 2, "graph node search container query at 650 CSS px");
  assert.equal(containerSamples.nodeSearch.width651Columns, 4, "graph node search container query above 650 CSS px");
  return { window: windowSamples, containers: containerSamples };
}

async function waitForActivatedSnapshot(page, snapshotId) {
  await page.waitForFunction(async (expected) => {
    const project = await window.xray.getCurrentProject();
    const label = document.querySelector(".snapshot span")?.textContent ?? "";
    return project?.snapshotId === expected && label.includes("current") && !document.querySelector('[data-testid="stale-banner"]');
  }, snapshotId, { timeout: 180_000 });
  await page.locator(".graph-panel .stale-banner").waitFor({ state: "detached", timeout: 30_000 }).catch(() => undefined);
}

async function reindexAndWait(page, expectedSnapshotId) {
  await page.getByRole("button", { name: "更新索引" }).first().click();
  await page.getByTestId("index-progress").waitFor({ state: "attached", timeout: 30_000 });
  await page.getByTestId("index-progress").waitFor({ state: "detached", timeout: 180_000 });
  const actual = await page.evaluate(async () => (await window.xray.getCurrentProject())?.snapshotId ?? null);
  if (expectedSnapshotId) assert.equal(actual, expectedSnapshotId, "index completion must return the requested snapshot identity");
  assert.ok(actual, "index completion must install a project snapshot");
  await waitForActivatedSnapshot(page, actual);
  return actual;
}

async function runFlowSearchAndQuery(page, searchText, expectedSymbol) {
  await page.getByRole("button", { name: /调用 \/ 数据流/ }).click();
  const readiness = await page.locator(".graph-panel").evaluate((panel) => ({ stale: panel.querySelector(".stale-banner")?.textContent ?? null, searchDisabled: (panel.querySelector('.flow-controls button[aria-label="搜索"]') ?? panel.querySelector(".flow-controls button"))?.hasAttribute("disabled") ?? true, queryDisabled: panel.querySelector('.flow-controls button.primary')?.hasAttribute("disabled") ?? true, status: [...panel.querySelectorAll('[role="status"]')].map((item) => item.textContent).filter(Boolean) }));
  if (readiness.stale || readiness.searchDisabled) throw new Error(`call-flow session was not activated: ${JSON.stringify(readiness)}`);
  await page.getByRole("textbox", { name: "搜索符号" }).fill(searchText);
  await page.locator(".flow-controls").getByRole("button", { name: "搜索" }).click();
  const symbolSelect = page.getByRole("combobox", { name: "选择符号" });
  const option = symbolSelect.locator("option", { hasText: expectedSymbol });
  await option.waitFor({ state: "attached", timeout: 30_000 });
  await symbolSelect.selectOption(await option.getAttribute("value"));
  await page.getByRole("button", { name: "查询关系" }).click();
  await page.locator(".result-context").getByText(expectedSymbol).waitFor({ timeout: 30_000 });
}

async function main() {
  const base = await mkdtemp(join(tmpdir(), "xray-ownership-e2e-"));
  const fixture = join(base, "fixture"); const userData = join(base, "user-data");
  const screenshotsRoot = resolve(__dirname, "../../../docs/screenshots");
  const screenshots = resolve(screenshotsRoot, process.env.XRAY_UI_SCREENSHOT_SET ?? ".");
  if (screenshots !== screenshotsRoot && !screenshots.startsWith(`${screenshotsRoot}${sep}`)) throw new Error("Screenshot output must stay under docs/screenshots");
  await cp(resolve(__dirname, "../../../test-fixtures/ownership-training"), fixture, { recursive: true }); await mkdir(userData); await mkdir(screenshots, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
  const comparisonFile = join(fixture, "comparison.ts");
  await writeFile(comparisonFile, "export const comparisonMarker = 'base'\n", "utf8");
  git("init"); git("config", "user.email", "xray@example.test"); git("config", "user.name", "X-Ray E2E"); git("add", "."); git("commit", "-m", "fixture base");
  await writeFile(comparisonFile, "export const comparisonMarker = 'working-one'\n", "utf8");
  const polishCapture = process.argv.find((argument) => ["baseline", "final"].includes(argument)) ?? "";
  const explanationDisabledOnly = process.argv.includes("--explanation-disabled-only");
  const visualSamples = [];
  let breakpointSamples = [];
  let firstSnapshot; let firstSnapshotId; let secondSnapshot; let secondSnapshotId; let conceptLabel; let conceptName; let sourceFile; let sourceOriginal; let selectedEvidence; let trainingCitationCount;
  let launched = await launch(userData);
  try {
    const { app, page } = launched; await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1600, height: 1000 }));
    if (polishCapture && !explanationDisabledOnly) {
      await page.locator(".welcome-grid").waitFor();
      const welcomeScene = await capturePolishScene(app, page, screenshots, polishCapture, "base-controls-welcome-1440x900", 1440, 900);
      if (welcomeScene) visualSamples.push(welcomeScene);
    }
    await importFixture(page, fixture); firstSnapshot = await page.locator(".snapshot code").textContent();
    firstSnapshotId = await page.evaluate(async () => (await window.xray.getCurrentProject())?.snapshotId ?? null);
    assert.ok(firstSnapshotId); assert.equal(firstSnapshot, firstSnapshotId.slice(0, 10));
    if (explanationDisabledOnly) {
      await page.getByRole("button", { name: /功能解释/ }).click();
      await page.getByRole("textbox", { name: "需要解释的功能" }).fill("登录");
      await page.getByRole("button", { name: "开始追踪" }).click();
      await page.waitForFunction(() => ["已完成", "无结果"].includes(document.querySelector('[data-testid="explanation-state"]')?.textContent ?? ""), undefined, { timeout: 30_000 });
      const picker = page.locator(".explanation-steps > li").first().locator("details.step-evidence-picker");
      if (await picker.count()) await picker.locator("summary").click();
      const result = await verifyExplanationDisabledFeedback(app, page, screenshots, polishCapture);
      process.stdout.write(`explanation-evidence-disabled-feedback: passed ${JSON.stringify({ firstSnapshotId, result })}\n`);
      return;
    }
    if (polishCapture && !explanationDisabledOnly) {
      const shellScene = await capturePolishScene(app, page, screenshots, polishCapture, "shell-controls-1440x900", 1440, 900);
      if (shellScene) visualSamples.push(shellScene);
    }
    await page.getByRole("button", { name: /Git 变更/ }).click(); await page.getByRole("button", { name: "生成比较报告" }).click();
    await page.getByRole("button", { name: /架构地图/ }).click(); await page.getByTestId("architecture-overview").waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="comparison-task-tray"]')?.textContent?.includes("报告已生成"), undefined, { timeout: 120_000 });
    await page.getByRole("button", { name: "打开任务" }).click(); const backgroundReport = page.getByTestId("comparison-identities"); await backgroundReport.waitFor({ timeout: 30_000 });
    const initialReportId = await backgroundReport.getAttribute("data-report-id"); assert.ok(initialReportId);
    const initialReport = await page.evaluate(async (reportId) => { const project = await window.xray.getCurrentProject(); if (!project) throw new Error("missing project"); return window.xray.loadChangeReport({ repositoryId: project.repositoryId, reportId }); }, initialReportId);
    assert.equal(initialReport.mode, "working"); assert.match(initialReport.left.label, /^Index/); assert.match(initialReport.right.label, /Working tree/); assert.ok(initialReport.files.some((file) => file.newPath === "comparison.ts"));
    const gitScene = await capturePolishScene(app, page, screenshots, polishCapture, "git-1024x800", 1024, 800); if (gitScene) visualSamples.push(gitScene);
    const leftSourceTab = page.getByRole("tab", { name: /左侧/ }); const rightSourceTab = page.getByRole("tab", { name: /右侧/ });
    if (await leftSourceTab.count()) {
      await leftSourceTab.click(); const leftSide = page.locator('.comparison-source-side[aria-label^="左侧"]');
      await leftSide.locator('[data-testid="source-viewer"][data-source-file="comparison.ts"]').waitFor();
      assert.equal(await leftSide.locator('[data-testid="source-viewer"]').getAttribute("data-snapshot-id"), initialReport.left.snapshot.snapshotId);
      const leftSourceScene = await capturePolishScene(app, page, screenshots, polishCapture, "git-left-source-1024x800", 1024, 800); if (leftSourceScene) visualSamples.push(leftSourceScene);
      await rightSourceTab.click(); const rightSide = page.locator('.comparison-source-side[aria-label^="右侧"]');
      await rightSide.locator('[data-testid="source-viewer"][data-source-file="comparison.ts"]').waitFor();
      assert.equal(await rightSide.locator('[data-testid="source-viewer"]').getAttribute("data-snapshot-id"), initialReport.right.snapshot.snapshotId);
      const rightSourceScene = await capturePolishScene(app, page, screenshots, polishCapture, "git-right-source-1024x800", 1024, 800); if (rightSourceScene) visualSamples.push(rightSourceScene);
      await page.getByRole("textbox", { name: "搜索变化文件" }).fill("no-such-file"); await page.getByText("没有匹配的变化文件。").waitFor(); await page.getByRole("button", { name: "清除筛选" }).click(); await page.getByRole("button", { name: /comparison\.ts/ }).waitFor();
    }
    if (polishCapture) await resizeContent(app, page, 1440, 900);
    await captureElectronWindow(app, page, join(screenshots, "comparison-returned-after-navigation.png"));
    await page.getByRole("button", { name: /调用 \/ 数据流/ }).click(); await page.getByRole("textbox", { name: "搜索符号" }).fill("login"); await page.locator(".flow-controls").getByRole("button", { name: "搜索" }).click();
    const symbolSelect = page.getByRole("combobox", { name: "选择符号" }); const loginOption = symbolSelect.locator("option", { hasText: "pkg/api.py::login" }); await loginOption.waitFor({ state: "attached" }); const loginId = await loginOption.getAttribute("value"); assert.ok(loginId); await symbolSelect.selectOption(loginId); await page.getByRole("button", { name: "查询关系" }).click(); await page.locator(".relation-list button", { hasText: "CALLS" }).first().waitFor();
    const aliasEvidence = await page.evaluate(async (rootNodeId) => { const project = await window.xray.getCurrentProject(); if (!project) throw new Error("missing project"); const graph = await window.xray.queryGraph({ version: "1.0.0", repositoryId: project.repositoryId, snapshotId: project.snapshotId, rootNodeIds: [rootNodeId], view: "call", direction: "outgoing", maxDepth: 3, maxNodes: 120, maxEdges: 240, maxWork: 3600, confidences: ["verified", "inferred", "unknown"] }); const edge = graph.edges.find((item) => item.source === rootNodeId && item.kind === "CALLS" && item.confidence === "verified" && item.reason.includes("import 本地绑定")); if (!edge) throw new Error("missing verified alias call"); const evidence = await window.xray.getEvidence({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, evidenceId: edge.evidenceId }); return { evidenceId: evidence.id, snapshotId: project.snapshotId, filePath: evidence.span.filePath, range: `${evidence.span.startLine}:${evidence.span.startColumn}-${evidence.span.endLine}:${evidence.span.endColumn}` }; }, loginId);
    await page.locator(".relation-list button", { hasText: "Python import 本地绑定" }).click(); const aliasViewer = page.getByTestId("source-viewer"); await page.waitForFunction((expected) => { const viewer = document.querySelector('[data-testid="source-viewer"]'); return viewer?.getAttribute("data-evidence-id") === expected.evidenceId && viewer.getAttribute("data-monaco-selection") === expected.range; }, aliasEvidence); assert.equal(await aliasViewer.getAttribute("data-source-file"), aliasEvidence.filePath); assert.equal(await aliasViewer.getAttribute("data-snapshot-id"), aliasEvidence.snapshotId);

    await page.getByRole("button", { name: /功能解释/ }).click(); await page.getByRole("textbox", { name: "需要解释的功能" }).fill("登录"); await page.getByRole("button", { name: "开始追踪" }).click();
    await page.waitForFunction(() => ["已完成", "无结果"].includes(document.querySelector('[data-testid="explanation-state"]')?.textContent ?? ""), undefined, { timeout: 30_000 });
    const submittedExplanation = page.locator(".submitted-question span"); await submittedExplanation.waitFor(); assert.equal(await submittedExplanation.textContent(), "登录");
    const firstExplanationStep = page.locator(".explanation-steps > li").first(); const stepEvidencePicker = firstExplanationStep.locator("details.step-evidence-picker");
    if (await stepEvidencePicker.count()) await stepEvidencePicker.locator("summary").click();
    const explanationEvidence = firstExplanationStep.getByRole("button", { name: /核验第/ });
    if (polishCapture && await explanationEvidence.count()) await verifyExplanationDisabledFeedback(app, page, screenshots, polishCapture);
    else if (await explanationEvidence.count()) { await explanationEvidence.first().click(); await page.getByTestId("source-viewer").waitFor(); }
    const explanationFile = await page.getByTestId("source-viewer").getAttribute("data-source-file"); assert.ok(explanationFile);
    const returnToExplanation = page.getByRole("button", { name: /返回第 .* 步说明/ }); if (await returnToExplanation.count()) await returnToExplanation.first().click();
    const explanationScene = await capturePolishScene(app, page, screenshots, polishCapture, "feature-explanation-evidence-1440x900", 1440, 900); if (explanationScene) visualSamples.push(explanationScene);
    await captureElectronWindow(app, page, join(screenshots, "feature-explanation-session.png"));
    await page.getByRole("button", { name: /调用 \/ 数据流/ }).click(); await page.getByRole("button", { name: /功能解释/ }).click();
    assert.equal(await submittedExplanation.textContent(), "登录"); await page.waitForFunction((expected) => document.querySelector('[data-testid="source-viewer"]')?.getAttribute("data-source-file") === expected, explanationFile);
    await openOwnership(page);
    await page.getByRole("button", { name: "生成结构化题目" }).click(); await page.locator(".quiz-progress b", { hasText: "调用方向" }).waitFor();
    conceptLabel = await page.locator(".difficulty").textContent(); conceptName = conceptLabel?.split(" · ").slice(1).join(" · ");
    const caller = page.getByRole("combobox", { name: "选择调用者" }); const callee = page.getByRole("combobox", { name: "选择被调用者" });
    const values = await caller.locator("option").evaluateAll((options) => options.slice(1).map((option) => ({ value: option.value, text: option.textContent ?? "" })));
    assert.equal(values.length, 2, "call direction must expose exactly the two structural choices");
    const nodes = await page.evaluate(async (ids) => { const project = await window.xray.getCurrentProject(); if (!project) throw new Error("missing project"); const result = await window.xray.search({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, query: "", kinds: ["function", "method"], limit: 100 }); return result.items.filter((item) => ids.includes(item.id)); }, values.map((item) => item.value));
    sourceFile = nodes.find((node) => node.id === values[0].value)?.filePath; assert.ok(sourceFile, "caller source file missing"); sourceOriginal = await readFile(join(fixture, sourceFile));
    await page.getByRole("button", { name: sourceFile, exact: true }).click(); await page.locator(".monaco-editor").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "引用选中范围" }).click(); await page.getByText(/源码引用 [1-9]/).waitFor(); trainingCitationCount = await page.locator(".citation-row").count();
    const trainingNote = "调用关系的方向需要从源码证据核对。";
    await caller.selectOption(values[0].value); await page.locator(".ownership-notes summary").click(); await page.getByRole("textbox", { name: "自由文本学习记录" }).fill(trainingNote); await page.locator(".ownership-notes summary").click();
    const noteLayout = await page.evaluate(() => { const notes=document.querySelector(".ownership-notes"), citations=document.querySelector(".citations"), submit=document.querySelector(".ownership-quiz > .button.primary"); return { notesOpen: notes?.hasAttribute("open"), notesAfterCitations: Boolean(notes && citations && (citations.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING)), notesAfterSubmit: Boolean(notes && submit && (submit.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING)) }; });
    assert.deepEqual(noteLayout, { notesOpen: false, notesAfterCitations: true, notesAfterSubmit: true }, "notes should stay folded after required answer and citation actions");
    await page.locator(".citation-row").first().getByRole("button", { name: "重新定位" }).click();
    const trainingViewer = page.getByTestId("source-viewer");
    await page.waitForFunction((expected) => { const viewer = document.querySelector('[data-testid="source-viewer"]'); return viewer?.getAttribute("data-source-file") === expected && Boolean(viewer.getAttribute("data-monaco-selection")); }, sourceFile);
    const trainingSelection = await trainingViewer.getAttribute("data-monaco-selection");
    assert.ok(trainingSelection, "training editor must expose its selected source range");
    const trainingScene = await capturePolishScene(app, page, screenshots, polishCapture, "training-partial-1440x900", 1440, 900); if (trainingScene) visualSamples.push(trainingScene);

    await page.getByRole("button", { name: /架构地图/ }).click();
    await page.getByRole("button", { name: "列表", exact: true }).click();
    const architectureTarget = await page.evaluate(async (avoidFile) => {
      const project = await window.xray.getCurrentProject(); if (!project) throw new Error("missing project");
      const overview = await window.xray.getModuleOverview({ version: "1.0.0", repositoryId: project.repositoryId, snapshotId: project.snapshotId, query: "", limit: 80, relationLimit: 160, referenceLimit: 40 });
      for (const module of overview.modules) {
        const expansion = await window.xray.expandModule({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, moduleId: module.id, limit: 100 });
        const file = expansion.nodes.find((node) => node.kind === "file" && node.filePath === "pkg/service.py" && node.filePath !== avoidFile);
        if (file?.filePath) return { modulePath: module.qualifiedName, filePath: file.filePath };
      }
      return null;
    }, sourceFile);
    assert.ok(architectureTarget, "fixture must include a second architecture file");
    const moduleCard = page.locator(".module-card").filter({ hasText: architectureTarget.modulePath });
    await moduleCard.getByRole("button", { name: /展开文件/ }).click();
    const fileCard = page.locator(".file-card-list article").filter({ hasText: architectureTarget.filePath });
    await fileCard.getByRole("button", { name: /符号与源码/ }).click();
    const architectureSymbol = page.locator('.symbol-list button[title="pkg/service.py::normalize"]'); await architectureSymbol.waitFor({ timeout: 30_000 }); await architectureSymbol.click();
    try { await page.waitForFunction(() => document.querySelector(".local-graph .graph-canvas")?.dataset.nodesInBounds === "true", undefined, { timeout: 10_000 }); }
    catch (error) { const state = await page.locator(".local-graph .graph-canvas").evaluate((canvas) => ({ ...canvas.dataset, rect: canvas.getBoundingClientRect().toJSON(), layers: [...canvas.querySelectorAll("canvas")].map((layer) => ({ width: layer.width, height: layer.height })) })); throw new Error(`${error.message}; graph pane state: ${JSON.stringify(state)}`); }
    const localGraphLayout = await page.locator(".local-graph .graph-canvas").evaluate((canvas) => ({ inBounds: canvas.dataset.nodesInBounds, renderedBounds: canvas.dataset.renderedBounds, size: { width: canvas.clientWidth, height: canvas.clientHeight }, nodeLayers: [...canvas.querySelectorAll("canvas")].map((layer) => ({ width: layer.width, height: layer.height })) }));
    assert.equal(localGraphLayout.inBounds, "true", `selected symbol relationships should render inside the available graph pane: ${JSON.stringify(localGraphLayout)}`);
    await page.getByRole("button", { name: "打开文件源码" }).click();
    await page.waitForFunction((expected) => {
      const viewer = document.querySelector('[data-testid="source-viewer"]');
      return viewer?.getAttribute("data-source-file") === expected && Boolean(viewer.getAttribute("data-monaco-selection"));
    }, architectureTarget.filePath);
    const graphWidthBesideSource = await page.locator(".local-graph .graph-canvas").evaluate((canvas) => canvas.getBoundingClientRect().width);
    assert.ok(graphWidthBesideSource >= 360, `selected-symbol graph should use the actual pane width beside source instead of shrinking into an unreadable column: ${graphWidthBesideSource}px`);
    const architectureSelection = await page.getByTestId("source-viewer").getAttribute("data-monaco-selection");
    assert.ok(architectureSelection, "opening a selected symbol should wait for its precise Monaco range");
    await page.getByRole("button", { name: /调用 \/ 数据流/ }).click(); await page.waitForFunction((expected) => document.querySelector('[data-testid="source-viewer"]')?.getAttribute("data-source-file") === expected, aliasEvidence.filePath);
    await page.getByRole("button", { name: /架构地图/ }).click();
    await page.waitForFunction((expected) => {
      const viewer = document.querySelector('[data-testid="source-viewer"]');
      return viewer?.getAttribute("data-source-file") === expected.filePath && viewer.getAttribute("data-monaco-selection") === expected.selection;
    }, { filePath: architectureTarget.filePath, selection: architectureSelection });
    assert.equal(await page.getByTestId("source-viewer").getAttribute("data-monaco-selection"), architectureSelection);
    assert.match(await page.locator(".local-graph .section-caption span").textContent(), new RegExp(architectureTarget.filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const divider = page.getByRole("separator", { name: "调整源码面板宽度" });
    if (await divider.count()) {
      const before = Number(await divider.getAttribute("aria-valuenow")); const dividerBox = await divider.boundingBox(); assert.ok(dividerBox);
      await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2); await page.mouse.down(); await page.mouse.move(dividerBox.x + dividerBox.width / 2 - 60, dividerBox.y + dividerBox.height / 2); await page.mouse.up();
      assert.notEqual(Number(await divider.getAttribute("aria-valuenow")), before, "dragging the divider should adjust the source width preference");
      const sourceViewer = page.getByTestId("source-viewer"); await sourceViewer.getByRole("button", { name: "最大化" }).click(); assert.ok((await page.getByTestId("evidence-workspace").getAttribute("class"))?.includes("source-maximized"));
      await sourceViewer.getByRole("button", { name: "还原" }).click(); assert.ok(!(await page.getByTestId("evidence-workspace").getAttribute("class"))?.includes("source-maximized"));
    }
    const architectureScene = await capturePolishScene(app, page, screenshots, polishCapture, "architecture-source-1440x900", 1440, 900); if (architectureScene) visualSamples.push(architectureScene);
    if (polishCapture) {
      await resizeContent(app, page, 1024, 800);
      await page.waitForFunction(() => document.querySelector(".evidence-workspace")?.classList.contains("compact-layout"));
      assert.equal(await page.getByTestId("source-viewer").getAttribute("data-source-file"), architectureTarget.filePath);
      const paneSwitch = page.locator(".compact-pane-switch");
      if (await paneSwitch.isVisible()) { await paneSwitch.getByRole("button", { name: "架构地图" }).click(); assert.equal(await page.locator(".symbol-list button[aria-pressed=true]").getAttribute("title"), "pkg/service.py::normalize"); await paneSwitch.getByRole("button", { name: "源码" }).click(); }
      await resizeContent(app, page, 1440, 900);
      await page.waitForFunction((expected) => {
        const viewer = document.querySelector('[data-testid="source-viewer"]');
        return viewer?.getAttribute("data-source-file") === expected.filePath && viewer.getAttribute("data-monaco-selection") === expected.selection;
      }, { filePath: architectureTarget.filePath, selection: architectureSelection });
      assert.equal(await page.getByTestId("source-viewer").getAttribute("data-source-file"), architectureTarget.filePath); assert.equal(await page.getByTestId("source-viewer").getAttribute("data-monaco-selection"), architectureSelection);
      const wideScene = await capturePolishScene(app, page, screenshots, polishCapture, "architecture-source-1920x1080", 1920, 1080); if (wideScene) visualSamples.push(wideScene);
      await resizeContent(app, page, 1440, 900);
    }
    await captureElectronWindow(app, page, join(screenshots, "architecture-context-restored.png"));
    await page.getByRole("button", { name: /所有权模式/ }).click();
    await page.locator(".quiz-progress b", { hasText: "调用方向" }).waitFor();
    await page.waitForFunction((expected) => {
      const viewer = document.querySelector('[data-testid="source-viewer"]');
      return viewer?.getAttribute("data-source-file") === expected.filePath && viewer.getAttribute("data-monaco-selection") === expected.selection;
    }, { filePath: sourceFile, selection: trainingSelection });
    assert.equal(await caller.inputValue(), values[0].value, "partial structural answer must survive page changes");
    await page.locator(".ownership-notes summary").click(); assert.equal(await page.getByRole("textbox", { name: "自由文本学习记录" }).inputValue(), trainingNote);
    assert.equal(await page.locator(".citation-row").count(), trainingCitationCount, "source restoration must not create an extra citation");
    assert.equal(await page.getByTestId("source-viewer").getAttribute("data-monaco-selection"), trainingSelection);

    await caller.selectOption(values[1].value); await callee.selectOption(values[0].value); await page.getByRole("button", { name: "提交并核验结构" }).click();
    await page.getByText("调用方向错误：调用者和被调用者不能互换。").waitFor(); assert.equal(await page.getByText("未评估", { exact: true }).count(), 1); await page.locator(".structured-grade").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "关闭源码" }).click();
    await page.locator(".structured-grade").scrollIntoViewIfNeeded();
    await captureElectronWindow(app, page, join(screenshots, "ownership-structured-feedback.png"));
    await page.getByRole("button", { name: "修正后重试" }).click(); await caller.selectOption(values[0].value); await callee.selectOption(values[1].value); await page.getByRole("button", { name: "提交并核验结构" }).click(); await page.locator(".structured-grade").waitFor();
    assert.deepEqual(await page.locator(".structured-grade strong").allTextContents(), ["通过", "通过", "未评估"]);
    const evidenceButton = page.locator(".revealed button").first(); selectedEvidence = await evidenceButton.textContent(); assert.ok(selectedEvidence); await evidenceButton.click();
    const expected = await page.evaluate(async (evidenceId) => { const project = await window.xray.getCurrentProject(); if (!project) throw new Error("missing project"); const evidence = await window.xray.getEvidence({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, evidenceId }); return { snapshotId: project.snapshotId, filePath: evidence.span.filePath, range: `${evidence.span.startLine}:${evidence.span.startColumn}-${evidence.span.endLine}:${evidence.span.endColumn}` }; }, selectedEvidence);
    const viewer = page.getByTestId("source-viewer"); await page.waitForFunction((range) => document.querySelector('[data-testid="source-viewer"]')?.getAttribute("data-monaco-selection") === range, expected.range);
    assert.equal(await viewer.getAttribute("data-snapshot-id"), expected.snapshotId); assert.equal(await viewer.getAttribute("data-source-file"), expected.filePath); assert.equal(await viewer.getAttribute("data-monaco-selection"), expected.range);
    await writeFile(comparisonFile, "export const comparisonMarker = 'working-two'\n", "utf8");
    await appendFile(join(fixture, sourceFile), "\n# source changed after mastery\n", "utf8");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByTestId("stale-banner").waitFor({ timeout: 30_000 }); await page.getByTestId("training-stale").waitFor({ timeout: 30_000 });
    assert.match(await page.locator(".structured-grade").innerText(), /通过/);
    await page.getByRole("button", { name: /Git 变更/ }).click(); await page.getByTestId("change-report-stale").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "安全重算" }).click();
    await page.waitForFunction((prior) => document.querySelector('[data-testid="comparison-identities"]')?.getAttribute("data-report-id") !== prior, initialReportId, { timeout: 120_000 });
    await page.getByTestId("change-report-stale").waitFor({ state: "detached", timeout: 30_000 });
    await page.locator(".health.current").waitFor({ timeout: 30_000 });
    assert.equal(await page.locator(".report-state-error").count(), 0, "recomputed report state must remain readable after the compare worker completes");
    await captureElectronWindow(app, page, join(screenshots, "comparison-recomputed-after-stale.png"));
    // Restore every indexed byte to the original contents, then prove the backend
    // publishes the exact original snapshot identity rather than a mock/new ID.
    await writeFile(comparisonFile, "export const comparisonMarker = 'working-one'\n", "utf8");
    await writeFile(join(fixture, sourceFile), sourceOriginal);
    const sameSnapshotAfterRestore = await reindexAndWait(page, firstSnapshotId);
    assert.equal(sameSnapshotAfterRestore, firstSnapshotId, "restoring exact source bytes must reactivate the original snapshot A");
    await runFlowSearchAndQuery(page, "login", "pkg/api.py::login");
    await page.locator(".relation-list button", { hasText: "CALLS" }).first().waitFor({ timeout: 30_000 });

    // Repeat the exact A -> B -> A cycle. B's page state uses a different query
    // so returning to A proves the old search/result cache remains snapshot-bound.
    await writeFile(comparisonFile, "export const comparisonMarker = 'working-two'\n", "utf8");
    await appendFile(join(fixture, sourceFile), "\n# source changed for snapshot B\n", "utf8");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByTestId("stale-banner").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "更新索引" }).first().click();
    await page.getByTestId("index-progress").waitFor({ state: "attached", timeout: 30_000 });
    await page.getByTestId("index-progress").waitFor({ state: "detached", timeout: 180_000 });
    secondSnapshotId = await page.evaluate(async () => (await window.xray.getCurrentProject())?.snapshotId ?? null);
    assert.ok(secondSnapshotId); assert.notEqual(secondSnapshotId, firstSnapshotId);
    secondSnapshot = secondSnapshotId.slice(0, 10);
    await waitForActivatedSnapshot(page, secondSnapshotId);
    await runFlowSearchAndQuery(page, "normalize", "pkg/service.py::normalize");
    await openOwnership(page);
    const revalidationOnB = page.locator(".mastery-panel div", { hasText: conceptName });
    await revalidationOnB.waitFor({ timeout: 30_000 }); assert.match(await revalidationOnB.innerText(), /需要重新验证/);
    await page.getByRole("button", { name: /调用 \/ 数据流/ }).click();

    await writeFile(comparisonFile, "export const comparisonMarker = 'working-one'\n", "utf8");
    await writeFile(join(fixture, sourceFile), sourceOriginal);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByTestId("stale-banner").waitFor({ timeout: 30_000 });
    const restoredSnapshotA = await reindexAndWait(page, firstSnapshotId);
    assert.equal(restoredSnapshotA, firstSnapshotId, "A -> B -> A must return to the original content identity");
    await page.getByRole("button", { name: /调用 \/ 数据流/ }).click();
    assert.equal(await page.getByRole("textbox", { name: "搜索符号" }).inputValue(), "login", "A's query draft must be restored instead of B's");
    await page.locator(".result-context").getByText("pkg/api.py::login").waitFor();
    await runFlowSearchAndQuery(page, "login", "pkg/api.py::login");
    await page.locator(".relation-list button", { hasText: "CALLS" }).first().waitFor({ timeout: 30_000 });

    await openOwnership(page);
    await page.getByRole("heading", { name: "选择学习范围" }).waitFor();
    const oldDraftButtons = page.getByRole("button", { name: new RegExp(`查看快照 ${firstSnapshot}`) });
    let archivedText = "";
    for (let index = 0; index < await oldDraftButtons.count(); index += 1) {
      await oldDraftButtons.nth(index).click();
      archivedText = await page.getByTestId("archived-training-preview").innerText();
      if (archivedText.includes("已提交评分")) break;
    }
    const archived = page.getByTestId("archived-training-preview");
    await archived.waitFor(); assert.match(archivedText, /调用方向/); assert.match(archivedText, /调用关系的方向需要从源码证据核对/);
    assert.match(archivedText, /已提交评分/);
    assert.ok(await page.getByRole("button", { name: new RegExp(`丢弃旧草稿 ${firstSnapshot}`) }).count());
    await app.close();

    launched = await launch(userData); await openOwnership(launched.page); assert.ok(conceptName); const mastered = launched.page.locator(".mastery-panel div", { hasText: conceptName }); await mastered.waitFor({ timeout: 30_000 }); assert.match(await mastered.innerText(), /本快照已通过/);
    await captureElectronWindow(launched.app, launched.page, join(screenshots, "ownership-needs-revalidation.png"));
    assert.ok(conceptLabel?.includes("调用方向"));
    if (polishCapture) breakpointSamples = await auditWindowBreakpoints(launched.app, launched.page);
    if (polishCapture) await writeFile(join(screenshots, `ui-polish-${polishCapture}-computed-styles.json`), JSON.stringify({ capture: polishCapture, fixture: "ownership-training deterministic temporary copy", breakpointSamples, visualSamples }, null, 2) + "\n", "utf8");
    process.stdout.write(`cross-page-workspace-e2e: passed ${JSON.stringify({ firstSnapshot, firstSnapshotId, sameSnapshotAfterRestore, secondSnapshotId, restoredSnapshotA, secondSnapshot, sourceFile, evidenceId: selectedEvidence, comparisonReportId: initialReportId, explanationFile, architectureFile: architectureTarget.filePath, breakpointSamples, visualSamples, screenshotFiles: ["comparison-returned-after-navigation.png", "feature-explanation-session.png", "architecture-context-restored.png", "comparison-recomputed-after-stale.png", "ownership-structured-feedback.png", "ownership-needs-revalidation.png"] })}\n`);
  } finally {
    await launched.app.close().catch(() => undefined); await rm(base, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
