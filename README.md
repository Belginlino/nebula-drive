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
| Space / Jump | Jump over cubes |
| S / Down / Slide | Slide under overhead barriers |
| Shift / Nitro | Nitro boost (fills when not boosting) |
| R | Rocket (unlock at 0.5 km in endless / finish a trial) |
| M | Toggle sound |
| F | Fullscreen (mobile / desktop) |
| ESC | Pause / resume / return to menu |
| Swipe ← → | Steer on touch (drag anywhere on the track) |
| Swipe ↑ / ↓ | Jump / slide on touch |
| Touch buttons | Steer, jump, slide, accelerate, brake, nitro, rocket |

## Feature List

- ✅ Vendored Three.js r161 IIFE bundle — runs offline from `file://`
- ✅ Curved tracks via ordered segment queue (`trackAt(z)`) with sinusoidal heading steering
- ✅ Instanced road + city meshes — ~12 draw calls instead of ~500
- ✅ Pooled obstacles with swept collision (crossing `prevZ`/`z` at car z‑plane) — no tunnelling at rocket speed
- ✅ Subway‑Surfers style run: jump over cubes, slide under overhead barriers, steer around traffic
- ✅ Collectible spinning coins (+50 score each, HUD coin counter, coin pickup SFX)
- ✅ Explicit `paintMat` — no heuristic recolouring
- ✅ Rocket protocol (unlock at 0.5 km, 4.6 s boost)
- ✅ WebAudio synthesized engine, coin/gate tones, jump/slide/impact SFX, transform SFX
- ✅ Bloom‑free neon polish: sky sphere, orbital planet ring, speed streaks, camera shake / FOV shift
- ✅ HUD with speed, distance, score, coins, integrity, nitro, gate count, streak × multiplier
- ✅ Sequentially unlocked campaign + "Unlock All" / "Reset Progress" escape hatches
- ✅ Save/Load via `localStorage` (key: `nebula-drive-v2`)
- ✅ Full mobile support: swipe steering, jump/slide gestures, large touch targets, safe‑area insets, portrait + landscape layouts, fullscreen button, reduced render cost
- ✅ Reduced‑motion respect (`prefers-reduced-motion`)
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

- **Rocket**: Unlock after traveling 0.5 km (endless) or finishing a trial. Press **R** to deploy — the roadster transforms and speed spikes to 325 km/h for ~4.6 s.
- **Nitro**: Holds while held, depletes while active. Recharges when not boosting.
- **Assist**: Smooths steering in the pause-menu toggle. Without it, steering is snappier.
- **Jump / Slide**: Jump clears cubes; slide clears overhead orange barriers. Both are available from the keyboard, the touch buttons, and swipes.
- **Touch**: Drag anywhere to steer, swipe up to jump, swipe down to slide. Dedicated buttons are also available at the bottom of the screen.
- **Coin counter**: Coins contribute +50 score each and a small nitro refill.

## Save Data

Progress is stored in `localStorage` under key `nebula-drive-v2`. The save object contains:

- `levels` — per‑trial scores, distances, gates, coins, integrity, clear flags
- `endless` — best distance and score
- `custom` — best score/distance/gates/coins
- `allUnlocked` — whether all 20 campaign trials are unlocked
- `settings` — sound, assist, paint colour, road glow, track length, traffic density, layout choice

To reset all progress, click **RESET PROGRESS** in the level‑select panel.

## License

MIT — free to fork and modify for personal use.