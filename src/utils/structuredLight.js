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

function sleep(ms) {
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
    gray[i] = Math.round((img.data[i * 4] + img.data[i * 4 + 1] + img.data[i * 4 + 2]) / 3)
  }
  return { data: gray, width: img.width, height: img.height }
}

/**
 * Capture and average N grayscale frames for noise reduction.
 * Reduces temporal noise by ~sqrt(count).
 */
export async function captureAveragedGrayscale(captureFrame, count = 2, delayMs = 40) {
  const frames = []
  for (let i = 0; i < count; i++) {
    const f = captureGrayscale(captureFrame)
    if (!f) return null
    frames.push(f)
    if (i < count - 1) await sleep(delayMs)
  }

  const { width, height } = frames[0]
  const n = width * height
  const acc = new Float32Array(n)
  for (const f of frames) {
    for (let i = 0; i < n; i++) acc[i] += f.data[i]
  }

  const result = new Uint8Array(n)
  const inv = 1 / count
  for (let i = 0; i < n; i++) result[i] = Math.round(acc[i] * inv)
  return { data: result, width, height }
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

      // Sort by projector X and pick the median — robust to outlier pixels
      pts.sort((a, b) => a.px - b.px)
      const mid = Math.floor(pts.length / 2)
      srcPts.push([pts[mid].cx, pts[mid].cy])
      dstPts.push([pts[mid].px, pts[mid].py])
    }
  }

  return { srcPts, dstPts }
}
