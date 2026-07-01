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
  /** Парение: боковая кнопка зажата сейчас. */
  private penBtnActive = false;
  private penBtnStartX = 0;
  private penBtnStartY = 0;
  /** Кнопку при парении сдвинули за порог — это не тап и не удержание. */
  private penBtnMoved = false;
  /** Меню инструментов уже открыто этим удержанием — отпускание ничего не делает. */
  private penBtnHeldOpen = false;
  /** Таймер удержания кнопки (→ меню инструментов). */
  private holdTimer: number | null = null;
  /** Таймер ожидания второго тапа (одиночный тап → меню вставки). */
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
    this.clearTimer();
    this.clearHoldTimer();
    this.clearTapTimer();
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
      this.clearTapTimer(); // отменяем отложенное меню вставки от одиночного тапа кнопки
    }
    this.onPointer(e.clientX, e.clientY); // запоминаем позицию пера (для команды)
    if (!this.onDrawSurface(e)) return; // не трогаем кнопки/панели Excalidraw

    if (s.trigger === "penbutton") {
      // Жесты кнопкой — только при ПАРЕНИИ (см. move). Сбрасываем «парящее» состояние.
      this.penBtnActive = false;
      this.clearHoldTimer();
      // Касание: взводим распознавание тапа по объекту (down+up без движения).
      if (e.buttons & 1 && s.objectTapMenu) {
        this.downX = e.clientX;
        this.downY = e.clientY;
        this.moved = false;
        this.armed = true;
        this.onArm(); // снимок сцены — убрать точку-артефакт от тапа
      }
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
    // Одиночный тап → меню вставки; двойной тап → копировать; удержание → вставить.
    if (s.trigger === "penbutton" && e.pointerType === "pen" && !this.penDown) {
      const pressed = !!(e.buttons & 1);
      if (pressed && !this.penBtnActive) {
        // нажали кнопку
        this.penBtnActive = true;
        this.penBtnMoved = false;
        this.penBtnHeldOpen = false;
        this.penBtnStartX = e.clientX;
        this.penBtnStartY = e.clientY;
        this.startHoldTimer();
      } else if (pressed && this.penBtnActive && !this.penBtnHeldOpen) {
        // держим: если ушли за порог — это не тап и не удержание (отменяем меню инструментов)
        const dist = Math.hypot(e.clientX - this.penBtnStartX, e.clientY - this.penBtnStartY);
        if (dist > s.moveThresholdPx) {
          this.penBtnMoved = true;
          this.clearHoldTimer();
        }
      } else if (this.penBtnActive && !pressed) {
        // отпустили кнопку
        this.penBtnActive = false;
        this.clearHoldTimer();
        if (!this.penBtnHeldOpen && !this.penBtnMoved) this.handleBtnTap(e);
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
      if (wasTap) {
        const ctx = { clientX: this.downX, clientY: this.downY };
        // В penbutton контактный тап ведём в меню действий над объектом (по hit-test),
        // в остальных режимах — обычный триггер (меню/коннектор).
        if (this.getSettings().trigger === "penbutton") this.onContactTap(ctx);
        else this.onTrigger(ctx);
      }
    }
  };

  private cancel = (): void => {
    this.clearTimer();
    this.clearHoldTimer();
    this.penDown = false;
    this.penBtnActive = false;
    this.armed = false;
  };

  private ctx = (e: Event): void => {
    // penbutton: кнопка S Pen в момент КАСАНИЯ приходит как contextmenu type=pen.
    // Меню по ней НЕ открываем (только при парении) — лишь гасим родное контекстное меню,
    // чтобы оно не мешало рисованию пером.
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

  /**
   * Отпустили кнопку при парении без движения и без удержания: это тап.
   * Второй такой тап в окне doubleTapMs → перо⇄ластик, иначе по тайм-ауту → меню вставки.
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

  /** Кнопку держат на месте дольше longPressMs → меню инструментов у кончика пера. */
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
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private clearTapTimer(): void {
    if (this.tapTimer != null) {
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
    }
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
