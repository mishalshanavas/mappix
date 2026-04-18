/**
 * Pure-JS homography estimation (DLT, normalised least-squares).
 * No OpenCV / WASM required.
 *
 * computeHomography(srcPts, dstPts)
 *   srcPts / dstPts  – arrays of [x, y] pairs  (≥4 correspondences)
 *   Returns a flat 9-element row-major H matrix (h33 = 1)
 *
 * applyHomography(H, x, y)
 *   Returns { x, y } in destination space.
 */

// ---------------------------------------------------------------------------
// Gauss-Jordan solver  ( A * h = b ,  A is n×n )
// ---------------------------------------------------------------------------
function gaussSolve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let maxRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row
    }
    ;[M[col], M[maxRow]] = [M[maxRow], M[col]]

    const pivot = M[col][col]
    if (Math.abs(pivot) < 1e-14) continue

    // Eliminate column in all other rows
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const f = M[row][col] / pivot
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k]
    }
  }

  return M.map((row, i) => row[n] / row[i])
}

// ---------------------------------------------------------------------------
// Normalise a set of 2-D points (zero mean, RMS distance = sqrt(2))
// Returns { pts: normalised points, T: 3×3 normalisation matrix (flat) }
// ---------------------------------------------------------------------------
function normalise(pts) {
  let mx = 0, my = 0
  for (const [x, y] of pts) { mx += x; my += y }
  mx /= pts.length; my /= pts.length

  let rms = 0
  for (const [x, y] of pts) rms += (x - mx) ** 2 + (y - my) ** 2
  rms = Math.sqrt(rms / pts.length)
  const s = rms < 1e-10 ? 1 : Math.SQRT2 / rms

  const norm = pts.map(([x, y]) => [(x - mx) * s, (y - my) * s])
  // T = [[s,0,-mx*s],[0,s,-my*s],[0,0,1]]  (flat, row-major)
  const T = [s, 0, -mx * s, 0, s, -my * s, 0, 0, 1]
  return { pts: norm, T }
}

// ---------------------------------------------------------------------------
// Multiply two 3×3 matrices (flat row-major)
// ---------------------------------------------------------------------------
function mat3x3mul(A, B) {
  const C = new Array(9)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]
    }
  }
  return C
}

// Invert a 3×3 matrix (flat row-major).  Returns null if singular.
function mat3x3inv(M) {
  const [a, b, c, d, e, f, g, h, k] = M
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-14) return null
  const inv_det = 1 / det
  return [
    (e * k - f * h) * inv_det, (c * h - b * k) * inv_det, (b * f - c * e) * inv_det,
    (f * g - d * k) * inv_det, (a * k - c * g) * inv_det, (c * d - a * f) * inv_det,
    (d * h - e * g) * inv_det, (b * g - a * h) * inv_det, (a * e - b * d) * inv_det,
  ]
}

// ---------------------------------------------------------------------------
// Main export: compute homography via normalised DLT + least-squares
// ---------------------------------------------------------------------------
export function computeHomography(srcPts, dstPts) {
  if (srcPts.length < 4) throw new Error('Need at least 4 correspondences')

  const { pts: srcN, T: Ts } = normalise(srcPts)
  const { pts: dstN, T: Td } = normalise(dstPts)

  const n = srcPts.length
  // Build 2N × 8 matrix A and vector b  (DLT with h33 = 1)
  const Arows = []
  const bvec = []

  for (let i = 0; i < n; i++) {
    const [x, y] = srcN[i]
    const [xp, yp] = dstN[i]
    Arows.push([x, y, 1, 0, 0, 0, -x * xp, -y * xp])
    bvec.push(xp)
    Arows.push([0, 0, 0, x, y, 1, -x * yp, -y * yp])
    bvec.push(yp)
  }

  // Normal equations: (A^T A) h = A^T b  →  8×8 system
  const nc = 8
  const AtA = Array.from({ length: nc }, () => new Array(nc).fill(0))
  const Atb = new Array(nc).fill(0)
  for (let i = 0; i < Arows.length; i++) {
    for (let j = 0; j < nc; j++) {
      Atb[j] += Arows[i][j] * bvec[i]
      for (let k = 0; k < nc; k++) AtA[j][k] += Arows[i][j] * Arows[i][k]
    }
  }

  const h = gaussSolve(AtA, Atb)   // 8 elements; h33 = 1

  // Hn (normalised space): flat 9-element row-major
  const Hn = [...h, 1]

  // Denormalise: H = Td^-1 * Hn * Ts
  const TdInv = mat3x3inv(Td)
  if (!TdInv) throw new Error('Degenerate destination points')
  const H = mat3x3mul(TdInv, mat3x3mul(Hn, Ts))

  // Normalise so H[8] = 1
  if (Math.abs(H[8]) > 1e-14) {
    const scale = 1 / H[8]
    for (let i = 0; i < 9; i++) H[i] *= scale
  }

  return H
}

// ---------------------------------------------------------------------------
// Apply H to a single point
// ---------------------------------------------------------------------------
export function applyHomography(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8]
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  }
}

// ---------------------------------------------------------------------------
// RANSAC wrapper — robust homography with outlier rejection
// ---------------------------------------------------------------------------

/**
 * Compute homography using RANSAC for robustness.
 * @param {Array} srcPts — [[x,y], ...] (≥4)
 * @param {Array} dstPts — [[x,y], ...]
 * @param {number} threshold — reprojection error threshold in pixels (default 5)
 * @param {number} iterations — number of RANSAC iterations (default 50)
 * @returns {{ H: number[], inliers: number, error: number }}
 */
export function computeHomographyRANSAC(srcPts, dstPts, threshold = 5, iterations = 50) {
  const n = srcPts.length
  if (n < 4) throw new Error('Need at least 4 correspondences for RANSAC')

  // If exactly 4, just compute directly
  if (n === 4) {
    const H = computeHomography(srcPts, dstPts)
    const err = _meanReprojError(H, srcPts, dstPts)
    return { H, inliers: 4, error: err }
  }

  let bestH = null
  let bestInliers = 0
  let bestError = Infinity

  for (let iter = 0; iter < iterations; iter++) {
    // Random 4-point sample (Fisher-Yates partial shuffle)
    const indices = Array.from({ length: n }, (_, i) => i)
    for (let i = 0; i < 4; i++) {
      const j = i + Math.floor(Math.random() * (n - i))
      ;[indices[i], indices[j]] = [indices[j], indices[i]]
    }
    const sample4 = indices.slice(0, 4)

    let H
    try {
      H = computeHomography(
        sample4.map(i => srcPts[i]),
        sample4.map(i => dstPts[i])
      )
    } catch { continue }

    // Count inliers
    let inlierCount = 0
    let totalErr = 0
    for (let i = 0; i < n; i++) {
      const proj = applyHomography(H, srcPts[i][0], srcPts[i][1])
      const dx = proj.x - dstPts[i][0]
      const dy = proj.y - dstPts[i][1]
      const err = Math.sqrt(dx * dx + dy * dy)
      if (err < threshold) {
        inlierCount++
        totalErr += err
      }
    }

    if (inlierCount > bestInliers || (inlierCount === bestInliers && totalErr < bestError)) {
      bestH = H
      bestInliers = inlierCount
      bestError = totalErr
    }
  }

  if (!bestH) throw new Error('RANSAC failed — no valid homography found')

  // Refit on all inliers for best accuracy
  const inlierSrc = []
  const inlierDst = []
  for (let i = 0; i < n; i++) {
    const proj = applyHomography(bestH, srcPts[i][0], srcPts[i][1])
    const dx = proj.x - dstPts[i][0]
    const dy = proj.y - dstPts[i][1]
    if (Math.sqrt(dx * dx + dy * dy) < threshold) {
      inlierSrc.push(srcPts[i])
      inlierDst.push(dstPts[i])
    }
  }

  if (inlierSrc.length >= 4) {
    try {
      bestH = computeHomography(inlierSrc, inlierDst)
    } catch { /* keep previous bestH */ }
  }

  const finalError = _meanReprojError(bestH, srcPts, dstPts)
  return { H: bestH, inliers: bestInliers, error: finalError }
}

function _meanReprojError(H, srcPts, dstPts) {
  let total = 0
  for (let i = 0; i < srcPts.length; i++) {
    const proj = applyHomography(H, srcPts[i][0], srcPts[i][1])
    const dx = proj.x - dstPts[i][0]
    const dy = proj.y - dstPts[i][1]
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total / srcPts.length
}
