/**
 * useDetection — yellow sticky note detection at 5 Hz.
 * Pure-JS implementation (no OpenCV).
 *
 * startDetection(captureFrame, transformPoint)
 * updateSettings({ hueMin, hueMax, satMin, valMin, minBlobArea })
 */
import { ref } from 'vue'
import { rgbToHsv, morphClose, findBlobs, downsample } from '../utils/imageUtils.js'

const DETECTION_INTERVAL_MS = 200   // 5 Hz
const DOWNSAMPLE_FACTOR = 4         // process at 160×120

export function useDetection() {
  const detectedRects = ref([])
  let _timer = null

  // Live-tuneable settings
  let _s = { hueMin: 15, hueMax: 70, satMin: 8, valMin: 55, minBlobArea: 50 }

  function updateSettings(s) { _s = { ..._s, ...s } }

  /** Inline yellow mask using live settings */
  function _yellowMask(imageData) {
    const { data, width, height } = imageData
    const mask = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      const { h, s, v } = rgbToHsv(r, g, b)
      if (h >= _s.hueMin && h <= _s.hueMax && s >= _s.satMin && v >= _s.valMin) mask[i] = 1
    }
    return mask
  }

  function startDetection(captureFrame, transformPoint) {
    if (_timer) clearInterval(_timer)

    _timer = setInterval(() => {
      const canvas = captureFrame()
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      const imgFull = ctx.getImageData(0, 0, canvas.width, canvas.height)

      const img = downsample(imgFull, DOWNSAMPLE_FACTOR)
      const { width: dw, height: dh } = img

      let mask = _yellowMask(img)
      mask = morphClose(mask, dw, dh, 4)
      const blobs = findBlobs(mask, dw, dh, _s.minBlobArea)

      const F = DOWNSAMPLE_FACTOR
      detectedRects.value = blobs.map(b => {
        // Transform hull contour points to canvas coordinates
        const hull = (b.hull && b.hull.length >= 3)
          ? b.hull.map(p => transformPoint(p.x * F, p.y * F))
          : [
              transformPoint(b.x * F, b.y * F),
              transformPoint((b.x + b.w) * F, b.y * F),
              transformPoint((b.x + b.w) * F, (b.y + b.h) * F),
              transformPoint(b.x * F, (b.y + b.h) * F),
            ]
        const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length
        const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length
        return {
          cx, cy,
          w: Math.abs(b.w * F),
          h: Math.abs(b.h * F),
          angle: 0,
          hull,
        }
      })
    }, DETECTION_INTERVAL_MS)
  }

  function stopDetection() {
    if (_timer) { clearInterval(_timer); _timer = null }
    detectedRects.value = []
  }

  return { detectedRects, startDetection, stopDetection, updateSettings }
}


