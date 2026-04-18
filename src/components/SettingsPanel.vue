<template>
  <div class="settings-panel" :class="{ open }">
    <!-- Toggle button (always visible) -->
    <button class="toggle-btn" @click="$emit('toggle')" :title="open ? 'Hide settings' : 'Show settings'">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path v-if="!open" d="M3 12h18M3 6h18M3 18h18" stroke-linecap="round"/>
        <path v-else d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/>
      </svg>
    </button>

    <div class="panel-body" v-show="open">
      <h2 class="panel-title">Settings</h2>

      <!-- ============== STATUS ============== -->
      <section class="section">
        <div class="status-row">
          <span class="status-dot" :class="statusClass" />
          <span class="status-label">{{ statusText }}</span>
        </div>
      </section>

      <!-- ============== CAMERA ============== -->
      <section class="section">
        <h3>Camera</h3>
        <button class="btn" @click="$emit('toggle-webcam')" :disabled="appState === 'calibrating'">
          {{ webcamOn ? 'Stop Webcam' : 'Start Webcam' }}
        </button>
        <label class="toggle-row" v-if="webcamOn">
          <span>Show Webcam BG</span>
          <input type="checkbox" :checked="showWebcamBg" @change="$emit('update:showWebcamBg', $event.target.checked)">
        </label>
      </section>

      <!-- ============== PHYSICS ============== -->
      <section class="section">
        <h3>Physics Controls</h3>
        <label class="slider-row">
          <span>Spawn Interval</span>
          <input type="range" min="50" max="1000" step="10" :value="spawnInterval"
            @input="$emit('update:spawnInterval', +$event.target.value)">
          <span class="val">{{ spawnInterval }}ms</span>
        </label>
        <label class="slider-row">
          <span>Ball Size</span>
          <input type="range" min="5" max="50" step="1" :value="ballSize"
            @input="$emit('update:ballSize', +$event.target.value)">
          <span class="val">{{ ballSize }}px</span>
        </label>
        <label class="slider-row">
          <span>Bounciness</span>
          <input type="range" min="0" max="1" step="0.05" :value="bounciness"
            @input="$emit('update:bounciness', +$event.target.value)">
          <span class="val">{{ bounciness.toFixed(2) }}</span>
        </label>
        <label class="slider-row">
          <span>Gravity</span>
          <input type="range" min="0" max="3" step="0.05" :value="gravity"
            @input="$emit('update:gravity', +$event.target.value)">
          <span class="val">{{ gravity.toFixed(2) }}</span>
        </label>
        <label class="slider-row">
          <span>Max Balls</span>
          <input type="range" min="10" max="500" step="10" :value="maxBalls"
            @input="$emit('update:maxBalls', +$event.target.value)">
          <span class="val">{{ maxBalls }}</span>
        </label>
      </section>

      <!-- ============== COLOR DETECTION ============== -->
      <section class="section">
        <h3>Color Detection</h3>
        <label class="slider-row">
          <span>Hue Min</span>
          <input type="range" min="0" max="360" step="1" :value="hueMin"
            @input="$emit('update:hueMin', +$event.target.value)">
          <span class="val">{{ hueMin }}°</span>
        </label>
        <label class="slider-row">
          <span>Hue Max</span>
          <input type="range" min="0" max="360" step="1" :value="hueMax"
            @input="$emit('update:hueMax', +$event.target.value)">
          <span class="val">{{ hueMax }}°</span>
        </label>
        <label class="slider-row">
          <span>Saturation Min</span>
          <input type="range" min="0" max="100" step="1" :value="satMin"
            @input="$emit('update:satMin', +$event.target.value)">
          <span class="val">{{ satMin }}%</span>
        </label>
        <label class="slider-row">
          <span>Value Min</span>
          <input type="range" min="0" max="100" step="1" :value="valMin"
            @input="$emit('update:valMin', +$event.target.value)">
          <span class="val">{{ valMin }}%</span>
        </label>
        <label class="slider-row">
          <span>Min Blob Area</span>
          <input type="range" min="10" max="500" step="5" :value="minBlobArea"
            @input="$emit('update:minBlobArea', +$event.target.value)">
          <span class="val">{{ minBlobArea }}</span>
        </label>
      </section>

      <!-- ============== CALIBRATION ============== -->
      <section class="section">
        <h3>Calibration</h3>
        <button class="btn" @click="$emit('calibrate')" :disabled="!webcamOn || appState === 'calibrating'">
          {{ isCalibrated ? 'Re-calibrate' : 'Calibrate' }}
        </button>
        <button class="btn secondary" @click="$emit('skip-calibration')" :disabled="!webcamOn">
          Skip (Identity)
        </button>
        <div v-if="appState === 'calibrating'" class="calib-progress">
          <div class="calib-bar">
            <div class="calib-fill" :style="{ width: (calibTotal > 0 ? (calibStep / calibTotal) * 100 : 0) + '%' }"></div>
          </div>
          <div class="calib-msg">{{ calibMessage }}</div>
        </div>
        <div v-else-if="isCalibrated" class="calib-done">✓ Calibrated</div>
      </section>

      <!-- ============== ACTIONS ============== -->
      <section class="section">
        <h3>Actions</h3>
        <button class="btn" @click="$emit('clear-balls')">Clear Balls</button>
        <button class="btn" @click="$emit('toggle-fullscreen')">Toggle Fullscreen</button>
        <label class="toggle-row">
          <span>Debug Outlines</span>
          <input type="checkbox" :checked="debug" @change="$emit('update:debug', $event.target.checked)">
        </label>
      </section>

      <!-- ============== STATS ============== -->
      <section class="section stats">
        <div><span>FPS</span><strong>{{ fps }}</strong></div>
        <div><span>Balls</span><strong>{{ ballCount }}</strong></div>
        <div><span>Stickies</span><strong>{{ stickyCount }}</strong></div>
      </section>

      <!-- ============== WEBCAM PREVIEW ============== -->
      <section class="section" v-if="webcamOn">
        <h3>Webcam Preview</h3>
        <div class="webcam-box">
          <video ref="videoRef" class="webcam-video" autoplay playsinline muted />
        </div>
      </section>

      <div class="footer">
        Press <kbd>H</kbd> to hide/show &middot; <kbd>F</kbd> fullscreen
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  open:           { type: Boolean, default: true },
  appState:       { type: String, default: 'idle' },
  webcamOn:       { type: Boolean, default: false },
  isCalibrated:   { type: Boolean, default: false },
  debug:          { type: Boolean, default: false },
  showWebcamBg:   { type: Boolean, default: false },
  fps:            { type: Number, default: 0 },
  ballCount:      { type: Number, default: 0 },
  stickyCount:    { type: Number, default: 0 },
  videoEl:        { type: Object, default: null },
  // Physics
  spawnInterval:  { type: Number, default: 250 },
  ballSize:       { type: Number, default: 18 },
  bounciness:     { type: Number, default: 0.65 },
  gravity:        { type: Number, default: 1 },
  maxBalls:       { type: Number, default: 200 },
  // Detection
  hueMin:         { type: Number, default: 20 },
  hueMax:         { type: Number, default: 65 },
  satMin:         { type: Number, default: 35 },
  valMin:         { type: Number, default: 40 },
  minBlobArea:    { type: Number, default: 50 },
  // Calibration progress
  calibStep:      { type: Number, default: 0 },
  calibTotal:     { type: Number, default: 1 },
  calibMessage:   { type: String, default: '' },
})

defineEmits([
  'toggle',
  'toggle-webcam',
  'calibrate',
  'skip-calibration',
  'clear-balls',
  'toggle-fullscreen',
  'update:debug',
  'update:showWebcamBg',
  'update:spawnInterval',
  'update:ballSize',
  'update:bounciness',
  'update:gravity',
  'update:maxBalls',
  'update:hueMin',
  'update:hueMax',
  'update:satMin',
  'update:valMin',
  'update:minBlobArea',
])

const videoRef = ref(null)

const statusMap = {
  idle:        { cls: 'grey', text: 'Ready — start webcam' },
  loading:     { cls: 'yellow', text: 'Loading…' },
  calibrating: { cls: 'yellow', text: 'Calibrating…' },
  running:     { cls: 'green', text: 'Running' },
  'cam-denied':{ cls: 'red', text: 'Camera denied' },
  error:       { cls: 'red', text: 'Error' },
}

import { computed } from 'vue'
const statusClass = computed(() => statusMap[props.appState]?.cls || 'grey')
const statusText = computed(() => statusMap[props.appState]?.text || props.appState)

// Pipe webcam stream into our preview <video>
watch(() => props.videoEl, (el) => {
  if (el && videoRef.value) videoRef.value.srcObject = el.srcObject
}, { immediate: true, flush: 'post' })

watch(() => props.open, () => {
  // Re-pipe when panel opens
  if (props.videoEl && videoRef.value) videoRef.value.srcObject = props.videoEl.srcObject
}, { flush: 'post' })
</script>

<style scoped>
.settings-panel {
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  z-index: 9000;
  display: flex;
  flex-direction: row;
  pointer-events: none;
  font-family: system-ui, -apple-system, sans-serif;
}

.toggle-btn {
  pointer-events: auto;
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 9001;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(20, 20, 25, 0.85);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
  backdrop-filter: blur(8px);
}
.toggle-btn:hover { background: rgba(50, 50, 60, 0.95); }

.panel-body {
  pointer-events: auto;
  width: 300px;
  height: 100vh;
  overflow-y: auto;
  background: rgba(18, 18, 22, 0.92);
  backdrop-filter: blur(16px);
  border-right: 1px solid rgba(255,255,255,0.08);
  padding: 62px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #d0d0d4;
  font-size: 13px;
}

.panel-body::-webkit-scrollbar { width: 5px; }
.panel-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }

.panel-title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 8px;
}

.section {
  background: rgba(255,255,255,0.04);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section h3 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: rgba(255,255,255,0.45);
  margin: 0;
  font-weight: 600;
}

/* Status */
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.green { background: #4ade80; box-shadow: 0 0 6px #4ade80; }
.status-dot.yellow { background: #facc15; box-shadow: 0 0 6px #facc15; animation: pulse-dot 1s infinite; }
.status-dot.red { background: #f87171; box-shadow: 0 0 6px #f87171; }
.status-dot.grey { background: #71717a; }
.status-label { font-weight: 500; color: #e4e4e7; }

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* Buttons */
.btn {
  background: #fff;
  color: #111;
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  font-family: inherit;
}
.btn:hover { background: #e4e4e7; }
.btn:disabled { opacity: 0.35; cursor: default; }
.btn.secondary {
  background: rgba(255,255,255,0.1);
  color: #d0d0d4;
}
.btn.secondary:hover { background: rgba(255,255,255,0.18); }

/* Calibration progress */
.calib-progress { margin-top: 8px; }
.calib-bar {
  width: 100%;
  height: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  overflow: hidden;
}
.calib-fill {
  height: 100%;
  background: #60a5fa;
  transition: width 0.3s ease;
  border-radius: 3px;
}
.calib-msg {
  font-size: 11px;
  color: #a0a0a8;
  margin-top: 4px;
}
.calib-done {
  margin-top: 6px;
  font-size: 12px;
  color: #4ade80;
}

/* Sliders */
.slider-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 2px 8px;
  align-items: center;
}
.slider-row span:first-child {
  grid-column: 1;
  color: #a1a1aa;
}
.slider-row .val {
  grid-column: 2;
  grid-row: 1;
  font-variant-numeric: tabular-nums;
  color: #fff;
  font-weight: 600;
  text-align: right;
  min-width: 52px;
}
.slider-row input[type="range"] {
  grid-column: 1 / -1;
  grid-row: 2;
  width: 100%;
  accent-color: #818cf8;
  height: 4px;
}

/* Toggle row */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}
.toggle-row span { color: #a1a1aa; }
.toggle-row input[type="checkbox"] {
  accent-color: #818cf8;
  width: 16px;
  height: 16px;
}

/* Stats */
.stats {
  flex-direction: row;
  justify-content: space-around;
}
.stats > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.stats span { font-size: 11px; color: #71717a; }
.stats strong { font-size: 18px; color: #fff; }

/* Webcam preview */
.webcam-box {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.1);
}
.webcam-video {
  width: 100%;
  display: block;
  background: #111;
}

.footer {
  text-align: center;
  font-size: 11px;
  color: rgba(255,255,255,0.25);
  padding: 8px 0 4px;
}
.footer kbd {
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 11px;
}
</style>
