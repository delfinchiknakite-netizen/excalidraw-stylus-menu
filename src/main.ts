import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS, StylusMenuSettings } from "./settings";
import { PointerWatcher, TriggerCtx } from "./PointerWatcher";
import { InsertMenu, MenuItem } from "./InsertMenu";
import { insertEmbedOrImage, insertShape, insertSticker, insertText } from "./inserters";
import { ConnectorController, contains } from "./connector";
import {
  ExAppState,
  ExBinding,
  ExcalidrawApi,
  ExcalidrawAutomate,
  ExElement,
  getApi,
  getEA,
  hasBBox,
  zoomValue,
} from "./excalidraw";

const EXCALIDRAW_VIEW = "excalidraw";
const STRAY_TYPES = ["freedraw", "draw", "line", "arrow"];
const STRAY_MAX_PX = 12;
const LINEAR_TYPES = ["arrow", "line", "freedraw"];

/** Случайный id в стиле Excalidraw (nanoid-подобный) для вставляемых клонов. */
function genId(): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-";
  let s = "";
  for (let i = 0; i < 21; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

function randInt(): number {
  return (Math.random() * 2 ** 31) | 0;
}

export default class StylusMenuPlugin extends Plugin {
  settings: StylusMenuSettings;
  private watchers = new Map<HTMLElement, PointerWatcher>();
  private debugEl: HTMLElement | null = null;
  private connector = new ConnectorController();
  private snapshot: Set<string> | null = null;
  private snapApi: ExcalidrawApi | null = null;
  private lastPointer: { clientX: number; clientY: number } | null = null;
  private diagHandlers: Array<[string, EventListener]> | null = null;
  private diagLines: string[] = [];
  private lastMoveSig = "";
  /** Внутренний буфер копирования: глубокие копии скопированных элементов сцены. */
  private clipboard: ExElement[] | null = null;
  /** Ожидание второго тапа для стрелки: исходный объект (тап по цели создаёт стрелку). */
  private pendingArrowFrom: ExElement | null = null;
  /** Единственное открытое меню (синглтон — чтобы меню не стекировались). */
  private activeMenu: InsertMenu | null = null;
  /** До этого времени (ms) новое меню не открываем — гасим дребезг после закрытия. */
  private menuSuppressUntil = 0;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new StylusMenuSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncWatchers()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncWatchers()));
    this.app.workspace.onLayoutReady(() => this.syncWatchers());

    this.addCommand({
      id: "open-insert-menu",
      name: "Открыть меню вставки (стилус)",
      callback: () => this.openMenuAtLastPointer(),
    });

    this.addCommand({
      id: "copy-selection",
      name: "Копировать выделенное (стилус)",
      callback: () => this.copySelection(),
    });

    this.addCommand({
      id: "paste-clipboard",
      name: "Вставить (стилус)",
      callback: () =>
        this.pasteClipboard(
          this.lastPointer ?? {
            clientX: window.innerWidth / 2,
            clientY: window.innerHeight / 2,
          },
        ),
    });

    this.addCommand({
      id: "toggle-debug-overlay",
      name: "Переключить debug-оверлей стилуса",
      callback: async () => {
        this.settings.debugOverlay = !this.settings.debugOverlay;
        await this.saveSettings();
        this.refreshDebugOverlay();
      },
    });

    this.refreshDebugOverlay();
  }

  onunload(): void {
    for (const w of Array.from(this.watchers.values())) w.detach();
    this.watchers.clear();
    this.removeDiagnostics();
    this.removeDebugOverlay();
  }

  /** Навешивает PointerWatcher на все открытые вью Excalidraw, снимает с закрытых. */
  private syncWatchers(): void {
    for (const [el, w] of Array.from(this.watchers.entries())) {
      if (!activeDocument.body.contains(el)) {
        w.detach();
        this.watchers.delete(el);
        this.connector.reset();
      }
    }
    const leaves = this.app.workspace.getLeavesOfType(EXCALIDRAW_VIEW);
    for (const leaf of leaves) {
      const el = (leaf.view as unknown as { contentEl?: HTMLElement }).contentEl;
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
        (ctx) => this.onObjectTap(ctx),
      );
      watcher.attach();
      this.watchers.set(el, watcher);
    }
  }

  /* ---------- координаты ---------- */

  private toScene(api: ExcalidrawApi, clientX: number, clientY: number): { x: number; y: number } {
    const st: ExAppState = api.getAppState?.() ?? {};
    const zoom = zoomValue(st);
    return {
      x: (clientX - (st.offsetLeft ?? 0)) / zoom - (st.scrollX ?? 0),
      y: (clientY - (st.offsetTop ?? 0)) / zoom - (st.scrollY ?? 0),
    };
  }

  /* ---------- очистка артефактной точки ---------- */

  private snapshotScene(): void {
    if (!this.settings.cleanupStrayDot) return;
    const api = getApi(this.app);
    if (!api) return;
    try {
      const els = api.getSceneElements?.() ?? [];
      this.snapshot = new Set(els.filter((e) => !e.isDeleted).map((e) => e.id));
      this.snapApi = api;
    } catch {
      this.clearSnapshot();
    }
  }

  private clearSnapshot(): void {
    this.snapshot = null;
    this.snapApi = null;
  }

  private scheduleCleanup(): void {
    const snap = this.snapshot;
    const api = this.snapApi;
    this.clearSnapshot();
    if (!snap || !api) return;
    window.setTimeout(() => {
      try {
        const cur = api.getSceneElements?.() ?? [];
        const strays = cur.filter(
          (e) =>
            !e.isDeleted &&
            !snap.has(e.id) &&
            STRAY_TYPES.includes(e.type) &&
            Math.max(e.width || 0, e.height || 0) < STRAY_MAX_PX,
        );
        if (strays.length) {
          const ids = new Set(strays.map((e) => e.id));
          api.updateScene?.({
            elements: cur.filter((e) => !ids.has(e.id)),
            commitToHistory: false,
          });
        }
      } catch (err) {
        console.error("[excalidraw-stylus-menu] cleanup failed", err);
      }
    }, 80);
  }

  /* ---------- основной обработчик жеста ---------- */

  private onTrigger(ctx: TriggerCtx): void {
    const ea = getEA(this.app);
    if (!ea) {
      this.clearSnapshot();
      new Notice("Excalidraw не найден — включите плагин Excalidraw.");
      return;
    }
    try {
      ea.setView("active");
    } catch {
      /* ignore */
    }

    const api = getApi(this.app);
    if (!api) {
      this.clearSnapshot();
      new Notice("Активный холст Excalidraw не найден.");
      return;
    }

    const { x: sceneX, y: sceneY } = this.toScene(api, ctx.clientX, ctx.clientY);
    const elements = (api.getSceneElements?.() ?? []).filter((el) => !el.isDeleted && hasBBox(el));

    const handled = this.connector.handleTrigger({
      ea,
      api,
      sceneX,
      sceneY,
      elements,
      settings: this.settings,
    });
    if (handled) {
      this.scheduleCleanup();
      return;
    }

    this.openInsertMenu(ctx, ea, sceneX, sceneY);
    this.scheduleCleanup();
  }

  /** Открыть меню по команде/хоткею: в последней позиции пера или в центре экрана. */
  private openMenuAtLastPointer(): void {
    const ea = getEA(this.app);
    if (!ea) {
      new Notice("Excalidraw не найден — откройте рисунок Excalidraw.");
      return;
    }
    try {
      ea.setView("active");
    } catch {
      /* ignore */
    }
    const api = getApi(this.app);
    if (!api) {
      new Notice("Откройте активный холст Excalidraw.");
      return;
    }
    const p = this.lastPointer ?? {
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2,
    };
    const { x, y } = this.toScene(api, p.clientX, p.clientY);
    this.openInsertMenu(p, ea, x, y);
  }

  /**
   * Открыть меню как СИНГЛТОН: если меню уже открыто — этот вызов только закрывает его
   * (тап-дисмисс) и НЕ открывает новое; сразу после закрытия действует короткое окно
   * подавления, чтобы отложенный жест (напр. таймер тапа кнопки) не открыл меню заново.
   */
  private presentMenu(ctx: TriggerCtx, items: MenuItem[]): void {
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

  private openInsertMenu(ctx: TriggerCtx, ea: ExcalidrawAutomate, x: number, y: number): void {
    const items: MenuItem[] = [
      { label: "✎  Текст", onClick: () => insertText(ea, this.app, x, y) },
      { label: "▢  Стикер (текст в рамке)", onClick: () => insertSticker(ea, this.app, x, y) },
      {
        label: "◆  Фигуры ›",
        children: [
          { label: "▭  Прямоугольник", onClick: () => insertShape(ea, "rect", x, y, this.settings) },
          { label: "◯  Эллипс", onClick: () => insertShape(ea, "ellipse", x, y, this.settings) },
          { label: "→  Стрелка", onClick: () => insertShape(ea, "arrow", x, y, this.settings) },
          { label: "／  Линия", onClick: () => insertShape(ea, "line", x, y, this.settings) },
        ],
      },
      {
        label: "🖼  Заметка / изображение",
        onClick: () => insertEmbedOrImage(ea, this.app, x, y, this.settings),
      },
    ];
    this.presentMenu(ctx, items);
  }

  /* ---------- меню действий над объектом (тап пером по объекту) ---------- */

  /**
   * Контактный тап пером: по фигуре/выделению — меню действий (если включено),
   * по пустому месту — основное меню вставки.
   */
  private onObjectTap(ctx: TriggerCtx): void {
    const ea = getEA(this.app);
    const api = getApi(this.app);
    if (!ea || !api?.getSceneElements) {
      this.clearSnapshot();
      this.pendingArrowFrom = null;
      return;
    }
    const { x: sx, y: sy } = this.toScene(api, ctx.clientX, ctx.clientY);
    const all = (api.getSceneElements() ?? []).filter((el) => !el.isDeleted && hasBBox(el));

    // Одиночный хит для меню фигуры / цели стрелки. Стрелки/линии/росчерки исключаем:
    // у них огромный bbox по диагонали, из-за чего тап по пустому месту рядом попадал «в стрелку».
    let hit: ExElement | null = null;
    for (const el of all) {
      if (LINEAR_TYPES.includes(el.type)) continue;
      if (contains(sx, sy, el, 0)) hit = el; // последний = верхний
    }

    // Второй тап для стрелки: соединяем исходный объект с тем, по которому тапнули.
    if (this.pendingArrowFrom) {
      const from = this.pendingArrowFrom;
      this.pendingArrowFrom = null;
      this.scheduleCleanup();
      if (hit && hit.id !== from.id) void this.connectArrow(from, hit);
      else new Notice("Стрелка отменена.");
      return;
    }

    if (this.settings.objectTapMenu) {
      // Тап по МНОЖЕСТВЕННОМУ выделению → меню действий над набором (дублировать/удалить).
      // Требуем >1 элемента и попадание по выделенной ФИГУРЕ (не по bbox стрелки — он огромный).
      const appState: ExAppState = api.getAppState?.() ?? {};
      const selIds = appState.selectedElementIds ?? {};
      const selected = all.filter((el) => selIds[el.id]);
      if (
        selected.length > 1 &&
        selected.some((el) => !LINEAR_TYPES.includes(el.type) && contains(sx, sy, el, 0))
      ) {
        this.scheduleCleanup();
        this.openSelectionMenu(ctx, selected);
        return;
      }
      // Тап по одиночной фигуре → меню действий над ней.
      if (hit) {
        this.scheduleCleanup();
        this.openObjectMenu(ctx, ea, hit);
        return;
      }
    }

    // Тап по пустому месту (или меню объекта выключено) → основное меню вставки.
    this.scheduleCleanup(); // убрать точку-артефакт от самого тапа
    this.openInsertMenu(ctx, ea, sx, sy);
  }

  private openObjectMenu(ctx: TriggerCtx, ea: ExcalidrawAutomate, el: ExElement): void {
    // Меню только для фигур (стрелки/линии в хит-тест не попадают).
    this.presentMenu(ctx, this.shapeMenuItems(ea, el));
  }

  /** Меню для фигуры (прямоугольник/эллипс/текст/картинка/заметка). */
  private shapeMenuItems(ea: ExcalidrawAutomate, el: ExElement): MenuItem[] {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    return [
      {
        label: "→  Стрелка к объекту…",
        onClick: () => {
          this.pendingArrowFrom = el;
          new Notice("Тапните объект, к которому вести стрелку.");
        },
      },
      { label: "▢  Стикер на объект", onClick: () => insertSticker(ea, this.app, cx, cy) },
      { label: "⧉  Дублировать", onClick: () => this.duplicateElements([el]) },
      { label: "🗑  Удалить", onClick: () => this.deleteElements([el]) },
    ];
  }

  /** Меню для выделения: тап по выделенным объектам → дублировать/удалить весь набор. */
  private openSelectionMenu(ctx: TriggerCtx, els: ExElement[]): void {
    const items: MenuItem[] = [
      { label: `⧉  Дублировать (${els.length})`, onClick: () => this.duplicateElements(els) },
      { label: `🗑  Удалить (${els.length})`, onClick: () => this.deleteElements(els) },
    ];
    this.presentMenu(ctx, items);
  }

  /** Стрелка между двумя существующими объектами (с привязкой обоих концов). */
  private async connectArrow(from: ExElement, to: ExElement): Promise<void> {
    if (LINEAR_TYPES.includes(from.type) || LINEAR_TYPES.includes(to.type)) {
      new Notice("Соединять стрелкой можно только фигуры.");
      return;
    }
    const ea = getEA(this.app);
    if (!ea) return;
    try {
      ea.reset();
      ea.setView("active");
      // connectObjects читает объекты из EA — заносим их из вью.
      ea.copyViewElementsToEAforEditing?.([from, to]);
      ea.connectObjects(from.id, null, to.id, null, { endArrowHead: "arrow" });
      await ea.addElementsToView(false, true, true);
      new Notice("Стрелка создана.");
    } catch (err) {
      console.error("[excalidraw-stylus-menu] connectArrow failed", err);
      new Notice("Не удалось создать стрелку.");
    }
  }

  /**
   * Клонировать набор элементов с новыми id, перенастроив связи (группы, привязки,
   * контейнеры) ВНУТРИ набора, и сместить на (dx, dy). Используется вставкой и дублированием.
   */
  private cloneElements(list: ExElement[], dx: number, dy: number): ExElement[] {
    const idMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    for (const el of list) idMap.set(el.id, genId());
    const remap = (id: string) => idMap.get(id) ?? id;
    const remapBinding = (b: ExBinding | null | undefined): ExBinding | null => {
      if (!b?.elementId) return b ?? null;
      return idMap.has(b.elementId) ? { ...b, elementId: remap(b.elementId) } : null;
    };
    return list.map((src) => {
      const el = JSON.parse(JSON.stringify(src)) as ExElement;
      el.id = idMap.get(src.id) ?? genId();
      el.x = src.x + dx;
      el.y = src.y + dy;
      el.seed = randInt();
      el.versionNonce = randInt();
      el.version = (src.version ?? 1) + 1;
      el.updated = Date.now();
      if (Array.isArray(el.groupIds)) {
        el.groupIds = el.groupIds.map((g) => {
          const mapped = groupMap.get(g) ?? genId();
          if (!groupMap.has(g)) groupMap.set(g, mapped);
          return mapped;
        });
      }
      if (el.containerId) el.containerId = idMap.has(el.containerId) ? remap(el.containerId) : null;
      if (Array.isArray(el.boundElements)) {
        el.boundElements = el.boundElements
          .filter((b) => idMap.has(b.id))
          .map((b) => ({ ...b, id: remap(b.id) }));
      }
      el.startBinding = remapBinding(el.startBinding);
      el.endBinding = remapBinding(el.endBinding);
      return el;
    });
  }

  private duplicateElements(els: ExElement[]): void {
    const api = getApi(this.app);
    if (!api?.updateScene || !els.length) return;
    const clones = this.cloneElements(els, 20, 20);
    const cur = (api.getSceneElements?.() ?? []).filter((e) => !e.isDeleted);
    const sel: Record<string, boolean> = {};
    for (const c of clones) sel[c.id] = true;
    const appState: ExAppState = api.getAppState?.() ?? {};
    api.updateScene({
      elements: [...cur, ...clones],
      appState: { ...appState, selectedElementIds: sel },
      commitToHistory: true,
    });
    new Notice(`Дублировано: ${clones.length}`);
  }

  private deleteElements(els: ExElement[]): void {
    const api = getApi(this.app);
    if (!api?.updateScene || !els.length) return;
    const ids = new Set<string>();
    for (const el of els) {
      ids.add(el.id);
      for (const b of el.boundElements ?? []) ids.add(b.id);
    }
    const cur = (api.getSceneElements?.() ?? []).filter((e) => !e.isDeleted);
    const appState: ExAppState = api.getAppState?.() ?? {};
    api.updateScene({
      elements: cur.filter((e) => !ids.has(e.id) && !(e.containerId && ids.has(e.containerId))),
      appState: { ...appState, selectedElementIds: {} },
      commitToHistory: true,
    });
    new Notice(`Удалено: ${els.length}`);
  }

  /* ---------- копировать / вставить (жесты кнопкой при парении) ---------- */

  /** Двойной тап кнопкой: скопировать выделенные элементы во внутренний буфер плагина. */
  private copySelection(): void {
    const api = getApi(this.app);
    if (!api?.getSceneElements) {
      new Notice("Активный холст Excalidraw не найден.");
      return;
    }
    const appState: ExAppState = api.getAppState?.() ?? {};
    const sel = appState.selectedElementIds ?? {};
    const selected = (api.getSceneElements() ?? []).filter((el) => !el.isDeleted && sel[el.id]);
    if (!selected.length) {
      new Notice("Нечего копировать — выделите элементы.");
      return;
    }
    // Глубокая копия, чтобы последующие правки сцены не меняли буфер.
    this.clipboard = selected.map((el) => JSON.parse(JSON.stringify(el)) as ExElement);
    new Notice(`Скопировано: ${this.clipboard.length}`);
  }

  /** Удержание/команда: вставить буфер у кончика пера с новыми id и выделить вставленное. */
  private pasteClipboard(ctx: TriggerCtx): void {
    const buffer = this.clipboard;
    if (!buffer?.length) {
      new Notice("Буфер пуст — сначала скопируйте (двойной тап кнопкой).");
      return;
    }
    const ea = getEA(this.app);
    try {
      ea?.setView("active");
    } catch {
      /* ignore */
    }
    const api = getApi(this.app);
    if (!api?.updateScene) {
      new Notice("Активный холст Excalidraw не найден.");
      return;
    }

    // Смещаем набор так, чтобы его левый-верхний угол оказался у кончика пера.
    const minX = Math.min(...buffer.map((e) => e.x));
    const minY = Math.min(...buffer.map((e) => e.y));
    const { x: penX, y: penY } = this.toScene(api, ctx.clientX, ctx.clientY);
    const clones = this.cloneElements(buffer, penX - minX, penY - minY);

    const current = (api.getSceneElements?.() ?? []).filter((e) => !e.isDeleted);
    const selectedElementIds: Record<string, boolean> = {};
    for (const c of clones) selectedElementIds[c.id] = true;
    const appState: ExAppState = api.getAppState?.() ?? {};
    try {
      api.updateScene({
        elements: [...current, ...clones],
        appState: { ...appState, selectedElementIds },
        commitToHistory: true,
      });
      new Notice(`Вставлено: ${clones.length}`);
    } catch (err) {
      console.error("[excalidraw-stylus-menu] paste failed", err);
      new Notice("Не удалось вставить.");
    }
  }

  /* ---------- диагностика стилуса ---------- */

  refreshDebugOverlay(): void {
    if (this.settings.debugOverlay) {
      this.ensureDebugOverlay();
      this.installDiagnostics();
    } else {
      this.removeDiagnostics();
      this.removeDebugOverlay();
    }
  }

  private ensureDebugOverlay(): void {
    if (this.debugEl) return;
    this.debugEl = activeDocument.body.createDiv({ cls: "esm-debug" });
    this.debugEl.setText("S Pen debug: жмите кнопку пера в разных режимах…");
  }

  private removeDebugOverlay(): void {
    this.debugEl?.remove();
    this.debugEl = null;
    this.diagLines = [];
  }

  private logLine(s: string): void {
    this.diagLines.push(s);
    if (this.diagLines.length > 8) this.diagLines.shift();
    if (this.debugEl) this.debugEl.setText(this.diagLines.join("\n"));
  }

  /**
   * Глобальный сниффер: ловит события, в которых на Samsung может «всплыть»
   * кнопка S Pen — наведение с зажатой кнопкой, contextmenu, auxclick, клавиши.
   * pointerdown логируется самим PointerWatcher (на полотне).
   */
  private installDiagnostics(): void {
    if (this.diagHandlers) return;
    this.diagHandlers = [];
    const handlers = this.diagHandlers;
    this.lastMoveSig = "";

    const move = (ev: Event) => {
      const e = ev as PointerEvent;
      if (e.pointerType !== "pen" && e.pointerType !== "mouse") return;
      const sig = `${e.pointerType}:${e.buttons}`;
      if (sig === this.lastMoveSig) return; // только при смене состояния кнопок
      this.lastMoveSig = sig;
      this.logLine(`hover ${e.pointerType} b=${e.buttons}`);
    };
    const up = (ev: Event) => {
      const e = ev as PointerEvent;
      this.logLine(`up    ${e.pointerType} b=${e.buttons} btn=${e.button}`);
    };
    const ctx = (ev: Event) => {
      const e = ev as PointerEvent;
      this.logLine(`contextmenu type=${e.pointerType ?? "?"} btn=${e.button ?? "?"}`);
    };
    const aux = (ev: Event) => {
      const e = ev as PointerEvent;
      this.logLine(`auxclick btn=${e.button} type=${e.pointerType ?? "?"}`);
    };
    const key = (ev: Event) => {
      const e = ev as KeyboardEvent;
      this.logLine(`keydown "${e.key}" code=${e.code}`);
    };

    const reg = (name: string, fn: EventListener) => {
      window.addEventListener(name, fn, true);
      handlers.push([name, fn]);
    };
    reg("pointermove", move);
    reg("pointerup", up);
    reg("contextmenu", ctx);
    reg("auxclick", aux);
    reg("keydown", key);
  }

  private removeDiagnostics(): void {
    if (!this.diagHandlers) return;
    for (const [name, fn] of this.diagHandlers) window.removeEventListener(name, fn, true);
    this.diagHandlers = null;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as StylusMenuSettings;
    this.settings.trigger = "penbutton"; // единственный режим (старые значения игнорируем)
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class StylusMenuSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: StylusMenuPlugin) {
    super(app, plugin);
  }

  private numberField(
    name: string,
    desc: string,
    get: () => number,
    set: (n: number) => void,
    placeholder = "",
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((t) =>
        t
          .setPlaceholder(placeholder)
          .setValue(String(get()))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n)) {
              set(n);
              await this.plugin.saveSettings();
            }
          }),
      );
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Основное меню вставки открывается двумя способами: тап пером по пустому месту холста " +
        "и одиночный тап боковой кнопкой S Pen при парении. Двойной тап кнопкой — копировать, " +
        "удержание — вставить.",
    });

    new Setting(containerEl)
      .setName("Меню действий по тапу на объект")
      .setDesc("Тап пером по фигуре/объекту → меню: стрелка к объекту, стикер, дублировать, удалить.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.objectTapMenu).onChange(async (v) => {
          this.plugin.settings.objectTapMenu = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Убирать случайную точку")
      .setDesc("Если активен карандаш, тап пером может оставить точку — удалять её автоматически.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.cleanupStrayDot).onChange(async (v) => {
          this.plugin.settings.cleanupStrayDot = v;
          await this.plugin.saveSettings();
        }),
      );

    this.numberField(
      "Порог движения (тап), px",
      "Если перо сдвинулось больше — это рисование, а не тап.",
      () => this.plugin.settings.moveThresholdPx,
      (n) => (this.plugin.settings.moveThresholdPx = n),
    );
    this.numberField(
      "Удержание кнопки (вставить), мс",
      "Через сколько удержание боковой кнопки при парении вставляет буфер.",
      () => this.plugin.settings.longPressMs,
      (n) => (this.plugin.settings.longPressMs = n),
    );
    this.numberField(
      "Окно двойного тапа, мс",
      "Окно распознавания двойного тапа кнопкой (копировать) и задержки одиночного тапа.",
      () => this.plugin.settings.doubleTapMs,
      (n) => (this.plugin.settings.doubleTapMs = n),
    );
    this.numberField(
      "Зона края блока, px (сцена)",
      "Насколько близко к рамке блока считается «край» для стрелки-коннектора.",
      () => this.plugin.settings.edgeMarginPx,
      (n) => (this.plugin.settings.edgeMarginPx = n),
    );
    this.numberField(
      "Ширина фигуры по умолчанию",
      "Прямоугольник / эллипс / длина линии и стрелки.",
      () => this.plugin.settings.defaultRectW,
      (n) => (this.plugin.settings.defaultRectW = n),
    );
    this.numberField(
      "Высота фигуры по умолчанию",
      "",
      () => this.plugin.settings.defaultRectH,
      (n) => (this.plugin.settings.defaultRectH = n),
    );

    new Setting(containerEl)
      .setName("Debug-оверлей")
      .setDesc(
        "Лог событий стилуса (наведение, contextmenu, auxclick, клавиши) — чтобы увидеть, " +
          "в каком событии всплывает боковая кнопка S Pen.",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.debugOverlay).onChange(async (v) => {
          this.plugin.settings.debugOverlay = v;
          await this.plugin.saveSettings();
          this.plugin.refreshDebugOverlay();
        }),
      );
  }
}
