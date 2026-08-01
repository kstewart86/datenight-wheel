# 🎡 Date Night Wheel

A spinning wheel that settles the "where should we eat?" argument.

## Run it

```bash
node server.js
```

Then open <http://localhost:4321>. No dependencies, no install step — just Node.

Use a different port with `node server.js --port 8080`.

## How the list is saved

`data/restaurants.json` is the source of truth. Adding, renaming, or removing a
place through the site writes straight back to that file, so the list is
permanent and lives in the repo — commit it and it travels with the project.

Opening `index.html` directly from disk (without the server) still works, but
edits are then kept in browser storage only; the page says so under the list.

## Features

- Weighted-free random spin with easing, ticking, and a confetti finish
- Add, rename, and delete entries
- Last 12 spins kept as history (stored per-browser)
- Sound toggle, keyboard `Space` to spin, responsive down to phone width

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page markup |
| `styles.css` | All styling |
| `app.js` | Wheel rendering, spin physics, sound, confetti, list + history UI |
| `server.js` | Static file server + JSON API that writes `data/restaurants.json` |
| `data/restaurants.json` | The list itself |
