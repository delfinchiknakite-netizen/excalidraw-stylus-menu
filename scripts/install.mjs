import { copyFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// Копирует собранный плагин в папку плагинов хранилища Obsidian.
// Путь берётся из переменной окружения OBSIDIAN_PLUGIN_DIR — это путь до
// <vault>/.obsidian/plugins (без имени плагина). Пример:
//   OBSIDIAN_PLUGIN_DIR="/Users/me/Vault/.obsidian/plugins" npm run install-to-vault
const base = process.env.OBSIDIAN_PLUGIN_DIR;
if (!base) {
  console.error("Задайте OBSIDIAN_PLUGIN_DIR=<vault>/.obsidian/plugins");
  process.exit(1);
}

const dest = join(base, "excalidraw-stylus-menu");
mkdirSync(dest, { recursive: true });

for (const f of ["main.js", "manifest.json", "styles.css"]) {
  if (!existsSync(f)) {
    console.error(`Нет файла ${f}. Сначала: npm run build`);
    process.exit(1);
  }
  copyFileSync(f, join(dest, f));
  console.log(`→ ${join(dest, f)}`);
}
console.log("Готово. Перезагрузите плагин в Obsidian.");
