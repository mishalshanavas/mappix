import { ref } from 'vue'
import { isValidQuad } from '../utils/geometry.js'
import { sleep, afterPaint } from '../utils/async.js'
import { drawGrayPattern, captureGrayscale, decodeCorrespondenceMap, filterCorrespondenceMap, cellCorrespondences, patternBits } from '../utils/structuredLight.js'
import { computeHomography, applyHomography, isValidHomography } from '../utils/homography.js'
import { fitCalibration } from '../utils/calibrationFit.js'

const STORAGE_KEY = 'mappix:calibration-v2'

export function useCalibration(getContext = () => null) {
  const isCalibrated = ref(false)
  const calibrationQuality = ref(null)
  const manualCorners = ref(null) // Camera coordinates, independent of preview layout.
  const calibrationMarkers = ref([])
  let mapping = null
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (stored?.version === 2 && isValidHomography(stored.H) && isValidQuad(stored.corners)) {
      mapping = stored
      isCalibrated.value = true
      manualCorners.value = stored.corners
      calibrationQuality.value = stored.quality
    }
  } catch { /* Storage is optional. */ }

  function commit(H, corners, quality) {
    mapping = { version: 2, H, corners: corners.map(p => ({ ...p })), quality, context: getContext() }
    manualCorners.value = mapping.corners
    calibrationQuality.value = quality
    isCalibrated.value = true
    // One record prevents a new matrix being paired with stale camera metadata.
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(mapping)) } catch {}
  }

  function resetCalibration() {
    mapping = null
    isCalibrated.value = false
    calibrationQuality.value = null
    manualCorners.value = null
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  function validateContext() {
    if (!mapping) return true
    const current = getContext()
    if (current && (!mapping.context || Object.keys(current).some(key => current[key] !== mapping.context[key]))) {
      resetCalibration()
      return false
    }
    return true
  }

  function transformPoint(x, y) {
    if (!mapping) return { x, y }
    const result = applyHomography(mapping.H, x, y)
    // Ignore projective extrapolation far outside the output instead of feeding
    // huge vertices into the physics solver near the homography's horizon.
    const context = mapping.context
    if (context && (result.x < -context.width || result.x > 2 * context.width || result.y < -context.height || result.y > 2 * context.height)) return { x: NaN, y: NaN }
    return result
  }

  function getDefaultCorners(width, height, inset = 40) {
    const margin = Math.min(inset, width / 4, height / 4)
    return [{ x: margin, y: margin }, { x: width - margin, y: margin }, { x: width - margin, y: height - margin }, { x: margin, y: height - margin }]
  }

  function applyManualCorners(src, dst) {
    if (!isValidQuad(src) || !isValidQuad(dst)) return false
    try {
      const H = computeHomography(src.map(p => [p.x, p.y]), dst.map(p => [p.x, p.y]))
      commit(H, src, null)
      return true
    } catch { return false }
  }

  async function calibrate(canvas, captureFrame, waitForNewFrame, onProgress, signal) {
    signal?.throwIfAborted()
    const width = canvas.width, height = canvas.height
    const initial = captureFrame()
    if (!initial) throw new Error('Camera is not providing frames')
    const cameraWidth = initial.width, cameraHeight = initial.height
    const ctx = canvas.getContext('2d')
    const check = () => {
      signal?.throwIfAborted()
      if (canvas.width !== width || canvas.height !== height) throw new Error('Display size changed during calibration')
    }
    const settle = async (draw, ms = 250) => {
      check()
      draw()
      await afterPaint(signal)
      await sleep(ms, signal)
      await waitForNewFrame(1000, signal)
      await waitForNewFrame(1000, signal)
      check()
    }
    const solid = value => () => { ctx.fillStyle = value; ctx.fillRect(0, 0, width, height) }
    const capture = async (count = 2) => {
      const sum = new Float32Array(cameraWidth * cameraHeight)
      for (let f = 0; f < count; f++) {
        if (f) await waitForNewFrame(1000, signal)
        check()
        const frame = captureGrayscale(captureFrame)
        if (!frame || frame.width !== cameraWidth || frame.height !== cameraHeight) throw new Error('Camera frame missing or dimensions changed')
        for (let i = 0; i < sum.length; i++) sum[i] += frame.data[i]
      }
      return Uint8Array.from(sum, value => Math.round(value / count))
    }
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const bitsX = patternBits(width, cameraWidth, attempt), bitsY = patternBits(height, cameraHeight, attempt)
        const total = 4 + 2 * (bitsX + bitsY)
        let step = 0
        const report = message => onProgress?.(step, total, `Attempt ${attempt}/3 — ${message}`)
        report('warming up camera…')
        for (let flash = 0; flash < 2; flash++) {
          await settle(solid('#FFFFFF'), 150)
          await settle(solid('#000000'), 150)
        }
        await settle(solid('#FFFFFF'), 600)
        const white = await capture(4); step++
        await settle(solid('#000000'), 600)
        const black = await capture(4); step++
        const n = white.length, codeX = new Int32Array(n), codeY = new Int32Array(n)
        const reliable = new Uint8Array(n).fill(1)
        for (const [vertical, bits, code] of [[true, bitsX, codeX], [false, bitsY, codeY]]) {
          for (let bit = 0; bit < bits; bit++) {
            report(`${vertical ? 'Vertical' : 'Horizontal'} pattern ${bit + 1}/${bits}…`)
            await settle(() => drawGrayPattern(ctx, width, height, bit, bits, vertical, false))
            const pattern = await capture(); step++
            await settle(() => drawGrayPattern(ctx, width, height, bit, bits, vertical, true))
            const inverse = await capture(); step++
            for (let i = 0; i < n; i++) {
              const difference = pattern[i] - inverse[i]
              if (Math.abs(difference) <= Math.max(3, (white[i] - black[i]) * .1)) reliable[i] = 0
              if (difference > 0) code[i] |= 1 << (bits - bit - 1)
            }
          }
        }
        check()
        solid('#000000')()
        report('Decoding cells…'); step++
        const { mapX, mapY, valid } = decodeCorrespondenceMap(white, black, codeX, codeY, cameraWidth, cameraHeight, width, height, bitsX, bitsY, 15)
        for (let i = 0; i < n; i++) valid[i] &= reliable[i]
        filterCorrespondenceMap(mapX, mapY, valid, cameraWidth, cameraHeight, width, height)
        const { srcPts, dstPts } = cellCorrespondences(mapX, mapY, valid, cameraWidth, cameraHeight)
        report('Fitting and validating mapping…')
        try {
          const result = fitCalibration(srcPts, dstPts, width, height, cameraWidth, cameraHeight)
          check()
          commit(result.H, result.corners, result.quality)
          step = total
          report('Calibrated')
          return true
        } catch (error) {
          signal?.throwIfAborted()
          report(`${error.message}${attempt < 3 ? '; retrying with wider stripes…' : ''}`)
        }
      }
      return false
    } finally {
      // Render loop resumes only after this operation releases the canvas.
      solid('#000000')()
    }
  }

  return { isCalibrated, calibrationQuality, calibrationMarkers, manualCorners, validateContext, resetCalibration, transformPoint, getDefaultCorners, applyManualCorners, calibrate }
}
