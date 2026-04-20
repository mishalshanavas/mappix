/**
 * detection.worker.js — yellow blob detection off the main thread.
 *
 * Receives:  { pixels: Uint8ClampedArray, width, height, settings, downsampleFactor }
 *            (pixels buffer is transferred — zero-copy)
 * Posts back: { blobs: Array<{x,y,w,h,hull}> }
 *            (pixels buffer transferred back so caller can reuse it)
 *
 * Performs: downsample → yellow HSV mask → morphological close → blob detection
 * Does NOT perform temporal smoothing — that stays on the main thread because
 * transformPoint is a main-thread function.
 */

import { morphClose, morphOpen, findBlobs } from '../utils/imageUtils.js'

/** Downsample RGBA pixels by integer factor (nearest-neighbour, no ImageData API needed). */
function downsampleRaw(src, srcW, srcH, factor) {
  const dw = Math.floor(srcW / factor)
  const dh = Math.floor(srcH / factor)
  const out = new Uint8ClampedArray(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const si = (y * factor * srcW + x * factor) * 4
      const di = (y * dw + x) * 4
      out[di]     = src[si]
      out[di + 1] = src[si + 1]
      out[di + 2] = src[si + 2]
      out[di + 3] = 255
    }
  }
  return { data: out, width: dw, height: dh }
}

/** Inline yellow HSV mask — no function call or object allocation per pixel. */
function yellowMask(data, pixelCount, s) {
  const mask = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    const ri = data[i * 4], gi = data[i * 4 + 1], bi = data[i * 4 + 2]
    const r = ri / 255, g = gi / 255, b = bi / 255
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b)
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b)
    const v = max * 100
    if (v < s.valMin) continue
    const d = max - min
    const sat = max === 0 ? 0 : (d / max) * 100
    if (sat < s.satMin) continue
    let h = 0
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
      else if (max === g) h = ((b - r) / d + 2) / 6
      else h = ((r - g) / d + 4) / 6
    }
    h *= 360
    if (h >= s.hueMin && h <= s.hueMax) mask[i] = 1
  }
  return mask
}

let _osc = null
let _octx = null

self.onmessage = ({ data: msg }) => {
  const { bitmap, settings, downsampleFactor } = msg
  const width = bitmap.width, height = bitmap.height

  // Draw ImageBitmap to OffscreenCanvas and read pixels (all off main thread)
  if (!_osc || _osc.width !== width || _osc.height !== height) {
    _osc = new OffscreenCanvas(width, height)
    _octx = _osc.getContext('2d', { willReadFrequently: true })
  }
  _octx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const pixels = _octx.getImageData(0, 0, width, height).data
  const img = downsampleRaw(pixels, width, height, downsampleFactor)
  const { data, width: dw, height: dh } = img

  let mask = yellowMask(data, dw * dh, settings)
  // morphOpen removes small noise specks (especially on top edge from reflections)
  mask = morphOpen(mask, dw, dh, 2)
  // morphClose fills small gaps within the blob
  mask = morphClose(mask, dw, dh, 3)
  const blobs = findBlobs(mask, dw, dh, settings.minBlobArea)

  self.postMessage({ blobs })
}
