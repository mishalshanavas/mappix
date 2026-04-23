/**
 * Structured Light — Gray-code pattern projection & decoding.
 * Industry-standard approach for projector-camera calibration.
 *
 * Projects binary stripe patterns (Gray-code encoded) sequentially,
 * captures webcam response to each pattern + its inverse,
 * and decodes a per-pixel projector coordinate mapping.
 *
 * Gray codes ensure adjacent stripes differ by only 1 bit,
 * making decoding robust at stripe boundaries.
 */

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Gray code conversion
// ---------------------------------------------------------------------------

export function binaryToGray(n) {
  return n ^ (n >>> 1)
}

export function grayToBinary(gray) {
  let b = gray
  let mask = gray >>> 1
  while (mask > 0) {
    b ^= mask
    mask >>>= 1
  }
  return b
}

// ---------------------------------------------------------------------------
// Pattern rendering
// ---------------------------------------------------------------------------

/**
 * Draw a Gray code stripe pattern on a canvas 2D context.
 * Groups consecutive white stripes into batched fillRect calls for efficiency.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W — canvas width
 * @param {number} H — canvas height
 * @param {number} bit — which bit (0 = most significant)
 * @param {number} numBits — total bits for this axis
 * @param {boolean} vertical — true = vertical stripes (encoding projector X)
 * @param {boolean} inverse — invert the pattern
 */
export function drawGrayPattern(ctx, W, H, bit, numBits, vertical, inverse) {
  const total = 1 << numBits

  // Fill black background
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)

  // Draw white stripes (batched runs of consecutive white columns/rows)
  ctx.fillStyle = '#FFFFFF'
  const size = vertical ? W : H
  let runStart = -1

  for (let s = 0; s <= total; s++) {
    let on = false
    if (s < total) {
      const gray = binaryToGray(s)
      const bitVal = (gray >>> (numBits - 1 - bit)) & 1
      on = inverse ? !bitVal : !!bitVal
    }

    if (on && runStart < 0) {
      runStart = s
    } else if (!on && runStart >= 0) {
      const p0 = Math.floor(runStart * size / total)
      const p1 = Math.floor(s * size / total)
      if (p1 > p0) {
        if (vertical) ctx.fillRect(p0, 0, p1 - p0, H)
        else          ctx.fillRect(0, p0, W, p1 - p0)
      }
      runStart = -1
    }
  }
}

// ---------------------------------------------------------------------------
// Capture helpers
// ---------------------------------------------------------------------------

/**
 * Capture a single grayscale frame from the webcam.
 * @param {Function} captureFrame — returns offscreen canvas with webcam image
 * @returns {{ data: Uint8Array, width: number, height: number } | null}
 */
export function captureGrayscale(captureFrame) {
  const canvas = captureFrame()
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const gray = new Uint8Array(img.width * img.height)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2])
  }
  return { data: gray, width: img.width, height: img.height }
}

// ---------------------------------------------------------------------------
// Correspondence map decoding
// ---------------------------------------------------------------------------

/**
 * Decode the Gray code correspondence map.
 * For each camera pixel, computes the projector (x, y) it corresponds to.
 *
 * Only pixels where the projector light produces sufficient contrast
 * (white − black > minContrast) are considered valid.
 *
 * @param {Uint8Array} whiteGray — per-pixel brightness of all-white projection
 * @param {Uint8Array} blackGray — per-pixel brightness of all-black projection
 * @param {Int32Array} codeX — accumulated Gray code bits for projector X
 * @param {Int32Array} codeY — accumulated Gray code bits for projector Y
 * @param {number} camW, camH — camera dimensions
 * @param {number} projW, projH — projector dimensions
 * @param {number} numBitsV — vertical Gray code bits (for projector X)
 * @param {number} numBitsH — horizontal Gray code bits (for projector Y)
 * @param {number} minContrast — minimum (white−black) brightness to be valid
 * @returns {{ mapX: Float32Array, mapY: Float32Array, valid: Uint8Array }}
 */
export function decodeCorrespondenceMap(
  whiteGray, blackGray, codeX, codeY,
  camW, camH, projW, projH,
  numBitsV, numBitsH,
  minContrast = 25
) {
  const n = camW * camH
  const totalV = 1 << numBitsV
  const totalH = 1 << numBitsH
  const mapX = new Float32Array(n).fill(-1)
  const mapY = new Float32Array(n).fill(-1)
  const valid = new Uint8Array(n)

  for (let i = 0; i < n; i++) {
    // Reject pixels where projector light doesn't reach (low contrast)
    if ((whiteGray[i] - blackGray[i]) < minContrast) continue

    const binX = grayToBinary(codeX[i])
    const binY = grayToBinary(codeY[i])

    // Clamp to valid range
    if (binX >= totalV || binY >= totalH) continue

    valid[i] = 1
    mapX[i] = (binX + 0.5) * projW / totalV
    mapY[i] = (binY + 0.5) * projH / totalH
  }

  return { mapX, mapY, valid }
}

// ---------------------------------------------------------------------------
// Spatial consistency filter — removes isolated bit-flip errors
// ---------------------------------------------------------------------------

/**
 * Filter the decoded correspondence map for spatial consistency.
 * For each valid pixel, compare its decoded projector coords to the median
 * of its valid neighbors in a small window. If the deviation exceeds
 * `maxDev` projector pixels, invalidate it.
 *
 * @param {Float32Array} mapX — projector X per camera pixel
 * @param {Float32Array} mapY — projector Y per camera pixel
 * @param {Uint8Array} valid — validity mask (modified in place)
 * @param {number} camW, camH — camera dimensions
 * @param {number} projW, projH — projector dimensions
 * @param {number} radius — neighborhood radius (default 2 → 5×5 window)
 */
export function filterCorrespondenceMap(mapX, mapY, valid, camW, camH, projW, projH, radius = 2) {
  // Expected projector-pixel stride per camera pixel
  const strideX = projW / camW
  const strideY = projH / camH
  // Allow deviation of up to 3× the local stride (handles perspective distortion)
  const maxDevX = Math.max(4, strideX * 3 * (2 * radius + 1))
  const maxDevY = Math.max(4, strideY * 3 * (2 * radius + 1))

  // Work on a copy so we don't invalidate pixels that are needed as neighbors
  const filtered = new Uint8Array(valid)
  const buf = []

  for (let cy = radius; cy < camH - radius; cy++) {
    for (let cx = radius; cx < camW - radius; cx++) {
      const i = cy * camW + cx
      if (!valid[i]) continue

      // Gather valid neighbor projector coords
      buf.length = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue
          const j = (cy + dy) * camW + (cx + dx)
          if (valid[j]) buf.push(j)
        }
      }

      if (buf.length < 3) { filtered[i] = 0; continue }

      // Median of neighbor X values
      buf.sort((a, b) => mapX[a] - mapX[b])
      const medX = mapX[buf[buf.length >> 1]]

      // Median of neighbor Y values
      buf.sort((a, b) => mapY[a] - mapY[b])
      const medY = mapY[buf[buf.length >> 1]]

      if (Math.abs(mapX[i] - medX) > maxDevX || Math.abs(mapY[i] - medY) > maxDevY) {
        filtered[i] = 0
      }
    }
  }

  // Also invalidate border pixels (no full neighborhood available)
  for (let cy = 0; cy < camH; cy++) {
    for (let cx = 0; cx < camW; cx++) {
      if (cy < radius || cy >= camH - radius || cx < radius || cx >= camW - radius) {
        filtered[cy * camW + cx] = 0
      }
    }
  }

  // Copy back
  valid.set(filtered)
}

// ---------------------------------------------------------------------------
// Correspondence sampling
// ---------------------------------------------------------------------------

/**
 * Sample well-distributed correspondences from the decoded map.
 * Divides the camera image into a grid; in each cell, picks the median
 * correspondence point for robustness against outlier pixels.
 *
 * @param {Float32Array} mapX — projector X for each camera pixel
 * @param {Float32Array} mapY — projector Y for each camera pixel
 * @param {Uint8Array} valid — validity mask
 * @param {number} camW, camH — camera dimensions
 * @param {number} gridSize — subdivisions per axis (gridSize×gridSize cells)
 * @returns {{ srcPts: Array<[number,number]>, dstPts: Array<[number,number]> }}
 */
export function sampleCorrespondences(mapX, mapY, valid, camW, camH, gridSize = 8) {
  const cellW = camW / gridSize
  const cellH = camH / gridSize
  const srcPts = []
  const dstPts = []

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const x0 = Math.floor(gx * cellW)
      const x1 = Math.min(Math.floor((gx + 1) * cellW), camW)
      const y0 = Math.floor(gy * cellH)
      const y1 = Math.min(Math.floor((gy + 1) * cellH), camH)

      const pts = []
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * camW + x
          if (valid[i]) pts.push({ cx: x, cy: y, px: mapX[i], py: mapY[i] })
        }
      }

      if (pts.length < 10) continue

      // 2D median: find point closest to (medianX, medianY) for robust center
      const mid = Math.floor(pts.length / 2)
      pts.sort((a, b) => a.px - b.px)
      const medPx = pts[mid].px
      pts.sort((a, b) => a.py - b.py)
      const medPy = pts[mid].py

      let bestDist = Infinity, bestPt = pts[mid]
      for (const p of pts) {
        const d = (p.px - medPx) ** 2 + (p.py - medPy) ** 2
        if (d < bestDist) { bestDist = d; bestPt = p }
      }
      srcPts.push([bestPt.cx, bestPt.cy])
      dstPts.push([bestPt.px, bestPt.py])
    }
  }

  return { srcPts, dstPts }
}
