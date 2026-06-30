import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS, StylusMenuSettings, TriggerGesture } from "./settings";
import { PointerWatcher, TriggerCtx } from "./PointerWatcher";
import { InsertMenu, MenuItem } from "./InsertMenu";
import { insertEmbedOrImage, insertShape, insertSticker, insertText } from "./inserters";
import { ConnectorController } from "./connector";

const EXCALIDRAW_VIEW = "excalidraw";

/** Доступ к ExcalidrawAutomate из плагина Excalidraw. */
export function getEA(app: App): any | null {
  const w = window as any;
  return (
    w.ExcalidrawAutomate ??
    (app as any).plugins?.plugins?.["obsidian-excalidraw-plugin"]?.ea ??
    null
  );
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

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new StylusMenuSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncWatchers()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncWatchers()));
    this.app.workspace.onLayoutReady(() => this.syncWatchers());

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
        (info) => this.updateDebug(info),
      );
      watcher.attach();
      this.watchers.set(el, watcher);
    }
  }

  private onTrigger(ctx: TriggerCtx): void {
    const ea = getEA(this.app);
    if (!ea) {
      new Notice("Excalidraw не найден — включите плагин Excalidraw.");
      return;
    }
    try {
      ea.setView("active");
    } catch {
      /* ignore */
    }

    let api: any = null;
    try {
      api = ea.getExcalidrawAPI();
    } catch {
      api = null;
    }
    if (!api) {
      new Notice("Активный холст Excalidraw не найден.");
      return;
    }

    const st = api.getAppState?.() ?? {};
    const zoom = st?.zoom?.value ?? st?.zoom ?? 1;
    const sceneX = (ctx.clientX - (st.offsetLeft ?? 0)) / zoom - (st.scrollX ?? 0);
    const sceneY = (ctx.clientY - (st.offsetTop ?? 0)) / zoom - (st.scrollY ?? 0);

    const elements = (api.getSceneElements?.() ?? []).filter(
      (el: any) => el && !el.isDeleted && hasBBox(el),
    );

    // Сначала пытаемся обработать как коннектор (касание у края блока).
    const handled = this.connector.handleTrigger({
      ea,
      api,
      sceneX,
      sceneY,
      elements,
      settings: this.settings,
    });
    if (handled) return;

    this.openInsertMenu(ctx, ea, sceneX, sceneY);
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

  /* ---------- debug overlay ---------- */

  refreshDebugOverlay(): void {
    if (this.settings.debugOverlay) this.ensureDebugOverlay();
    else this.removeDebugOverlay();
  }

  private ensureDebugOverlay(): void {
    if (this.debugEl) return;
    this.debugEl = document.body.createDiv({ cls: "esm-debug" });
    this.debugEl.setText("S Pen debug: коснитесь холста…");
  }

  private removeDebugOverlay(): void {
    this.debugEl?.remove();
    this.debugEl = null;
  }

  private updateDebug(info: string): void {
    if (this.debugEl) this.debugEl.setText(info);
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
          .addOption("barrel", "Боковая кнопка S Pen + касание")
          .addOption("longpress", "Долгое нажатие пером")
          .addOption("doubletap", "Двойное касание пером")
          .setValue(this.plugin.settings.trigger)
          .onChange(async (v) => {
            this.plugin.settings.trigger = v as TriggerGesture;
            await this.plugin.saveSettings();
          }),
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
        "Показывать pointerType и buttons последнего касания — проверить, отдаёт ли S Pen боковую кнопку (ожидается buttons=3).",
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
