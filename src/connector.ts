import { Notice } from "obsidian";
import { StylusMenuSettings } from "./settings";

interface El {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConnectorInput {
  ea: any;
  api: any;
  sceneX: number;
  sceneY: number;
  elements: El[];
  settings: StylusMenuSettings;
}

/** Точка в зоне ±margin от рамки блока (рядом с границей, снаружи или внутри). */
export function nearEdge(px: number, py: number, el: El, margin: number): boolean {
  const inOuter =
    px >= el.x - margin &&
    px <= el.x + el.width + margin &&
    py >= el.y - margin &&
    py <= el.y + el.height + margin;
  const inInner =
    px >= el.x + margin &&
    px <= el.x + el.width - margin &&
    py >= el.y + margin &&
    py <= el.y + el.height - margin;
  return inOuter && !inInner;
}

/** Точка внутри блока (с небольшим допуском). */
export function contains(px: number, py: number, el: El, margin: number): boolean {
  return (
    px >= el.x - margin &&
    px <= el.x + el.width + margin &&
    py >= el.y - margin &&
    py <= el.y + el.height + margin
  );
}

/**
 * Состояние режима стрелки-коннектора.
 * Первый триггер у края блока → запоминаем источник.
 * Следующий триггер по другому блоку → рисуем стрелку с привязкой.
 */
export class ConnectorController {
  private sourceId: string | null = null;

  /** @returns true, если событие обработано коннектором (меню открывать не нужно). */
  handleTrigger(input: ConnectorInput): boolean {
    const { sceneX, sceneY, elements, settings } = input;
    const margin = settings.edgeMarginPx;

    if (this.sourceId == null) {
      const edgeEl = elements.find((el) => nearEdge(sceneX, sceneY, el, margin));
      if (!edgeEl) return false; // не у края — пусть откроется меню вставки
      this.sourceId = edgeEl.id;
      new Notice("Коннектор: коснитесь второго блока (пустое место — отмена)");
      return true;
    }

    const src = elements.find((el) => el.id === this.sourceId);
    const tgt = elements.find(
      (el) => el.id !== this.sourceId && contains(sceneX, sceneY, el, margin),
    );
    this.sourceId = null;
    if (!src || !tgt) {
      new Notice("Коннектор отменён");
      return true;
    }
    void this.drawArrow(input.ea, src, tgt);
    return true;
  }

  reset(): void {
    this.sourceId = null;
  }

  private async drawArrow(ea: any, a: El, b: El): Promise<void> {
    try {
      ea.reset();
      ea.setView("active");
      const ca: [number, number] = [a.x + a.width / 2, a.y + a.height / 2];
      const cb: [number, number] = [b.x + b.width / 2, b.y + b.height / 2];
      try {
        // Привязка концов к блокам (если поддерживается версией Excalidraw).
        ea.addArrow([ca, cb], { endArrowHead: "arrow", startObjectId: a.id, endObjectId: b.id });
      } catch {
        // Деградация: просто стрелка по центрам без привязки.
        ea.addArrow([ca, cb], { endArrowHead: "arrow" });
      }
      await ea.addElementsToView(false, true, true);
    } catch (e) {
      console.error("[excalidraw-stylus-menu] arrow failed", e);
      new Notice("Не удалось нарисовать стрелку");
    }
  }
}
