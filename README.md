# Mappix

<img width="1200" height="350" alt="Mappix" src="./public/banner.svg" />

Stick notes on a wall. Watch physics balls bounce off them. That's it. That's the project.

**[→ Open Mappix](https://mappix.isacool.monster/)** — no install, just open in the browser on the machine driving the projector.

---

## What You Need

- A projector aimed at a wall
- A webcam with a clear view of the same wall
- Some yellow sticky notes — or any bright object; yellow is just the default (configurable in settings)

The webcam and projector don't need to be perfectly aligned — that's what calibration is for.

---

## Hardware Setup

<div align="center">
  <a href="https://github.com/user-attachments/assets/bd8cbd01-6d11-4f0d-8ec1-abe6f2bbecca">
    <img width="480" alt="Hardware setup — projector and webcam aimed at the same wall" src="./public/setup.svg" />
  </a>
</div>

1. Mount your projector so it covers the wall area you want to use
2. Position the webcam so it can see the full projected area — off to the side or above works fine
3. Make sure the room isn't so bright that the projector image washes out; the camera needs to read the patterns during calibration

---

## Calibration

Calibration maps every projector pixel to its corresponding camera pixel using a Gray-code structured light sequence. Recalibrate if the projector or camera moves, the selected camera changes, or the output size changes. Mapping assumes a flat surface; objects away from that plane can have alignment errors.

1. Clear the wall of people and moving objects
2. Click **Calibrate** in the sidebar
3. The projector will flash a series of black-and-white stripe patterns for roughly 20–30 seconds per attempt; up to three attempts may run. Don't cover the wall during this. Press **Esc** to cancel
4. When it finishes, reprojection error and matching-point counts are shown. These describe the fitted mapping, not a guaranteed accuracy score. Check alignment against the actual surface
5. Calibration is saved to `localStorage` when available. Saved mappings are reused only when camera identity, camera resolution, and output dimensions match. Older saved mappings without this information require recalibration

> If you just want to try it quickly, choose **Skip for now** during setup. If a compatible mapping is saved, the tour offers **Use saved calibration** instead. The app will use proportional scaling, which works reasonably well when the camera is centred and close to the projector.

---

## Running

1. Follow the setup guide and choose **Allow Camera**
2. Calibrate or skip, then stick yellow post-its on the wall
3. Balls fall from the top and bounce off detected outlines
4. Press **H** to open settings. Under **Advanced → Detection**, use **Pick**, **Color**, **Tolerance**, **Vividness**, and **Brightness** to match your lighting
5. For manual calibration, place the four corners on the projected area in the camera view. Drag to adjust, use **[ / ]** to select a corner, arrows to nudge, **Shift** for larger steps, and **Tab** to reach Apply or Cancel

The camera runs locally in your browser. Use HTTPS or localhost for camera access. A browser with Web Workers, ImageBitmap, and OffscreenCanvas support is required.


## Running Locally (Optional)

Use Node.js 20.19+ within the 20.x line, or 22.12+.

```bash
git clone https://github.com/mishalshanavas/mappix.git
cd mappix
npm ci
npm run dev
```

Open `http://localhost:5173` in the browser on the machine driving the projector.

---

> Full hardware guide, calibration tuning, and troubleshooting coming in the wiki.

## Verification

```bash
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

The browser test starts a local server on port 5175 and uses a simulated camera. It checks UI flows, not physical projector alignment. See [PROJECT_REVIEW.md](./PROJECT_REVIEW.md) for the review, completed fixes, and prioritized remaining work.
