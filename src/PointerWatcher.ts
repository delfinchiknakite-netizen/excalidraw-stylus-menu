import { StylusMenuSettings } from "./settings";

export interface TriggerCtx {
  clientX: number;
  clientY: number;
}

type Trigger = (ctx: TriggerCtx) => void;
type Arm = () => void;
type Pointer = (clientX: number, clientY: number) => void;
type Debug = (info: string) => void;
type Swipe = (dir: "undo" | "redo") => void;

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
  /** Перо в контакте с полотном (после pointerdown с buttons&1). */
  private penDown = false;
  /** Боковая кнопка зажата во время ПАРЕНИЯ (без касания). */
  private penBtnActive = false;
  /** Свайп уже распознан в этом нажатии кнопки — не открывать меню и не дублировать. */
  private penBtnConsumed = false;
  private penBtnStartX = 0;
  private penBtnStartY = 0;
  /** Время последнего срабатывания penbutton (антидребезг). */
  private lastPenButtonFire = 0;

  constructor(
    private el: HTMLElement,
    private getSettings: () => StylusMenuSettings,
    private onTrigger: Trigger,
    private onArm: Arm,
    private onPointer: Pointer,
    private onDebug: Debug,
    private onSwipe: Swipe,
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
    if (e.buttons & 1) {
      this.penDown = true; // перо коснулось полотна
      this.penBtnActive = false; // касание отменяет «парящий» жест кнопкой
    }
    this.onPointer(e.clientX, e.clientY); // запоминаем позицию пера (для команды)
    if (!this.onDrawSurface(e)) return; // не трогаем кнопки/панели Excalidraw

    if (s.trigger === "penbutton") {
      // Меню/свайп работают ТОЛЬКО при парении (см. move). Касание — обычное
      // рисование Excalidraw; кнопку при касании только гасим в contextmenu (см. ctx).
      return;
    }

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
    const s = this.getSettings();

    // penbutton: кнопка во время ПАРЕНИЯ (без касания) приходит как buttons&1.
    // Тап кнопкой (без движения) → меню; горизонтальный свайп → undo/redo.
    if (s.trigger === "penbutton" && e.pointerType === "pen") {
      const pressed = !!(e.buttons & 1);
      if (pressed && !this.penDown) {
        if (!this.penBtnActive) {
          this.penBtnActive = true;
          this.penBtnConsumed = false;
          this.penBtnStartX = e.clientX;
          this.penBtnStartY = e.clientY;
        } else if (!this.penBtnConsumed) {
          const dx = e.clientX - this.penBtnStartX;
          const dy = e.clientY - this.penBtnStartY;
          if (Math.abs(dx) >= s.penSwipeMinPx && Math.abs(dx) > Math.abs(dy)) {
            this.penBtnConsumed = true; // свайп распознан — меню по отпусканию не открываем
            this.firePenButton(e, () => this.onSwipe(dx > 0 ? "redo" : "undo"));
          }
        }
      } else if (this.penBtnActive && !pressed) {
        // кнопку отпустили: если свайпа не было — это тап → меню в точке старта.
        this.penBtnActive = false;
        if (!this.penBtnConsumed) {
          this.firePenButton(e, () =>
            this.onTrigger({ clientX: this.penBtnStartX, clientY: this.penBtnStartY }),
          );
        }
      }
    }

    const thr = s.moveThresholdPx;
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
    this.penDown = false;
    if (this.armed) {
      const wasTap = !this.moved;
      this.armed = false;
      if (wasTap) this.onTrigger({ clientX: this.downX, clientY: this.downY });
    }
  };

  private cancel = (): void => {
    this.clearTimer();
    this.penDown = false;
    this.penBtnActive = false;
    this.penBtnConsumed = false;
    this.armed = false;
  };

  private ctx = (e: Event): void => {
    // penbutton: кнопка S Pen в момент КАСАНИЯ приходит как contextmenu type=pen.
    // Меню по ней НЕ открываем (только без касания) — лишь гасим родное контекстное меню,
    // чтобы оно не мешало рисованию пером с зажатой кнопкой.
    const s = this.getSettings();
    if (s.trigger === "penbutton" && (e as PointerEvent).pointerType === "pen") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Гасим контекстное меню после barrel-триггера мышью на ПК.
    if (this.suppressContext) {
      this.suppressContext = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /** Срабатывание режима penbutton с антидребезгом. */
  private firePenButton(e: PointerEvent, action: () => void): void {
    if (e.timeStamp - this.lastPenButtonFire < 400) return;
    this.lastPenButtonFire = e.timeStamp;
    e.preventDefault();
    e.stopPropagation();
    action();
  }

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
