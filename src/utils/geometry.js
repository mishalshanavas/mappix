// Corners must follow the perimeter, with no crossing, collinearity, or collapsed edges.
export function isValidQuad(points) {
  if (!Array.isArray(points) || points.length !== 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false
  const turns = points.map((p, i) => {
    const q = points[(i + 1) % 4], r = points[(i + 2) % 4]
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x)
  })
  return turns.every(v => v > 1) || turns.every(v => v < -1)
}

export function polygonArea(points) {
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]
    return sum + p.x * q.y - q.x * p.y
  }, 0)) / 2
}

export function polygonBounds(hull) {
  const xs = hull.map(p => p.x), ys = hull.map(p => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  const w = Math.max(...xs) - x, h = Math.max(...ys) - y
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
}
