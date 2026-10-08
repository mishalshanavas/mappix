# Project review — 2026-10-08

Mappix is a small Vue/Vite application with no application backend. The camera supplies frames to a worker for color segmentation and blob detection; the main thread tracks outlines, maps camera coordinates to projector coordinates, creates Matter.js obstacles, and renders falling balls. Automatic calibration estimates a planar homography from projected Gray-code patterns. Manual calibration estimates the same mapping from four clicked corners.

The largest issues were lifecycle correctness and geometry. A successful build did not prove that camera shutdown, calibration acceptance, or collision placement worked correctly. Those paths now have regression coverage.

## Completed fixes

| Priority | Finding and user impact | Change |
| --- | --- | --- |
| High | Automatic calibration accepted excessive error on its last retry, and a small set of matching points could masquerade as a successful calibration. | Every attempt now requires finite error ≤6 px, at least 12 inliers, and ≥60% inlier agreement. Ambiguous stripe bits and incomplete captures are rejected. These are initial acceptance thresholds, not a hardware accuracy guarantee. |
| High | An exception, repeat activation, or interrupted calibration could leave the app in the wrong state. | Added operation guards, cancellation, cleanup in `finally`, and visible outcomes. Calibration pauses physics and detection and waits for the UI to release the canvas. |
| High | Saved mappings could silently be applied to a different camera or output size. | Persist camera identity and both resolutions; invalidate mismatched or legacy mappings. Abort calibration when output size changes during capture. Preserve a previous compatible mapping when a retry fails or is cancelled. |
| High | Irregular collision polygons were shifted because outline-point averages differ from polygon area centroids. | Place and update Matter.js polygons using the polygon area centroid. Reject non-finite or collapsed collision geometry. |
| High | Overlapping camera requests, late permission responses, and playback failures could leak streams. | Deduplicate requests, invalidate cancelled sessions, release late/failed streams, and respond to track termination. Removed unconditional manual-exposure requests without exposure values. |
| High | Invalid saved settings could cause a zero-interval spawn loop or broken formatting; restored detection settings were never sent to the worker. | Validate and clamp stored settings, tolerate unavailable storage, and apply all settings on mount. |
| Medium | A bitmap created before stopping detection could be sent to a newly started worker. | Check worker identity after capture, close stale bitmaps, and expose terminal detection failures to the UI. |
| Medium | Keyboard corner selection also acted as pointer dragging; crossing corners could produce invalid warps. | Separate selection and drag state, capture pointers, validate convex corner order, and leave invalid edits open with an explanation. |
| Medium | Manual calibration claimed perfect measured accuracy; color picking and manual editing left the camera background enabled. | Remove invented manual quality measurements and restore the previous background state after editing. |
| Medium | Red detection failed at the 0°/360° hue boundary. | Use circular hue ranges in the picker, sliders, and worker. |
| Medium | Pausing/resuming could accumulate spawn debt or create duplicate animation loops; live bounciness changes did not update existing bodies. | Bound elapsed spawn time, make resume idempotent, reset timing on resume, update existing restitution, and apply lower ball limits immediately. |
| Medium | Controls lacked accessible names/state, the tour used inconsistent duration claims, and keyboard shortcuts intercepted unrelated input. | Add control labels and switch states, preserve normal Tab navigation, improve text contrast and focus indicators, make the tour scroll on short screens, add cancellation, remove delayed auto-advance, and guard shortcuts. |
| Medium | The lockfile had six high-severity audit entries. | Update compatible locked dependencies. Final audit reports zero known vulnerabilities; this is not a claim that the original app exposed every reported attack path. |

Source areas: [App.vue](src/App.vue), [calibration](src/composables/useCalibration.js), [detection](src/composables/useDetection.js), [physics](src/composables/usePhysics.js), [camera](src/composables/useWebcam.js), [settings](src/components/SettingsPanel.vue), and [setup](src/components/SetupTour.vue).

## Remaining issues and recommended order

These are unresolved findings or design limitations, not completed changes.

1. **High — Match calibration pattern detail to camera resolution.** `useCalibration.js` selects enough bits to represent every projector pixel, while `useWebcam.js` requests 640×480. On a 1920×1080 output, the narrowest stripes can be smaller than a camera pixel. Optical blur and resampling can destroy that information. Start with coarser projector cells, measure error on held-out points across the surface, and refine only when the camera resolves the pattern. The new confidence rejection may expose failures that were previously reported as successes. Test with the actual projector before promising accuracy.

2. **High — Add a camera selector with a full-frame preview.** The UI always opens the default camera, despite onboarding describing an external camera. `startWebcam(deviceId)` exists but has no selection UI. Enumerate devices after permission, show the selected camera, and restart calibration on a change. The current `Math.max` cover scaling in `App.vue` and `ProjectorCanvas.vue` crops the camera image, so manual calibration may hide the projected area's corners. Use a contained preview and one shared coordinate-conversion helper for rendering, picking, and manual editing.

3. **Medium — Improve tracking identity and outline correspondence.** `useDetection.js` greedily matches centroids within 80 projector pixels and smooths perimeter samples by array index. Nearby objects can swap identities; changes in the convex hull's starting vertex can pair unrelated points and shrink or rotate the smoothed outline. Align hull sample indices before smoothing, account for elapsed time, and evaluate matching with recorded sequences containing crossing and moving notes.

4. **Medium — Validate the whole usable surface.** RANSAC's fitting error measures its selected inliers. It does not establish coverage, held-out accuracy, or extrapolation safety at the corners. Require distributed inliers across the intended area and offer a projected verification grid. A single homography also assumes one plane: raised objects and curved surfaces produce parallax errors. Explain that scope in product copy.

5. **Medium — Separate setup completion from camera running state.** Stopping the camera currently returns to the welcome tour. Track onboarding completion separately, keep the controls accessible when stopped, and offer a clear Resume action. Distinguish camera-ready, detection-failed, and simulation-paused states instead of allowing a generic Running label to carry all three meanings.

6. **Medium — Separate operator controls from projector output.** The sidebar, error messages, and camera preview share the projected window. During calibration, controls are hidden to avoid corrupting patterns; progress is currently announced for assistive technology, with Esc cancellation explained beforehand. An operator window would allow visible progress and camera diagnosis without contaminating projection. This needs a deliberate single-display versus dual-display workflow.

7. **Medium — Hardware and compatibility validation.** Frame waits currently time out without proving a new camera frame arrived. Automatic exposure can still change between stripe captures. Test fresh-frame timeouts, disconnection, exposure adaptation, browser support, and mapping accuracy with actual hardware. Consider a measured exposure lock and explicit stale-frame errors. The width-based mobile blocker also blocks narrow desktop windows; capability detection would provide a more useful fallback.

8. **Low — Consolidate state and geometry.** `App.vue` handles onboarding, camera lifecycle, calibration, manual dragging, storage, picking, and shortcuts. Extract interaction modes and coordinate conversion after the flow is settled. Remove unused marker plumbing, share remaining UI defaults, document blob-area units, and add CI for tests/build. This improves maintainability without a framework rewrite.

## Verification and limits

- `npm test`: regression tests cover homography, invalid corners, context invalidation, corrupt stored calibration, cancellation, settings validation, wrapped hue, Gray-code decoding, blob detection, collision coordinates, camera cleanup, and worker restart races. A synthetic projection/capture test exercises successful automatic calibration and all three failed attempts while retaining the previous mapping.
- `npm run test:browser`: Chromium with a simulated camera exercises onboarding, camera access, skip, manual selection/nudge/apply, background restoration, color picking cancellation, red hue, automatic-calibration cancellation, resize invalidation, camera stop, and permission-denied recovery on a short desktop viewport. No uncaught page errors were observed.
- `npm run build`: production build validation.
- `npm audit`: zero known vulnerabilities after updates.
- Physical projector alignment, real camera exposure behavior, moving-object latency, and other browser engines remain unverified. Synthetic tests cannot establish these results.

Run the commands in [README.md](README.md#verification). Existing saved calibrations without camera/display metadata intentionally require recalibration once.
