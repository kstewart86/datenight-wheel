# 🎡 Date Night Wheel

A spinning wheel that settles the "where should we eat?" argument.

## Run it

```bash
node server.js
```

Then open <http://localhost:4321>. No dependencies, no install step — just Node.

Use a different port with `node server.js --port 8080`.

## Two wheels

- **🍽️ Dinner** — where to eat, from `data/restaurants.json`
- **🍸 Drinks** — which bar, from `data/bars.json`

Each entry has a `weight`: how many slices it gets on the wheel. Weight 1 is the
default; the bar wheel ships with Lobby and Bones at 8 each against Jack's and
Stay Home at 1, so the two favourites take ~44% each and the long shots ~6%.
Repeated slices are spread evenly around the wheel rather than stacked into one
wedge, so it reads like a roulette wheel instead of a pie chart. Heavier entries
claim their slots first on an even stride; the lighter one-offs then settle into
the widest remaining gaps, so they end up spaced through the dominant entry
instead of bunched next to each other.

## How the lists are saved

`data/restaurants.json` and `data/bars.json` are the source of truth. Adding,
editing, or removing a place through the site writes straight back to those
files, so the lists are permanent and live in the repo — commit them and they
travel with the project.

Opening `index.html` from disk, or visiting a static host like GitHub Pages,
still works, but edits are then kept in that browser's storage only; the page
says which mode it's in under the list.

## Features

- Weighted random spin with easing, ticking, and a confetti finish
- Add, rename, re-weight, and delete entries on either wheel
- Live odds per entry (`×8 · 44%`)
- Last 12 spins kept per wheel as history (stored per-browser)
- Sound toggle, keyboard `Space` to spin, responsive down to phone width

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page markup |
| `styles.css` | All styling |
| `app.js` | Wheel rendering, spin physics, sound, confetti, list + history UI |
| `server.js` | Static file server + JSON API that writes the data files |
| `data/restaurants.json` | The dinner list |
| `data/bars.json` | The bar list |
