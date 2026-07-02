# Excalidraw Stylus Menu (S Pen)

Companion plugin for [Obsidian Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin)
that makes drawing with a stylus (Samsung S Pen) faster.

- **Open an insert menu** at the pen tip — by tapping empty canvas or by a single tap of the pen's
  side button while hovering. Insert text, a sticker (boxed text), shapes (rectangle / ellipse /
  arrow / line), or an embedded note / image.
- **Tap an object** to get quick actions: draw an arrow to another object, add a sticker, duplicate
  or delete. Tap a multi-selection to duplicate / delete the whole group.
- **Side-button gestures while hovering:** double tap → copy the selection, hold → paste at the pen tip.

It is a standalone plugin — it does not fork Excalidraw; it calls Excalidraw's public
`window.ExcalidrawAutomate` API. Copy/paste and duplicate use that API directly (no system clipboard).
The finger is never intercepted, so touch drawing and navigation keep working. Requires the Excalidraw
plugin to be installed and enabled.

Русское описание ниже. / Russian description follows.

---

Плагин-компаньон для [Obsidian Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin).
Делает рисование пером (Samsung S Pen) удобнее:

- **Жест-триггер пером → меню вставки блока** в точке касания: Текст, Стикер (текст в рамке),
  Фигуры (прямоугольник / эллипс / стрелка / линия), Встроенная заметка или изображение.
- **Касание у края блока → режим коннектора:** следующий тап по другому блоку рисует стрелку
  между ними.

Это отдельный плагин — он НЕ форкает Excalidraw, а вызывает его публичный `window.ExcalidrawAutomate`.

## Жесты

**Основное меню вставки** (Текст, Стикер, Фигуры, Заметка/изображение) открывается **двумя способами**:

- **тап пером по пустому месту** холста (касание без движения);
- **одиночный тап боковой кнопкой S Pen** при парении (перо над холстом, без касания).

Ещё жесты боковой кнопкой при парении:

- **двойной тап кнопкой** → **копировать** выделенные элементы;
- **удержание кнопки** (~0.45 c) → **вставить** у кончика пера.

Копирование/вставка идут через API Excalidraw (внутренний буфер плагина + `updateScene`, с новыми
id и сохранением связей) — надёжно, без системного буфера. Те же действия доступны командами
«Копировать выделенное (стилус)» / «Вставить (стилус)» (можно повесить на хоткей). Касание пера к
экрану с движением — обычное рисование Excalidraw. Палец не перехватывается совсем.

**Тап пером по фигуре** → меню действий над фигурой: **стрелка к объекту…** (затем тапните целевой
объект — стрелка свяжет оба), стикер на объект, дублировать, удалить. **Тап по выделению из
нескольких объектов** → меню над всем набором: дублировать / удалить. Стрелки/линии в распознавании
тапа не участвуют (большой прямоугольник габаритов). Подпись делается стикером (текст в рамке) —
обычный «голый» текст на этом устройстве Excalidraw не сохраняется. Меню действий по тапу
отключается в настройках; при этом тап по любому месту открывает основное меню.

Артефактная точка, которую карандаш может оставить, удаляется автоматически (отключается в настройках).

## Кнопка на S Pen — как она ловится

На Samsung боковая кнопка **не приходит** как `buttons=2`/`buttons=3`, но всплывает иначе (подтверждено
через Debug-оверлей):

- **при парении** (перо над холстом, без касания) + кнопка → `pointermove` с `buttons=1`
  (обычное парение даёт `buttons=0`);
- **в момент касания** + кнопка → событие `contextmenu` с `pointerType="pen"`.

Жест `penbutton` ловит оба пути (с антидребезгом, чтобы не сработать дважды) и гасит родное
контекстное меню. **BLE-кнопка «Air actions» (двойной клик) вебу недоступна** — идёт через
Bluetooth-HID мимо WebView, в DOM не приходит; используйте короткое нажатие кнопки.

Если на вашем устройстве кнопка не всплывает нигде — есть мост: команда **«Открыть меню вставки
(стилус)»** (повесьте горячую клавишу в *Настройки → Горячие клавиши*), а автоматизатор
(**Tasker/MacroDroid**) ловит нажатие S Pen-кнопки и шлёт эту клавишу.

## Сборка

```bash
cd excalidraw-stylus-menu
npm install
npm run build      # → main.js
```

Как плагин устроен внутри (для разработки) — см. [ARCHITECTURE.md](ARCHITECTURE.md).

## Установка

Скопируйте `main.js`, `manifest.json`, `styles.css` в папку вашего хранилища:

```
<vault>/.obsidian/plugins/excalidraw-stylus-menu/
```

Включите плагин в *Настройки → Сторонние плагины*. На телефон попадёт через Obsidian Sync /
git / облако (та же папка) или [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Известные ограничения (v0.1)

- Стрелка-коннектор рисуется между центрами блоков; точная привязка концов
  (`startObjectId`/`endObjectId`) зависит от версии Excalidraw и может не сработать —
  тогда стрелка просто рисуется по центрам.
- Жесты «долгое нажатие» / «двойное касание» могут оставить короткий штрих от пера,
  т.к. рисование начинается до распознавания жеста. Боковая кнопка от этого свободна.
