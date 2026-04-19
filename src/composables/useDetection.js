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

const DETECTION_INTERVAL_MS = 200   // 5 Hz
const DOWNSAMPLE_FACTOR = 4         // must match worker default
const CONFIRM_FRAMES = 2            // frames a new blob must appear before going active
const REMOVE_FRAMES  = 3            // frames a blob must be absent before removal
const MATCH_DIST_PX  = 80           // max centroid distance to match blobs across frames

export function useDetection() {
  const detectedRects = ref([])
  let _timer  = null
  let _worker = null
  let _busy   = false

  // Live-tuneable settings
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

    // Build canvas-space detections from raw blobs
    const detections = rawBlobs.map(b => {
      const hull = (b.hull && b.hull.length >= 3)
        ? b.hull.map(p => tp(p.x * F, p.y * F))
        : [
            tp(b.x * F, b.y * F),
            tp((b.x + b.w) * F, b.y * F),
            tp((b.x + b.w) * F, (b.y + b.h) * F),
            tp(b.x * F, (b.y + b.h) * F),
          ]
      const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length
      const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length
      return { cx, cy, w: Math.abs(b.w * F), h: Math.abs(b.h * F), hull }
    })

    // Mark all tracked blobs as not matched this frame
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
        bestTrack.cx = det.cx
        bestTrack.cy = det.cy
        bestTrack.w  = det.w
        bestTrack.h  = det.h
        bestTrack.hull = det.hull
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

    // Increment missed counter for unmatched tracked blobs; remove stale
    _tracked = _tracked.filter(t => {
      if (!t._matchedThisFrame) {
        t.missedFor++
        t.seenFor = 0
      }
      return t.missedFor < REMOVE_FRAMES
    })

    // Expose only confirmed-active blobs
    detectedRects.value = _tracked
      .filter(t => t.active)
      .map(t => ({ id: t.id, cx: t.cx, cy: t.cy, w: t.w, h: t.h, angle: 0, hull: t.hull }))
  }

  function startDetection(getVideoEl, transformPoint) {
    if (_timer) clearInterval(_timer)
    if (_worker) _worker.terminate()
    _tracked = []
    _busy = false
    _transformPoint = transformPoint

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

    _timer = setInterval(async () => {
      if (_busy) return
      const video = getVideoEl()
      if (!video || video.readyState < 2) return
      _busy = true
      try {
        const bmp = await createImageBitmap(video)
        _worker.postMessage(
          { bitmap: bmp, settings: { ..._s }, downsampleFactor: DOWNSAMPLE_FACTOR },
          [bmp]
        )
      } catch {
        _busy = false
      }
    }, DETECTION_INTERVAL_MS)
  }

  function stopDetection() {
    if (_timer) { clearInterval(_timer); _timer = null }
    if (_worker) { _worker.terminate(); _worker = null }
    _tracked = []
    _busy = false
    detectedRects.value = []
  }

  return { detectedRects, startDetection, stopDetection, updateSettings }
}
