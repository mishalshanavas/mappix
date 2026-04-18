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
  drawGrayPattern,
  captureGrayscale,
  captureAveragedGrayscale,
  decodeCorrespondenceMap,
  sampleCorrespondences,
} from '../utils/structuredLight.js'
import { computeHomographyRANSAC, applyHomography } from '../utils/homography.js'

const SETTLE_MS       = 150   // ms after projecting each pattern before capture
const SETTLE_INIT_MS  = 300   // longer settle for initial white/black frames
const AVG_FRAMES      = 2     // frames to average for white/black captures
const MIN_CONTRAST    = 25    // minimum (white−black) brightness for validity
const SAMPLE_GRID     = 8     // correspondence sampling grid (8×8 = up to 64 points)
const MAX_RETRIES     = 2     // calibration attempts
const REPROJ_ACCEPT   = 8     // max mean reprojection error (px) to accept

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

export function useCalibration() {
  const isCalibrated = ref(false)
  const calibrationMarkers = ref([])
  let _H = null

  function transformPoint(wx, wy) {
    if (!_H) return { x: wx, y: wy }
    return applyHomography(_H, wx, wy)
  }

  /**
   * Run Gray-code structured light calibration.
   * @param {HTMLCanvasElement} projectorCanvas — the fullscreen projector canvas
   * @param {Function} captureFrame — returns offscreen canvas with current webcam frame
   * @param {Function} [onProgress] — callback(step, totalSteps, message)
   * @returns {Promise<boolean>}
   */
  async function calibrate(projectorCanvas, captureFrame, onProgress) {
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

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      step = 0

      // ===== All-white capture =====
      report(`Attempt ${attempt}/${MAX_RETRIES} — projecting white…`)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, W, H)
      await sleep(SETTLE_INIT_MS)
      const whiteFrame = await captureAveragedGrayscale(captureFrame, AVG_FRAMES)
      if (!whiteFrame) { report('Error: no webcam frame'); continue }
      step++

      // ===== All-black capture =====
      report('Projecting black…')
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, W, H)
      await sleep(SETTLE_INIT_MS)
      const blackFrame = await captureAveragedGrayscale(captureFrame, AVG_FRAMES)
      if (!blackFrame) { report('Error: no webcam frame'); continue }
      step++

      const camW = whiteFrame.width
      const camH = whiteFrame.height
      const n = camW * camH

      // Accumulated Gray codes per camera pixel
      const codeX = new Int32Array(n)
      const codeY = new Int32Array(n)

      // ===== Vertical patterns (encode projector X) =====
      for (let b = 0; b < numBitsV; b++) {
        report(`Vertical ${b + 1}/${numBitsV}…`)

        // Pattern
        drawGrayPattern(ctx, W, H, b, numBitsV, true, false)
        await sleep(SETTLE_MS)
        const patFrame = captureGrayscale(captureFrame)
        step++

        // Inverse
        drawGrayPattern(ctx, W, H, b, numBitsV, true, true)
        await sleep(SETTLE_MS)
        const invFrame = captureGrayscale(captureFrame)
        step++

        if (!patFrame || !invFrame) continue

        // Decode bit: pattern brighter than inverse → bit is 1
        for (let i = 0; i < n; i++) {
          if (patFrame.data[i] > invFrame.data[i]) {
            codeX[i] |= (1 << (numBitsV - 1 - b))
          }
        }
      }

      // ===== Horizontal patterns (encode projector Y) =====
      for (let b = 0; b < numBitsH; b++) {
        report(`Horizontal ${b + 1}/${numBitsH}…`)

        drawGrayPattern(ctx, W, H, b, numBitsH, false, false)
        await sleep(SETTLE_MS)
        const patFrame = captureGrayscale(captureFrame)
        step++

        drawGrayPattern(ctx, W, H, b, numBitsH, false, true)
        await sleep(SETTLE_MS)
        const invFrame = captureGrayscale(captureFrame)
        step++

        if (!patFrame || !invFrame) continue

        for (let i = 0; i < n; i++) {
          if (patFrame.data[i] > invFrame.data[i]) {
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
      console.log(`[Calibration] ${validCount}/${n} valid pixels (${(validCount / n * 100).toFixed(1)}%)`)

      if (validCount < 100) {
        report(`Too few valid pixels (${validCount}) — camera may not see projector`)
        if (attempt < MAX_RETRIES) continue
        return false
      }

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
        const result = computeHomographyRANSAC(srcPts, dstPts, 8, 80)
        console.log(`[Calibration] RANSAC: ${result.inliers}/${srcPts.length} inliers, mean error: ${result.error.toFixed(1)}px`)

        if (result.error > REPROJ_ACCEPT && attempt < MAX_RETRIES) {
          report(`High error (${result.error.toFixed(1)}px) — retrying…`)
          continue
        }

        _H = result.H
        isCalibrated.value = true
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

  return { isCalibrated, calibrationMarkers, calibrate, transformPoint }
}
