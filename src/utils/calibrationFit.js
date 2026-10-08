import { applyHomography, computeHomographyRANSAC, invertHomography } from './homography.js'
import { isValidQuad, polygonArea } from './geometry.js'
import { convexHull } from './imageUtils.js'

export function mappingCorners(H, width, height, cameraWidth, cameraHeight) {
  const inverse = invertHomography(H)
  if (!inverse) return null
  const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(p => applyHomography(inverse, ...p))
  if (!isValidQuad(corners)) return null
  const marginX = cameraWidth * .05, marginY = cameraHeight * .05
  if (corners.some(p => p.x < -marginX || p.x > cameraWidth + marginX || p.y < -marginY || p.y > cameraHeight + marginY)) return null
  // A projective pole inside the calibrated surface cannot describe a wall.
  const denominators = corners.map(p => H[6] * p.x + H[7] * p.y + H[8])
  if (!(denominators.every(v => v > 1e-8) || denominators.every(v => v < -1e-8))) return null
  return corners
}

export function fitCalibration(srcPts, dstPts, width, height, cameraWidth, cameraHeight) {
  if (srcPts.length < 32) throw new Error('Need at least 32 distributed calibration cells')
  const train = [], check = []
  srcPts.forEach((_, i) => (i % 4 === 0 ? check : train).push(i))
  const result = computeHomographyRANSAC(train.map(i => srcPts[i]), train.map(i => dstPts[i]), 6, 500)
  if (result.inliers < 18 || result.inliers / train.length < .65 || result.error > 6) throw new Error('Too few reliable calibration cells')
  const errors = check.map(i => {
    const p = applyHomography(result.H, ...srcPts[i])
    return Math.hypot(p.x - dstPts[i][0], p.y - dstPts[i][1])
  }).sort((a, b) => a - b)
  const validationError = errors[Math.floor(errors.length * .75)]
  if (!Number.isFinite(validationError) || validationError > 8) throw new Error('Mapping failed independent validation')
  const points = result.inlierIndices.map(i => dstPts[train[i]]).map(([x, y]) => ({ x, y }))
  const coverage = polygonArea(convexHull(points)) / (width * height)
  const regions = new Set(points.map(p => `${Math.min(3, Math.floor(p.x / width * 4))},${Math.min(3, Math.floor(p.y / height * 4))}`))
  if (coverage < .4 || regions.size < 10) throw new Error('Camera must see more of the projected area')
  const corners = mappingCorners(result.H, width, height, cameraWidth, cameraHeight)
  if (!corners) throw new Error('Projected corners fall outside the camera view or mapping is unstable')
  return { H: result.H, corners, quality: {
    error: +result.error.toFixed(1), validationError: +validationError.toFixed(1),
    inliers: result.inliers, total: train.length, validPct: Math.round(coverage * 100),
  } }
}
