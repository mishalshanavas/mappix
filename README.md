# dynamic-mapper

A browser-based AR physics sandbox where a projector throws falling balls that bounce off real physical objects — like sticky notes on a wall — detected live by a webcam.

Point a webcam at your wall, stick some yellow post-its up, run the app on a projector, and watch white physics balls rain down and interact with whatever is on the wall in real time.

---

## How it works

**Detection** — the webcam feed is processed entirely in the browser using pure JavaScript (no OpenCV, no WASM). Yellow objects are detected via HSV masking, blob detection, and convex hull extraction at 5 Hz.

**Calibration** — press *Calibrate* and the app runs a **Gray-code structured light** sequence: it projects a series of binary stripe patterns onto the wall, reads them back through the webcam, and computes a per-pixel projector↔camera correspondence map. From that map it builds a robust homography via RANSAC. This is the same technique used by tools like TouchDesigner and RoomAlive — zero blob matching, zero ambiguity.

**Physics** — [Matter.js](https://brm.io/matter-js/) handles everything. Detected objects become static rigid bodies. Balls spawn from the top-centre and cascade down, bouncing off whatever the camera sees.

---

## Stack

| Layer | Tech |
|---|---|
| UI framework | Vue 3 (Composition API, `<script setup>`) |
| Bundler | Vite |
| Physics | Matter.js |
| Image processing | Pure JS — HSV masking, union-find blob detection, convex hull |
| Calibration | Gray-code structured light + normalised DLT homography + RANSAC |
| Camera | `getUserMedia` 640×480 |

No runtime dependencies beyond Vue and Matter.js.

---

## Getting started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` on whatever machine is driving the projector. The app runs fullscreen.

### First run

1. Click **Start** — browser will ask for camera permission
2. Stick yellow post-its (or any yellow objects) on the wall the projector is aimed at
3. Hit **Skip (Identity)** if the webcam and projector are roughly aligned — detection will just scale coordinates proportionally
4. Or hit **Calibrate** to run the full structured light sequence (~7 s) for pixel-accurate mapping
5. Balls start falling immediately from the top-centre

---

## Settings

Everything is live-tuneable from the sidebar:

| Setting | What it does |
|---|---|
| Spawn interval | How often a new ball drops |
| Ball size | Radius in px |
| Bounciness | Matter.js restitution (0 = dead, 1 = perfect bounce) |
| Gravity | Gravity scale |
| Max balls | Oldest ball removed when limit is hit |
| Hue min / max | Yellow detection hue range (HSV, 0–360°) |
| Sat min | Minimum saturation — lower this if stickies look washed out under projector light |
| Val min | Minimum brightness |
| Min blob area | Ignore blobs smaller than this (in detection pixels) |

Keyboard shortcuts: `H` toggle sidebar · `F` fullscreen

---

## Calibration notes

- Keep the wall area clear of people during the ~7 s structured light sequence
- The projector must be visible to the webcam for calibration to work
- If it fails, the app falls back to identity (proportional) scaling automatically
- Re-calibrate any time the projector or camera moves

