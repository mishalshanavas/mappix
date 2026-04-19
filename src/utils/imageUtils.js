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
// ---------------------------------------------------------------------------
// Morphology (O(n) sliding-window separable passes)
// ---------------------------------------------------------------------------

function dilate1D(mask, width, height, radius, horizontal) {
  const out = new Uint8Array(mask.length)
  if (horizontal) {
    for (let y = 0; y < height; y++) {
      const row = y * width
      let count = 0
      for (let x = 0; x <= radius && x < width; x++) count += mask[row + x]
      for (let x = 0; x < width; x++) {
        if (count > 0) out[row + x] = 1
        const a = x + radius + 1
        if (a < width) count += mask[row + a]
        const r = x - radius
        if (r >= 0) count -= mask[row + r]
      }
    }
  } else {
    for (let x = 0; x < width; x++) {
      let count = 0
      for (let y = 0; y <= radius && y < height; y++) count += mask[y * width + x]
      for (let y = 0; y < height; y++) {
        if (count > 0) out[y * width + x] = 1
        const a = y + radius + 1
        if (a < height) count += mask[a * width + x]
        const r = y - radius
        if (r >= 0) count -= mask[r * width + x]
      }
    }
  }
  return out
}

function erode1D(mask, width, height, radius, horizontal) {
  const out = new Uint8Array(mask.length)
  const full = 2 * radius + 1
  if (horizontal) {
    for (let y = 0; y < height; y++) {
      const row = y * width
      let count = 0
      for (let x = 0; x <= radius && x < width; x++) count += mask[row + x]
      for (let x = 0; x < width; x++) {
        const wl = Math.max(0, x - radius)
        const wr = Math.min(width - 1, x + radius)
        out[row + x] = (wr - wl + 1 === full && count === full) ? 1 : 0
        const a = x + radius + 1
        if (a < width) count += mask[row + a]
        const r = x - radius
        if (r >= 0) count -= mask[row + r]
      }
    }
  } else {
    for (let x = 0; x < width; x++) {
      let count = 0
      for (let y = 0; y <= radius && y < height; y++) count += mask[y * width + x]
      for (let y = 0; y < height; y++) {
        const wt = Math.max(0, y - radius)
        const wb = Math.min(height - 1, y + radius)
        out[y * width + x] = (wb - wt + 1 === full && count === full) ? 1 : 0
        const a = y + radius + 1
        if (a < height) count += mask[a * width + x]
        const r = y - radius
        if (r >= 0) count -= mask[r * width + x]
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
        b = { minX: x, maxX: x, minY: y, maxY: y, sumX: 0, sumY: 0, count: 0, edgeXY: [] }
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
      if (isEdge) b.edgeXY.push(x, y)
    }
  }

  const blobs = []
  for (const b of stats.values()) {
    if (b.count >= minArea) {
      // Convert flat edge array to points, then compute convex hull
      const n = b.edgeXY.length >> 1
      const edgePts = new Array(n)
      for (let k = 0; k < n; k++) edgePts[k] = { x: b.edgeXY[k * 2], y: b.edgeXY[k * 2 + 1] }
      const hull = convexHull(edgePts)
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
