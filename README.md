# NEBULA DRIVE

A neon arcade roadster flight simulator built with Three.js r161 (vendored) and vanilla JavaScript.

## Gameplay

- **Endless** — survive as long as you can, collect boost gates, outrun the difficulty curve
- **Campaign** — 20 hand‑crafted trials across 4 curved track layouts (Flow / Zigzag / Ring / Tunnel)
- **Custom** — create your own track length, layout, traffic density, road glow and car paint

## Controls

| Key / Touch | Action |
|---|---|
| ← / A / Left | Steer left |
| → / D / Right | Steer right |
| W / Up / Accel | Accelerate |
| S / Down / Brake | Brake / reverse |
| Shift / Nitro | Nitro boost (fills when not boosting) |
| R | Rocket (unlock at 1.0 km in endless / finish a trial) |
| M | Toggle sound |
| ESC | Pause / resume / return to menu |
| Touch buttons | Same actions on mobile |

## Feature List

- ✅ Vendored Three.js r161 IIFE bundle — runs offline from `file://`
- ✅ Curved tracks via ordered segment queue (`trackAt(z)`) with sinusoidal heading steering
- ✅ Instanced road + city meshes — ~12 draw calls instead of ~500
- ✅ Pooled obstacles with swept collision (crossing `prevZ`/`z` at car z‑plane) — no tunnelling at rocket speed
- ✅ Explicit `paintMat` — no heuristic recolouring
- ✅ Rocket protocol (unlock at 1.0 km, 4.6 s boost)
- ✅ WebAudio synthesized engine, gate tones, impact flashes, transform SFX
- ✅ Bloom‑free neon polish: sky sphere, orbital planet ring, speed streaks, camera shake / FOV shift
- ✅ HUD with speed, distance, score, integrity, nitro, gate count, streak × multiplier
- ✅ Sequential level unlocks + "Unlock All" / "Reset Progress" escape hatches
- ✅ Save/Load via `localStorage` (key: `nebula-drive-v2`)
- ✅ Touch controls with rocket button
- ✅ Reduced‑motion respect (`prefers-reduced-motion`)
- ✅ Responsive layout (desktop + mobile media queries)
- ✅ Runtime error overlay — shows `boot` message if Three.js fails to load

## Build / Run

```bash
python -m http.server 8765 --bind 127.0.0.1
# then open http://127.0.0.1:8765/index.html
```

Or just open `index.html` directly — Three.js is bundled in `vendor/three.min.js`.

## Project Structure

```
nebula drive/
│
├─ index.html          — full markup: boot overlay, HUD, menus, modals, touch controls
├─ styles.css          — complete styling, responsive/touch media queries, modals, flash/vignette/scanlines
├─ game.js           — entire new engine (state machine, save/load, audio, 20 levels + 4 layouts,
                       ordered segments + trackAt(z), instanced road/city matrices, car model,
                       pooled obstacles with swept collision, camera/FOV/shake, speed streaks,
                       HUD sync, results/best/unlocks, keyboard+touch input, error overlay)
├─ vendor/
│   └─ three.min.js   — Three.js r161 IIFE bundle (global THREEE)
└─ README.md         — this file
```

## Controls Detail

- **Rocket**: Unlock after traveling 1.0 km (endless) or finishing a trial. Press **R** to deploy — the roadster transforms and speed spikes to 325 km/h for ~4.6 s.
- **Nitro**: Holds while held, depletes while active. Recharges when not boosting.
- **Assist**: Smooths steering in the pause‑menu toggle. Without it, steering is snappier.
- **Touch**: Tap the rocket button to deploy (only when unlocked). Other touch buttons steer, accelerate, brake, and nitro.

## Save Data

Progress is stored in `localStorage` under key `nebula-drive-v2`. The save object contains:

- `levels` — per‑trial scores, distances, gates, integrity, clear flags
- `endless` — best distance and score
- `custom` — best score/distance/gates
- `allUnlocked` — whether all 20 campaign trials are unlocked
- `settings` — sound, assist, paint colour, road glow, track length, traffic density, layout choice

To reset all progress, click **RESET PROGRESS** in the level‑select panel.

## License

MIT — free to fork and modify for personal use.