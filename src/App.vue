<template>
  <div class="app-root">
    <!-- Main projector canvas -->
    <ProjectorCanvas
      ref="canvasComponent"
      :engine="engine"
      :debug="debug"
      :appState="appState"
      :calibrationMarkers="calibrationMarkers"
      :showMarkers="showMarkers"
      :isCalibrated="isCalibrated"
      :detectedRects="detectedRects"
      :showWebcamBg="showWebcamBg"
      :videoEl="videoEl"
      :maxBalls="phys.maxBalls"
      :physicsPaused="!policy.simulate"
      :previewOnly="manualCalibActive || pickingColor"
      :calibrationQuality="calibrationQuality"
      :showOutlines="showOutlines"
      :targetFps="perf.targetFps"
      @canvas-ready="onCanvasReady"
      @resize="onCanvasResize"
    />

    <!-- Color pick overlay -->
    <div v-if="pickingColor" class="pick-overlay" @click="onCanvasClick">
      <div class="pick-hint">Click on a sticky note to pick its color · Esc to cancel</div>
    </div>

    <!-- Manual calibration overlay (4-corner warp) -->
    <div v-if="manualCalibActive" class="manual-calib-overlay"
      @pointermove="onManualOverlayPointerMove"
      @pointerup="onManualOverlayPointerUp"
      @pointercancel="onManualOverlayPointerUp"
    >
      <!-- Grid lines -->
      <svg class="manual-grid mc-grid-interactive" :viewBox="`0 0 ${canvasWidth()} ${canvasHeight()}`" preserveAspectRatio="none">
        <defs>
          <clipPath id="mc-clip">
            <polygon :points="manualDragCorners ? manualDragCorners.map(c => `${c.x},${c.y}`).join(' ') : ''" />
          </clipPath>
        </defs>
        <!-- Quad fill — clickable to drag entire selection -->
        <polygon
          :points="manualDragCorners ? manualDragCorners.map(c => `${c.x},${c.y}`).join(' ') : ''"
          fill="rgba(255,255,255,0.03)" stroke="#3b82f6" stroke-width="2"
          style="cursor: move;"
          @pointerdown="onManualQuadPointerDown($event)"
        />
        <!-- Interior grid (5×5) clipped to quad -->
        <g clip-path="url(#mc-clip)" v-if="manualDragCorners" style="pointer-events: none;">
          <template v-for="i in 4" :key="'gh'+i">
            <line
              :x1="lerp4(manualDragCorners, 3, 0, i/5).x" :y1="lerp4(manualDragCorners, 3, 0, i/5).y"
              :x2="lerp4(manualDragCorners, 2, 1, i/5).x" :y2="lerp4(manualDragCorners, 2, 1, i/5).y"
              stroke="rgba(59,130,246,0.25)" stroke-width="1"
            />
          </template>
          <template v-for="i in 4" :key="'gv'+i">
            <line
              :x1="lerp4(manualDragCorners, 0, 1, i/5).x" :y1="lerp4(manualDragCorners, 0, 1, i/5).y"
              :x2="lerp4(manualDragCorners, 3, 2, i/5).x" :y2="lerp4(manualDragCorners, 3, 2, i/5).y"
              stroke="rgba(59,130,246,0.25)" stroke-width="1"
            />
          </template>
        </g>
      </svg>

      <!-- Draggable corner handles -->
      <div v-for="(c, idx) in manualDragCorners" :key="idx"
        class="mc-handle" :class="{ selected: manualSelectedIdx === idx }"
        :style="{ left: (c.x / canvasWidth() * 100) + '%', top: (c.y / canvasHeight() * 100) + '%' }"
        @pointerdown="onManualCornerPointerDown(idx, $event)"
      >
        <span class="mc-label">{{ ['TL','TR','BR','BL'][idx] }}</span>
      </div>

      <!-- Controls bar -->
      <div class="mc-bar">
        <div class="mc-bar-info">
          Place corners on the projected area in the camera view. Drag inside to move all · Drag corners to warp · Arrows nudge<template v-if="manualSelectedIdx >= 0"> {{ ['TL','TR','BR','BL'][manualSelectedIdx] }}</template><template v-else> all</template> · Shift ×10 · [ / ] select corners · Tab controls
        </div>
        <div class="mc-bar-btns">
          <button class="mc-btn cancel" @click="onManualCancel">Cancel</button>
          <button class="mc-btn apply" @click="onManualApply">Apply</button>
        </div>
      </div>
    </div>

    <!-- Settings panel (left sidebar) -->
    <SettingsPanel
      v-show="appState !== 'calibrating'"
      :inert="manualCalibActive || pickingColor || !sessionStarted || tourVisible"
      :open="settingsOpen"
      :cameras="cameras"
      :selectedCamera="selectedCamera"
      @select-camera="onCameraChange"
      :appState="appState"
      :webcamOn="webcamReady"
      :isCalibrated="isCalibrated"
      :debug="debug"
      :showWebcamBg="showWebcamBg"
      :fps="fps"
      :ballCount="ballCount"
      :stickyCount="stickyCount"
      :spawnInterval="phys.spawnInterval"
      :ballSize="phys.ballSize"
      :bounciness="phys.bounciness"
      :gravity="phys.gravity"
      :maxBalls="phys.maxBalls"
      :hueMin="det.hueMin"
      :hueMax="det.hueMax"
      :satMin="det.satMin"
      :valMin="det.valMin"
      :minBlobArea="det.minBlobArea"
      :calibStep="calibProgress.step"
      :calibTotal="calibProgress.total"
      :calibMessage="calibProgress.message"
      :calibrationQuality="calibrationQuality"
      :targetFps="perf.targetFps"
      @toggle="settingsOpen = !settingsOpen"
      @toggle-webcam="onToggleWebcam"
      @calibrate="onCalibrate"
      @manual-calibrate="onManualCalibrate"
      @skip-calibration="onSkipCalibration"
      @reset-calibration="onResetCalibration"
      @clear-balls="clearBalls"
      @reset-physics="onResetPhysics"
      @reset-detection="onResetDetection"
      @toggle-fullscreen="toggleFullscreen"
      @toggle-pause="physicsPaused = !physicsPaused"
      :paused="physicsPaused"
      @retry-detection="detectionError = ''; restartDetection()"
      :showOutlines="showOutlines"
      @update:debug="debug = $event"
      @update:showWebcamBg="showWebcamBg = $event"
      @update:showOutlines="showOutlines = $event"
      @update:spawnInterval="phys.spawnInterval = $event; pushPhysicsSettings()"
      @update:ballSize="phys.ballSize = $event; pushPhysicsSettings()"
      @update:bounciness="phys.bounciness = $event; pushPhysicsSettings()"
      @update:gravity="phys.gravity = $event; pushPhysicsSettings()"
      @update:maxBalls="phys.maxBalls = $event; pushPhysicsSettings()"
      @update:hueMin="det.hueMin = $event; pushDetectionSettings()"
      @update:hueMax="det.hueMax = $event; pushDetectionSettings()"
      @update:satMin="det.satMin = $event; pushDetectionSettings()"
      @update:valMin="det.valMin = $event; pushDetectionSettings()"
      @update:minBlobArea="det.minBlobArea = $event; pushDetectionSettings()"
      @update:targetFps="perf.targetFps = $event; pushPerfSettings()"
      @pick-color="onPickColor"
      @open-tour="tourVisible = true"
    />

    <div v-if="notice && appState !== 'calibrating'" class="app-notice" role="status">{{ notice }} <button @click="notice = ''" aria-label="Dismiss message">×</button></div>
    <!-- Progress is announced without covering the projected calibration patterns. -->
    <div v-if="appState === 'calibrating'" class="sr-only" role="status">{{ calibProgress.message }}. Press Escape to cancel.</div>

    <!-- Mobile blocker -->
    <div class="mobile-block">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
      </svg>
      <h2>Desktop Only</h2>
      <p>mappix requires a webcam and a large screen.<br>Please open this on a desktop or laptop.</p>
    </div>

    <!-- Setup tour -->
    <Transition name="fade">
      <SetupTour
        v-if="(!sessionStarted || tourVisible) && interactionMode !== 'calibrating'"
        :cameraState="tourCameraState"
        :cameras="cameras"
        :selectedCamera="selectedCamera"
        :videoStream="videoEl?.srcObject"
        @select-camera="onCameraChange"
        :isCalibrated="isCalibrated"
        :closeable="sessionStarted"
        @request-camera="onTourCameraRequest"
        @calibrate="tourVisible = false; onCalibrate()"
        @skip-calibration="tourVisible = false; onSkipCalibration()"
        @close="tourVisible = false"
      />
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'

import ProjectorCanvas from './components/ProjectorCanvas.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import SetupTour from './components/SetupTour.vue'

import { sessionPolicy } from './utils/session.js'
import { cameraViewport, cameraToCanvas, canvasToCamera } from './utils/coordinates.js'
import { physicsDefaults, detectionDefaults, performanceDefaults, loadSettings, saveSettings, wrapHue } from './utils/settings.js'
import { useWebcam } from './composables/useWebcam.js'
import { usePhysics } from './composables/usePhysics.js'
import { useCalibration } from './composables/useCalibration.js'
import { useDetection } from './composables/useDetection.js'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const sessionStarted = ref(false)
const cameraPending = ref(false)
const cameraError = ref('')
const selectedCamera = ref('')
const interactionMode = ref('normal')
const pageHidden = ref(document.hidden)
const debug = ref(false)
const showWebcamBg = ref(false)
const showOutlines = ref(true)
const showMarkers = ref(true)
const physicsPaused = ref(false)
const settingsOpen = ref(false)
const tourVisible = ref(false)
const tourCameraState = computed(() => cameraPending.value ? 'loading' : webcamReady.value ? 'ready' : cameraError.value ? (cameraError.value === 'NotAllowedError' ? 'denied' : 'error') : 'idle')

// Canvas ref
let _canvas = null
const canvasWidth  = () => _canvas?.width ?? window.innerWidth
const canvasHeight = () => _canvas?.height ?? window.innerHeight

// Reactive settings objects – loaded from localStorage with defaults
const _physDefaults = physicsDefaults
const _detDefaults = detectionDefaults
const phys = reactive(loadSettings('dm-phys', physicsDefaults))
const det = reactive(loadSettings('dm-det', detectionDefaults))
const perf = reactive(loadSettings('dm-perf', performanceDefaults))
const notice = ref('')
let calibrationController = null
let calibrationCapturing = false
let disposed = false

// ---------------------------------------------------------------------------
// Composables
// ---------------------------------------------------------------------------
const { videoEl, devices: cameras, refreshDevices, ready: webcamReady, startWebcam, stopWebcam, captureFrame, waitForNewFrame } = useWebcam()
const { engine, ballCount, startPhysics, stopPhysics, syncStaticBodies, updateSettings: updatePhysSettings, clearBalls, pausePhysics, resumePhysics } = usePhysics(canvasWidth, canvasHeight)
const { isCalibrated, calibrationMarkers, calibrationQuality, manualCorners, calibrate, transformPoint, resetCalibration, getDefaultCorners, applyManualCorners, validateContext } = useCalibration(() => ({
  width: canvasWidth(), height: canvasHeight(),
  cameraWidth: videoEl.value?.videoWidth, cameraHeight: videoEl.value?.videoHeight,
  deviceId: videoEl.value?.srcObject?.getVideoTracks()[0]?.getSettings().deviceId || '',
}))
const { error: detectionError, detectedRects, startDetection, stopDetection, updateSettings: updateDetSettings, setTargetFps } = useDetection()
const policy = computed(() => sessionPolicy({
  started: sessionStarted.value, ready: webcamReady.value, pending: cameraPending.value,
  cameraError: cameraError.value, mode: interactionMode.value, guide: tourVisible.value,
  hidden: pageHidden.value, paused: physicsPaused.value, detectionError: detectionError.value,
}))
const appState = computed(() => policy.value.state)
let detectionActive = false

function haltDetection() {
  stopDetection()
  detectionActive = false
}
function restartDetection() {
  haltDetection()
  reconcileSession()
}
function reconcileSession() {
  if (disposed) return
  if (!policy.value.detect) haltDetection()
  else if (!detectionActive) {
    detectionActive = true
    startDetection(() => videoEl.value, _scaledTransform())
  }
  if (policy.value.simulate) resumePhysics(); else pausePhysics()
}
watch(policy, reconcileSession)

function pushPhysicsSettings()  { updatePhysSettings({ ...phys }); saveSettings('dm-phys', { ...phys }) }
function pushDetectionSettings() { updateDetSettings({ ...det }); saveSettings('dm-det', { ...det }) }
function pushPerfSettings() { setTargetFps(perf.targetFps); saveSettings('dm-perf', { ...perf }) }

function onResetPhysics() {
  clearBalls()
  Object.assign(phys, _physDefaults)
  pushPhysicsSettings()
}

function onResetDetection() {
  Object.assign(det, _detDefaults)
  pushDetectionSettings()
}

// ---------------------------------------------------------------------------
// Derived stats
// ---------------------------------------------------------------------------
const fps = ref(0)
const calibProgress = reactive({ step: 0, total: 1, message: '' })
const canvasComponent = ref(null)
const stickyCount = computed(() => detectedRects.value.length)

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
let _fpsTimer = null

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  document.addEventListener('visibilitychange', onVisibilityChange)
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
  startPhysics()
  pushPhysicsSettings()
  pushDetectionSettings()
  pushPerfSettings()
  pausePhysics()
})

onUnmounted(() => {
  disposed = true
  calibrationController?.abort()
  window.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
  stopDetection()
  stopPhysics()
  stopWebcam()
  if (_fpsTimer) clearInterval(_fpsTimer)
})

// ---------------------------------------------------------------------------
// Tour camera request (step 3 of SetupTour)
// ---------------------------------------------------------------------------
function onVisibilityChange() {
  pageHidden.value = document.hidden
  if (document.hidden) calibrationController?.abort()
}

async function openCamera() {
  if (cameraPending.value || webcamReady.value) return
  cameraPending.value = true
  cameraError.value = ''
  try {
    await startWebcam(selectedCamera.value || null)
    if (disposed) return
    _startFpsPolling()
    validateContext()
  } catch (error) {
    if (disposed || error.name === 'AbortError') return
    cameraError.value = error.name || 'Error'
    notice.value = error.message || 'Camera unavailable. Check the connection and try again.'
  } finally {
    cameraPending.value = false
  }
}
async function onCameraChange(deviceId) {
  if (cameraPending.value || calibrationController || interactionMode.value !== 'normal') return
  selectedCamera.value = deviceId
  haltDetection()
  pausePhysics()
  stopWebcam()
  resetCalibration()
  detectionError.value = ''
  await openCamera()
}
async function onTourCameraRequest() { await openCamera() }

watch(webcamReady, ready => {
  if (!ready) {
    if (interactionMode.value === 'manual' || interactionMode.value === 'picking') showWebcamBg.value = previousWebcamBg
    interactionMode.value = calibrationController ? 'calibrating' : 'normal'
    calibrationController?.abort()
    haltDetection()
    pausePhysics()
    if (sessionStarted.value) settingsOpen.value = true
  }
})

async function onToggleWebcam() {
  if (cameraPending.value || calibrationController) return
  if (webcamReady.value) {
    haltDetection()
    pausePhysics()
    stopWebcam()
  } else {
    detectionError.value = ''
    await openCamera()
  }
}

async function onCalibrate() {
  if (!_canvas || !webcamReady.value || calibrationController || manualCalibActive.value || pickingColor.value) return
  calibrationController = new AbortController()
  const signal = calibrationController.signal
  interactionMode.value = 'calibrating'
  haltDetection()
  pausePhysics()
  settingsOpen.value = false
  tourVisible.value = false
  notice.value = ''
  calibProgress.step = 0; calibProgress.total = 1; calibProgress.message = 'Starting…'
  try {
    if (!document.fullscreenElement) {
      try { await document.documentElement.requestFullscreen() } catch { /* fullscreen is optional */ }
      await new Promise(r => setTimeout(r, 400))
    }
    await nextTick()
    calibrationCapturing = true
    validateContext()
    const ok = await calibrate(_canvas, captureFrame, waitForNewFrame, (step, total, message) => {
      Object.assign(calibProgress, { step, total, message })
    }, signal)
    notice.value = ok ? 'Calibration saved.' : 'Calibration failed. Check the camera view and lighting, then retry or use Manual.'
  } catch (err) {
    notice.value = signal.aborted ? 'Calibration cancelled. Retry after positioning your display.' : `Calibration failed: ${err.message}`
  } finally {
    calibrationController = null
    calibrationCapturing = false
    if (!disposed) {
      sessionStarted.value = true
      interactionMode.value = 'normal'
      reconcileSession()
      settingsOpen.value = true
    }
  }
}

function onSkipCalibration() {
  if (!webcamReady.value || calibrationController) return
  sessionStarted.value = true
  tourVisible.value = false
  detectionError.value = ''
}

function onResetCalibration() {
  if (calibrationController) return
  resetCalibration()
  restartDetection()
}

// ---------------------------------------------------------------------------
// Manual calibration (4-corner warp)
// ---------------------------------------------------------------------------
const manualCalibActive = computed(() => interactionMode.value === 'manual')
const manualDragCorners = ref(null)   // [{x,y},...] during manual calib
const manualSelectedIdx = ref(-1)     // which corner is being dragged (-1 = none)
const manualPointerDragging = ref(false)
let previousWebcamBg = false
const manualDragAll = ref(false)       // true = dragging entire quad
const manualDragOrigin = ref(null)     // { x, y, corners } — snapshot when drag-all started

function onManualCalibrate() {
  if (!_canvas || !webcamReady.value || calibrationController || pickingColor.value) return
  previousWebcamBg = showWebcamBg.value
  haltDetection()
  pausePhysics()
  notice.value = ''
  validateContext()
  // Initialize corners — use existing manual corners or defaults
  manualDragCorners.value = manualCorners.value
    ? manualCorners.value.map(p => cameraToCanvas(p, currentViewport()))
    : getDefaultCorners(videoEl.value.videoWidth, videoEl.value.videoHeight).map(p => cameraToCanvas(p, currentViewport()))
  manualSelectedIdx.value = -1
  interactionMode.value = 'manual'
  // Show webcam background so user can see alignment
  if (!showWebcamBg.value) showWebcamBg.value = true
}

function onManualCornerPointerDown(idx, e) {
  e.preventDefault()
  manualSelectedIdx.value = idx
  manualPointerDragging.value = true
  e.currentTarget.setPointerCapture(e.pointerId)
  manualDragAll.value = false
}

function onManualQuadPointerDown(e) {
  // Click inside the quad polygon → drag all corners together
  if (!manualDragCorners.value) return
  e.preventDefault()
  const rect = _canvas.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * canvasWidth()
  const y = ((e.clientY - rect.top) / rect.height) * canvasHeight()
  manualDragAll.value = true
  e.currentTarget.setPointerCapture(e.pointerId)
  manualSelectedIdx.value = -1
  manualDragOrigin.value = {
    x, y,
    corners: manualDragCorners.value.map(c => ({ ...c })),
  }
}

function onManualOverlayPointerMove(e) {
  if (!manualDragCorners.value) return
  const rect = _canvas.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * canvasWidth()
  const y = ((e.clientY - rect.top) / rect.height) * canvasHeight()

  if (manualDragAll.value && manualDragOrigin.value) {
    // Move all corners by the delta from the drag start
    const dx = x - manualDragOrigin.value.x
    const dy = y - manualDragOrigin.value.y
    const orig = manualDragOrigin.value.corners
    for (let i = 0; i < 4; i++) {
      manualDragCorners.value[i] = { x: orig[i].x + dx, y: orig[i].y + dy }
    }
    return
  }

  if (manualPointerDragging.value && manualSelectedIdx.value >= 0) {
    manualDragCorners.value[manualSelectedIdx.value] = { x, y }
  }
}

function onManualOverlayPointerUp() {
  manualPointerDragging.value = false
  manualDragAll.value = false
  manualDragOrigin.value = null
}

function onManualNudge(dx, dy) {
  if (!manualDragCorners.value) return
  if (manualSelectedIdx.value >= 0) {
    // Nudge single corner
    const c = manualDragCorners.value[manualSelectedIdx.value]
    c.x += dx
    c.y += dy
  } else {
    // Nudge all corners
    for (const c of manualDragCorners.value) {
      c.x += dx
      c.y += dy
    }
  }
}

function onManualApply() {
  if (!manualDragCorners.value) return
  const w = canvasWidth(), h = canvasHeight()

  const srcCornersWebcam = manualDragCorners.value.map(c => canvasToCamera(c, currentViewport()))
  if (srcCornersWebcam.some(p => !p)) { notice.value = 'Keep every corner inside the camera image.'; return }

  // Destination = full canvas corners (projector output)
  const dstCorners = [
    { x: 0, y: 0 }, { x: w, y: 0 },
    { x: w, y: h }, { x: 0, y: h },
  ]
  const ok = applyManualCorners(srcCornersWebcam, dstCorners)
  if (!ok) { notice.value = 'Corners must form a convex shape without crossing or overlapping.'; return }
  finishManualCalibration()
}

function finishManualCalibration() {
  interactionMode.value = 'normal'
  onManualOverlayPointerUp()
  showWebcamBg.value = previousWebcamBg
  notice.value = ''
  reconcileSession()
}
function onManualCancel() { finishManualCalibration() }

function currentViewport() {
  return cameraViewport(videoEl.value?.videoWidth || 640, videoEl.value?.videoHeight || 480, canvasWidth(), canvasHeight())
}

function _scaledTransform() {
  if (!validateContext()) notice.value = 'Saved calibration no longer matches the camera or display. Recalibrate for accurate alignment.'
  return isCalibrated.value ? transformPoint : (x, y) => cameraToCanvas({ x, y }, currentViewport())
}

function _startFpsPolling() {
  if (_fpsTimer) return
  _fpsTimer = setInterval(() => {
    if (canvasComponent.value) fps.value = canvasComponent.value.getFps()
  }, 500)
}

// ---------------------------------------------------------------------------
// Sync stickies → physics
// ---------------------------------------------------------------------------
watch(detectedRects, rects => syncStaticBodies(rects))
watch(detectionError, error => { if (error) { notice.value = error; settingsOpen.value = true } })

// ---------------------------------------------------------------------------
// Canvas callbacks
// ---------------------------------------------------------------------------
function onCanvasReady(canvas) { _canvas = canvas }
function onCanvasResize() {
  if (calibrationCapturing) calibrationController?.abort()
  if (isCalibrated.value) {
    resetCalibration()
    notice.value = 'Display size changed. Recalibrate for accurate alignment.'
  }
  if (manualCalibActive.value) onManualCancel()
  else if (policy.value.detect) restartDetection()
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
function onKeyDown(e) {
  const key = e.key.toLowerCase()
  if (e.ctrlKey || e.metaKey || e.altKey || e.target?.closest?.('input, textarea, select, [contenteditable=true]')) return
  if (calibrationController) {
    if (key === 'escape') calibrationController.abort()
    return
  }
  if (pickingColor.value) {
    if (key === 'escape') finishColorPick()
    return
  }
  if (!sessionStarted.value || tourVisible.value) return

  // Manual calibration keyboard shortcuts
  if (manualCalibActive.value) {
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowLeft')  { e.preventDefault(); onManualNudge(-step, 0); return }
    if (e.key === 'ArrowRight') { e.preventDefault(); onManualNudge(step, 0); return }
    if (e.key === 'ArrowUp')    { e.preventDefault(); onManualNudge(0, -step); return }
    if (e.key === 'ArrowDown')  { e.preventDefault(); onManualNudge(0, step); return }
    if (key === 'escape') { e.preventDefault(); onManualCancel(); return }
    if (e.target?.closest?.('button')) return
    if (key === 'enter')        { e.preventDefault(); onManualApply(); return }
    // Brackets select corners; Tab remains available for Apply and Cancel.
    if (key === '[' || key === ']') {
      e.preventDefault()
      manualSelectedIdx.value = ((manualSelectedIdx.value + 1 + (key === ']' ? 1 : 4)) % 5) - 1
      return
    }
    return
  }
  
  if (e.target?.closest?.('button') && (key === ' ' || key === 'enter')) return

  // Universal shortcuts
  if (key === 'h') settingsOpen.value = !settingsOpen.value
  else if (key === 'f') toggleFullscreen()
  else if (key === 'd') debug.value = !debug.value
  else if (key === 'c' && webcamReady.value && appState.value !== 'calibrating') onCalibrate()
  
  // Debug-only shortcuts
  else if (debug.value) {
    if (key === 'r') clearBalls()
    else if (key === 'b') showWebcamBg.value = !showWebcamBg.value
    else if (key === 'm') showMarkers.value = !showMarkers.value
    else if (key === ' ') {
      e.preventDefault()
      physicsPaused.value = !physicsPaused.value
    }
    else if (key === 'escape') emergencyReset()
  }
}

// ---------------------------------------------------------------------------
// Debug helper functions
// ---------------------------------------------------------------------------
function emergencyReset() {
  physicsPaused.value = false
  onResetPhysics()
  detectionError.value = ''
  restartDetection()
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {})
  else document.exitFullscreen().catch(() => {})
}

const pickingColor = computed(() => interactionMode.value === 'picking')

// Helper for grid lines interpolation between quad corners
function lerp4(corners, idxA, idxB, t) {
  return {
    x: corners[idxA].x + (corners[idxB].x - corners[idxA].x) * t,
    y: corners[idxA].y + (corners[idxB].y - corners[idxA].y) * t,
  }
}

function onPickColor() {
  if (!videoEl.value || !webcamReady.value || calibrationController || manualCalibActive.value) return
  previousWebcamBg = showWebcamBg.value
  interactionMode.value = 'picking'
  // Temporarily show webcam bg so user can see what they're picking
  if (!showWebcamBg.value) showWebcamBg.value = true
}

function finishColorPick() {
  notice.value = ''
  interactionMode.value = 'normal'
  showWebcamBg.value = previousWebcamBg
}

function onCanvasClick(e) {
  if (!pickingColor.value) return
  const vid = videoEl.value
  if (!vid || vid.readyState < 2) return

  // Sample pixel from video at click position, accounting for cover-scale letterbox
  const rect = _canvas.getBoundingClientRect()
  const canvasX = (e.clientX - rect.left) / rect.width * _canvas.width
  const canvasY = (e.clientY - rect.top) / rect.height * _canvas.height
  const vw = vid.videoWidth, vh = vid.videoHeight
  const sample = canvasToCamera({ x: canvasX, y: canvasY }, currentViewport())
  if (!sample) { notice.value = 'Choose a color inside the camera image.'; return }
  const px = Math.min(vw - 1, Math.floor(sample.x)), py = Math.min(vh - 1, Math.floor(sample.y))
  finishColorPick()

  const tmp = document.createElement('canvas')
  tmp.width = vw
  tmp.height = vh
  const tctx = tmp.getContext('2d')
  tctx.drawImage(vid, 0, 0)
  const [r, g, b] = tctx.getImageData(px, py, 1, 1).data
  // RGB → HSV
  const rf = r / 255, gf = g / 255, bf = b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6
    else if (max === gf) h = ((bf - rf) / d + 2) / 6
    else h = ((rf - gf) / d + 4) / 6
  }
  const hDeg = Math.round(h * 360)
  const s = max === 0 ? 0 : Math.round((d / max) * 100)
  const v = Math.round(max * 100)
  det.hueMin = wrapHue(hDeg - 25)
  det.hueMax = wrapHue(hDeg + 25)
  det.satMin = Math.max(5, Math.min(s - 30, 40))
  det.valMin = Math.max(20, Math.min(v - 30, 60))
  pushDetectionSettings()
  console.log(`[Pick] rgb(${r},${g},${b}) → H${hDeg}° S${s}% V${v}% → range ${det.hueMin}-${det.hueMax}°`)
}
</script>

<style scoped>
.app-notice { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 10001; max-width: 600px; padding: 12px 16px; background: #18181b; color: #fafafa; border: 1px solid #52525b; border-radius: 8px; font: 14px/1.5 system-ui; }
.app-notice button { margin-left: 12px; background: none; color: inherit; border: 0; cursor: pointer; }

.app-root {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #000;
}

.pick-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: crosshair;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 40px;
}
.pick-hint {
  background: rgba(0,0,0,0.75);
  color: #fff;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 13px;
  pointer-events: none;
}

/* ── Mobile blocker ── */
.mobile-block {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: #09090b;
  color: #a1a1aa;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  font-family: system-ui, sans-serif;
}
.mobile-block h2 { color: #e4e4e7; font-size: 20px; margin: 16px 0 8px; }
.mobile-block p  { font-size: 14px; line-height: 1.5; max-width: 280px; }
@media (max-width: 768px), (hover: none) and (pointer: coarse) {
  .mobile-block { display: flex; }
  .status-overlay, .sp, .pick-overlay { display: none !important; }
}


.fade-enter-active, .fade-leave-active { transition: opacity 0.4s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ── Manual calibration overlay ── */
.manual-calib-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  cursor: crosshair;
  touch-action: none;
}
.manual-grid {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.mc-grid-interactive {
  pointer-events: auto;
}
.mc-grid-interactive polygon {
  pointer-events: fill;
}
.mc-handle {
  position: absolute;
  width: 36px; height: 36px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2.5px solid #3b82f6;
  background: rgba(59,130,246,0.2);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, background 0.15s;
  z-index: 2;
}
.mc-handle:hover, .mc-handle.selected {
  border-color: #60a5fa;
  background: rgba(59,130,246,0.35);
  box-shadow: 0 0 12px rgba(59,130,246,0.4);
}
.mc-handle.selected { cursor: grabbing; }
.mc-label {
  font-size: 9px;
  font-weight: 700;
  color: #93c5fd;
  pointer-events: none;
  user-select: none;
  font-family: system-ui, sans-serif;
}
.mc-bar {
  position: fixed;
  top: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(9,9,11,0.92);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 3;
  font-family: system-ui, sans-serif;
}
.mc-bar-info {
  color: #a1a1aa;
  font-size: 13px;
}
.mc-bar-btns {
  display: flex;
  gap: 8px;
}
.mc-btn {
  border: none;
  border-radius: 8px;
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: system-ui, sans-serif;
  transition: background 0.15s;
}
.mc-btn.cancel {
  background: #27272a;
  color: #a1a1aa;
}
.mc-btn.cancel:hover { background: #3f3f46; }
.mc-btn.apply {
  background: #3b82f6;
  color: #fff;
}
.mc-btn.apply:hover { background: #2563eb; }
</style>
