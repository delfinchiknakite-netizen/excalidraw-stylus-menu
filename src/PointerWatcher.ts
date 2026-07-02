import { StylusMenuSettings } from "./settings";

export interface TriggerCtx {
  clientX: number;
  clientY: number;
}

type Trigger = (ctx: TriggerCtx) => void;
type Arm = () => void;
type Pointer = (clientX: number, clientY: number) => void;
type Debug = (info: string) => void;
type Action = () => void;

/**
 * Слушает pointer-события на элементе вью Excalidraw в capture-фазе (чтобы
 * опередить React-обработчики холста) и распознаёт жесты пера S Pen.
 *
 * Палец (pointerType="touch") никогда не перехватывается — он остаётся для
 * рисования и навигации. Перехватывается только перо (и мышь — для отладки на ПК).
 *
 * Единственный режим. Различаем ПАРЕНИЕ (перо над холстом, `!penDown`) и КАСАНИЕ:
 * - парение + боковая кнопка (`buttons&1` при парении): одиночный тап → onTrigger
 *   (меню вставки), двойной тап → onDoubleTap (копировать), удержание → onHold (вставить);
 * - касание без движения (тап) → onContactTap: плагин по hit-test открывает меню
 *   объекта/выделения либо меню вставки (по пустому месту).
 * onArm вызывается на касании — чтобы плагин снял снимок сцены до артефактной точки.
 */
export class PointerWatcher {
  private downX = 0;
  private downY = 0;
  private moved = false;
  private armed = false;
  /** Перо в контакте с полотном (после pointerdown с buttons&1). */
  private penDown = false;
  /** Парение: боковая кнопка зажата сейчас. */
  private penBtnActive = false;
  private penBtnStartX = 0;
  private penBtnStartY = 0;
  /** Кнопку при парении сдвинули за порог — это не тап и не удержание. */
  private penBtnMoved = false;
  /** Удержанием уже открыто действие — отпускание ничего не делает. */
  private penBtnHeldOpen = false;
  /** Таймер удержания кнопки (→ onHold). */
  private holdTimer: number | null = null;
  /** Таймер ожидания второго тапа (одиночный тап → onTrigger). */
  private tapTimer: number | null = null;
  /** Время предыдущего тапа кнопкой (для распознавания двойного). */
  private lastBtnTap = 0;

  constructor(
    private el: HTMLElement,
    private getSettings: () => StylusMenuSettings,
    private onTrigger: Trigger,
    private onArm: Arm,
    private onPointer: Pointer,
    private onDebug: Debug,
    private onDoubleTap: Action,
    private onHold: Trigger,
    private onContactTap: Trigger,
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
    this.clearHoldTimer();
    this.clearTapTimer();
  }

  /** Перо или мышь (мышь — чтобы тестировать на ПК). Палец игнорируем. */
  private penLike(e: PointerEvent): boolean {
    return e.pointerType === "pen" || e.pointerType === "mouse";
  }

  /**
   * Реагируем только на касания собственно полотна Excalidraw (<canvas>), а не
   * элементов интерфейса (панель инструментов, кнопки, меню).
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
      this.clearHoldTimer();
      this.clearTapTimer(); // отменяем отложенное меню от одиночного тапа кнопки
    }
    this.onPointer(e.clientX, e.clientY); // запоминаем позицию пера (для команды)
    if (!this.onDrawSurface(e)) return; // не трогаем кнопки/панели Excalidraw

    // Касание: взводим распознавание тапа (down+up без движения). Дальше onContactTap
    // сам решает — меню объекта/выделения или меню вставки (по пустому месту).
    if (e.buttons & 1) {
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.moved = false;
      this.armed = true;
      this.onArm(); // снимок сцены — убрать точку-артефакт от тапа
    }
  };

  private move = (e: PointerEvent): void => {
    if (this.penLike(e)) this.onPointer(e.clientX, e.clientY);
    const s = this.getSettings();

    // Кнопка во время ПАРЕНИЯ (без касания) приходит как buttons&1.
    // Одиночный тап → меню вставки; двойной тап → копировать; удержание → вставить.
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

  private up = (): void => {
    this.penDown = false;
    if (this.armed) {
      const wasTap = !this.moved;
      this.armed = false;
      if (wasTap) this.onContactTap({ clientX: this.downX, clientY: this.downY });
    }
  };

  private cancel = (): void => {
    this.clearHoldTimer();
    this.penDown = false;
    this.penBtnActive = false;
    this.armed = false;
  };

  private ctx = (e: Event): void => {
    // Кнопка S Pen в момент КАСАНИЯ приходит как contextmenu type=pen. Меню по ней не
    // открываем — лишь гасим родное контекстное меню, чтобы оно не мешало рисованию.
    if ((e as PointerEvent).pointerType === "pen") {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /**
   * Отпустили кнопку при парении без движения и без удержания: это тап.
   * Второй такой тап в окне doubleTapMs → onDoubleTap, иначе по тайм-ауту → onTrigger.
   */
  private handleBtnTap(e: PointerEvent): void {
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
  private startHoldTimer(): void {
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

  private clearHoldTimer(): void {
    if (this.holdTimer != null) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private clearTapTimer(): void {
    if (this.tapTimer != null) {
      window.clearTimeout(this.tapTimer);
      this.tapTimer = null;
    }
  }
}
