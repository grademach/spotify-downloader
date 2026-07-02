# AGENTS.md

## Project Notes

- This repo contains a Spicetify extension and a Python companion service.
- Use `npm run build-local` for extension validation; `npm run build` writes to the local Spicetify extensions directory.
- Run `npx tsc --noEmit` after TypeScript changes.
- Run `python3 -m py_compile companion-service.py` after companion service changes.
- The extension's download actions use `(SD)` to avoid confusion with Spotify's native Premium/offline Download button.
- Keep the companion service API backward-compatible unless the extension and docs are updated together.
