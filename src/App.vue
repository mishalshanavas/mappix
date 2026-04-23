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
      :detectedRects="detectedRects"
      :showWebcamBg="showWebcamBg"
      :videoEl="videoEl"
      :maxBalls="phys.maxBalls"
      :physicsPaused="physicsPaused"
      :calibrationQuality="calibrationQuality"
      :showOutlines="showOutlines"
      :targetFps="perf.targetFps"
      @canvas-ready="onCanvasReady"
      @resize="onCanvasResize"
    />

    <!-- Color pick overlay -->
    <div v-if="pickingColor" class="pick-overlay" @click="onCanvasClick">
      <div class="pick-hint">Click on a sticky note to pick its color</div>
    </div>

    <!-- Manual calibration overlay (4-corner warp) -->
    <div v-if="manualCalibActive" class="manual-calib-overlay"
      @pointermove="onManualOverlayPointerMove"
      @pointerup="onManualOverlayPointerUp"
      @pointerleave="onManualOverlayPointerUp"
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
          Drag inside to move all · Drag corners to warp · Arrows nudge<template v-if="manualSelectedIdx >= 0"> {{ ['TL','TR','BR','BL'][manualSelectedIdx] }}</template><template v-else> all</template> · Shift ×10 · Tab cycle
        </div>
        <div class="mc-bar-btns">
          <button class="mc-btn cancel" @click="onManualCancel">Cancel</button>
          <button class="mc-btn apply" @click="onManualApply">Apply</button>
        </div>
      </div>
    </div>

    <!-- Settings panel (left sidebar) -->
    <SettingsPanel
      :open="settingsOpen"
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
        v-if="appState === 'idle' || tourVisible"
        :cameraState="tourCameraState"
        :closeable="appState !== 'idle'"
        @request-camera="onTourCameraRequest"
        @calibrate="tourVisible = false; onCalibrate()"
        @skip-calibration="tourVisible = false; onSkipCalibration()"
        @close="tourVisible = false"
      />
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, watchEffect, onMounted, onUnmounted } from 'vue'

import ProjectorCanvas from './components/ProjectorCanvas.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import SetupTour from './components/SetupTour.vue'

import { useWebcam } from './composables/useWebcam.js'
import { usePhysics } from './composables/usePhysics.js'
import { useCalibration } from './composables/useCalibration.js'
import { useDetection } from './composables/useDetection.js'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const appState = ref('idle')
const debug = ref(false)
const showWebcamBg = ref(false)
const showOutlines = ref(true)
const showMarkers = ref(true)
const physicsPaused = ref(false)
const settingsOpen = ref(false)
const tourVisible = ref(false)
const tourCameraState = ref('idle') // 'idle' | 'loading' | 'ready' | 'denied'

// Canvas ref
let _canvas = null
const canvasWidth  = () => _canvas?.width ?? window.innerWidth
const canvasHeight = () => _canvas?.height ?? window.innerHeight

// Reactive settings objects – loaded from localStorage with defaults
const _physDefaults = { spawnInterval: 430, ballSize: 11, bounciness: 0.80, gravity: 0.85, maxBalls: 300 }
const _detDefaults  = { hueMin: 15, hueMax: 70, satMin: 8, valMin: 55, minBlobArea: 50 }
const _perfDefaults = { targetFps: 60 }
function _loadStorage(key, defaults) {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') } } catch { return { ...defaults } }
}
const phys = reactive(_loadStorage('dm-phys', _physDefaults))
const det  = reactive(_loadStorage('dm-det',  _detDefaults))
const perf = reactive(_loadStorage('dm-perf', _perfDefaults))

// ---------------------------------------------------------------------------
// Composables
// ---------------------------------------------------------------------------
const { videoEl, ready: webcamReady, startWebcam, stopWebcam, captureFrame, waitForNewFrame } = useWebcam()
const { engine, ballCount, startPhysics, stopPhysics, syncStaticBodies, updateSettings: updatePhysSettings, clearBalls, pausePhysics, resumePhysics } = usePhysics(canvasWidth, canvasHeight)
const { isCalibrated, calibrationMarkers, calibrationQuality, manualCorners, calibrate, transformPoint, resetCalibration, getDefaultCorners, applyManualCorners } = useCalibration()
const { detectedRects, startDetection, stopDetection, updateSettings: updateDetSettings, setTargetFps } = useDetection()

function pushPhysicsSettings()  { updatePhysSettings({ ...phys }); localStorage.setItem('dm-phys', JSON.stringify({ ...phys })) }
function pushDetectionSettings() { updateDetSettings({ ...det }); localStorage.setItem('dm-det', JSON.stringify({ ...det })) }
function pushPerfSettings() { setTargetFps(perf.targetFps); localStorage.setItem('dm-perf', JSON.stringify({ ...perf })) }

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
  startPhysics()
  pushPhysicsSettings()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  stopDetection()
  stopPhysics()
  stopWebcam()
  if (_fpsTimer) clearInterval(_fpsTimer)
})

// ---------------------------------------------------------------------------
// Tour camera request (step 3 of SetupTour)
// ---------------------------------------------------------------------------
async function onTourCameraRequest() {
  if (webcamReady.value) { tourCameraState.value = 'ready'; return }
  tourCameraState.value = 'loading'
  try {
    await startWebcam()
    _startFpsPolling()
    setTargetFps(perf.targetFps)
    tourCameraState.value = 'ready'
  } catch (err) {
    console.error('[App] Tour camera error:', err)
    tourCameraState.value = 'denied'
  }
}

// Keep tourCameraState in sync with actual webcam state
watch(webcamReady, ready => {
  if (ready) tourCameraState.value = 'ready'
  else if (tourCameraState.value === 'ready') tourCameraState.value = 'idle'
})

// ---------------------------------------------------------------------------
// Settings-panel actions
// ---------------------------------------------------------------------------
async function onToggleWebcam() {
  if (webcamReady.value) {
    stopWebcam()
    stopDetection()
    appState.value = 'idle'
    return
  }
  try {
    await startWebcam()
    _startFpsPolling()
    appState.value = 'running'
    setTargetFps(perf.targetFps)
    startDetection(() => videoEl.value, _scaledTransform())
  } catch (err) {
    console.error('[App] Webcam error:', err)
    appState.value = err?.name === 'NotAllowedError' ? 'cam-denied' : 'error'
  }
}

async function onCalibrate() {
  if (!_canvas || !webcamReady.value) return
  stopDetection()

  // Auto-fullscreen and hide settings panel for clean calibration
  settingsOpen.value = false
  if (!document.fullscreenElement) {
    try { await document.documentElement.requestFullscreen() } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 400)) // wait for fullscreen transition
  }

  appState.value = 'calibrating'
  calibProgress.step = 0; calibProgress.total = 1; calibProgress.message = 'Starting…'
  const ok = await calibrate(_canvas, captureFrame, waitForNewFrame, (step, total, message) => {
    calibProgress.step = step
    calibProgress.total = total
    calibProgress.message = message
  })
  appState.value = 'running'
  startDetection(() => videoEl.value, ok ? (x, y) => transformPoint(x, y) : _scaledTransform())
  if (!ok) console.warn('[App] Calibration did not succeed — using identity transform')
}

function onSkipCalibration() {
  stopDetection()
  appState.value = 'running'
  startDetection(() => videoEl.value, _scaledTransform())
}

function onResetCalibration() {
  resetCalibration()
  stopDetection()
  if (appState.value === 'running') {
    startDetection(() => videoEl.value, _scaledTransform())
  }
}

// ---------------------------------------------------------------------------
// Manual calibration (4-corner warp)
// ---------------------------------------------------------------------------
const manualCalibActive = ref(false)
const manualDragCorners = ref(null)   // [{x,y},...] during manual calib
const manualSelectedIdx = ref(-1)     // which corner is being dragged (-1 = none)
const manualDragAll = ref(false)       // true = dragging entire quad
const manualDragOrigin = ref(null)     // { x, y, corners } — snapshot when drag-all started

function onManualCalibrate() {
  if (!_canvas || !webcamReady.value) return
  // Initialize corners — use existing manual corners or defaults
  const w = canvasWidth(), h = canvasHeight()
  manualDragCorners.value = manualCorners.value
    ? manualCorners.value.map(p => ({ ...p }))
    : getDefaultCorners(w, h)
  manualSelectedIdx.value = -1
  manualCalibActive.value = true
  // Show webcam background so user can see alignment
  if (!showWebcamBg.value) showWebcamBg.value = true
}

function onManualCornerPointerDown(idx, e) {
  e.preventDefault()
  manualSelectedIdx.value = idx
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

  if (manualSelectedIdx.value >= 0) {
    manualDragCorners.value[manualSelectedIdx.value] = { x, y }
  }
}

function onManualOverlayPointerUp() {
  manualSelectedIdx.value = -1
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
  const ww = videoEl.value?.videoWidth || 640
  const wh = videoEl.value?.videoHeight || 480

  // Convert drag corners from canvas space to webcam pixel space
  // (the webcam feed uses aspect-preserving fit, not stretch)
  const scale = Math.max(w / ww, h / wh)
  const ox = (w - ww * scale) / 2
  const oy = (h - wh * scale) / 2
  const srcCornersWebcam = manualDragCorners.value.map(c => ({
    x: (c.x - ox) / scale,
    y: (c.y - oy) / scale,
  }))

  // Destination = full canvas corners (projector output)
  const dstCorners = [
    { x: 0, y: 0 }, { x: w, y: 0 },
    { x: w, y: h }, { x: 0, y: h },
  ]
  const ok = applyManualCorners(srcCornersWebcam, dstCorners, manualDragCorners.value)
  manualCalibActive.value = false
  if (ok) {
    stopDetection()
    startDetection(() => videoEl.value, (x, y) => transformPoint(x, y))
  }
}

function onManualCancel() {
  manualCalibActive.value = false
}

/** Build a transform that scales webcam → canvas size when uncalibrated.
 *  Uses aspect-preserving zoom-to-fill (cover) so the canvas is fully covered. */
function _scaledTransform() {
  if (isCalibrated.value) {
    return (x, y) => transformPoint(x, y)
  }
  return (x, y) => {
    const cw = canvasWidth(), ch = canvasHeight()
    const ww = videoEl.value?.videoWidth || 640
    const wh = videoEl.value?.videoHeight || 480
    const scale = Math.max(cw / ww, ch / wh)
    const ox = (cw - ww * scale) / 2
    const oy = (ch - wh * scale) / 2
    return { x: x * scale + ox, y: y * scale + oy }
  }
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

// ---------------------------------------------------------------------------
// Canvas callbacks
// ---------------------------------------------------------------------------
function onCanvasReady(canvas) { _canvas = canvas }
function onCanvasResize() { /* reserved for future layout-dependent logic */ }

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
function onKeyDown(e) {
  const key = e.key.toLowerCase()

  // Manual calibration keyboard shortcuts
  if (manualCalibActive.value) {
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowLeft')  { e.preventDefault(); onManualNudge(-step, 0); return }
    if (e.key === 'ArrowRight') { e.preventDefault(); onManualNudge(step, 0); return }
    if (e.key === 'ArrowUp')    { e.preventDefault(); onManualNudge(0, -step); return }
    if (e.key === 'ArrowDown')  { e.preventDefault(); onManualNudge(0, step); return }
    if (key === 'enter')        { e.preventDefault(); onManualApply(); return }
    if (key === 'escape')       { e.preventDefault(); onManualCancel(); return }
    // Tab cycles through corners (and "all" mode)
    if (key === 'tab') {
      e.preventDefault()
      manualSelectedIdx.value = (manualSelectedIdx.value + 1) % 4
      return
    }
    return
  }
  
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
      if (physicsPaused.value) {
        resumePhysics()
        physicsPaused.value = false
      } else {
        pausePhysics()
        physicsPaused.value = true
      }
    }
    else if (key === 'escape') emergencyReset()
  }
}

// ---------------------------------------------------------------------------
// Debug helper functions
// ---------------------------------------------------------------------------
function emergencyReset() {
  clearBalls()
  stopDetection()
  physicsPaused.value = false
  resumePhysics()
  onResetPhysics()
  if (appState.value === 'running') {
    startDetection(() => videoEl.value, _scaledTransform())
  }
  console.log('[Debug] Emergency reset')
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {})
  else document.exitFullscreen().catch(() => {})
}

const pickingColor = ref(false)

// Helper for grid lines interpolation between quad corners
function lerp4(corners, idxA, idxB, t) {
  return {
    x: corners[idxA].x + (corners[idxB].x - corners[idxA].x) * t,
    y: corners[idxA].y + (corners[idxB].y - corners[idxA].y) * t,
  }
}

function onPickColor() {
  if (!videoEl.value || !webcamReady.value) return
  pickingColor.value = true
  // Temporarily show webcam bg so user can see what they're picking
  if (!showWebcamBg.value) showWebcamBg.value = true
}

function onCanvasClick(e) {
  if (!pickingColor.value) return
  pickingColor.value = false
  const vid = videoEl.value
  if (!vid || vid.readyState < 2) return

  // Sample pixel from video at click position, accounting for cover-scale letterbox
  const rect = _canvas.getBoundingClientRect()
  const canvasX = (e.clientX - rect.left) / rect.width * _canvas.width
  const canvasY = (e.clientY - rect.top) / rect.height * _canvas.height
  const cw = _canvas.width, ch = _canvas.height
  const vw = vid.videoWidth, vh = vid.videoHeight
  const coverScale = Math.max(cw / vw, ch / vh)
  const ox = (cw - vw * coverScale) / 2
  const oy = (ch - vh * coverScale) / 2
  const px = Math.max(0, Math.min(vw - 1, Math.round((canvasX - ox) / coverScale)))
  const py = Math.max(0, Math.min(vh - 1, Math.round((canvasY - oy) / coverScale)))

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
  det.hueMin = Math.max(0, hDeg - 25)
  det.hueMax = Math.min(360, hDeg + 25)
  det.satMin = Math.max(5, Math.min(s - 30, 40))
  det.valMin = Math.max(20, Math.min(v - 30, 60))
  pushDetectionSettings()
  console.log(`[Pick] rgb(${r},${g},${b}) → H${hDeg}° S${s}% V${v}% → range ${det.hueMin}-${det.hueMax}°`)
}
</script>

<style scoped>
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
