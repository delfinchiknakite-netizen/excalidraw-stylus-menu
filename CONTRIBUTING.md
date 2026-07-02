# Contributing

Thanks for your interest in improving Excalidraw Stylus Menu.

## Development

```bash
npm install
npm run dev     # esbuild watch → main.js
npm run build   # type-check + production build
```

To test in a vault, copy `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/excalidraw-stylus-menu/`, or use:

```bash
OBSIDIAN_PLUGIN_DIR="<vault>/.obsidian/plugins" npm run install-to-vault
```

The [Excalidraw plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin) must be installed
and enabled — this plugin drives Excalidraw through its public `window.ExcalidrawAutomate` API.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the plugin is structured (gesture recognition, the
three menus, and the Excalidraw API integration).

## Pull requests

- Keep `npm run build` clean (type-check must pass).
- Match the existing code style; keep changes focused.
- Update `README.md` / `ARCHITECTURE.md` when behavior changes.

## Bugs and features

Please open an issue on the GitHub repository with steps to reproduce (and, for stylus issues, the
device model and the Debug overlay log).
