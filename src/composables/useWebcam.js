/**
 * useWebcam — composable for webcam access and frame capture.
 *
 * Usage:
 *   const { videoEl, ready, startWebcam, stopWebcam, captureFrame } = useWebcam()
 *   await startWebcam()
 *   const canvas = captureFrame()  // returns offscreen canvas with current frame
 */
import { ref, shallowRef } from 'vue'
import { waitForVideoFrame } from '../utils/async.js'

export function useWebcam() {
  const videoEl = shallowRef(null)
  const stream = shallowRef(null)
  const ready = ref(false)
  const devices = ref([])

  // Hidden offscreen canvas used for grabbing frames
  let _offscreenCanvas = null
  let _offscreenCtx = null

  let generation = 0
  let pending = null

  async function refreshDevices() {
    try { devices.value = (await navigator.mediaDevices?.enumerateDevices?.() || []).filter(device => device.kind === 'videoinput') } catch { devices.value = [] }
  }

  function startWebcam(deviceId = null) {
    if (ready.value) return Promise.resolve()
    if (pending) return pending
    const session = ++generation
    const request = openCamera(deviceId, session)
    pending = request
    request.finally(() => { if (pending === request) pending = null }).catch(() => {})
    return request
  }

  async function openCamera(deviceId, session) {
    let acquired = null
    let video = null
    const checkActive = () => {
      if (session !== generation) throw new DOMException('Camera request cancelled', 'AbortError')
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost and a supported browser')
      acquired = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
        audio: false,
      })
      checkActive()
      stream.value = acquired
      video = document.createElement('video')
      video.srcObject = acquired
      video.playsInline = true
      video.muted = true
      await video.play()
      checkActive()
      // Keep the camera's automatic exposure until a measured lock strategy exists.
      // Switching to manual with no exposure value can leave the feed black.
      videoEl.value = video
      ready.value = true
      await refreshDevices()
      checkActive()
      for (const track of acquired.getVideoTracks()) {
        track.addEventListener('ended', () => { if (session === generation) stopWebcam() }, { once: true })
      }
    } catch (err) {
      acquired?.getTracks().forEach(track => track.stop())
      if (video) video.srcObject = null
      if (session === generation) {
        stream.value = null
        videoEl.value = null
        ready.value = false
      }
      throw err
    }
  }

  function stopWebcam() {
    generation++
    pending = null
    stream.value?.getTracks().forEach(track => track.stop())
    stream.value = null
    if (videoEl.value) videoEl.value.srcObject = null
    videoEl.value = null
    ready.value = false
  }

  /**
   * Draw the current video frame to an offscreen canvas and return it.
   * The returned canvas is reused each call — read it immediately.
   */
  function captureFrame() {
    const video = videoEl.value
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null

    const w = video.videoWidth || 640
    const h = video.videoHeight || 480

    if (!_offscreenCanvas) {
      _offscreenCanvas = document.createElement('canvas')
      _offscreenCtx = _offscreenCanvas.getContext('2d', { willReadFrequently: true })
    }

    if (_offscreenCanvas.width !== w) _offscreenCanvas.width = w
    if (_offscreenCanvas.height !== h) _offscreenCanvas.height = h
    _offscreenCtx.drawImage(video, 0, 0, w, h)
    return _offscreenCanvas
  }

  /**
   * Wait until the video element has a genuinely new frame.
   * Uses requestVideoFrameCallback when available, falls back to polling currentTime.
   */
  function waitForNewFrame(timeoutMs = 1000, signal) {
    return waitForVideoFrame(videoEl.value, timeoutMs, signal)
  }

  return { videoEl, stream, ready, devices, refreshDevices, startWebcam, stopWebcam, captureFrame, waitForNewFrame }
}
