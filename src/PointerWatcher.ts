import { StylusMenuSettings } from "./settings";

export interface TriggerCtx {
  clientX: number;
  clientY: number;
}

type Trigger = (ctx: TriggerCtx) => void;
type Debug = (info: string) => void;

/**
 * Слушает pointer-события на элементе вью Excalidraw в capture-фазе (чтобы
 * опередить React-обработчики холста) и распознаёт настроенный жест-триггер.
 * Палец (pointerType="touch") никогда не перехватывается — он остаётся для
 * рисования и навигации. Перехватывается только перо (и мышь — для отладки на ПК).
 */
export class PointerWatcher {
  private longPressTimer: number | null = null;
  private downX = 0;
  private downY = 0;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private suppressContext = false;

  constructor(
    private el: HTMLElement,
    private getSettings: () => StylusMenuSettings,
    private onTrigger: Trigger,
    private onDebug: Debug,
  ) {}

  attach(): void {
    this.el.addEventListener("pointerdown", this.down, true);
    this.el.addEventListener("pointermove", this.move, true);
    this.el.addEventListener("pointerup", this.up, true);
    this.el.addEventListener("pointercancel", this.up, true);
    this.el.addEventListener("contextmenu", this.ctx, true);
  }

  detach(): void {
    this.el.removeEventListener("pointerdown", this.down, true);
    this.el.removeEventListener("pointermove", this.move, true);
    this.el.removeEventListener("pointerup", this.up, true);
    this.el.removeEventListener("pointercancel", this.up, true);
    this.el.removeEventListener("contextmenu", this.ctx, true);
    this.clearTimer();
  }

  /** Перо или мышь (мышь — чтобы тестировать на ПК правой кнопкой). Палец игнорируем. */
  private penLike(e: PointerEvent): boolean {
    return e.pointerType === "pen" || e.pointerType === "mouse";
  }

  private down = (e: PointerEvent): void => {
    const s = this.getSettings();
    if (s.debugOverlay) {
      this.onDebug(`down  type=${e.pointerType}  buttons=${e.buttons}  button=${e.button}`);
    }
    if (!this.penLike(e)) return;

    if (s.trigger === "barrel") {
      // Боковая кнопка S Pen = бит 2 в buttons (на ПК — правая кнопка мыши).
      if (e.buttons & 2) this.fire(e);
      return;
    }

    if (s.trigger === "longpress") {
      if (!(e.buttons & 1)) return; // только контакт пера/ЛКМ
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.clearTimer();
      this.longPressTimer = window.setTimeout(() => {
        this.longPressTimer = null;
        this.onTrigger({ clientX: this.downX, clientY: this.downY });
      }, s.longPressMs);
      return;
    }

    if (s.trigger === "doubletap") {
      if (!(e.buttons & 1)) return;
      const dt = e.timeStamp - this.lastTapTime;
      const dist = Math.hypot(e.clientX - this.lastTapX, e.clientY - this.lastTapY);
      if (dt < s.doubleTapMs && dist < s.moveThresholdPx) {
        this.lastTapTime = 0;
        this.fire(e);
      } else {
        this.lastTapTime = e.timeStamp;
        this.lastTapX = e.clientX;
        this.lastTapY = e.clientY;
      }
      return;
    }
  };

  private move = (e: PointerEvent): void => {
    if (this.longPressTimer != null) {
      const dist = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      if (dist > this.getSettings().moveThresholdPx) this.clearTimer();
    }
  };

  private up = (): void => {
    this.clearTimer();
  };

  private ctx = (e: Event): void => {
    // Гасим контекстное меню браузера/Obsidian после barrel-триггера мышью на ПК.
    if (this.suppressContext) {
      this.suppressContext = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private fire(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    (e as any).stopImmediatePropagation?.();
    if (e.pointerType === "mouse") this.suppressContext = true;
    this.onTrigger({ clientX: e.clientX, clientY: e.clientY });
  }

  private clearTimer(): void {
    if (this.longPressTimer != null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
}
