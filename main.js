var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => StylusMenuPlugin,
  getEA: () => getEA
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/settings.ts
var DEFAULT_SETTINGS = {
  trigger: "penbutton",
  longPressMs: 450,
  doubleTapMs: 300,
  moveThresholdPx: 8,
  edgeMarginPx: 16,
  cleanupStrayDot: true,
  objectTapMenu: true,
  debugOverlay: false,
  defaultRectW: 160,
  defaultRectH: 100,
  defaultEmbedW: 400,
  defaultEmbedH: 300
};

// src/PointerWatcher.ts
var PointerWatcher = class {
  constructor(el, getSettings, onTrigger, onArm, onPointer, onDebug, onDoubleTap, onHold, onContactTap) {
    this.el = el;
    this.getSettings = getSettings;
    this.onTrigger = onTrigger;
    this.onArm = onArm;
    this.onPointer = onPointer;
    this.onDebug = onDebug;
    this.onDoubleTap = onDoubleTap;
    this.onHold = onHold;
    this.onContactTap = onContactTap;
    this.downX = 0;
    this.downY = 0;
    this.moved = false;
    this.armed = false;
    /** Перо в контакте с полотном (после pointerdown с buttons&1). */
    this.penDown = false;
    /** Парение: боковая кнопка зажата сейчас. */
    this.penBtnActive = false;
    this.penBtnStartX = 0;
    this.penBtnStartY = 0;
    /** Кнопку при парении сдвинули за порог — это не тап и не удержание. */
    this.penBtnMoved = false;
    /** Удержанием уже открыто действие — отпускание ничего не делает. */
    this.penBtnHeldOpen = false;
    /** Таймер удержания кнопки (→ onHold). */
    this.holdTimer = null;
    /** Таймер ожидания второго тапа (одиночный тап → onTrigger). */
    this.tapTimer = null;
    /** Время предыдущего тапа кнопкой (для распознавания двойного). */
    this.lastBtnTap = 0;
    this.down = (e) => {
      const s = this.getSettings();
      if (s.debugOverlay) {
        this.onDebug(`down  type=${e.pointerType}  buttons=${e.buttons}  button=${e.button}`);
      }
      if (!this.penLike(e)) return;
      if (e.buttons & 1) {
        this.penDown = true;
        this.penBtnActive = false;
        this.clearHoldTimer();
        this.clearTapTimer();
      }
      this.onPointer(e.clientX, e.clientY);
      if (!this.onDrawSurface(e)) return;
      if (e.buttons & 1) {
        this.downX = e.clientX;
        this.downY = e.clientY;
        this.moved = false;
        this.armed = true;
        this.onArm();
      }
    };
    this.move = (e) => {
      if (this.penLike(e)) this.onPointer(e.clientX, e.clientY);
      const s = this.getSettings();
      if (e.pointerType === "pen" && !this.penDown) {
        const pressed = !!(e.buttons & 1);
        if (pressed && !this.penBtnActive) {
          this.penBtnActive = true;
          this.penBtnMoved = false;
          this.penBtnHeldOpen = false;
          this.penBtnStartX = e.clientX;
          this.penBtnStartY = e.clientY;
          this.startHoldTimer();
        } else if (pressed && this.penBtnActive && !this.penBtnHeldOpen) {
          const dist = Math.hypot(e.clientX - this.penBtnStartX, e.clientY - this.penBtnStartY);
          if (dist > s.moveThresholdPx) {
            this.penBtnMoved = true;
            this.clearHoldTimer();
          }
        } else if (this.penBtnActive && !pressed) {
          this.penBtnActive = false;
          this.clearHoldTimer();
          if (!this.penBtnHeldOpen && !this.penBtnMoved) this.handleBtnTap(e);
        }
      }
      if (this.armed) {
        const dist = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
        if (dist > s.moveThresholdPx) this.moved = true;
      }
    };
    this.up = () => {
      this.penDown = false;
      if (this.armed) {
        const wasTap = !this.moved;
        this.armed = false;
        if (wasTap) this.onContactTap({ clientX: this.downX, clientY: this.downY });
      }
    };
    this.cancel = () => {
      this.clearHoldTimer();
      this.penDown = false;
      this.penBtnActive = false;
      this.armed = false;
    };
    this.ctx = (e) => {
      if (e.pointerType === "pen") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
  }
  attach() {
    this.el.addEventListener("pointerdown", this.down, true);
    this.el.addEventListener("pointermove", this.move, true);
    this.el.addEventListener("pointerup", this.up, true);
    this.el.addEventListener("pointercancel", this.cancel, true);
    this.el.addEventListener("contextmenu", this.ctx, true);
  }
  detach() {
    this.el.removeEventListener("pointerdown", this.down, true);
    this.el.removeEventListener("pointermove", this.move, true);
    this.el.removeEventListener("pointerup", this.up, true);
    this.el.removeEventListener("pointercancel", this.cancel, true);
    this.el.removeEventListener("contextmenu", this.ctx, true);
    this.clearHoldTimer();
    this.clearTapTimer();
  }
  /** Перо или мышь (мышь — чтобы тестировать на ПК). Палец игнорируем. */
  penLike(e) {
    return e.pointerType === "pen" || e.pointerType === "mouse";
  }
  /**
   * Реагируем только на касания собственно полотна Excalidraw (<canvas>), а не
   * элементов интерфейса (панель инструментов, кнопки, меню).
   */
  onDrawSurface(e) {
    const t = e.target;
    return !!t && t.tagName === "CANVAS";
  }
  /**
   * Отпустили кнопку при парении без движения и без удержания: это тап.
   * Второй такой тап в окне doubleTapMs → onDoubleTap, иначе по тайм-ауту → onTrigger.
   */
  handleBtnTap(e) {
    const s = this.getSettings();
    e.preventDefault();
    e.stopPropagation();
    if (e.timeStamp - this.lastBtnTap < s.doubleTapMs) {
      this.lastBtnTap = 0;
      this.clearTapTimer();
      this.onDoubleTap();
      return;
    }
    this.lastBtnTap = e.timeStamp;
    this.clearTapTimer();
    const x = this.penBtnStartX;
    const y = this.penBtnStartY;
    this.tapTimer = window.setTimeout(() => {
      this.tapTimer = null;
      this.onTrigger({ clientX: x, clientY: y });
    }, s.doubleTapMs);
  }
  /** Кнопку держат на месте дольше longPressMs → onHold (вставить). */
  startHoldTimer() {
    this.clearHoldTimer();
    const x = this.penBtnStartX;
    const y = this.penBtnStartY;
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = null;
      this.penBtnHeldOpen = true;
      this.clearTapTimer();
      this.onHold({ clientX: x, clientY: y });
    }, this.getSettings().longPressMs);
  }
  clearHoldTimer() {
    if (this.holdTimer != null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }
  clearTapTimer() {
    if (this.tapTimer != null) {
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
    }
  }
};

// src/InsertMenu.ts
var InsertMenu = class {
  constructor(anchor, root) {
    this.anchor = anchor;
    this.root = root;
    this.overlay = null;
    this.menu = null;
    this.onClose = null;
  }
  open(onClose) {
    this.onClose = onClose != null ? onClose : null;
    this.overlay = document.body.createDiv({ cls: "esm-overlay" });
    this.overlay.addEventListener(
      "pointerdown",
      (e) => {
        if (e.target === this.overlay) {
          e.preventDefault();
          this.close();
        }
      },
      true
    );
    this.menu = this.overlay.createDiv({ cls: "esm-menu" });
    this.render(this.root, false);
    this.position();
  }
  close() {
    var _a;
    (_a = this.overlay) == null ? void 0 : _a.remove();
    this.overlay = null;
    this.menu = null;
    const cb = this.onClose;
    this.onClose = null;
    cb == null ? void 0 : cb();
  }
  render(items, isSub) {
    const menu = this.menu;
    if (!menu) return;
    menu.empty();
    if (isSub) {
      const back = menu.createDiv({ cls: "esm-item esm-back" });
      back.setText("\u2039 \u041D\u0430\u0437\u0430\u0434");
      back.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.render(this.root, false);
        this.position();
      });
    }
    for (const it of items) {
      const row = menu.createDiv({ cls: "esm-item" });
      row.setText(it.label);
      row.addEventListener("pointerup", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (it.children) {
          this.render(it.children, true);
          this.position();
          return;
        }
        this.close();
        const cb = it.onClick;
        if (cb) {
          window.setTimeout(() => {
            void Promise.resolve(cb()).catch(
              (err) => console.error("[excalidraw-stylus-menu] insert failed", err)
            );
          }, 0);
        }
      });
    }
  }
  position() {
    const m = this.menu;
    if (!m) return;
    const rect = m.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = this.anchor.x + 8;
    let y = this.anchor.y + 8;
    if (x + rect.width > vw - 8) x = vw - rect.width - 8;
    if (y + rect.height > vh - 8) y = vh - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
  }
};

// src/inserters.ts
var import_obsidian = require("obsidian");
var IMAGE_EXT = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "avif",
  "ico"
]);
function isImage(f) {
  return IMAGE_EXT.has((f.extension || "").toLowerCase());
}
async function commit(ea) {
  await ea.addElementsToView(false, true, true);
}
async function commitSelect(ea, id) {
  var _a, _b, _c, _d;
  await ea.addElementsToView(false, true, true);
  if (!id) return;
  try {
    const api = (_a = ea.getExcalidrawAPI) == null ? void 0 : _a.call(ea);
    if (!api) return;
    (_d = api.updateScene) == null ? void 0 : _d.call(api, {
      appState: { ...(_c = (_b = api.getAppState) == null ? void 0 : _b.call(api)) != null ? _c : {}, selectedElementIds: { [id]: true } }
    });
  } catch (e) {
  }
}
async function insertText(ea, app, x, y) {
  const text = await promptText(app, "\u0422\u0435\u043A\u0441\u0442");
  if (text == null) return;
  ea.reset();
  ea.setView("active");
  const id = ea.addText(x, y, text, { autoResize: true });
  await commitSelect(ea, id);
}
async function insertSticker(ea, app, x, y) {
  const text = await promptText(app, "\u0422\u0435\u043A\u0441\u0442 \u0441\u0442\u0438\u043A\u0435\u0440\u0430");
  if (text == null) return;
  ea.reset();
  ea.setView("active");
  const id = ea.addText(x, y, text.trim() === "" ? " " : text, {
    box: "box",
    textAlign: "center",
    boxPadding: 12
  });
  await commitSelect(ea, id);
}
async function insertShape(ea, kind, x, y, s) {
  ea.reset();
  ea.setView("active");
  const w = s.defaultRectW;
  const h = s.defaultRectH;
  let id;
  switch (kind) {
    case "rect":
      id = ea.addRect(x, y, w, h);
      break;
    case "ellipse":
      id = ea.addEllipse(x, y, w, h);
      break;
    case "arrow":
      id = ea.addArrow([[x, y], [x + w, y]], { endArrowHead: "arrow" });
      break;
    case "line":
      id = ea.addLine([[x, y], [x + w, y]]);
      break;
  }
  await commitSelect(ea, id);
}
async function insertEmbedOrImage(ea, app, x, y, s) {
  const file = await pickFile(app);
  if (!file) return;
  ea.reset();
  ea.setView("active");
  if (isImage(file)) {
    await ea.addImage(x, y, file);
    await commit(ea);
    return;
  }
  const id = ea.addEmbeddable(x, y, s.defaultEmbedW, s.defaultEmbedH, `[[${file.path}]]`, void 0);
  await commitSelect(ea, id);
}
function promptText(app, title) {
  return new Promise((resolve) => new TextPromptModal(app, title, resolve).open());
}
var TextPromptModal = class extends import_obsidian.Modal {
  constructor(app, heading, cb) {
    super(app);
    this.heading = heading;
    this.cb = cb;
    this.resolved = false;
  }
  onOpen() {
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl("textarea", { cls: "esm-input" });
    input.rows = 3;
    window.setTimeout(() => input.focus(), 0);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.done(input.value);
      }
    });
    const row = this.contentEl.createDiv({ cls: "esm-modal-buttons" });
    const ok = row.createEl("button", { text: "\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044C" });
    ok.addClass("mod-cta");
    ok.addEventListener("click", () => this.done(input.value));
    const cancel = row.createEl("button", { text: "\u041E\u0442\u043C\u0435\u043D\u0430" });
    cancel.addEventListener("click", () => this.done(null));
  }
  done(v) {
    if (this.resolved) return;
    this.resolved = true;
    this.cb(v);
    this.close();
  }
  onClose() {
    if (!this.resolved) {
      this.resolved = true;
      this.cb(null);
    }
    this.contentEl.empty();
  }
};
function pickFile(app) {
  return new Promise((resolve) => new FilePickModal(app, resolve).open());
}
var FilePickModal = class extends import_obsidian.FuzzySuggestModal {
  constructor(app, cb) {
    super(app);
    this.cb = cb;
    this.resolved = false;
    this.setPlaceholder("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u0438\u043B\u0438 .md \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0434\u043B\u044F \u0432\u0441\u0442\u0430\u0432\u043A\u0438");
  }
  getItems() {
    return this.app.vault.getFiles().filter((f) => isImage(f) || f.extension === "md");
  }
  getItemText(f) {
    return f.path;
  }
  onChooseItem(f) {
    this.resolved = true;
    this.cb(f);
  }
  onClose() {
    if (!this.resolved) {
      this.resolved = true;
      this.cb(null);
    }
  }
};

// src/connector.ts
var import_obsidian2 = require("obsidian");
function nearEdge(px, py, el, margin) {
  const inOuter = px >= el.x - margin && px <= el.x + el.width + margin && py >= el.y - margin && py <= el.y + el.height + margin;
  const inInner = px >= el.x + margin && px <= el.x + el.width - margin && py >= el.y + margin && py <= el.y + el.height - margin;
  return inOuter && !inInner;
}
function contains(px, py, el, margin) {
  return px >= el.x - margin && px <= el.x + el.width + margin && py >= el.y - margin && py <= el.y + el.height + margin;
}
var ConnectorController = class {
  constructor() {
    this.sourceId = null;
  }
  /** @returns true, если событие обработано коннектором (меню открывать не нужно). */
  handleTrigger(input) {
    const { sceneX, sceneY, elements, settings } = input;
    const margin = settings.edgeMarginPx;
    if (this.sourceId == null) {
      const edgeEl = elements.find((el) => nearEdge(sceneX, sceneY, el, margin));
      if (!edgeEl) return false;
      this.sourceId = edgeEl.id;
      new import_obsidian2.Notice("\u041A\u043E\u043D\u043D\u0435\u043A\u0442\u043E\u0440: \u043A\u043E\u0441\u043D\u0438\u0442\u0435\u0441\u044C \u0432\u0442\u043E\u0440\u043E\u0433\u043E \u0431\u043B\u043E\u043A\u0430 (\u043F\u0443\u0441\u0442\u043E\u0435 \u043C\u0435\u0441\u0442\u043E \u2014 \u043E\u0442\u043C\u0435\u043D\u0430)");
      return true;
    }
    const src = elements.find((el) => el.id === this.sourceId);
    const tgt = elements.find(
      (el) => el.id !== this.sourceId && contains(sceneX, sceneY, el, margin)
    );
    this.sourceId = null;
    if (!src || !tgt) {
      new import_obsidian2.Notice("\u041A\u043E\u043D\u043D\u0435\u043A\u0442\u043E\u0440 \u043E\u0442\u043C\u0435\u043D\u0451\u043D");
      return true;
    }
    void this.drawArrow(input.ea, src, tgt);
    return true;
  }
  reset() {
    this.sourceId = null;
  }
  async drawArrow(ea, a, b) {
    try {
      ea.reset();
      ea.setView("active");
      const ca = [a.x + a.width / 2, a.y + a.height / 2];
      const cb = [b.x + b.width / 2, b.y + b.height / 2];
      try {
        ea.addArrow([ca, cb], { endArrowHead: "arrow", startObjectId: a.id, endObjectId: b.id });
      } catch (e) {
        ea.addArrow([ca, cb], { endArrowHead: "arrow" });
      }
      await ea.addElementsToView(false, true, true);
    } catch (e) {
      console.error("[excalidraw-stylus-menu] arrow failed", e);
      new import_obsidian2.Notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043D\u0430\u0440\u0438\u0441\u043E\u0432\u0430\u0442\u044C \u0441\u0442\u0440\u0435\u043B\u043A\u0443");
    }
  }
};

// src/main.ts
var EXCALIDRAW_VIEW = "excalidraw";
var STRAY_TYPES = ["freedraw", "draw", "line", "arrow"];
var STRAY_MAX_PX = 12;
function getEA(app) {
  var _a, _b, _c, _d, _e;
  const w = window;
  return (_e = (_d = w.ExcalidrawAutomate) != null ? _d : (_c = (_b = (_a = app.plugins) == null ? void 0 : _a.plugins) == null ? void 0 : _b["obsidian-excalidraw-plugin"]) == null ? void 0 : _c.ea) != null ? _e : null;
}
function getApi(app) {
  const ea = getEA(app);
  if (!ea) return null;
  try {
    return ea.getExcalidrawAPI();
  } catch (e) {
    return null;
  }
}
function genId() {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-";
  let s = "";
  for (let i = 0; i < 21; i++) s += chars[Math.random() * chars.length | 0];
  return s;
}
function hasBBox(el) {
  return el && typeof el.x === "number" && typeof el.y === "number" && typeof el.width === "number" && typeof el.height === "number";
}
var StylusMenuPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.watchers = /* @__PURE__ */ new Map();
    this.debugEl = null;
    this.connector = new ConnectorController();
    this.snapshot = null;
    this.snapApi = null;
    this.lastPointer = null;
    this.diagHandlers = null;
    this.diagLines = [];
    this.lastMoveSig = "";
    /** Внутренний буфер копирования: глубокие копии скопированных элементов сцены. */
    this.clipboard = null;
    /** Ожидание второго тапа для стрелки: исходный объект (тап по цели создаёт стрелку). */
    this.pendingArrowFrom = null;
    /** Единственное открытое меню (синглтон — чтобы меню не стекировались). */
    this.activeMenu = null;
    /** До этого времени (ms) новое меню не открываем — гасим дребезг после закрытия. */
    this.menuSuppressUntil = 0;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new StylusMenuSettingTab(this.app, this));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncWatchers()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncWatchers()));
    this.app.workspace.onLayoutReady(() => this.syncWatchers());
    this.addCommand({
      id: "open-insert-menu",
      name: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043C\u0435\u043D\u044E \u0432\u0441\u0442\u0430\u0432\u043A\u0438 (\u0441\u0442\u0438\u043B\u0443\u0441)",
      callback: () => this.openMenuAtLastPointer()
    });
    this.addCommand({
      id: "copy-selection",
      name: "\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0432\u044B\u0434\u0435\u043B\u0435\u043D\u043D\u043E\u0435 (\u0441\u0442\u0438\u043B\u0443\u0441)",
      callback: () => this.copySelection()
    });
    this.addCommand({
      id: "paste-clipboard",
      name: "\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044C (\u0441\u0442\u0438\u043B\u0443\u0441)",
      callback: () => {
        var _a;
        return this.pasteClipboard(
          (_a = this.lastPointer) != null ? _a : {
            clientX: window.innerWidth / 2,
            clientY: window.innerHeight / 2
          }
        );
      }
    });
    this.addCommand({
      id: "toggle-debug-overlay",
      name: "\u041F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0438\u0442\u044C debug-\u043E\u0432\u0435\u0440\u043B\u0435\u0439 \u0441\u0442\u0438\u043B\u0443\u0441\u0430",
      callback: async () => {
        this.settings.debugOverlay = !this.settings.debugOverlay;
        await this.saveSettings();
        this.refreshDebugOverlay();
      }
    });
    this.refreshDebugOverlay();
  }
  onunload() {
    for (const w of Array.from(this.watchers.values())) w.detach();
    this.watchers.clear();
    this.removeDiagnostics();
    this.removeDebugOverlay();
  }
  /** Навешивает PointerWatcher на все открытые вью Excalidraw, снимает с закрытых. */
  syncWatchers() {
    for (const [el, w] of Array.from(this.watchers.entries())) {
      if (!document.body.contains(el)) {
        w.detach();
        this.watchers.delete(el);
        this.connector.reset();
      }
    }
    const leaves = this.app.workspace.getLeavesOfType(EXCALIDRAW_VIEW);
    for (const leaf of leaves) {
      const view = leaf.view;
      const el = view == null ? void 0 : view.contentEl;
      if (!el || this.watchers.has(el)) continue;
      const watcher = new PointerWatcher(
        el,
        () => this.settings,
        (ctx) => this.onTrigger(ctx),
        () => this.snapshotScene(),
        (x, y) => {
          this.lastPointer = { clientX: x, clientY: y };
        },
        (info) => this.logLine(info),
        () => this.copySelection(),
        (ctx) => this.pasteClipboard(ctx),
        (ctx) => this.onObjectTap(ctx)
      );
      watcher.attach();
      this.watchers.set(el, watcher);
    }
  }
  /* ---------- координаты ---------- */
  toScene(api, clientX, clientY) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const st = (_b = (_a = api.getAppState) == null ? void 0 : _a.call(api)) != null ? _b : {};
    const zoom = (_e = (_d = (_c = st == null ? void 0 : st.zoom) == null ? void 0 : _c.value) != null ? _d : st == null ? void 0 : st.zoom) != null ? _e : 1;
    return {
      x: (clientX - ((_f = st.offsetLeft) != null ? _f : 0)) / zoom - ((_g = st.scrollX) != null ? _g : 0),
      y: (clientY - ((_h = st.offsetTop) != null ? _h : 0)) / zoom - ((_i = st.scrollY) != null ? _i : 0)
    };
  }
  /* ---------- очистка артефактной точки ---------- */
  snapshotScene() {
    var _a, _b;
    if (!this.settings.cleanupStrayDot) return;
    const api = getApi(this.app);
    if (!api) return;
    try {
      const els = (_b = (_a = api.getSceneElements) == null ? void 0 : _a.call(api)) != null ? _b : [];
      this.snapshot = new Set(els.filter((e) => !e.isDeleted).map((e) => e.id));
      this.snapApi = api;
    } catch (e) {
      this.clearSnapshot();
    }
  }
  clearSnapshot() {
    this.snapshot = null;
    this.snapApi = null;
  }
  scheduleCleanup() {
    const snap = this.snapshot;
    const api = this.snapApi;
    this.clearSnapshot();
    if (!snap || !api) return;
    window.setTimeout(() => {
      var _a, _b;
      try {
        const cur = (_b = (_a = api.getSceneElements) == null ? void 0 : _a.call(api)) != null ? _b : [];
        const strays = cur.filter(
          (e) => !e.isDeleted && !snap.has(e.id) && STRAY_TYPES.includes(e.type) && Math.max(e.width || 0, e.height || 0) < STRAY_MAX_PX
        );
        if (strays.length) {
          const ids = new Set(strays.map((e) => e.id));
          api.updateScene({
            elements: cur.filter((e) => !ids.has(e.id)),
            commitToHistory: false
          });
        }
      } catch (err) {
        console.error("[excalidraw-stylus-menu] cleanup failed", err);
      }
    }, 80);
  }
  /* ---------- основной обработчик жеста ---------- */
  onTrigger(ctx) {
    var _a, _b;
    const ea = getEA(this.app);
    if (!ea) {
      this.clearSnapshot();
      new import_obsidian3.Notice("Excalidraw \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u2014 \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u043F\u043B\u0430\u0433\u0438\u043D Excalidraw.");
      return;
    }
    try {
      ea.setView("active");
    } catch (e) {
    }
    const api = getApi(this.app);
    if (!api) {
      this.clearSnapshot();
      new import_obsidian3.Notice("\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0445\u043E\u043B\u0441\u0442 Excalidraw \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.");
      return;
    }
    const { x: sceneX, y: sceneY } = this.toScene(api, ctx.clientX, ctx.clientY);
    const elements = ((_b = (_a = api.getSceneElements) == null ? void 0 : _a.call(api)) != null ? _b : []).filter(
      (el) => el && !el.isDeleted && hasBBox(el)
    );
    const handled = this.connector.handleTrigger({
      ea,
      api,
      sceneX,
      sceneY,
      elements,
      settings: this.settings
    });
    if (handled) {
      this.scheduleCleanup();
      return;
    }
    this.openInsertMenu(ctx, ea, sceneX, sceneY);
    this.scheduleCleanup();
  }
  /** Открыть меню по команде/хоткею: в последней позиции пера или в центре экрана. */
  openMenuAtLastPointer() {
    var _a;
    const ea = getEA(this.app);
    if (!ea) {
      new import_obsidian3.Notice("Excalidraw \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u2014 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0440\u0438\u0441\u0443\u043D\u043E\u043A Excalidraw.");
      return;
    }
    try {
      ea.setView("active");
    } catch (e) {
    }
    const api = getApi(this.app);
    if (!api) {
      new import_obsidian3.Notice("\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0445\u043E\u043B\u0441\u0442 Excalidraw.");
      return;
    }
    const p = (_a = this.lastPointer) != null ? _a : {
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2
    };
    const { x, y } = this.toScene(api, p.clientX, p.clientY);
    this.openInsertMenu(p, ea, x, y);
  }
  /**
   * Открыть меню как СИНГЛТОН: если меню уже открыто — этот вызов только закрывает его
   * (тап-дисмисс) и НЕ открывает новое; сразу после закрытия действует короткое окно
   * подавления, чтобы отложенный жест (напр. таймер тапа кнопки) не открыл меню заново.
   */
  presentMenu(ctx, items) {
    if (this.activeMenu) {
      this.activeMenu.close();
      return;
    }
    if (Date.now() < this.menuSuppressUntil) return;
    const menu = new InsertMenu({ x: ctx.clientX, y: ctx.clientY }, items);
    this.activeMenu = menu;
    menu.open(() => {
      if (this.activeMenu === menu) this.activeMenu = null;
      this.menuSuppressUntil = Date.now() + 350;
    });
  }
  openInsertMenu(ctx, ea, x, y) {
    const items = [
      { label: "\u270E  \u0422\u0435\u043A\u0441\u0442", onClick: () => insertText(ea, this.app, x, y) },
      { label: "\u25A2  \u0421\u0442\u0438\u043A\u0435\u0440 (\u0442\u0435\u043A\u0441\u0442 \u0432 \u0440\u0430\u043C\u043A\u0435)", onClick: () => insertSticker(ea, this.app, x, y) },
      {
        label: "\u25C6  \u0424\u0438\u0433\u0443\u0440\u044B \u203A",
        children: [
          { label: "\u25AD  \u041F\u0440\u044F\u043C\u043E\u0443\u0433\u043E\u043B\u044C\u043D\u0438\u043A", onClick: () => insertShape(ea, "rect", x, y, this.settings) },
          { label: "\u25EF  \u042D\u043B\u043B\u0438\u043F\u0441", onClick: () => insertShape(ea, "ellipse", x, y, this.settings) },
          { label: "\u2192  \u0421\u0442\u0440\u0435\u043B\u043A\u0430", onClick: () => insertShape(ea, "arrow", x, y, this.settings) },
          { label: "\uFF0F  \u041B\u0438\u043D\u0438\u044F", onClick: () => insertShape(ea, "line", x, y, this.settings) }
        ]
      },
      {
        label: "\u{1F5BC}  \u0417\u0430\u043C\u0435\u0442\u043A\u0430 / \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435",
        onClick: () => insertEmbedOrImage(ea, this.app, x, y, this.settings)
      }
    ];
    this.presentMenu(ctx, items);
  }
  /* ---------- меню действий над объектом (тап пером по объекту) ---------- */
  /**
   * Контактный тап пером: по фигуре/выделению — меню действий (если включено),
   * по пустому месту — основное меню вставки.
   */
  onObjectTap(ctx) {
    var _a, _b, _c, _d;
    const ea = getEA(this.app);
    const api = getApi(this.app);
    if (!ea || !(api == null ? void 0 : api.getSceneElements)) {
      this.clearSnapshot();
      this.pendingArrowFrom = null;
      return;
    }
    const { x: sx, y: sy } = this.toScene(api, ctx.clientX, ctx.clientY);
    const all = ((_a = api.getSceneElements()) != null ? _a : []).filter(
      (el) => el && !el.isDeleted && hasBBox(el)
    );
    const LINEAR = ["arrow", "line", "freedraw"];
    let hit = null;
    for (const el of all) {
      if (LINEAR.includes(el.type)) continue;
      if (contains(sx, sy, el, 0)) hit = el;
    }
    if (this.pendingArrowFrom) {
      const from = this.pendingArrowFrom;
      this.pendingArrowFrom = null;
      this.scheduleCleanup();
      if (hit && hit.id !== from.id) this.connectArrow(from, hit);
      else new import_obsidian3.Notice("\u0421\u0442\u0440\u0435\u043B\u043A\u0430 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430.");
      return;
    }
    if (this.settings.objectTapMenu) {
      const selIds = (_d = ((_c = (_b = api.getAppState) == null ? void 0 : _b.call(api)) != null ? _c : {}).selectedElementIds) != null ? _d : {};
      const selected = all.filter((el) => selIds[el.id]);
      if (selected.length > 1 && selected.some((el) => !LINEAR.includes(el.type) && contains(sx, sy, el, 0))) {
        this.scheduleCleanup();
        this.openSelectionMenu(ctx, selected);
        return;
      }
      if (hit) {
        this.scheduleCleanup();
        this.openObjectMenu(ctx, ea, hit);
        return;
      }
    }
    this.scheduleCleanup();
    this.openInsertMenu(ctx, ea, sx, sy);
  }
  openObjectMenu(ctx, ea, el) {
    this.presentMenu(ctx, this.shapeMenuItems(ea, el));
  }
  /** Меню для фигуры (прямоугольник/эллипс/текст/картинка/заметка). */
  shapeMenuItems(ea, el) {
    var _a, _b, _c, _d;
    const cx = ((_a = el.x) != null ? _a : 0) + ((_b = el.width) != null ? _b : 0) / 2;
    const cy = ((_c = el.y) != null ? _c : 0) + ((_d = el.height) != null ? _d : 0) / 2;
    return [
      {
        label: "\u2192  \u0421\u0442\u0440\u0435\u043B\u043A\u0430 \u043A \u043E\u0431\u044A\u0435\u043A\u0442\u0443\u2026",
        onClick: () => {
          this.pendingArrowFrom = el;
          new import_obsidian3.Notice("\u0422\u0430\u043F\u043D\u0438\u0442\u0435 \u043E\u0431\u044A\u0435\u043A\u0442, \u043A \u043A\u043E\u0442\u043E\u0440\u043E\u043C\u0443 \u0432\u0435\u0441\u0442\u0438 \u0441\u0442\u0440\u0435\u043B\u043A\u0443.");
        }
      },
      { label: "\u25A2  \u0421\u0442\u0438\u043A\u0435\u0440 \u043D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442", onClick: () => insertSticker(ea, this.app, cx, cy) },
      { label: "\u29C9  \u0414\u0443\u0431\u043B\u0438\u0440\u043E\u0432\u0430\u0442\u044C", onClick: () => this.duplicateElements([el]) },
      { label: "\u{1F5D1}  \u0423\u0434\u0430\u043B\u0438\u0442\u044C", onClick: () => this.deleteElements([el]) }
    ];
  }
  /** Меню для выделения: тап по выделенным объектам → дублировать/удалить весь набор. */
  openSelectionMenu(ctx, els) {
    const items = [
      { label: `\u29C9  \u0414\u0443\u0431\u043B\u0438\u0440\u043E\u0432\u0430\u0442\u044C (${els.length})`, onClick: () => this.duplicateElements(els) },
      { label: `\u{1F5D1}  \u0423\u0434\u0430\u043B\u0438\u0442\u044C (${els.length})`, onClick: () => this.deleteElements(els) }
    ];
    this.presentMenu(ctx, items);
  }
  /** Стрелка между двумя существующими объектами (с привязкой обоих концов). */
  async connectArrow(from, to) {
    var _a;
    const linear = ["arrow", "line", "freedraw"];
    if (linear.includes(from.type) || linear.includes(to.type)) {
      new import_obsidian3.Notice("\u0421\u043E\u0435\u0434\u0438\u043D\u044F\u0442\u044C \u0441\u0442\u0440\u0435\u043B\u043A\u043E\u0439 \u043C\u043E\u0436\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0444\u0438\u0433\u0443\u0440\u044B.");
      return;
    }
    const ea = getEA(this.app);
    if (!ea) return;
    try {
      ea.reset();
      ea.setView("active");
      await ((_a = ea.copyViewElementsToEAforEditing) == null ? void 0 : _a.call(ea, [from, to]));
      ea.connectObjects(from.id, null, to.id, null, { endArrowHead: "arrow" });
      await ea.addElementsToView(false, true, true);
      new import_obsidian3.Notice("\u0421\u0442\u0440\u0435\u043B\u043A\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0430.");
    } catch (err) {
      console.error("[excalidraw-stylus-menu] connectArrow failed", err);
      new import_obsidian3.Notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0441\u0442\u0440\u0435\u043B\u043A\u0443.");
    }
  }
  /**
   * Клонировать набор элементов с новыми id, перенастроив связи (группы, привязки,
   * контейнеры) ВНУТРИ набора, и сместить на (dx, dy). Используется вставкой и дублированием.
   */
  cloneElements(list, dx, dy) {
    const idMap = /* @__PURE__ */ new Map();
    const groupMap = /* @__PURE__ */ new Map();
    for (const el of list) idMap.set(el.id, genId());
    const remap = (id) => {
      var _a;
      return (_a = idMap.get(id)) != null ? _a : id;
    };
    return list.map((src) => {
      var _a, _b, _c, _d;
      const el = JSON.parse(JSON.stringify(src));
      el.id = idMap.get(src.id);
      el.x = ((_a = src.x) != null ? _a : 0) + dx;
      el.y = ((_b = src.y) != null ? _b : 0) + dy;
      el.seed = Math.random() * 2 ** 31 | 0;
      el.versionNonce = Math.random() * 2 ** 31 | 0;
      el.version = ((_c = src.version) != null ? _c : 1) + 1;
      el.updated = Date.now();
      if (Array.isArray(el.groupIds)) {
        el.groupIds = el.groupIds.map((g) => {
          if (!groupMap.has(g)) groupMap.set(g, genId());
          return groupMap.get(g);
        });
      }
      if (el.containerId) el.containerId = idMap.has(el.containerId) ? remap(el.containerId) : null;
      if (Array.isArray(el.boundElements)) {
        el.boundElements = el.boundElements.filter((b) => b && idMap.has(b.id)).map((b) => ({ ...b, id: remap(b.id) }));
      }
      for (const k of ["startBinding", "endBinding"]) {
        if ((_d = el[k]) == null ? void 0 : _d.elementId) {
          if (idMap.has(el[k].elementId)) el[k] = { ...el[k], elementId: remap(el[k].elementId) };
          else el[k] = null;
        }
      }
      return el;
    });
  }
  duplicateElements(els) {
    var _a, _b, _c, _d;
    const api = getApi(this.app);
    if (!(api == null ? void 0 : api.updateScene) || !els.length) return;
    const clones = this.cloneElements(els, 20, 20);
    const cur = ((_b = (_a = api.getSceneElements) == null ? void 0 : _a.call(api)) != null ? _b : []).filter((e) => e && !e.isDeleted);
    const sel = {};
    for (const c of clones) sel[c.id] = true;
    api.updateScene({
      elements: [...cur, ...clones],
      appState: { ...(_d = (_c = api.getAppState) == null ? void 0 : _c.call(api)) != null ? _d : {}, selectedElementIds: sel },
      commitToHistory: true
    });
    new import_obsidian3.Notice(`\u0414\u0443\u0431\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u043E: ${clones.length}`);
  }
  deleteElements(els) {
    var _a, _b, _c, _d, _e;
    const api = getApi(this.app);
    if (!(api == null ? void 0 : api.updateScene) || !els.length) return;
    const ids = /* @__PURE__ */ new Set();
    for (const el of els) {
      ids.add(el.id);
      for (const b of (_a = el.boundElements) != null ? _a : []) ids.add(b.id);
    }
    const cur = ((_c = (_b = api.getSceneElements) == null ? void 0 : _b.call(api)) != null ? _c : []).filter((e) => e && !e.isDeleted);
    api.updateScene({
      elements: cur.filter(
        (e) => !ids.has(e.id) && !(e.containerId && ids.has(e.containerId))
      ),
      appState: { ...(_e = (_d = api.getAppState) == null ? void 0 : _d.call(api)) != null ? _e : {}, selectedElementIds: {} },
      commitToHistory: true
    });
    new import_obsidian3.Notice(`\u0423\u0434\u0430\u043B\u0435\u043D\u043E: ${els.length}`);
  }
  /* ---------- копировать / вставить (жесты кнопкой при парении) ---------- */
  /** Двойной тап кнопкой: скопировать выделенные элементы во внутренний буфер плагина. */
  copySelection() {
    var _a, _b, _c, _d;
    const api = getApi(this.app);
    if (!(api == null ? void 0 : api.getSceneElements)) {
      new import_obsidian3.Notice("\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0445\u043E\u043B\u0441\u0442 Excalidraw \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.");
      return;
    }
    const st = (_b = (_a = api.getAppState) == null ? void 0 : _a.call(api)) != null ? _b : {};
    const sel = (_c = st.selectedElementIds) != null ? _c : {};
    const selected = ((_d = api.getSceneElements()) != null ? _d : []).filter(
      (el) => el && !el.isDeleted && sel[el.id]
    );
    if (!selected.length) {
      new import_obsidian3.Notice("\u041D\u0435\u0447\u0435\u0433\u043E \u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u2014 \u0432\u044B\u0434\u0435\u043B\u0438\u0442\u0435 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B.");
      return;
    }
    this.clipboard = selected.map((el) => JSON.parse(JSON.stringify(el)));
    new import_obsidian3.Notice(`\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E: ${this.clipboard.length}`);
  }
  /** Удержание/команда: вставить буфер у кончика пера с новыми id и выделить вставленное. */
  pasteClipboard(ctx) {
    var _a, _b, _c, _d, _e, _f;
    if (!((_a = this.clipboard) == null ? void 0 : _a.length)) {
      new import_obsidian3.Notice("\u0411\u0443\u0444\u0435\u0440 \u043F\u0443\u0441\u0442 \u2014 \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u0443\u0439\u0442\u0435 (\u0434\u0432\u043E\u0439\u043D\u043E\u0439 \u0442\u0430\u043F \u043A\u043D\u043E\u043F\u043A\u043E\u0439).");
      return;
    }
    const ea = getEA(this.app);
    try {
      (_b = ea == null ? void 0 : ea.setView) == null ? void 0 : _b.call(ea, "active");
    } catch (e) {
    }
    const api = getApi(this.app);
    if (!(api == null ? void 0 : api.updateScene)) {
      new import_obsidian3.Notice("\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0445\u043E\u043B\u0441\u0442 Excalidraw \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.");
      return;
    }
    const minX = Math.min(...this.clipboard.map((e) => {
      var _a2;
      return (_a2 = e.x) != null ? _a2 : 0;
    }));
    const minY = Math.min(...this.clipboard.map((e) => {
      var _a2;
      return (_a2 = e.y) != null ? _a2 : 0;
    }));
    const { x: penX, y: penY } = this.toScene(api, ctx.clientX, ctx.clientY);
    const clones = this.cloneElements(this.clipboard, penX - minX, penY - minY);
    const current = ((_d = (_c = api.getSceneElements) == null ? void 0 : _c.call(api)) != null ? _d : []).filter((e) => e && !e.isDeleted);
    const selectedElementIds = {};
    for (const c of clones) selectedElementIds[c.id] = true;
    try {
      api.updateScene({
        elements: [...current, ...clones],
        appState: { ...(_f = (_e = api.getAppState) == null ? void 0 : _e.call(api)) != null ? _f : {}, selectedElementIds },
        commitToHistory: true
      });
      new import_obsidian3.Notice(`\u0412\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E: ${clones.length}`);
    } catch (err) {
      console.error("[excalidraw-stylus-menu] paste failed", err);
      new import_obsidian3.Notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044C.");
    }
  }
  /* ---------- диагностика стилуса ---------- */
  refreshDebugOverlay() {
    if (this.settings.debugOverlay) {
      this.ensureDebugOverlay();
      this.installDiagnostics();
    } else {
      this.removeDiagnostics();
      this.removeDebugOverlay();
    }
  }
  ensureDebugOverlay() {
    if (this.debugEl) return;
    this.debugEl = document.body.createDiv({ cls: "esm-debug" });
    this.debugEl.setText("S Pen debug: \u0436\u043C\u0438\u0442\u0435 \u043A\u043D\u043E\u043F\u043A\u0443 \u043F\u0435\u0440\u0430 \u0432 \u0440\u0430\u0437\u043D\u044B\u0445 \u0440\u0435\u0436\u0438\u043C\u0430\u0445\u2026");
  }
  removeDebugOverlay() {
    var _a;
    (_a = this.debugEl) == null ? void 0 : _a.remove();
    this.debugEl = null;
    this.diagLines = [];
  }
  logLine(s) {
    this.diagLines.push(s);
    if (this.diagLines.length > 8) this.diagLines.shift();
    if (this.debugEl) this.debugEl.setText(this.diagLines.join("\n"));
  }
  /**
   * Глобальный сниффер: ловит события, в которых на Samsung может «всплыть»
   * кнопка S Pen — наведение с зажатой кнопкой, contextmenu, auxclick, клавиши.
   * pointerdown логируется самим PointerWatcher (на полотне).
   */
  installDiagnostics() {
    if (this.diagHandlers) return;
    this.diagHandlers = [];
    this.lastMoveSig = "";
    const move = (e) => {
      if (e.pointerType !== "pen" && e.pointerType !== "mouse") return;
      const sig = `${e.pointerType}:${e.buttons}`;
      if (sig === this.lastMoveSig) return;
      this.lastMoveSig = sig;
      this.logLine(`hover ${e.pointerType} b=${e.buttons}`);
    };
    const up = (e) => this.logLine(`up    ${e.pointerType} b=${e.buttons} btn=${e.button}`);
    const ctx = (e) => {
      var _a, _b;
      return this.logLine(`contextmenu type=${(_a = e.pointerType) != null ? _a : "?"} btn=${(_b = e.button) != null ? _b : "?"}`);
    };
    const aux = (e) => {
      var _a;
      return this.logLine(`auxclick btn=${e.button} type=${(_a = e.pointerType) != null ? _a : "?"}`);
    };
    const key = (e) => this.logLine(`keydown "${e.key}" code=${e.code}`);
    const reg = (name, fn) => {
      window.addEventListener(name, fn, true);
      this.diagHandlers.push([name, fn]);
    };
    reg("pointermove", move);
    reg("pointerup", up);
    reg("contextmenu", ctx);
    reg("auxclick", aux);
    reg("keydown", key);
  }
  removeDiagnostics() {
    if (!this.diagHandlers) return;
    for (const [name, fn] of this.diagHandlers) window.removeEventListener(name, fn, true);
    this.diagHandlers = null;
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.trigger = "penbutton";
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var StylusMenuSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  numberField(name, desc, get, set, placeholder = "") {
    new import_obsidian3.Setting(this.containerEl).setName(name).setDesc(desc).addText(
      (t) => t.setPlaceholder(placeholder).setValue(String(get())).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n)) {
          set(n);
          await this.plugin.saveSettings();
        }
      })
    );
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "\u041E\u0441\u043D\u043E\u0432\u043D\u043E\u0435 \u043C\u0435\u043D\u044E \u0432\u0441\u0442\u0430\u0432\u043A\u0438 \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0434\u0432\u0443\u043C\u044F \u0441\u043F\u043E\u0441\u043E\u0431\u0430\u043C\u0438: \u0442\u0430\u043F \u043F\u0435\u0440\u043E\u043C \u043F\u043E \u043F\u0443\u0441\u0442\u043E\u043C\u0443 \u043C\u0435\u0441\u0442\u0443 \u0445\u043E\u043B\u0441\u0442\u0430 \u0438 \u043E\u0434\u0438\u043D\u043E\u0447\u043D\u044B\u0439 \u0442\u0430\u043F \u0431\u043E\u043A\u043E\u0432\u043E\u0439 \u043A\u043D\u043E\u043F\u043A\u043E\u0439 S Pen \u043F\u0440\u0438 \u043F\u0430\u0440\u0435\u043D\u0438\u0438. \u0414\u0432\u043E\u0439\u043D\u043E\u0439 \u0442\u0430\u043F \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u2014 \u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C, \u0443\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435 \u2014 \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u044C."
    });
    new import_obsidian3.Setting(containerEl).setName("\u041C\u0435\u043D\u044E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439 \u043F\u043E \u0442\u0430\u043F\u0443 \u043D\u0430 \u043E\u0431\u044A\u0435\u043A\u0442").setDesc("\u0422\u0430\u043F \u043F\u0435\u0440\u043E\u043C \u043F\u043E \u0444\u0438\u0433\u0443\u0440\u0435/\u043E\u0431\u044A\u0435\u043A\u0442\u0443 \u2192 \u043C\u0435\u043D\u044E: \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u0435\u043A\u0441\u0442, \u0441\u0442\u0440\u0435\u043B\u043A\u0430 \u043E\u0442 \u043E\u0431\u044A\u0435\u043A\u0442\u0430, \u0441\u0442\u0438\u043A\u0435\u0440, \u0434\u0443\u0431\u043B\u0438\u0440\u043E\u0432\u0430\u0442\u044C, \u0443\u0434\u0430\u043B\u0438\u0442\u044C.").addToggle(
      (t) => t.setValue(this.plugin.settings.objectTapMenu).onChange(async (v) => {
        this.plugin.settings.objectTapMenu = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("\u0423\u0431\u0438\u0440\u0430\u0442\u044C \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u0443\u044E \u0442\u043E\u0447\u043A\u0443").setDesc("\u0415\u0441\u043B\u0438 \u0430\u043A\u0442\u0438\u0432\u0435\u043D \u043A\u0430\u0440\u0430\u043D\u0434\u0430\u0448, \u0442\u0430\u043F \u043F\u0435\u0440\u043E\u043C \u043C\u043E\u0436\u0435\u0442 \u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0442\u043E\u0447\u043A\u0443 \u2014 \u0443\u0434\u0430\u043B\u044F\u0442\u044C \u0435\u0451 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438.").addToggle(
      (t) => t.setValue(this.plugin.settings.cleanupStrayDot).onChange(async (v) => {
        this.plugin.settings.cleanupStrayDot = v;
        await this.plugin.saveSettings();
      })
    );
    this.numberField(
      "\u041F\u043E\u0440\u043E\u0433 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F (\u0442\u0430\u043F), px",
      "\u0415\u0441\u043B\u0438 \u043F\u0435\u0440\u043E \u0441\u0434\u0432\u0438\u043D\u0443\u043B\u043E\u0441\u044C \u0431\u043E\u043B\u044C\u0448\u0435 \u2014 \u044D\u0442\u043E \u0440\u0438\u0441\u043E\u0432\u0430\u043D\u0438\u0435, \u0430 \u043D\u0435 \u0442\u0430\u043F.",
      () => this.plugin.settings.moveThresholdPx,
      (n) => this.plugin.settings.moveThresholdPx = n
    );
    this.numberField(
      "\u0414\u043E\u043B\u0433\u043E\u0435 \u043D\u0430\u0436\u0430\u0442\u0438\u0435, \u043C\u0441",
      "\u0414\u043B\u044F \u0436\u0435\u0441\u0442\u0430 \xAB\u0434\u043E\u043B\u0433\u043E\u0435 \u043D\u0430\u0436\u0430\u0442\u0438\u0435 \u043F\u0435\u0440\u043E\u043C\xBB.",
      () => this.plugin.settings.longPressMs,
      (n) => this.plugin.settings.longPressMs = n
    );
    this.numberField(
      "\u041E\u043A\u043D\u043E \u0434\u0432\u043E\u0439\u043D\u043E\u0433\u043E \u043A\u0430\u0441\u0430\u043D\u0438\u044F, \u043C\u0441",
      "\u0414\u043B\u044F \u0436\u0435\u0441\u0442\u0430 \xAB\u0434\u0432\u043E\u0439\u043D\u043E\u0435 \u043A\u0430\u0441\u0430\u043D\u0438\u0435 \u043F\u0435\u0440\u043E\u043C\xBB.",
      () => this.plugin.settings.doubleTapMs,
      (n) => this.plugin.settings.doubleTapMs = n
    );
    this.numberField(
      "\u0417\u043E\u043D\u0430 \u043A\u0440\u0430\u044F \u0431\u043B\u043E\u043A\u0430, px (\u0441\u0446\u0435\u043D\u0430)",
      "\u041D\u0430\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0431\u043B\u0438\u0437\u043A\u043E \u043A \u0440\u0430\u043C\u043A\u0435 \u0431\u043B\u043E\u043A\u0430 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \xAB\u043A\u0440\u0430\u0439\xBB \u0434\u043B\u044F \u0441\u0442\u0440\u0435\u043B\u043A\u0438-\u043A\u043E\u043D\u043D\u0435\u043A\u0442\u043E\u0440\u0430.",
      () => this.plugin.settings.edgeMarginPx,
      (n) => this.plugin.settings.edgeMarginPx = n
    );
    this.numberField(
      "\u0428\u0438\u0440\u0438\u043D\u0430 \u0444\u0438\u0433\u0443\u0440\u044B \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E",
      "\u041F\u0440\u044F\u043C\u043E\u0443\u0433\u043E\u043B\u044C\u043D\u0438\u043A / \u044D\u043B\u043B\u0438\u043F\u0441 / \u0434\u043B\u0438\u043D\u0430 \u043B\u0438\u043D\u0438\u0438 \u0438 \u0441\u0442\u0440\u0435\u043B\u043A\u0438.",
      () => this.plugin.settings.defaultRectW,
      (n) => this.plugin.settings.defaultRectW = n
    );
    this.numberField(
      "\u0412\u044B\u0441\u043E\u0442\u0430 \u0444\u0438\u0433\u0443\u0440\u044B \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E",
      "",
      () => this.plugin.settings.defaultRectH,
      (n) => this.plugin.settings.defaultRectH = n
    );
    new import_obsidian3.Setting(containerEl).setName("Debug-\u043E\u0432\u0435\u0440\u043B\u0435\u0439").setDesc(
      "\u041B\u043E\u0433 \u0441\u043E\u0431\u044B\u0442\u0438\u0439 \u0441\u0442\u0438\u043B\u0443\u0441\u0430 (\u043D\u0430\u0432\u0435\u0434\u0435\u043D\u0438\u0435, contextmenu, auxclick, \u043A\u043B\u0430\u0432\u0438\u0448\u0438) \u2014 \u0447\u0442\u043E\u0431\u044B \u0443\u0432\u0438\u0434\u0435\u0442\u044C, \u0432 \u043A\u0430\u043A\u043E\u043C \u0441\u043E\u0431\u044B\u0442\u0438\u0438 \u0432\u0441\u043F\u043B\u044B\u0432\u0430\u0435\u0442 \u0431\u043E\u043A\u043E\u0432\u0430\u044F \u043A\u043D\u043E\u043F\u043A\u0430 S Pen."
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.debugOverlay).onChange(async (v) => {
        this.plugin.settings.debugOverlay = v;
        await this.plugin.saveSettings();
        this.plugin.refreshDebugOverlay();
      })
    );
  }
};
