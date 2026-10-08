/**
 * useDetection — configurable color detection at 2.5–10 Hz.
 *
 * Detection pipeline runs in a Web Worker using OffscreenCanvas:
 * main thread captures and transfers an ImageBitmap to the worker;
 * worker runs downsample → yellow HSV mask → morphClose → findBlobs and posts
 * raw blobs back; main thread applies temporal smoothing + transformPoint.
 *
 * Two observations confirm an object; a 500 ms absence removes it. Matching
 * and time-based outline smoothing happen in camera coordinates.
 *
 * startDetection(captureFrame, transformPoint)
 * updateSettings({ hueMin, hueMax, satMin, valMin, minBlobArea })
 */
import { ref } from 'vue'
import { createBlobTracker } from '../utils/tracking.js'
import { polygonBounds } from '../utils/geometry.js'
import { detectionDefaults, normalizeSettings } from '../utils/settings.js'

const DEFAULT_DETECTION_INTERVAL = 200   // 5 Hz
const DOWNSAMPLE_FACTOR = 2         // must match worker default
export function useDetection() {
  const detectedRects = ref([])
  let _timer  = null
  let _worker = null
  let _busy   = false
  let lastCapture = 0
  let lastVideoTime = null
  let _detectionInterval = DEFAULT_DETECTION_INTERVAL
  let _getVideoEl = null

  let _s = { ...detectionDefaults }
  const error = ref('')

  const tracker = createBlobTracker()
  let _transformPoint = null

  function updateSettings(s) { _s = normalizeSettings({ ..._s, ...s }, detectionDefaults) }

  function _matchBlobs(rawBlobs) {
    const F = DOWNSAMPLE_FACTOR
    const tracks = tracker.update(rawBlobs.map(b => ({
      ...b, x: b.x * F, y: b.y * F, w: b.w * F, h: b.h * F,
      hull: b.hull?.map(p => ({ x: p.x * F, y: p.y * F })),
    })), performance.now())
    detectedRects.value = tracks.flatMap(track => {
      const hull = track.hull.map(p => _transformPoint(p.x, p.y))
      if (hull.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return []
      return [{ id: track.id, ...polygonBounds(hull), angle: 0, hull }]
    })
  }

  /** Shared timer tick — captures a frame and sends it to the worker. */
  async function _tick() {
    if (performance.now() - lastCapture > 2500) {
      stopDetection()
      error.value = 'Detection stopped receiving frames. Check the camera, then retry detection.'
      return
    }
    if (_busy) return
    const video = _getVideoEl?.()
    if (!video || video.readyState < 2) return
    if (video.currentTime === lastVideoTime) return
    lastVideoTime = video.currentTime
    lastCapture = performance.now()
    const worker = _worker
    _busy = true
    let bmp
    try {
      bmp = await createImageBitmap(video)
      // Guard against worker being terminated during the async gap above
      if (!worker || worker !== _worker) { bmp.close(); return }
      worker.postMessage(
        { bitmap: bmp, settings: { ..._s }, downsampleFactor: DOWNSAMPLE_FACTOR },
        [bmp]
      )
    } catch (err) {
      bmp?.close()
      if (worker === _worker) {
        stopDetection()
        error.value = `Detection stopped: ${err.message}. Restart the camera to retry.`
      }
    }
  }

  function startDetection(getVideoEl, transformPoint) {
    if (_timer) clearInterval(_timer)
    if (_worker) _worker.terminate()
    tracker.reset()
    lastCapture = performance.now()
    lastVideoTime = null
    detectedRects.value = []
    error.value = ''
    _busy = false
    _transformPoint = transformPoint
    _getVideoEl = getVideoEl

    let _restarts = 0
    function _initWorker() {
      _worker = new Worker(
        new URL('../workers/detection.worker.js', import.meta.url),
        { type: 'module' }
      )
      const worker = _worker
      _worker.onmessage = ({ data: { blobs } }) => {
        if (worker !== _worker) return
        _busy = false
        _matchBlobs(blobs)
      }
      _worker.onerror = (e) => {
        if (worker !== _worker) return
        console.error('[Detection worker]', e)
        _busy = false
        if (_restarts < 3) {
          _restarts++
          console.warn(`[Detection] Restarting worker (${_restarts}/3)`)
          _worker.terminate()
          lastCapture = performance.now()
          lastVideoTime = null
          try { _initWorker() } catch (err) {
            stopDetection()
            error.value = `Detection unavailable: ${err.message}`
          }
        } else {
          stopDetection()
          error.value = 'Object detection failed. Restart the camera or try a browser with OffscreenCanvas support.'
        }
      }
    }
    try { _initWorker() } catch (err) {
      stopDetection()
      error.value = `Detection unavailable: ${err.message}`
      return
    }

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
    tracker.reset()
    _busy = false
    detectedRects.value = []
  }

  return { error, detectedRects, startDetection, stopDetection, updateSettings, setTargetFps }
}
