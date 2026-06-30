import { StylusMenuSettings } from "./settings";

export interface TriggerCtx {
  clientX: number;
  clientY: number;
}

type Trigger = (ctx: TriggerCtx) => void;
type Arm = () => void;
type Pointer = (clientX: number, clientY: number) => void;
type Debug = (info: string) => void;

/**
 * Слушает pointer-события на элементе вью Excalidraw в capture-фазе (чтобы
 * опередить React-обработчики холста) и распознаёт настроенный жест-триггер.
 *
 * Палец (pointerType="touch") никогда не перехватывается — он остаётся для
 * рисования и навигации. Перехватывается только перо (и мышь — для отладки на ПК).
 *
 * Режим "tapempty" (по умолчанию): не глушит событие — даёт Excalidraw рисовать.
 * Если перо опустилось и поднялось без движения (тап), вызывает onTrigger; дальше
 * плагин сам решает (по hit-test), открыть меню (пустое место), коннектор (край
 * блока) или ничего (по объекту). Артефактная точка убирается отдельной очисткой.
 * onArm вызывается на pointerdown — чтобы плагин снял снимок сцены ДО рисования.
 */
export class PointerWatcher {
  private longPressTimer: number | null = null;
  private downX = 0;
  private downY = 0;
  private moved = false;
  private armed = false;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private suppressContext = false;

  constructor(
    private el: HTMLElement,
    private getSettings: () => StylusMenuSettings,
    private onTrigger: Trigger,
    private onArm: Arm,
    private onPointer: Pointer,
    private onDebug: Debug,
  ) {}

  attach(): void {
    this.el.addEventListener("pointerdown", this.down, true);
    this.el.addEventListener("pointermove", this.move, true);
    this.el.addEventListener("pointerup", this.up, true);
    this.el.addEventListener("pointercancel", this.cancel, true);
    this.el.addEventListener("contextmenu", this.ctx, true);
  }

  detach(): void {
    this.el.removeEventListener("pointerdown", this.down, true);
    this.el.removeEventListener("pointermove", this.move, true);
    this.el.removeEventListener("pointerup", this.up, true);
    this.el.removeEventListener("pointercancel", this.cancel, true);
    this.el.removeEventListener("contextmenu", this.ctx, true);
    this.clearTimer();
  }

  /** Перо или мышь (мышь — чтобы тестировать на ПК). Палец игнорируем. */
  private penLike(e: PointerEvent): boolean {
    return e.pointerType === "pen" || e.pointerType === "mouse";
  }

  /**
   * Реагируем только на касания собственно полотна Excalidraw (<canvas>), а не
   * элементов интерфейса (панель инструментов, кнопки, меню) — иначе тап по
   * кнопкам Excalidraw распознавался бы как «тап по пустому месту».
   */
  private onDrawSurface(e: PointerEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && t.tagName === "CANVAS";
  }

  private down = (e: PointerEvent): void => {
    const s = this.getSettings();
    if (s.debugOverlay) {
      this.onDebug(`down  type=${e.pointerType}  buttons=${e.buttons}  button=${e.button}`);
    }
    if (!this.penLike(e)) return;
    this.onPointer(e.clientX, e.clientY); // запоминаем позицию пера (для команды)
    if (!this.onDrawSurface(e)) return; // не трогаем кнопки/панели Excalidraw

    if (s.trigger === "tapempty") {
      if (!(e.buttons & 1)) return; // только контакт пера/ЛКМ
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.moved = false;
      this.armed = true;
      this.onArm(); // снимок сцены до того, как Excalidraw создаст точку
      return; // НЕ preventDefault — обычное рисование продолжается
    }

    if (s.trigger === "barrel") {
      if (e.buttons & 2) this.fire(e);
      return;
    }

    if (s.trigger === "longpress") {
      if (!(e.buttons & 1)) return;
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.onArm();
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
    if (this.penLike(e)) this.onPointer(e.clientX, e.clientY);
    const thr = this.getSettings().moveThresholdPx;
    if (this.armed) {
      const dist = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      if (dist > thr) this.moved = true;
    }
    if (this.longPressTimer != null) {
      const dist = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
      if (dist > thr) this.clearTimer();
    }
  };

  private up = (): void => {
    this.clearTimer();
    if (this.armed) {
      const wasTap = !this.moved;
      this.armed = false;
      if (wasTap) this.onTrigger({ clientX: this.downX, clientY: this.downY });
    }
  };

  private cancel = (): void => {
    this.clearTimer();
    this.armed = false;
  };

  private ctx = (e: Event): void => {
    // Гасим контекстное меню после barrel-триггера мышью на ПК.
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
