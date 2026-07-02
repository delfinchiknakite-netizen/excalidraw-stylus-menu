// Минимальные типы для публичного API Excalidraw (ExcalidrawAutomate + imperative API),
// чтобы не использовать `any`. Описаны только те поля/методы, которыми пользуется плагин.
import { App, TFile } from "obsidian";

export interface ExBinding {
  elementId?: string;
  [key: string]: unknown;
}

export interface ExBoundElement {
  id: string;
  type?: string;
}

/** Элемент сцены Excalidraw (используемое подмножество полей). */
export interface ExElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  version?: number;
  versionNonce?: number;
  seed?: number;
  updated?: number;
  groupIds?: string[];
  boundElements?: ExBoundElement[] | null;
  containerId?: string | null;
  startBinding?: ExBinding | null;
  endBinding?: ExBinding | null;
  [key: string]: unknown;
}

export interface ExAppState {
  selectedElementIds?: Record<string, boolean>;
  zoom?: number | { value?: number };
  scrollX?: number;
  scrollY?: number;
  offsetLeft?: number;
  offsetTop?: number;
  [key: string]: unknown;
}

export interface UpdateSceneOpts {
  elements?: ExElement[];
  appState?: Partial<ExAppState>;
  commitToHistory?: boolean;
}

/** Imperative API, возвращаемый `ea.getExcalidrawAPI()`. */
export interface ExcalidrawApi {
  getSceneElements?: () => ExElement[];
  getAppState?: () => ExAppState;
  updateScene?: (opts: UpdateSceneOpts) => void;
  setActiveTool?: (opts: { type: string }) => void;
  selectElements?: (els: ExElement[]) => void;
}

export interface ArrowFormatting {
  startArrowHead?: string;
  endArrowHead?: string;
  startObjectId?: string;
  endObjectId?: string;
}

export interface TextFormatting {
  width?: number;
  box?: string;
  boxPadding?: number;
  textAlign?: string;
  autoResize?: boolean;
}

/** `window.ExcalidrawAutomate` из плагина Excalidraw (используемое подмножество). */
export interface ExcalidrawAutomate {
  reset: () => void;
  setView: (view: string) => void;
  getExcalidrawAPI: () => ExcalidrawApi;
  getViewElements?: () => ExElement[];
  addText: (x: number, y: number, text: string, formatting?: TextFormatting, id?: string) => string;
  addRect: (x: number, y: number, w: number, h: number) => string;
  addEllipse: (x: number, y: number, w: number, h: number) => string;
  addLine: (points: [number, number][]) => string;
  addArrow: (points: [number, number][], formatting?: ArrowFormatting, id?: string) => string;
  addImage: (x: number, y: number, file: TFile) => Promise<string>;
  addEmbeddable: (
    x: number,
    y: number,
    w: number,
    h: number,
    url?: string,
    file?: TFile,
  ) => string;
  addElementsToView: (
    repositionToCursor: boolean,
    save: boolean,
    newElementsOnTop: boolean,
  ) => Promise<boolean>;
  copyViewElementsToEAforEditing?: (els: ExElement[]) => void;
  connectObjects: (
    a: string,
    ca: string | null,
    b: string,
    cb: string | null,
    formatting?: ArrowFormatting,
  ) => void;
}

interface WindowWithEA {
  ExcalidrawAutomate?: ExcalidrawAutomate;
}

interface AppWithPlugins {
  plugins?: { plugins?: Record<string, { ea?: ExcalidrawAutomate }> };
}

/** Доступ к ExcalidrawAutomate: публичный глобал, иначе — экземпляр плагина Excalidraw. */
export function getEA(app: App): ExcalidrawAutomate | null {
  const fromWindow = (window as unknown as WindowWithEA).ExcalidrawAutomate;
  if (fromWindow) return fromWindow;
  const plugins = (app as unknown as AppWithPlugins).plugins?.plugins;
  return plugins?.["obsidian-excalidraw-plugin"]?.ea ?? null;
}

export function getApi(app: App): ExcalidrawApi | null {
  const ea = getEA(app);
  if (!ea) return null;
  try {
    return ea.getExcalidrawAPI();
  } catch {
    return null;
  }
}

/** Есть ли у элемента полноценный bbox (числовые x/y/width/height). */
export function hasBBox(el: ExElement): boolean {
  return (
    typeof el.x === "number" &&
    typeof el.y === "number" &&
    typeof el.width === "number" &&
    typeof el.height === "number"
  );
}

/** Текущее значение зума из appState (может быть числом или объектом). */
export function zoomValue(st: ExAppState): number {
  const z = st.zoom;
  if (typeof z === "number") return z;
  return z?.value ?? 1;
}
