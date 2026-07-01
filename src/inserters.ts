import { App, FuzzySuggestModal, Modal, TFile } from "obsidian";
import { StylusMenuSettings } from "./settings";

const IMAGE_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif", "ico",
]);

function isImage(f: TFile): boolean {
  return IMAGE_EXT.has((f.extension || "").toLowerCase());
}

async function commit(ea: any): Promise<void> {
  // repositionToCursor=false (координаты уже точные), save=true, newElementsOnTop=true
  await ea.addElementsToView(false, true, true);
}

/**
 * Коммит + выделение созданного элемента по id. На проверяемом устройстве только что
 * добавленный через EA элемент иногда тут же исчезал; выделение его «закрепляет»
 * (так же ведёт себя штатная команда Excalidraw «Embed note»).
 */
async function commitSelect(ea: any, id: string | undefined): Promise<void> {
  await ea.addElementsToView(false, true, true);
  if (!id) return;
  try {
    const api = ea.getExcalidrawAPI?.();
    const el = ea.getViewElements?.().find((e: any) => e.id === id);
    if (api && el) api.selectElements([el]);
  } catch {
    /* ignore */
  }
}

export async function insertText(ea: any, app: App, x: number, y: number): Promise<void> {
  const text = await promptText(app, "Текст");
  if (text == null) return;
  ea.reset();
  ea.setView("active");
  const id = ea.addText(x, y, text, { autoResize: true });
  await commitSelect(ea, id);
}

export async function insertSticker(ea: any, app: App, x: number, y: number): Promise<void> {
  const text = await promptText(app, "Текст стикера");
  if (text == null) return;
  ea.reset();
  ea.setView("active");
  const id = ea.addText(x, y, text.trim() === "" ? " " : text, {
    box: "box",
    textAlign: "center",
    boxPadding: 12,
  });
  await commitSelect(ea, id);
}

export type ShapeKind = "rect" | "ellipse" | "arrow" | "line";

export async function insertShape(
  ea: any,
  kind: ShapeKind,
  x: number,
  y: number,
  s: StylusMenuSettings,
): Promise<void> {
  ea.reset();
  ea.setView("active");
  const w = s.defaultRectW;
  const h = s.defaultRectH;
  let id: string | undefined;
  switch (kind) {
    case "rect":
      id = ea.addRect(x, y, w, h);
      break;
    case "ellipse":
      id = ea.addEllipse(x, y, w, h);
      break;
    case "arrow":
      id = ea.addArrow([[x, y], [x + w, y]], { endArrowHead: "arrow" });
      break;
    case "line":
      id = ea.addLine([[x, y], [x + w, y]]);
      break;
  }
  await commitSelect(ea, id);
}

export async function insertEmbedOrImage(
  ea: any,
  app: App,
  x: number,
  y: number,
  s: StylusMenuSettings,
): Promise<void> {
  const file = await pickFile(app);
  if (!file) return;
  ea.reset();
  ea.setView("active");

  if (isImage(file)) {
    await ea.addImage(x, y, file);
    await commit(ea);
    return;
  }

  // Заметка (.md) — встраиваемый блок. ЯВНО передаём ссылку как url (5-й аргумент),
  // как это делает штатная команда Excalidraw «Embed note». Если оставить url пустым
  // и полагаться на авто-вывод ссылки из файла, встройка может тут же исчезнуть.
  const id = ea.addEmbeddable(x, y, s.defaultEmbedW, s.defaultEmbedH, `[[${file.path}]]`, undefined);
  await commit(ea);
  // Выделяем вставленный блок — так же делает штатная команда (заодно «закрепляет» его).
  try {
    const api = ea.getExcalidrawAPI?.();
    const el = ea.getViewElements?.().find((e: any) => e.id === id);
    if (api && el) api.selectElements([el]);
  } catch {
    /* ignore */
  }
}

/* ---------- модальные окна ---------- */

function promptText(app: App, title: string): Promise<string | null> {
  return new Promise((resolve) => new TextPromptModal(app, title, resolve).open());
}

class TextPromptModal extends Modal {
  private resolved = false;

  constructor(app: App, private heading: string, private cb: (v: string | null) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl("textarea", { cls: "esm-input" });
    input.rows = 3;
    window.setTimeout(() => input.focus(), 0);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.done(input.value);
      }
    });
    const row = this.contentEl.createDiv({ cls: "esm-modal-buttons" });
    const ok = row.createEl("button", { text: "Вставить" });
    ok.addClass("mod-cta");
    ok.addEventListener("click", () => this.done(input.value));
    const cancel = row.createEl("button", { text: "Отмена" });
    cancel.addEventListener("click", () => this.done(null));
  }

  private done(v: string | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.cb(v);
    this.close();
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.cb(null);
    }
    this.contentEl.empty();
  }
}

function pickFile(app: App): Promise<TFile | null> {
  return new Promise((resolve) => new FilePickModal(app, resolve).open());
}

class FilePickModal extends FuzzySuggestModal<TFile> {
  private resolved = false;

  constructor(app: App, private cb: (f: TFile | null) => void) {
    super(app);
    this.setPlaceholder("Выберите изображение или .md заметку для вставки");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => isImage(f) || f.extension === "md");
  }

  getItemText(f: TFile): string {
    return f.path;
  }

  onChooseItem(f: TFile): void {
    this.resolved = true;
    this.cb(f);
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.cb(null);
    }
  }
}
