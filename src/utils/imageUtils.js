/**
 * Pure-JS image processing utilities.
 * No OpenCV / WASM.  Works directly on ImageData obtained from a canvas.
 *
 * Designed for 640×480 webcam frames; all hot paths operate on
 * a 4× downsampled (160×120) copy for speed.
 */

// ---------------------------------------------------------------------------
// Colour space
// ---------------------------------------------------------------------------

/** Convert sRGB (0-255) → HSV  h:0-360, s:0-100, v:0-100 */
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return { h: h * 360, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

// ---------------------------------------------------------------------------
// Colour masks  (return Uint8Array, 1 = pixel passes, length = width*height)
// ---------------------------------------------------------------------------

/** Yellow sticky note mask   H: 20-65°, S≥35%, V≥40% */
export function yellowMask(imageData) {
  const { data, width, height } = imageData
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    const { h, s, v } = rgbToHsv(r, g, b)
    if (h >= 20 && h <= 65 && s >= 35 && v >= 40) mask[i] = 1
  }
  return mask
}

/** Green calibration marker mask   H: 90-165°, S≥30%, V≥25% */
export function greenMask(imageData) {
  const { data, width, height } = imageData
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    const { h, s, v } = rgbToHsv(r, g, b)
    if (h >= 90 && h <= 165 && s >= 30 && v >= 25) mask[i] = 1
  }
  return mask
}

// ---------------------------------------------------------------------------
// Morphology (separable 1-D passes for performance)
// ---------------------------------------------------------------------------

function dilate1D(mask, width, height, radius, horizontal) {
  const out = new Uint8Array(mask.length)
  if (horizontal) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const base = y * width
        let v = 0
        for (let dx = -radius; dx <= radius && !v; dx++) {
          const nx = x + dx
          if (nx >= 0 && nx < width) v = mask[base + nx]
        }
        out[base + x] = v
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v = 0
        for (let dy = -radius; dy <= radius && !v; dy++) {
          const ny = y + dy
          if (ny >= 0 && ny < height) v = mask[ny * width + x]
        }
        out[y * width + x] = v
      }
    }
  }
  return out
}

function erode1D(mask, width, height, radius, horizontal) {
  const out = new Uint8Array(mask.length)
  if (horizontal) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const base = y * width
        let v = 1
        for (let dx = -radius; dx <= radius && v; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width || !mask[base + nx]) v = 0
        }
        out[base + x] = v
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v = 1
        for (let dy = -radius; dy <= radius && v; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= height || !mask[ny * width + x]) v = 0
        }
        out[y * width + x] = v
      }
    }
  }
  return out
}

/** Morphological close (dilate then erode) using separable passes */
export function morphClose(mask, width, height, radius = 4) {
  let m = dilate1D(mask, width, height, radius, true)
  m = dilate1D(m, width, height, radius, false)
  m = erode1D(m, width, height, radius, true)
  m = erode1D(m, width, height, radius, false)
  return m
}

// ---------------------------------------------------------------------------
// Convex hull (Andrew's monotone chain)
// ---------------------------------------------------------------------------

/** Compute convex hull of a set of {x,y} points. Returns hull points in CCW order. */
export function convexHull(points) {
  if (points.length <= 1) return points.slice()
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (O, A, B) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x)

  // Lower hull
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  // Upper hull
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

// ---------------------------------------------------------------------------
// Connected components (two-pass union-find)
// ---------------------------------------------------------------------------

function ufFind(parent, x) {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]]   // path compression
    x = parent[x]
  }
  return x
}

/**
 * Find blobs in a binary mask.
 * Returns array of { x, y, w, h, cx, cy, area }
 * where x,y,w,h are the bounding box and cx,cy is the centroid.
 */
export function findBlobs(mask, width, height, minArea = 200) {
  const labels = new Int32Array(mask.length).fill(-1)
  const parent = []

  let nextLabel = 0

  // First pass: assign provisional labels with union-find
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!mask[i]) continue

      const above = y > 0 ? labels[(y - 1) * width + x] : -1
      const left  = x > 0 ? labels[y * width + x - 1] : -1

      if (above < 0 && left < 0) {
        labels[i] = nextLabel
        parent.push(nextLabel)
        nextLabel++
      } else if (above >= 0 && left < 0) {
        labels[i] = ufFind(parent, above)
      } else if (above < 0 && left >= 0) {
        labels[i] = ufFind(parent, left)
      } else {
        const ra = ufFind(parent, above)
        const rl = ufFind(parent, left)
        if (ra !== rl) parent[ra] = rl
        labels[i] = rl
      }
    }
  }

  // Second pass: collect blob stats by root label
  const stats = new Map()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (labels[i] < 0) continue
      const root = ufFind(parent, labels[i])
      let b = stats.get(root)
      if (!b) {
        b = { minX: x, maxX: x, minY: y, maxY: y, sumX: 0, sumY: 0, count: 0, edgePixels: [] }
        stats.set(root, b)
      }
      if (x < b.minX) b.minX = x
      if (x > b.maxX) b.maxX = x
      if (y < b.minY) b.minY = y
      if (y > b.maxY) b.maxY = y
      b.sumX += x; b.sumY += y; b.count++

      // Collect boundary pixels (at least one neighbor is background)
      const isEdge =
        x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
        !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]
      if (isEdge) b.edgePixels.push({ x, y })
    }
  }

  const blobs = []
  for (const b of stats.values()) {
    if (b.count >= minArea) {
      // Simplify edge pixels via convex hull
      const hull = convexHull(b.edgePixels)
      blobs.push({
        x: b.minX, y: b.minY,
        w: b.maxX - b.minX + 1,
        h: b.maxY - b.minY + 1,
        cx: b.sumX / b.count,
        cy: b.sumY / b.count,
        area: b.count,
        hull,
      })
    }
  }
  return blobs
}

// ---------------------------------------------------------------------------
// Frame helpers
// ---------------------------------------------------------------------------

/**
 * Compute per-pixel absolute difference between two ImageData objects.
 * Returns a new ImageData with the result.
 */
export function absDiff(imgA, imgB) {
  const result = new Uint8ClampedArray(imgA.data.length)
  for (let i = 0; i < imgA.data.length; i++) {
    result[i] = Math.abs(imgA.data[i] - imgB.data[i])
  }
  return new ImageData(result, imgA.width, imgA.height)
}

/**
 * Downsample an ImageData by integer factor (nearest-neighbour).
 * Returns a new ImageData of size (floor(w/factor), floor(h/factor)).
 */
export function downsample(imageData, factor) {
  const sw = imageData.width, sh = imageData.height
  const dw = Math.floor(sw / factor), dh = Math.floor(sh / factor)
  const out = new Uint8ClampedArray(dw * dh * 4)
  const src = imageData.data
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const si = (y * factor * sw + x * factor) * 4
      const di = (y * dw + x) * 4
      out[di]     = src[si]
      out[di + 1] = src[si + 1]
      out[di + 2] = src[si + 2]
      out[di + 3] = 255
    }
  }
  return new ImageData(out, dw, dh)
}

// ---------------------------------------------------------------------------
// Brightness mask (for calibration diff images)
// ---------------------------------------------------------------------------

/**
 * Binary mask where average brightness (R+G+B)/3 exceeds threshold (0-255).
 * More robust than HSV-based masks on absDiff images.
 */
export function brightnessMask(imageData, threshold = 50) {
  const { data, width, height } = imageData
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const avg = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3
    if (avg > threshold) mask[i] = 1
  }
  return mask
}

// ---------------------------------------------------------------------------
// Multi-frame averaging
// ---------------------------------------------------------------------------

/**
 * Capture `count` frames via captureFrame(), average pixel values.
 * Reduces temporal noise by ~sqrt(count).
 * @param {Function} captureFrame — returns offscreen canvas with current webcam frame
 * @param {number} count — number of frames to average
 * @param {number} delayMs — ms between captures (default 50)
 * @returns {Promise<ImageData|null>}
 */
export async function averageFrames(captureFrame, count = 5, delayMs = 50) {
  const frames = []
  for (let i = 0; i < count; i++) {
    const canvas = captureFrame()
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (i < count - 1) await new Promise(r => setTimeout(r, delayMs))
  }

  const { width, height } = frames[0]
  const acc = new Float32Array(width * height * 4)
  for (const frame of frames) {
    for (let i = 0; i < frame.data.length; i++) acc[i] += frame.data[i]
  }

  const out = new Uint8ClampedArray(acc.length)
  const invN = 1 / count
  for (let i = 0; i < acc.length; i++) out[i] = Math.round(acc[i] * invN)
  return new ImageData(out, width, height)
}
