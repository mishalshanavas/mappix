/**
 * useWebcam — composable for webcam access and frame capture.
 *
 * Usage:
 *   const { videoEl, ready, startWebcam, stopWebcam, captureFrame } = useWebcam()
 *   await startWebcam()
 *   const canvas = captureFrame()  // returns offscreen canvas with current frame
 */
import { ref, shallowRef } from 'vue'

export function useWebcam() {
  const videoEl = shallowRef(null)
  const stream = shallowRef(null)
  const ready = ref(false)

  // Hidden offscreen canvas used for grabbing frames
  let _offscreenCanvas = null
  let _offscreenCtx = null

  async function startWebcam(deviceId = null) {
    const constraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {})
      },
      audio: false
    }

    stream.value = await navigator.mediaDevices.getUserMedia(constraints)

    const video = document.createElement('video')
    video.srcObject = stream.value
    video.playsInline = true
    video.muted = true
    await video.play()

    // Try to lock exposure & white balance so calibration frames are consistent
    try {
      const track = stream.value.getVideoTracks()[0]
      const caps = track.getCapabilities?.() || {}
      const adv = []
      if (caps.exposureMode) adv.push({ exposureMode: 'manual' })
      if (caps.whiteBalanceMode) adv.push({ whiteBalanceMode: 'manual' })
      if (adv.length) await track.applyConstraints({ advanced: adv })
    } catch (_) {
      // Not supported on all browsers — silently skip
    }

    videoEl.value = video
    ready.value = true
  }

  function stopWebcam() {
    if (stream.value) {
      stream.value.getTracks().forEach((t) => t.stop())
      stream.value = null
    }
    ready.value = false
  }

  /**
   * Draw the current video frame to an offscreen canvas and return it.
   * The returned canvas is reused each call — read it immediately.
   */
  function captureFrame() {
    const video = videoEl.value
    if (!video) return null

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
  function waitForNewFrame(timeoutMs = 500) {
    const video = videoEl.value
    if (!video) return Promise.resolve()

    // Preferred: requestVideoFrameCallback (Chrome 83+, Edge, Opera)
    if ('requestVideoFrameCallback' in video) {
      return new Promise(resolve => {
        const timer = setTimeout(resolve, timeoutMs)
        video.requestVideoFrameCallback(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }

    // Fallback: poll until currentTime changes
    const startTime = video.currentTime
    return new Promise(resolve => {
      const deadline = performance.now() + timeoutMs
      function poll() {
        if (video.currentTime !== startTime || performance.now() > deadline) {
          resolve()
        } else {
          requestAnimationFrame(poll)
        }
      }
      requestAnimationFrame(poll)
    })
  }

  return { videoEl, stream, ready, startWebcam, stopWebcam, captureFrame, waitForNewFrame }
}
