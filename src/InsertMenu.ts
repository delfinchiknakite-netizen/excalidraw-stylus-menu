export interface MenuItem {
  label: string;
  onClick?: () => void | Promise<void>;
  children?: MenuItem[];
}

/**
 * Простое всплывающее меню с крупными тач-целями, открывается у кончика пера.
 * Закрывается тапом вне меню. Пункты с children разворачивают подменю.
 */
export class InsertMenu {
  private overlay: HTMLElement | null = null;
  private menu: HTMLElement | null = null;
  private onClose: (() => void) | null = null;

  constructor(
    private anchor: { x: number; y: number },
    private root: MenuItem[],
  ) {}

  open(onClose?: () => void): void {
    this.onClose = onClose ?? null;
    this.overlay = document.body.createDiv({ cls: "esm-overlay" });
    this.overlay.addEventListener(
      "pointerdown",
      (e) => {
        if (e.target === this.overlay) {
          e.preventDefault();
          this.close();
        }
      },
      true,
    );
    this.menu = this.overlay.createDiv({ cls: "esm-menu" });
    this.render(this.root, false);
    this.position();
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.menu = null;
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private render(items: MenuItem[], isSub: boolean): void {
    const menu = this.menu;
    if (!menu) return;
    menu.empty();

    if (isSub) {
      const back = menu.createDiv({ cls: "esm-item esm-back" });
      back.setText("‹ Назад");
      back.addEventListener("pointerup", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.render(this.root, false);
        this.position();
      });
    }

    for (const it of items) {
      const row = menu.createDiv({ cls: "esm-item" });
      row.setText(it.label);
      row.addEventListener("pointerup", async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (it.children) {
          this.render(it.children, true);
          this.position();
          return;
        }
        this.close();
        try {
          await it.onClick?.();
        } catch (err) {
          console.error("[excalidraw-stylus-menu] insert failed", err);
        }
      });
    }
  }

  private position(): void {
    const m = this.menu;
    if (!m) return;
    const rect = m.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = this.anchor.x + 8;
    let y = this.anchor.y + 8;
    if (x + rect.width > vw - 8) x = vw - rect.width - 8;
    if (y + rect.height > vh - 8) y = vh - rect.height - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
  }
}
