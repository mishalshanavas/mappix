import { convexHull } from './imageUtils.js'
import { polygonArea, polygonBounds } from './geometry.js'

export function resampleHull(hull, count = 24) {
  const lengths = hull.map((p, i) => Math.hypot(p.x - hull[(i + 1) % hull.length].x, p.y - hull[(i + 1) % hull.length].y))
  const perimeter = lengths.reduce((a, b) => a + b, 0)
  if (perimeter < 1e-6) return []
  let segment = 0, offset = 0
  return Array.from({ length: count }, (_, i) => {
    const distance = i * perimeter / count
    while (segment < hull.length - 1 && offset + lengths[segment] < distance) offset += lengths[segment++]
    const p = hull[segment], q = hull[(segment + 1) % hull.length]
    const t = lengths[segment] ? (distance - offset) / lengths[segment] : 0
    return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) }
  })
}

// Align perimeter phase and winding before blending. Comparing centered points
// prevents translation from changing the selected correspondence.
export function alignHull(reference, incoming) {
  if (reference.length !== incoming.length) return incoming
  const n = reference.length
  const center = pts => ({ x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n })
  const a = center(reference), b = center(incoming)
  let best = incoming, bestCost = Infinity
  for (const direction of [1, -1]) {
    for (let shift = 0; shift < n; shift++) {
      const ordered = incoming.map((_, i) => incoming[(shift + direction * i + n) % n])
      const cost = ordered.reduce((sum, p, i) => sum + (p.x - b.x - reference[i].x + a.x) ** 2 + (p.y - b.y - reference[i].y + a.y) ** 2, 0)
      if (cost < bestCost) { bestCost = cost; best = ordered }
    }
  }
  return best
}

/** Track in camera pixels, so changing projector resolution does not change identity.
 * Tracks use unsmoothed observations for matching; render smoothing never drags
 * the match gate behind a moving object. Complete occlusion remains ambiguous.
 */
export function createBlobTracker() {
  let tracks = [], nextId = 1
  return {
    reset() { tracks = []; nextId = 1 },
    update(blobs, now) {
      tracks = tracks.filter(track => now - track.lastSeen < 500)
      const detections = blobs.map(b => {
        const hull = convexHull(b.hull?.length >= 3 ? b.hull : [
          { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
          { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
        ])
        if (hull.length < 3 || hull.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || polygonArea(hull) < 1) return null
        return { ...polygonBounds(hull), hull: resampleHull(hull), area: polygonArea(hull) }
      }).filter(Boolean)
      // Build every plausible pair, then consume the closest globally. Worker
      // scan order must not decide which track gets the best matching object.
      const pairs = []
      for (const track of tracks) {
        const dt = Math.min(500, Math.max(0, now - track.lastSeen))
        const px = track.raw.cx + track.vx * dt, py = track.raw.cy + track.vy * dt
        const gate = Math.max(30, Math.hypot(track.raw.w, track.raw.h) * .6) + dt * .08
        detections.forEach((det, index) => {
          const ratio = det.area / track.raw.area
          const distance = Math.hypot(det.cx - px, det.cy - py)
          if (distance <= gate && ratio > .3 && ratio < 3.3) pairs.push({ track, index, cost: distance / gate + Math.abs(Math.log(ratio)) * .3 })
        })
      }
      pairs.sort((a, b) => a.cost - b.cost || a.track.id - b.track.id)
      const matched = new Set(), used = new Set()
      for (const { track, index } of pairs) {
        if (matched.has(track.id) || used.has(index)) continue
        matched.add(track.id); used.add(index)
        const det = detections[index]
        const dt = Math.max(1, now - track.lastSeen)
        track.vx = (det.cx - track.raw.cx) / dt
        track.vy = (det.cy - track.raw.cy) / dt
        // ~100 ms time constant, independent of the detection/render FPS slider.
        const alpha = 1 - Math.exp(-dt / 100)
        const aligned = alignHull(track.hull, det.hull)
        track.hull = aligned.map((p, i) => ({ x: track.hull[i].x + alpha * (p.x - track.hull[i].x), y: track.hull[i].y + alpha * (p.y - track.hull[i].y) }))
        track.seen = track.missed ? 1 : track.seen + 1
        track.missed = 0
        track.active ||= track.seen >= 2
        track.lastSeen = now
        track.raw = det
      }
      tracks = tracks.filter(track => {
        if (matched.has(track.id)) return true
        track.missed++
        track.seen = 0
        return now - track.lastSeen < 500
      })
      detections.forEach((det, index) => {
        if (!used.has(index)) tracks.push({ id: nextId++, raw: det, hull: det.hull, vx: 0, vy: 0, seen: 1, missed: 0, active: false, lastSeen: now })
      })
      return tracks.filter(t => t.active).map(t => ({ id: t.id, hull: convexHull(t.hull) }))
    },
  }
}
