export type TriggerGesture = "penbutton" | "tapempty" | "barrel" | "longpress" | "doubletap";

export interface StylusMenuSettings {
  /** Жест, открывающий меню вставки. */
  trigger: TriggerGesture;
  /** Порог долгого нажатия, мс (для trigger="longpress"). */
  longPressMs: number;
  /** Окно двойного касания, мс (для trigger="doubletap"). */
  doubleTapMs: number;
  /** Допустимое движение пера, px, чтобы жест ещё считался "на месте" (тап, не штрих). */
  moveThresholdPx: number;
  /** Минимальный горизонтальный свайп пером с кнопкой (парение), px → undo/redo. */
  penSwipeMinPx: number;
  /** Зона у рамки блока (в координатах сцены), считающаяся "краем" для коннектора. */
  edgeMarginPx: number;
  /** Удалять случайную точку-артефакт, нарисованную пером при тапе (карандаш). */
  cleanupStrayDot: boolean;
  /** Показывать debug-оверлей с pointerType/buttons. */
  debugOverlay: boolean;
  /** Размеры по умолчанию для прямоугольника/эллипса/линии/стрелки. */
  defaultRectW: number;
  defaultRectH: number;
  /** Размеры по умолчанию для встроенной заметки (embeddable). */
  defaultEmbedW: number;
  defaultEmbedH: number;
}

export const DEFAULT_SETTINGS: StylusMenuSettings = {
  trigger: "penbutton",
  longPressMs: 450,
  doubleTapMs: 300,
  moveThresholdPx: 8,
  penSwipeMinPx: 60,
  edgeMarginPx: 16,
  cleanupStrayDot: true,
  debugOverlay: false,
  defaultRectW: 160,
  defaultRectH: 100,
  defaultEmbedW: 400,
  defaultEmbedH: 300,
};
