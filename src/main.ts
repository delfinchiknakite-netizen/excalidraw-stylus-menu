import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS, StylusMenuSettings, TriggerGesture } from "./settings";
import { PointerWatcher, TriggerCtx } from "./PointerWatcher";
import { InsertMenu, MenuItem } from "./InsertMenu";
import { insertEmbedOrImage, insertShape, insertSticker, insertText } from "./inserters";
import { ConnectorController, contains, nearEdge } from "./connector";

const EXCALIDRAW_VIEW = "excalidraw";
const STRAY_TYPES = ["freedraw", "draw", "line", "arrow"];
const STRAY_MAX_PX = 12;

/** Доступ к ExcalidrawAutomate из плагина Excalidraw. */
export function getEA(app: App): any | null {
  const w = window as any;
  return (
    w.ExcalidrawAutomate ??
    (app as any).plugins?.plugins?.["obsidian-excalidraw-plugin"]?.ea ??
    null
  );
}

function getApi(app: App): any | null {
  const ea = getEA(app);
  if (!ea) return null;
  try {
    return ea.getExcalidrawAPI();
  } catch {
    return null;
  }
}

function hasBBox(el: any): boolean {
  return (
    el &&
    typeof el.x === "number" &&
    typeof el.y === "number" &&
    typeof el.width === "number" &&
    typeof el.height === "number"
  );
}

export default class StylusMenuPlugin extends Plugin {
  settings: StylusMenuSettings;
  private watchers = new Map<HTMLElement, PointerWatcher>();
  private debugEl: HTMLElement | null = null;
  private connector = new ConnectorController();
  private snapshot: Set<string> | null = null;
  private snapApi: any = null;
  private lastPointer: { clientX: number; clientY: number } | null = null;
  private diagHandlers: Array<[string, (e: any) => void]> | null = null;
  private diagLines: string[] = [];
  private lastMoveSig = "";

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
      if (!document.body.contains(el)) {
        w.detach();
        this.watchers.delete(el);
        this.connector.reset();
      }
    }
    const leaves = this.app.workspace.getLeavesOfType(EXCALIDRAW_VIEW);
    for (const leaf of leaves) {
      const view: any = leaf.view;
      const el: HTMLElement | undefined = view?.contentEl;
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
        (dir) => this.undoRedo(el, dir),
      );
      watcher.attach();
      this.watchers.set(el, watcher);
    }
  }

  /* ---------- координаты ---------- */

  private toScene(api: any, clientX: number, clientY: number): { x: number; y: number } {
    const st = api.getAppState?.() ?? {};
    const zoom = st?.zoom?.value ?? st?.zoom ?? 1;
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
      this.snapshot = new Set(els.filter((e: any) => !e.isDeleted).map((e: any) => e.id));
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
          (e: any) =>
            !e.isDeleted &&
            !snap.has(e.id) &&
            STRAY_TYPES.includes(e.type) &&
            Math.max(e.width || 0, e.height || 0) < STRAY_MAX_PX,
        );
        if (strays.length) {
          const ids = new Set(strays.map((e: any) => e.id));
          api.updateScene({
            elements: cur.filter((e: any) => !ids.has(e.id)),
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
    const elements = (api.getSceneElements?.() ?? []).filter(
      (el: any) => el && !el.isDeleted && hasBBox(el),
    );

    const margin = this.settings.edgeMarginPx;
    const onEdge = elements.some((el: any) => nearEdge(sceneX, sceneY, el, margin));

    // tapempty: тап по объекту (не по краю) — отдаём обычному поведению Excalidraw.
    if (this.settings.trigger === "tapempty" && !onEdge) {
      const onObject = elements.some((el: any) => contains(sceneX, sceneY, el, 0));
      if (onObject) {
        this.clearSnapshot();
        return;
      }
    }

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

  /**
   * Undo/redo по свайпу пером с кнопкой. В imperative-API Excalidraw нет метода
   * undo/redo, поэтому шлём синтетический Ctrl/Cmd+Z (Shift — для redo) в контейнер
   * Excalidraw — его глобальный keydown-обработчик это распознаёт независимо от версии.
   * ctrlKey и metaKey ставим оба: на Android сработает ctrlKey, на macOS — metaKey.
   */
  private undoRedo(viewEl: HTMLElement, dir: "undo" | "redo"): void {
    const target =
      (viewEl.querySelector(".excalidraw") as HTMLElement | null) ??
      (viewEl.querySelector("canvas") as HTMLElement | null) ??
      viewEl;
    const ev = new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      keyCode: 90,
      which: 90,
      ctrlKey: true,
      metaKey: true,
      shiftKey: dir === "redo",
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(ev);
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

  private openInsertMenu(ctx: TriggerCtx, ea: any, x: number, y: number): void {
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
    new InsertMenu({ x: ctx.clientX, y: ctx.clientY }, items).open();
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
    this.debugEl = document.body.createDiv({ cls: "esm-debug" });
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
    this.lastMoveSig = "";

    const move = (e: PointerEvent) => {
      if (e.pointerType !== "pen" && e.pointerType !== "mouse") return;
      const sig = `${e.pointerType}:${e.buttons}`;
      if (sig === this.lastMoveSig) return; // только при смене состояния кнопок
      this.lastMoveSig = sig;
      this.logLine(`hover ${e.pointerType} b=${e.buttons}`);
    };
    const up = (e: PointerEvent) =>
      this.logLine(`up    ${e.pointerType} b=${e.buttons} btn=${e.button}`);
    const ctx = (e: any) =>
      this.logLine(`contextmenu type=${e.pointerType ?? "?"} btn=${e.button ?? "?"}`);
    const aux = (e: any) => this.logLine(`auxclick btn=${e.button} type=${e.pointerType ?? "?"}`);
    const key = (e: KeyboardEvent) => this.logLine(`keydown "${e.key}" code=${e.code}`);

    const reg = (name: string, fn: (e: any) => void) => {
      window.addEventListener(name, fn, true);
      this.diagHandlers!.push([name, fn]);
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

    new Setting(containerEl)
      .setName("Жест-триггер")
      .setDesc("Чем открывать меню вставки пером.")
      .addDropdown((d) =>
        d
          .addOption("penbutton", "Боковая кнопка S Pen при парении (тап→меню, свайп→undo/redo)")
          .addOption("tapempty", "Касание пером по пустому месту")
          .addOption("longpress", "Долгое нажатие пером")
          .addOption("doubletap", "Двойное касание пером")
          .addOption("barrel", "Боковая кнопка S Pen + касание (barrel)")
          .setValue(this.plugin.settings.trigger)
          .onChange(async (v) => {
            this.plugin.settings.trigger = v as TriggerGesture;
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
      "Свайп кнопкой (undo/redo), px",
      "Парение с зажатой кнопкой: свайп вправо → redo, влево → undo. Меньше — чувствительнее.",
      () => this.plugin.settings.penSwipeMinPx,
      (n) => (this.plugin.settings.penSwipeMinPx = n),
    );
    this.numberField(
      "Долгое нажатие, мс",
      "Для жеста «долгое нажатие пером».",
      () => this.plugin.settings.longPressMs,
      (n) => (this.plugin.settings.longPressMs = n),
    );
    this.numberField(
      "Окно двойного касания, мс",
      "Для жеста «двойное касание пером».",
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
