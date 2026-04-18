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

import { rgbToHsv, morphClose, findBlobs } from '../utils/imageUtils.js'

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

/** Inline yellow mask using caller-supplied settings (avoids closure over module state). */
function yellowMask(data, pixelCount, s) {
  const mask = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    const { h, s: sat, v } = rgbToHsv(r, g, b)
    if (h >= s.hueMin && h <= s.hueMax && sat >= s.satMin && v >= s.valMin) mask[i] = 1
  }
  return mask
}

self.onmessage = ({ data: msg }) => {
  const { pixels, width, height, settings, downsampleFactor } = msg

  const img = downsampleRaw(pixels, width, height, downsampleFactor)
  const { data, width: dw, height: dh } = img

  let mask = yellowMask(data, dw * dh, settings)
  mask = morphClose(mask, dw, dh, 4)
  const blobs = findBlobs(mask, dw, dh, settings.minBlobArea)

  // Transfer pixels buffer back so the main thread can reuse the allocation
  self.postMessage({ blobs }, [pixels.buffer])
}
