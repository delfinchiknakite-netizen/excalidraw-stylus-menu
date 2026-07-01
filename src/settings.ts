export type TriggerGesture = "penbutton";

export interface StylusMenuSettings {
  /** Режим жестов (единственный — penbutton). Оставлен для совместимости с сохранёнными данными. */
  trigger: TriggerGesture;
  /** Порог удержания кнопки при парении, мс (удержание → вставить). */
  longPressMs: number;
  /** Окно двойного тапа кнопкой, мс (двойной тап → копировать); также задержка одиночного тапа. */
  doubleTapMs: number;
  /** Допустимое движение пера, px, чтобы жест ещё считался "на месте" (тап, не штрих). */
  moveThresholdPx: number;
  /** Зона у рамки блока (в координатах сцены), считающаяся "краем" для коннектора. */
  edgeMarginPx: number;
  /** Удалять случайную точку-артефакт, нарисованную пером при тапе (карандаш). */
  cleanupStrayDot: boolean;
  /** Тап пером по объекту → всплывающее меню действий над объектом. */
  objectTapMenu: boolean;
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
  edgeMarginPx: 16,
  cleanupStrayDot: true,
  objectTapMenu: true,
  debugOverlay: false,
  defaultRectW: 160,
  defaultRectH: 100,
  defaultEmbedW: 400,
  defaultEmbedH: 300,
};
