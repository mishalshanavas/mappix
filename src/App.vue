<template>
  <div class="app-root">
    <!-- Main projector canvas -->
    <ProjectorCanvas
      ref="canvasComponent"
      :engine="engine"
      :debug="debug"
      :appState="appState"
      :calibrationMarkers="calibrationMarkers"
      :showMarkers="true"
      :detectedRects="detectedRects"
      :showWebcamBg="showWebcamBg"
      :videoEl="videoEl"
      @canvas-ready="onCanvasReady"
      @resize="onCanvasResize"
    />

    <!-- Settings panel (left sidebar) -->
    <SettingsPanel
      :open="settingsOpen"
      :autoHide="autoHide"
      :appState="appState"
      :webcamOn="webcamReady"
      :isCalibrated="isCalibrated"
      :debug="debug"
      :showWebcamBg="showWebcamBg"
      :fps="fps"
      :ballCount="ballCount"
      :stickyCount="stickyCount"
      :videoEl="videoEl"
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
      @toggle-fullscreen="toggleFullscreen"
      @update:debug="debug = $event"
      @update:showWebcamBg="showWebcamBg = $event"
      @update:autoHide="autoHide = $event"
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
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import Matter from 'matter-js'

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
const settingsOpen = ref(false)
const autoHide = ref(true)

// Canvas ref
let _canvas = null
const canvasWidth  = () => _canvas?.width ?? window.innerWidth
const canvasHeight = () => _canvas?.height ?? window.innerHeight

// Reactive settings objects
const phys = reactive({ spawnInterval: 430, ballSize: 11, bounciness: 0.80, gravity: 0.85, maxBalls: 300 })
const det  = reactive({ hueMin: 15, hueMax: 70, satMin: 8, valMin: 55, minBlobArea: 50 })

// ---------------------------------------------------------------------------
// Composables
// ---------------------------------------------------------------------------
const { videoEl, ready: webcamReady, startWebcam, stopWebcam, captureFrame } = useWebcam()
const { engine, startPhysics, stopPhysics, syncStaticBodies, updateSettings: updatePhysSettings, clearBalls } = usePhysics(canvasWidth, canvasHeight)
const { isCalibrated, calibrationMarkers, calibrationQuality, calibrate, transformPoint, resetCalibration } = useCalibration()
const { detectedRects, startDetection, stopDetection, updateSettings: updateDetSettings } = useDetection()

function pushPhysicsSettings()  { updatePhysSettings({ ...phys }) }
function pushDetectionSettings() { updateDetSettings({ ...det }) }

function onResetPhysics() {
  clearBalls()
  Object.assign(phys, { spawnInterval: 430, ballSize: 11, bounciness: 0.80, gravity: 0.85, maxBalls: 300 })
  pushPhysicsSettings()
}

// ---------------------------------------------------------------------------
// Derived stats
// ---------------------------------------------------------------------------
const fps = ref(0)
const calibProgress = reactive({ step: 0, total: 1, message: '' })
const canvasComponent = ref(null)
const ballCount = computed(() => {
  if (!engine.value) return 0
  return Matter.Composite.allBodies(engine.value.world).filter(b => !b.isStatic).length
})
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
  startDetection(captureFrame, _scaledTransform())
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
    startDetection(captureFrame, _scaledTransform())
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
  startDetection(captureFrame, ok ? (x, y) => transformPoint(x, y) : _scaledTransform())
  if (!ok) console.warn('[App] Calibration did not succeed — using identity transform')
}

function onSkipCalibration() {
  stopDetection()
  appState.value = 'running'
  startDetection(captureFrame, _scaledTransform())
}

function onResetCalibration() {
  resetCalibration()
  stopDetection()
  if (appState.value === 'running') {
    startDetection(captureFrame, _scaledTransform())
  }
}

/** Build a transform that scales webcam (640×480) → canvas size when uncalibrated */
function _scaledTransform() {
  if (isCalibrated.value) {
    return (x, y) => transformPoint(x, y)
  }
  return (x, y) => {
    const cw = canvasWidth(), ch = canvasHeight()
    const ww = 640, wh = 480
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
watch(detectedRects, rects => syncStaticBodies(rects), { deep: true })

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
  if (key === 'h') settingsOpen.value = !settingsOpen.value
  else if (key === 'f') toggleFullscreen()
  else if (key === 'd') debug.value = !debug.value
  else if (key === 'c' && webcamReady.value && appState.value !== 'calibrating') onCalibrate()
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {})
  else document.exitFullscreen().catch(() => {})
}
</script>

<style scoped>
.app-root {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #000;
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
