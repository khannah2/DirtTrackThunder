# Dirt Track Thunder — Career

First-person dirt **late model** career racer: drive as **CJ Permann #37**, race teammate **Dylan Permann #777** (Permann Diesel / Colorado Pawn).

**Project path:** `H:\My Drive\PersonalAIProjects\DirtTrackThunder`

## Play online (free hosting)

### Netlify (primary)

**https://dirt-track-thunder.netlify.app**

Admin: https://app.netlify.com/projects/dirt-track-thunder

**Online features (Netlify Functions + Blobs):**
- Global **High Scores** board
- **Head to Head** rooms (create code → friend joins → both race → fastest time wins)

Redeploy from this folder:

```powershell
npm install
netlify deploy --prod --dir .
```

### GitHub Pages (backup)

**https://khannah2.github.io/DirtTrackThunder/**

Repo: https://github.com/khannah2/DirtTrackThunder

```powershell
git add -A
git commit -m "Update game"
git push
```

### Local

1. Double-click **`play.bat`**
2. Open **http://localhost:8765** in Chrome or Edge

## Features

- **Career mode** — cash, championship points, season events
- **CJ Permann #37** — pit and race photos in `assets/cars/`
- **Dylan Permann #777** — real car photo in the rival field
- **Rival field** — choose which late models you race against
- **Upgrades** — engine, tires, suspension, brakes, aero
- **Photo-real WebGL** — Three.js night oval, bloom, flood lights, photo-skinned late models
- **First-person** — cockpit overlay + 3D hood, dirt FP camera
- **Sound** — procedural engine, tire scrub, impacts, crowd (Web Audio)

## Controls (race)

| Key | Action |
|-----|--------|
| W / ↑ | Throttle |
| S / ↓ | Brake / reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| C | Look back |
| Esc | Quit to garage |

## Save data

Career is stored in the browser (`localStorage` key `dirtTrackThunder_career_v1`).

## Files

- `index.html` / `style.css` — UI shells
- `js/main.js` — screens & career flow
- `js/career.js` — money, points, upgrades, events
- `js/characters.js` — #37 + rival roster
- `js/race.js` — first-person race engine
- `js/audio.js` — Web Audio SFX
- `assets/cars/` — your sponsored car photos
