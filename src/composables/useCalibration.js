/**
 * useCalibration — webcam→projector calibration via Gray-code structured light.
 *
 * Industry-standard approach (used in RoomAlive, TouchDesigner, MadMapper):
 *   1. Project all-white & all-black → per-pixel brightness threshold
 *   2. Project Gray-coded vertical stripe patterns (pattern + inverse per bit)
 *      → each camera pixel decodes which projector X column it sees
 *   3. Repeat with horizontal stripes → projector Y row
 *   4. Build dense camera→projector correspondence map
 *   5. Sample well-distributed correspondences from the map
 *   6. Compute robust homography via RANSAC
 *   7. Validate reprojection error; auto-retry on failure
 *
 * Each camera pixel gets a unique binary code → zero ambiguity.
 * No blob detection, no marker matching, no sorting heuristics.
 *
 * Exports:
 *   calibrate(projectorCanvasEl, captureFrame, onProgress?) → Promise<boolean>
 *   transformPoint(x, y) → {x, y}
 *   isCalibrated (ref)
 *   calibrationMarkers (ref)
 */
import { ref } from 'vue'
import {
  sleep,
  drawGrayPattern,
  captureGrayscale,
  decodeCorrespondenceMap,
  filterCorrespondenceMap,
  sampleCorrespondences,
} from '../utils/structuredLight.js'
import { computeHomography, computeHomographyRANSAC, applyHomography } from '../utils/homography.js'

const STORAGE_KEY       = 'mappix:calibration-H'
const CORNERS_KEY       = 'mappix:calibration-corners'

const SETTLE_MS       = 250   // ms after projecting each pattern before capture
const SETTLE_INIT_MS  = 600   // longer settle for initial white/black frames
const AVG_FRAMES      = 4     // frames to average for white/black captures (noise reduction)
const MIN_CONTRAST    = 15    // minimum (white−black) brightness for validity
const SAMPLE_GRID     = 12    // correspondence sampling grid (12×12 = up to 144 points)
const MAX_RETRIES     = 3     // calibration attempts
const REPROJ_ACCEPT   = 6     // max mean reprojection error (px) to accept
const WARMUP_FLASHES  = 3     // white/black flashes before capture to settle camera AGC
const RANSAC_ITERS    = 500   // RANSAC iterations (more = more robust)

export function useCalibration() {
  const isCalibrated = ref(false)
  const calibrationMarkers = ref([])
  const calibrationQuality = ref(null)  // { validPct, error, inliers, total }
  const manualCorners = ref(null)       // [{x,y}, {x,y}, {x,y}, {x,y}] — projector corners in camera space
  let _H = null

  // --- Restore from localStorage on init ---
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      _H = JSON.parse(stored)
      isCalibrated.value = true
      console.log('[Calibration] Restored from localStorage')
    }
  } catch { /* ignore */ }

  // Restore manual corners
  try {
    const stored = localStorage.getItem(CORNERS_KEY)
    if (stored) manualCorners.value = JSON.parse(stored)
  } catch { /* ignore */ }

  function transformPoint(wx, wy) {
    if (!_H) return { x: wx, y: wy }
    return applyHomography(_H, wx, wy)
  }

  function resetCalibration() {
    _H = null
    isCalibrated.value = false
    calibrationMarkers.value = []
    calibrationQuality.value = null
    manualCorners.value = null
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    try { localStorage.removeItem(CORNERS_KEY) } catch { /* ignore */ }
    console.log('[Calibration] Reset')
  }

  /**
   * Get default corner positions for manual calibration (canvas corners with inset).
   * @param {number} w — canvas width
   * @param {number} h — canvas height
   * @param {number} inset — pixels inset from edges (default 40)
   */
  function getDefaultCorners(w, h, inset = 40) {
    return [
      { x: inset,     y: inset },       // top-left
      { x: w - inset, y: inset },       // top-right
      { x: w - inset, y: h - inset },   // bottom-right
      { x: inset,     y: h - inset },   // bottom-left
    ]
  }

  /**
   * Apply manual 4-corner calibration.
   * srcCorners = 4 points in webcam pixel space
   * dstCorners = 4 corresponding projector/canvas corners
   * displayCorners = optional canvas-space corners for UI persistence
   */
  function applyManualCorners(srcCorners, dstCorners, displayCorners) {
    const srcPts = srcCorners.map(p => [p.x, p.y])
    const dstPts = dstCorners.map(p => [p.x, p.y])
    try {
      _H = computeHomography(srcPts, dstPts)
      isCalibrated.value = true
      // Store display-space corners for the manual calibration UI
      manualCorners.value = displayCorners || srcCorners
      calibrationQuality.value = { validPct: 100, error: 0, inliers: 4, total: 4 }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_H)) } catch {}
      try { localStorage.setItem(CORNERS_KEY, JSON.stringify(manualCorners.value)) } catch {}
      console.log('[Calibration] Manual corners applied')
      return true
    } catch (err) {
      console.error('[Calibration] Manual calibration failed:', err)
      return false
    }
  }

  /**
   * Run Gray-code structured light calibration.
   * @param {HTMLCanvasElement} projectorCanvas — the fullscreen projector canvas
   * @param {Function} captureFrame — returns offscreen canvas with current webcam frame
   * @param {Function} waitForNewFrame — waits for a genuinely new video frame
   * @param {Function} [onProgress] — callback(step, totalSteps, message)
   * @returns {Promise<boolean>}
   */
  async function calibrate(projectorCanvas, captureFrame, waitForNewFrame, onProgress) {
    isCalibrated.value = false
    _H = null
    calibrationMarkers.value = []

    const ctx = projectorCanvas.getContext('2d')
    const W = projectorCanvas.width
    const H = projectorCanvas.height

    // Compute bits needed per axis (covers full projector resolution)
    const numBitsV = Math.ceil(Math.log2(Math.max(W, 2)))
    const numBitsH = Math.ceil(Math.log2(Math.max(H, 2)))

    // Total steps: white + black + V*(pattern+inverse) + H*(pattern+inverse) + decode + compute
    const totalSteps = 2 + numBitsV * 2 + numBitsH * 2 + 2
    let step = 0
    const report = (msg) => {
      if (onProgress) onProgress(step, totalSteps, msg)
    }

    const estSeconds = ((2 * SETTLE_INIT_MS + (numBitsV + numBitsH) * 2 * SETTLE_MS) / 1000).toFixed(1)
    console.log(`[Calibration] Structured light: ${numBitsV}V + ${numBitsH}H bits, ~${estSeconds}s`)

    // Helper: draw on canvas, ensure browser composites it, wait for camera to see it
    async function projectAndSettle(drawFn, settleMs) {
      drawFn()
      // rAF double-flush ensures the canvas is composited to the screen
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      // Wait for the full pipeline: projector → surface → camera → USB → browser
      await sleep(settleMs)
      // Then wait for 2 genuinely new video frames to guarantee we see the new pattern
      await waitForNewFrame(400)
      await waitForNewFrame(400)
    }

    // Helper: capture N genuinely distinct video frames and average them
    async function captureDistinctFrames(count) {
      const frames = []
      for (let i = 0; i < count; i++) {
        if (i > 0) await waitForNewFrame(200)
        const f = captureGrayscale(captureFrame)
        if (!f) return null
        frames.push(f)
      }
      if (frames.length === 1) return frames[0]
      const { width, height } = frames[0]
      const px = width * height
      const acc = new Float32Array(px)
      for (const f of frames) for (let i = 0; i < px; i++) acc[i] += f.data[i]
      const result = new Uint8Array(px)
      const inv = 1 / count
      for (let i = 0; i < px; i++) result[i] = Math.round(acc[i] * inv)
      return { data: result, width, height }
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      step = 0

      // ===== Camera AGC warmup =====
      report(`Attempt ${attempt}/${MAX_RETRIES} — warming up camera…`)
      for (let f = 0; f < WARMUP_FLASHES; f++) {
        await projectAndSettle(() => { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H) }, 150)
        await projectAndSettle(() => { ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H) }, 150)
      }

      // ===== All-white capture =====
      report('Projecting white…')
      await projectAndSettle(() => { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H) }, SETTLE_INIT_MS)
      const whiteFrame = await captureDistinctFrames(AVG_FRAMES)
      if (!whiteFrame) { report('Error: no webcam frame'); continue }
      step++

      // ===== All-black capture =====
      report('Projecting black…')
      await projectAndSettle(() => { ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H) }, SETTLE_INIT_MS)
      const blackFrame = await captureDistinctFrames(AVG_FRAMES)
      if (!blackFrame) { report('Error: no webcam frame'); continue }
      step++

      const camW = whiteFrame.width
      const camH = whiteFrame.height
      const n = camW * camH

      const codeX = new Int32Array(n)
      const codeY = new Int32Array(n)

      // ===== Vertical patterns (encode projector X) =====
      for (let b = 0; b < numBitsV; b++) {
        report(`Vertical ${b + 1}/${numBitsV}…`)

        await projectAndSettle(() => drawGrayPattern(ctx, W, H, b, numBitsV, true, false), SETTLE_MS)
        const patFrame = await captureDistinctFrames(2)
        step++

        await projectAndSettle(() => drawGrayPattern(ctx, W, H, b, numBitsV, true, true), SETTLE_MS)
        const invFrame = await captureDistinctFrames(2)
        step++

        if (!patFrame || !invFrame) continue

        for (let i = 0; i < n; i++) {
          const diff = patFrame.data[i] - invFrame.data[i]
          const contrast = whiteFrame.data[i] - blackFrame.data[i]
          const threshold = Math.max(3, contrast * 0.1)
          if (diff > threshold) {
            codeX[i] |= (1 << (numBitsV - 1 - b))
          }
        }
      }

      // ===== Horizontal patterns (encode projector Y) =====
      for (let b = 0; b < numBitsH; b++) {
        report(`Horizontal ${b + 1}/${numBitsH}…`)

        await projectAndSettle(() => drawGrayPattern(ctx, W, H, b, numBitsH, false, false), SETTLE_MS)
        const patFrame = await captureDistinctFrames(2)
        step++

        await projectAndSettle(() => drawGrayPattern(ctx, W, H, b, numBitsH, false, true), SETTLE_MS)
        const invFrame = await captureDistinctFrames(2)
        step++

        if (!patFrame || !invFrame) continue

        for (let i = 0; i < n; i++) {
          const diff = patFrame.data[i] - invFrame.data[i]
          const contrast = whiteFrame.data[i] - blackFrame.data[i]
          const threshold = Math.max(3, contrast * 0.1)
          if (diff > threshold) {
            codeY[i] |= (1 << (numBitsH - 1 - b))
          }
        }
      }

      // Restore black
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, W, H)

      // ===== Decode correspondence map =====
      step++
      report('Decoding correspondence map…')
      const { mapX, mapY, valid } = decodeCorrespondenceMap(
        whiteFrame.data, blackFrame.data, codeX, codeY,
        camW, camH, W, H, numBitsV, numBitsH, MIN_CONTRAST
      )

      let validCount = 0
      for (let i = 0; i < n; i++) if (valid[i]) validCount++
      console.log(`[Calibration] ${validCount}/${n} valid pixels (${(validCount / n * 100).toFixed(1)}%) before filtering`)

      if (validCount < 100) {
        report(`Too few valid pixels (${validCount}) — camera may not see projector`)
        if (attempt < MAX_RETRIES) continue
        return false
      }

      // Spatial consistency filter — removes isolated bit-flip errors
      filterCorrespondenceMap(mapX, mapY, valid, camW, camH, W, H)
      let filteredCount = 0
      for (let i = 0; i < n; i++) if (valid[i]) filteredCount++
      console.log(`[Calibration] ${filteredCount}/${n} valid pixels (${(filteredCount / n * 100).toFixed(1)}%) after filtering (removed ${validCount - filteredCount})`)

      // ===== Sample correspondences =====
      const { srcPts, dstPts } = sampleCorrespondences(
        mapX, mapY, valid, camW, camH, SAMPLE_GRID
      )
      console.log(`[Calibration] ${srcPts.length} correspondences from ${SAMPLE_GRID}×${SAMPLE_GRID} grid`)

      if (srcPts.length < 4) {
        report(`Too few correspondences (${srcPts.length}, need ≥4)`)
        if (attempt < MAX_RETRIES) continue
        return false
      }

      // ===== RANSAC homography =====
      step++
      report('Computing homography…')
      try {
        const result = computeHomographyRANSAC(srcPts, dstPts, 5, RANSAC_ITERS)
        console.log(`[Calibration] RANSAC: ${result.inliers}/${srcPts.length} inliers, mean error: ${result.error.toFixed(1)}px`)

        if (result.error > REPROJ_ACCEPT && attempt < MAX_RETRIES) {
          report(`High error (${result.error.toFixed(1)}px) — retrying…`)
          continue
        }

        _H = result.H
        isCalibrated.value = true
        calibrationQuality.value = {
          validPct: Math.round(filteredCount / n * 100),
          error: +result.error.toFixed(1),
          inliers: result.inliers,
          total: srcPts.length,
        }
        // Persist to localStorage so calibration survives page refresh
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_H)) } catch { /* quota */ }
        report(`Calibrated ✓ (${result.error.toFixed(1)}px, ${result.inliers} inliers)`)
        console.log('[Calibration] Complete ✓')
        return true
      } catch (err) {
        console.error('[Calibration] Homography failed:', err)
        report(`Error: ${err.message}`)
        if (attempt < MAX_RETRIES) continue
        return false
      }
    }

    report('Calibration failed after all attempts')
    return false
  }

  return { isCalibrated, calibrationMarkers, calibrationQuality, manualCorners, calibrate, transformPoint, resetCalibration, getDefaultCorners, applyManualCorners }
}
