# Архитектура плагина Excalidraw Stylus Menu

> Документ описывает, как плагин устроен внутри. **Поддерживается вместе с кодом** —
> при любом изменении поведения/структуры обновляйте соответствующий раздел.
> Пользовательское описание жестов — в [README.md](README.md).

## Назначение

Компаньон к [Obsidian Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin):
делает работу пером Samsung S Pen удобной — жесты боковой кнопкой открывают меню вставки блоков,
переключают операции, а тап по объекту даёт контекстные действия. Плагин **не форкает** Excalidraw,
а вызывает его публичный `window.ExcalidrawAutomate` (EA) и imperative API (`getExcalidrawAPI()`).

## Ключевые ограничения устройства (почему всё так)

Подтверждено на Samsung + Obsidian WebView:

- **Боковая кнопка S Pen НЕ приходит** как `buttons=2/3`. Она всплывает только:
  - при **парении** (перо над холстом, без касания) + кнопка → `pointermove` с `buttons=1`
    (обычное парение = `buttons=0`); **это единственный надёжный сигнал**;
  - в момент **касания** + кнопка → событие `contextmenu` с `pointerType="pen"` — **на практике
    не отлавливается стабильно**, поэтому на него ничего не завязано (только гасим родное меню).
- **BLE «Air actions»** (двойной клик кнопки) идут через Bluetooth-HID мимо WebView — в DOM не приходят.
- **«Голый» текстовый элемент** (`addText` без рамки) на устройстве **не сохраняется** даже при
  выделении — используем стикер (текст в рамке-контейнере).
- Любой созданный через EA элемент может **исчезнуть**, если его не **выделить** сразу после
  `addElementsToView` (см. `commitSelect`).

Вывод: вся жестовая логика построена на **парении + кнопка** и на imperative API, а не на касании/клавишах.

## Структура файлов

```
src/
  main.ts           — плагин: onload, синхронизация watcher'ов, все действия и меню, настройки
  PointerWatcher.ts — распознавание жестов пера на одном вью Excalidraw (автомат состояний)
  InsertMenu.ts     — простое всплывающее меню (список у кончика пера, поддерживает подменю)
  inserters.ts      — вставка через EA: текст, стикер, фигуры, заметка/изображение (+ модалки)
  connector.ts      — режим стрелки-коннектора у края блока + геометрия (contains/nearEdge)
  settings.ts       — интерфейс настроек и значения по умолчанию
esbuild.config.mjs  — сборка в main.js
```

## Мост к Excalidraw (`main.ts`)

- `getEA(app)` → `window.ExcalidrawAutomate` (или `plugins["obsidian-excalidraw-plugin"].ea`).
- `getApi(app)` → `ea.getExcalidrawAPI()` (imperative API: `getSceneElements`, `getAppState`,
  `updateScene`, `setActiveTool`, `selectElements`, …).
- `genId()` — nanoid-подобный id для клонов; `hasBBox(el)` — есть ли у элемента x/y/width/height.

### Проверенные факты API (при правках сверяться!)

- `ea.addText(x, y, text, {width?, box?, boxPadding?, autoResize?, wrapAt?})` → id.
  `box: "box"|"ellipse"|"diamond"` создаёт рамку-контейнер вокруг текста (стикер).
- `ea.addArrow(points, {startObjectId?, endObjectId?, startArrowhead?, endArrowhead?, elbowed?}, id?)`.
- `ea.addEmbeddable(x, y, w, h, url, file?, custom?)` — **при вставке .md url задавать ЯВНО `[[path]]`**,
  иначе встройка исчезает.
- `ea.connectObjects(idA, connA, idB, connB, {endArrowHead})` — соединяет два объекта стрелкой с
  привязкой; **требует, чтобы оба объекта были в EA** (`ea.copyViewElementsToEAforEditing([a, b])`),
  и **отказывается** соединять line/arrow/freedraw.
- `ea.addElementsToView(repositionToCursor, save, newElementsOnTop)` — коммит EA-элементов во вью.
- Свойства элемента: `startArrowhead`/`endArrowhead`, `strokeStyle`, `strokeWidth`, `groupIds`,
  `boundElements`, `containerId`, `startBinding`/`endBinding`.

## Жизненный цикл и watcher'ы

`onload` регистрирует команды (`open-insert-menu`, `copy-selection`, `paste-clipboard`,
`toggle-debug-overlay`) и подписывается на `active-leaf-change`/`layout-change`. `syncWatchers()`
навешивает по одному `PointerWatcher` на `contentEl` каждого открытого вью Excalidraw и снимает с
закрытых. Watcher слушает pointer-события в **capture-фазе**, чтобы опережать обработчики холста.

## Распознавание жестов (`PointerWatcher.ts`)

Дефолтный режим — **`penbutton`**. Только `pointerType==="pen"` (и `mouse` для отладки на ПК),
палец никогда не перехватывается. Разделяем **парение** (`!penDown`) и **касание** (`penDown`).

### Жесты кнопкой при ПАРЕНИИ (без касания) — автомат
Состояние: `penBtnActive`, `penBtnMoved`, `penBtnHeldOpen`, таймеры `holdTimer`/`tapTimer`, `lastBtnTap`.
- **нажатие кнопки** (`buttons` 0→1 при парении): запоминаем старт, запускаем `holdTimer(longPressMs)`.
- **движение за `moveThresholdPx`**: это не тап и не удержание — гасим таймер удержания.
- **удержание `longPressMs` на месте** → `onHold(ctx)` → **вставить** (см. paste).
- **отпускание без движения/удержания** → `handleBtnTap`:
  - второй тап в окне `doubleTapMs` → `onDoubleTap` → **копировать** выделенное;
  - иначе по тайм-ауту `doubleTapMs` → `onTrigger` → **меню вставки** (ждём возможный второй тап).

### Жесты при КАСАНИИ
- Обычное касание = рисование Excalidraw (не мешаем).
- Если `objectTapMenu` включён: касание взводит распознавание тапа (`armed`, снимок сцены `onArm`);
  тап без движения → `onContactTap(ctx)` → `main.onObjectTap` (см. ниже).
- `contextmenu` с `pointerType==="pen"` — только `preventDefault` (гасим родное меню), меню не открываем.

Прочие режимы триггера (в настройках, legacy): `tapempty`, `longpress`, `doubletap`, `barrel`.

## Меню (`InsertMenu.ts`)

Всплывающий список у точки `ctx`, крупные тач-цели, закрывается тапом вне. Пункт `{label, onClick}`
или `{label, children}` (подменю). Позиционируется в пределах экрана. Закрывает себя перед запуском
`onClick` (чтобы не блокировать модалки).

### Три меню (все в `main.ts`)
1. **Меню вставки** (`openInsertMenu`) — Текст, Стикер, Фигуры›, Заметка/изображение.
   Открывается **только** одиночным тапом кнопки при парении (`onTrigger`) или командой.
   `onTrigger` сперва проверяет коннектор у края блока (`ConnectorController`), иначе — меню.
2. **Меню фигуры** (`onObjectTap` → `openObjectMenu`/`shapeMenuItems`) — тап пером по одиночной
   фигуре: «Стрелка к объекту…» (двухтаповый режим, `pendingArrowFrom` → `connectArrow`),
   «Стикер на объект», «Дублировать», «Удалить». **Стрелки/линии/freedraw исключены из хит-теста**
   (большой bbox по диагонали ловил бы пустые тапы).
3. **Меню выделения** (`openSelectionMenu`) — тап по МНОЖЕСТВЕННОМУ выделению (`>1` элемента) и
   попадание по выделенной **нелинейной** фигуре: «Дублировать (N)» / «Удалить (N)» для всего набора.
   Имеет приоритет над меню фигуры. Одиночное выделение → меню фигуры (там тоже есть dup/del).

Порядок в `onObjectTap`: считаем `hit` (верхняя нелинейная фигура под точкой) → обработка
`pendingArrowFrom` → меню выделения (`>1` + по фигуре) → меню фигуры (`hit`) → иначе ничего.

## Действия

- **copy/paste**: внутренний буфер `clipboard` (глубокие копии). `pasteClipboard` клонирует через
  `cloneElements(list, dx, dy)` (новые id, ремап `groupIds`/`boundElements`/`containerId`/`*Binding`
  внутри набора), смещает к перу, `updateScene(commitToHistory:true)` + выделяет.
- **duplicate/delete набора**: `duplicateElements` (тот же `cloneElements`), `deleteElements`
  (убирает элементы + их bound-text).
- **connectArrow(from, to)**: `copyViewElementsToEAforEditing([from,to])` → `connectObjects` → commit.
- **вставка** (`inserters.ts`): `commitSelect(ea, id)` = `addElementsToView` + `selectElements([id])`
  (выделение «закрепляет» элемент, иначе исчезает). Заметка .md — явный `[[path]]` как url.

## Очистка артефактов

Тап карандашом оставляет точку. `snapshotScene`/`onArm` снимает id элементов до жеста;
`scheduleCleanup` через 80 мс удаляет новые элементы типа `STRAY_TYPES` размером `<STRAY_MAX_PX`.
Управляется настройкой `cleanupStrayDot`.

## Настройки (`settings.ts`)

`trigger` (дефолт `penbutton`), `longPressMs`, `doubleTapMs`, `moveThresholdPx`, `edgeMarginPx`,
`cleanupStrayDot`, `objectTapMenu`, `debugOverlay`, размеры фигур/встройки по умолчанию.

## Диагностика

`debugOverlay` (команда/настройка) вешает глобальный сниффер (`pointermove`/`up`/`contextmenu`/
`auxclick`/`keydown`) и рисует оверлей с последними событиями — чтобы видеть, в каком событии
всплывает кнопка S Pen на конкретном устройстве.

## Сборка и релиз

- `npm run build` → `tsc -noEmit` + esbuild → `main.js`.
- Версия: `npm version <x.y.z> --no-git-tag-version` (хук `version-bump.mjs` правит
  `manifest.json`/`versions.json`), затем `npm run build`, commit, `git tag`, `git push --tags`.
- GitHub Actions по тегу собирает релиз с `main.js`/`manifest.json`/`styles.css`. Установка на
  телефон — через BRAT по адресу репозитория.

## Известные ограничения

- Меню фигуры недоступно для стрелок/линий (исключены из хит-теста намеренно).
- «Голый» текст не используется — только стикер.
- Свежесозданный/вставленный элемент авто-выделяется, поэтому тап по нему открывает меню выделения
  (если выделено >1) либо меню фигуры; чтобы точно попасть в меню фигуры, снимите выделение (тап по пустому).
- Undo/redo пером убраны (не работали на устройстве); при необходимости — мост Tasker/MacroDroid на команду.
