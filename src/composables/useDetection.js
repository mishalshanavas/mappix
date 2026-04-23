/**
 * useDetection — yellow sticky note detection at 5 Hz.
 *
 * Detection pipeline runs in a Web Worker (OffscreenCanvas-free approach):
 * main thread captures ImageData and transfers the pixel buffer to the worker;
 * worker runs downsample → yellow HSV mask → morphClose → findBlobs and posts
 * raw blobs back; main thread applies temporal smoothing + transformPoint.
 *
 * Temporal smoothing: blobs must appear in CONFIRM_FRAMES consecutive frames
 * before becoming active, and disappear for REMOVE_FRAMES consecutive frames
 * before being removed. Prevents single-frame glitches from adding/removing
 * physics bodies.
 *
 * startDetection(captureFrame, transformPoint)
 * updateSettings({ hueMin, hueMax, satMin, valMin, minBlobArea })
 */
import { ref } from 'vue'

const DEFAULT_DETECTION_INTERVAL = 200   // 5 Hz
const DOWNSAMPLE_FACTOR = 2         // must match worker default
const CONFIRM_FRAMES = 2            // frames a new blob must appear before going active
const REMOVE_FRAMES  = 3            // frames a blob must be absent before removal
const MATCH_DIST_PX  = 80           // max centroid distance to match blobs across frames
const SMOOTH_ALPHA   = 0.15         // EMA factor: lower = smoother outline (0 = frozen, 1 = raw)
const HULL_RESAMPLE  = 24           // fixed number of equidistant points per hull

/**
 * Resample a convex hull to N equidistant points along its perimeter.
 * This ensures hull point counts are always identical across frames,
 * enabling per-point EMA smoothing even when raw hull topology changes.
 */
function _resampleHull(hull, n) {
  if (!hull || hull.length < 3) return hull
  // Compute cumulative perimeter distances
  const len = hull.length
  const cumDist = [0]
  for (let i = 1; i <= len; i++) {
    const a = hull[i - 1], b = hull[i % len]
    cumDist.push(cumDist[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const totalLen = cumDist[len]
  if (totalLen < 1e-6) return hull

  const out = []
  for (let k = 0; k < n; k++) {
    const target = (k / n) * totalLen
    // Find segment containing this distance
    let seg = 0
    while (seg < len - 1 && cumDist[seg + 1] < target) seg++
    const segLen = cumDist[seg + 1] - cumDist[seg]
    const t = segLen > 1e-6 ? (target - cumDist[seg]) / segLen : 0
    const a = hull[seg], b = hull[(seg + 1) % len]
    out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
  }
  return out
}

export function useDetection() {
  const detectedRects = ref([])
  let _timer  = null
  let _worker = null
  let _busy   = false
  let _detectionInterval = DEFAULT_DETECTION_INTERVAL
  let _getVideoEl = null

  let _s = { hueMin: 15, hueMax: 70, satMin: 8, valMin: 55, minBlobArea: 50 }

  // Tracked blob state: { id, cx, cy, w, h, hull, seenFor, missedFor, active }
  let _tracked = []
  let _nextId  = 1
  let _transformPoint = null

  function updateSettings(s) { _s = { ..._s, ...s } }

  /** Nearest-centroid match between raw worker blobs and tracked blobs */
  function _matchBlobs(rawBlobs) {
    const F = DOWNSAMPLE_FACTOR
    const tp = _transformPoint

    const detections = rawBlobs.map(b => {
      let hull = (b.hull && b.hull.length >= 3)
        ? b.hull.map(p => tp(p.x * F, p.y * F))
        : [
            tp(b.x * F, b.y * F),
            tp((b.x + b.w) * F, b.y * F),
            tp((b.x + b.w) * F, (b.y + b.h) * F),
            tp(b.x * F, (b.y + b.h) * F),
          ]
      hull = _resampleHull(hull, HULL_RESAMPLE)
      const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length
      const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length
      return { cx, cy, w: Math.abs(b.w * F), h: Math.abs(b.h * F), hull }
    })

    for (const t of _tracked) t._matchedThisFrame = false

    // Greedy nearest-centroid matching
    for (const det of detections) {
      let bestTrack = null
      let bestDist = MATCH_DIST_PX

      for (const t of _tracked) {
        if (t._matchedThisFrame) continue
        const dx = t.cx - det.cx, dy = t.cy - det.cy
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < bestDist) { bestDist = d; bestTrack = t }
      }

      if (bestTrack) {
        const a = SMOOTH_ALPHA
        const b = 1 - a
        bestTrack.cx = b * bestTrack.cx + a * det.cx
        bestTrack.cy = b * bestTrack.cy + a * det.cy
        bestTrack.w  = b * bestTrack.w  + a * det.w
        bestTrack.h  = b * bestTrack.h  + a * det.h
        // Always smooth hull per-point (both are resampled to HULL_RESAMPLE length)
        if (bestTrack.hull && bestTrack.hull.length === det.hull.length) {
          for (let i = 0; i < det.hull.length; i++) {
            bestTrack.hull[i] = {
              x: b * bestTrack.hull[i].x + a * det.hull[i].x,
              y: b * bestTrack.hull[i].y + a * det.hull[i].y,
            }
          }
        } else {
          bestTrack.hull = det.hull
        }
        bestTrack.seenFor++
        bestTrack.missedFor = 0
        bestTrack._matchedThisFrame = true
        if (bestTrack.seenFor >= CONFIRM_FRAMES) bestTrack.active = true
      } else {
        _tracked.push({
          id: _nextId++,
          cx: det.cx, cy: det.cy, w: det.w, h: det.h, hull: det.hull,
          seenFor: 1, missedFor: 0, active: false,
          _matchedThisFrame: true,
        })
      }
    }

    _tracked = _tracked.filter(t => {
      if (!t._matchedThisFrame) {
        t.missedFor++
        t.seenFor = 0
      }
      return t.missedFor < REMOVE_FRAMES
    })

    detectedRects.value = _tracked
      .filter(t => t.active)
      .map(t => ({ id: t.id, cx: t.cx, cy: t.cy, w: t.w, h: t.h, angle: 0, hull: t.hull }))
  }

  /** Shared timer tick — captures a frame and sends it to the worker. */
  async function _tick() {
    if (_busy) return
    const video = _getVideoEl?.()
    if (!video || video.readyState < 2) return
    _busy = true
    try {
      const bmp = await createImageBitmap(video)
      // Guard against worker being terminated during the async gap above
      if (!_worker) { _busy = false; return }
      _worker.postMessage(
        { bitmap: bmp, settings: { ..._s }, downsampleFactor: DOWNSAMPLE_FACTOR },
        [bmp]
      )
    } catch {
      _busy = false
    }
  }

  function startDetection(getVideoEl, transformPoint) {
    if (_timer) clearInterval(_timer)
    if (_worker) _worker.terminate()
    _tracked = []
    _busy = false
    _transformPoint = transformPoint
    _getVideoEl = getVideoEl

    let _restarts = 0
    function _initWorker() {
      _worker = new Worker(
        new URL('../workers/detection.worker.js', import.meta.url),
        { type: 'module' }
      )
      _worker.onmessage = ({ data: { blobs } }) => {
        _busy = false
        _matchBlobs(blobs)
      }
      _worker.onerror = (e) => {
        console.error('[Detection worker]', e)
        _busy = false
        if (_restarts < 3) {
          _restarts++
          console.warn(`[Detection] Restarting worker (${_restarts}/3)`)
          _worker.terminate()
          _initWorker()
        }
      }
    }
    _initWorker()

    _timer = setInterval(_tick, _detectionInterval)
  }

  /** Adjust detection rate to match a target FPS. Detection runs at ~1/4 of render FPS. */
  function setTargetFps(fps) {
    _detectionInterval = Math.max(100, Math.round(1000 / Math.max(1, fps / 4)))
    // Restart timer if already running
    if (_timer && _getVideoEl) {
      clearInterval(_timer)
      _timer = setInterval(_tick, _detectionInterval)
    }
  }

  function stopDetection() {
    if (_timer) { clearInterval(_timer); _timer = null }
    if (_worker) { _worker.terminate(); _worker = null }
    _tracked = []
    _busy = false
    detectedRects.value = []
  }

  return { detectedRects, startDetection, stopDetection, updateSettings, setTargetFps }
}
