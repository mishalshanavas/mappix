// Pure policy: UI labels and background work are derived from the same inputs.
export function sessionPolicy({ started, ready, pending, cameraError, mode, guide, hidden, paused, detectionError }) {
  const active = started && ready && !cameraError && !pending && mode === 'normal' && !guide && !hidden
  let state = !started ? 'idle' : 'stopped'
  if (ready && started) state = 'running'
  if (active && paused) state = 'paused'
  if (active && detectionError) state = 'detection-error'
  if (ready && (guide || hidden)) state = 'ready'
  if (mode !== 'normal') state = mode
  if (cameraError) state = cameraError === 'NotAllowedError' ? 'cam-denied' : 'error'
  if (pending) state = 'loading'
  return { state, detect: active && !detectionError, simulate: active && !paused && !detectionError }
}
