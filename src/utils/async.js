export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const finish = error => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve()
    }
    const abort = () => finish(signal.reason)
    const timer = setTimeout(() => finish(), ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function afterPaint(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const abort = () => { cancelAnimationFrame(frame); reject(signal.reason) }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        signal?.removeEventListener('abort', abort)
        resolve()
      })
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function waitForVideoFrame(video, timeoutMs = 1000, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    if (!video || video.readyState < 2) { reject(new Error('Camera is not providing frames')); return }
    let callback, pollTimer, deadline
    const startTime = video.currentTime
    const finish = error => {
      clearTimeout(deadline)
      clearTimeout(pollTimer)
      if (callback !== undefined) video.cancelVideoFrameCallback?.(callback)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve()
    }
    const abort = () => finish(signal.reason)
    deadline = setTimeout(() => finish(new Error('Camera frame timed out. Check the camera and retry.')), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback(() => finish())
    else {
      const poll = () => {
        if (video.currentTime !== startTime) finish()
        else pollTimer = setTimeout(poll, 16)
      }
      poll()
    }
  })
}
