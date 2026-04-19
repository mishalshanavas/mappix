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
      @canvas-ready="onCanvasReady"
      @resize="onCanvasResize"
    />

    <!-- Color pick overlay -->
    <div v-if="pickingColor" class="pick-overlay" @click="onCanvasClick">
      <div class="pick-hint">Click on a sticky note to pick its color</div>
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
      @toggle="settingsOpen = !settingsOpen"
      @toggle-webcam="onToggleWebcam"
      @calibrate="onCalibrate"
      @skip-calibration="onSkipCalibration"
      @reset-calibration="onResetCalibration"
      @clear-balls="clearBalls"
      @reset-physics="onResetPhysics"
      @reset-detection="onResetDetection"
      @toggle-fullscreen="toggleFullscreen"
      @update:debug="debug = $event"
      @update:showWebcamBg="showWebcamBg = $event"
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
      @pick-color="onPickColor"
    />

    <!-- Status overlay (only when not yet running) -->
    <Transition name="fade">
      <div v-if="appState === 'idle'" class="status-overlay">
        <div class="status-box">
          <div class="status-text">
            <button class="start-btn" @click="onStart">Click to Start</button>
            <div class="sub">Webcam access required · or open settings first</div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, watchEffect, onMounted, onUnmounted } from 'vue'

import ProjectorCanvas from './components/ProjectorCanvas.vue'
import SettingsPanel from './components/SettingsPanel.vue'

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
const showMarkers = ref(true)
const physicsPaused = ref(false)
const settingsOpen = ref(false)

// Canvas ref
let _canvas = null
const canvasWidth  = () => _canvas?.width ?? window.innerWidth
const canvasHeight = () => _canvas?.height ?? window.innerHeight

// Reactive settings objects – loaded from localStorage with defaults
const _physDefaults = { spawnInterval: 430, ballSize: 11, bounciness: 0.80, gravity: 0.85, maxBalls: 300 }
const _detDefaults  = { hueMin: 15, hueMax: 70, satMin: 8, valMin: 55, minBlobArea: 50 }
function _loadStorage(key, defaults) {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') } } catch { return { ...defaults } }
}
const phys = reactive(_loadStorage('dm-phys', _physDefaults))
const det  = reactive(_loadStorage('dm-det',  _detDefaults))

// ---------------------------------------------------------------------------
// Composables
// ---------------------------------------------------------------------------
const { videoEl, ready: webcamReady, startWebcam, stopWebcam, captureFrame } = useWebcam()
const { engine, ballCount, startPhysics, stopPhysics, syncStaticBodies, updateSettings: updatePhysSettings, clearBalls, pausePhysics, resumePhysics } = usePhysics(canvasWidth, canvasHeight)
const { isCalibrated, calibrationMarkers, calibrationQuality, calibrate, transformPoint, resetCalibration } = useCalibration()
const { detectedRects, startDetection, stopDetection, updateSettings: updateDetSettings } = useDetection()

function pushPhysicsSettings()  { updatePhysSettings({ ...phys }); localStorage.setItem('dm-phys', JSON.stringify({ ...phys })) }
function pushDetectionSettings() { updateDetSettings({ ...det }); localStorage.setItem('dm-det', JSON.stringify({ ...det })) }

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
// One-click start (idle → running)
// ---------------------------------------------------------------------------
async function onStart() {
  try {
    await startWebcam()
  } catch (err) {
    console.error('[App] Webcam error:', err)
    appState.value = err?.name === 'NotAllowedError' ? 'cam-denied' : 'error'
    return
  }
  _startFpsPolling()
  appState.value = 'running'
  startDetection(() => videoEl.value, _scaledTransform())
}

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
    startDetection(() => videoEl.value, _scaledTransform())
  } catch (err) {
    console.error('[App] Webcam error:', err)
    appState.value = err?.name === 'NotAllowedError' ? 'cam-denied' : 'error'
  }
}

async function onCalibrate() {
  if (!_canvas || !webcamReady.value) return
  stopDetection()
  appState.value = 'calibrating'
  calibProgress.step = 0; calibProgress.total = 1; calibProgress.message = 'Starting…'
  const ok = await calibrate(_canvas, captureFrame, (step, total, message) => {
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

/** Build a transform that scales webcam → canvas size when uncalibrated */
function _scaledTransform() {
  if (isCalibrated.value) {
    return (x, y) => transformPoint(x, y)
  }
  return (x, y) => {
    const cw = canvasWidth(), ch = canvasHeight()
    const ww = videoEl.value?.videoWidth || 640
    const wh = videoEl.value?.videoHeight || 480
    return { x: (x / ww) * cw, y: (y / wh) * ch }
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
function onCanvasResize() {}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
function onKeyDown(e) {
  const key = e.key.toLowerCase()
  
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

  // Sample pixel from video at click position
  const rect = _canvas.getBoundingClientRect()
  const sx = (e.clientX - rect.left) / rect.width
  const sy = (e.clientY - rect.top) / rect.height
  const tmp = document.createElement('canvas')
  tmp.width = vid.videoWidth
  tmp.height = vid.videoHeight
  const tctx = tmp.getContext('2d')
  tctx.drawImage(vid, 0, 0)
  const px = Math.round(sx * vid.videoWidth)
  const py = Math.round(sy * vid.videoHeight)
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

.status-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 100;
}

.status-box {
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  padding: 24px 36px;
  text-align: center;
  font-family: system-ui, sans-serif;
  pointer-events: auto;
}

.start-btn {
  background: #fff;
  color: #000;
  border: none;
  border-radius: 8px;
  padding: 12px 32px;
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
  font-family: system-ui, sans-serif;
  transition: background 0.15s;
}
.start-btn:hover { background: #e0e0e0; }

.status-text { color: #e0e0e0; font-size: 20px; font-weight: 500; }

.sub {
  font-size: 13px;
  color: rgba(255,255,255,0.45);
  margin-top: 8px;
  font-weight: 400;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.4s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
