<template>
  <div
    class="sp"
    :class="{ open }"
  >
    <!-- Hamburger tab -->
    <button class="sp-tab" @click="$emit('toggle')" :title="open ? 'Hide' : 'Show settings'">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path v-if="!open" d="M3 12h18M3 6h18M3 18h18" stroke-linecap="round"/>
        <path v-else d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/>
      </svg>
    </button>

    <div class="sp-body" v-show="open">

      <!-- Header -->
      <div class="sp-header">
        <span class="sp-title">mappix</span>
        <span class="sp-status" :class="statusClass">{{ statusText }}</span>
      </div>

      <!-- Stats -->
      <div class="sp-stats">
        <div class="sp-stat"><span>{{ fps }}</span><label>fps</label></div>
        <div class="sp-stat"><span>{{ ballCount }}</span><label>balls</label></div>
        <div class="sp-stat"><span>{{ stickyCount }}</span><label>stickies</label></div>
      </div>

      <div class="sp-divider" />

      <!-- Camera -->
      <div class="sp-section">
        <p class="sp-section-label">Camera</p>
        <button class="sp-btn" @click="$emit('toggle-webcam')" :disabled="appState === 'calibrating'">
          {{ webcamOn ? 'Stop Webcam' : 'Start Webcam' }}
        </button>
        <template v-if="webcamOn">
          <div class="sp-row">
            <span>Show as background</span>
            <button class="sp-toggle" :class="{ on: showWebcamBg }" @click="$emit('update:showWebcamBg', !showWebcamBg)" />
          </div>
        </template>
      </div>

      <div class="sp-divider" />

      <!-- Calibration -->
      <div class="sp-section">
        <p class="sp-section-label">Calibration</p>
        <div class="sp-btn-group">
          <button class="sp-btn" @click="$emit('calibrate')" :disabled="!webcamOn || appState === 'calibrating'">
            {{ isCalibrated ? 'Re-calibrate' : 'Auto Calibrate' }}
          </button>
          <button class="sp-btn ghost" @click="$emit('manual-calibrate')" :disabled="!webcamOn || appState === 'calibrating'">
            Manual
          </button>
        </div>
        <div class="sp-btn-group" style="margin-top:4px">
          <button class="sp-btn ghost" @click="$emit('skip-calibration')" :disabled="!webcamOn">Skip</button>
          <button class="sp-btn destructive" @click="$emit('reset-calibration')" :disabled="!isCalibrated">Reset</button>
        </div>
        <div v-if="appState === 'calibrating'" class="sp-progress">
          <div class="sp-progress-bar">
            <div class="sp-progress-fill" :style="{ width: (calibTotal > 0 ? (calibStep / calibTotal) * 100 : 0) + '%' }" />
          </div>
          <span class="sp-progress-msg">{{ calibMessage }}</span>
        </div>
        <div v-else-if="isCalibrated" class="sp-calib-ok">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Calibrated
          <template v-if="calibrationQuality">
            &nbsp;·&nbsp;{{ calibrationQuality.error }}px&nbsp;·&nbsp;{{ calibrationQuality.inliers }}/{{ calibrationQuality.total }} inliers
          </template>
        </div>
      </div>

      <div class="sp-divider" />

      <!-- Actions -->
      <div class="sp-section">
        <p class="sp-section-label">Actions</p>
        <div class="sp-btn-group">
          <button class="sp-btn" @click="$emit('clear-balls')">Clear Balls</button>
          <button class="sp-btn ghost" @click="$emit('toggle-fullscreen')">Fullscreen</button>
        </div>
        <button class="sp-ghost-pill" @click="$emit('open-tour')">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;margin-right:4px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          Setup guide
        </button>
        <div class="sp-row">
            <span>Show outlines</span>
            <button class="sp-toggle" :class="{ on: showOutlines }" @click="$emit('update:showOutlines', !showOutlines)" />
          </div>
          <div class="sp-row">
            <span>Debug outlines</span>
          <button class="sp-toggle" :class="{ on: debug }" @click="$emit('update:debug', !debug)" />
        </div>
      </div>

      <div class="sp-divider" />

      <!-- Advanced collapsible -->
      <div class="sp-section">
        <button class="sp-collapse-btn" @click="advancedOpen = !advancedOpen">
          <span class="sp-section-label" style="margin:0">Advanced</span>
          <svg class="sp-chevron" :class="{ open: advancedOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <template v-if="advancedOpen">
          <p class="sp-group-label">Performance</p>
          <div class="sp-slider">
            <div class="sp-slider-meta">
              <span>Target FPS <button class="sp-info" type="button">?<span class="sp-tooltip">Lower FPS reduces CPU/GPU load. Affects rendering and detection rate.</span></button></span>
              <span class="sp-slider-val">{{ props.targetFps }}</span>
            </div>
            <input type="range" min="10" max="60" step="5" :value="props.targetFps"
              @input="$emit('update:targetFps', +$event.target.value)">
          </div>

          <p class="sp-group-label" style="margin-top:14px">Physics</p>
          <div class="sp-slider" v-for="s in physicsSliders" :key="s.key">
            <div class="sp-slider-meta">
              <span>{{ s.label }}</span>
              <span class="sp-slider-val">{{ s.fmt ? s.fmt(props[s.key]) : props[s.key] }}{{ s.unit }}</span>
            </div>
            <input type="range" :min="s.min" :max="s.max" :step="s.step" :value="props[s.key]"
              @input="$emit('update:' + s.key, +$event.target.value)">
          </div>
          <button class="sp-ghost-pill" @click="$emit('reset-physics')">Reset to defaults</button>

          <p class="sp-group-label" style="margin-top:14px">Detection</p>
          <div class="sp-color-row">
            <span>Sticky color</span>
            <div class="sp-color-right">
              <div class="sp-color-swatch" :style="{ background: stickyColorCss }" />
              <button class="sp-ghost-pill" @click="$emit('pick-color')" :disabled="!webcamOn">Pick</button>
            </div>
          </div>

          <!-- Color (hue center) -->
          <div class="sp-slider">
            <div class="sp-slider-meta">
              <span>Color <button class="sp-info" type="button">?<span class="sp-tooltip">Shifts the target colour — match this to the colour of your sticky notes</span></button></span>
              <span class="sp-slider-val">{{ hueCenter }}°</span>
            </div>
            <input type="range" min="0" max="360" step="1" :value="hueCenter"
              @input="onHueCenterChange(+$event.target.value)">
          </div>

          <!-- Tolerance (hue range width) -->
          <div class="sp-slider">
            <div class="sp-slider-meta">
              <span>Tolerance <button class="sp-info" type="button">?<span class="sp-tooltip">How wide a colour range to accept — increase if blobs flicker</span></button></span>
              <span class="sp-slider-val">&plusmn;{{ hueHalfRange }}°</span>
            </div>
            <input type="range" min="5" max="90" step="1" :value="hueHalfRange"
              @input="onHueTolChange(+$event.target.value)">
          </div>

          <!-- Saturation -->
          <div class="sp-slider">
            <div class="sp-slider-meta">
              <span>Vividness <button class="sp-info" type="button">?<span class="sp-tooltip">Ignores washed-out or grey areas — lower if notes aren’t detected</span></button></span>
              <span class="sp-slider-val">{{ props.satMin }}%</span>
            </div>
            <input type="range" min="0" max="100" step="1" :value="props.satMin"
              @input="$emit('update:satMin', +$event.target.value)">
          </div>

          <!-- Brightness -->
          <div class="sp-slider">
            <div class="sp-slider-meta">
              <span>Brightness <button class="sp-info" type="button">?<span class="sp-tooltip">Ignores dark or shadowed areas — lower if notes in shadow aren’t detected</span></button></span>
              <span class="sp-slider-val">{{ props.valMin }}%</span>
            </div>
            <input type="range" min="0" max="100" step="1" :value="props.valMin"
              @input="$emit('update:valMin', +$event.target.value)">
          </div>

          <!-- Min area -->
          <div class="sp-slider">
            <div class="sp-slider-meta">
              <span>Min size <button class="sp-info" type="button">?<span class="sp-tooltip">Ignores tiny colour blobs — increase to reduce noise</span></button></span>
              <span class="sp-slider-val">{{ props.minBlobArea }}</span>
            </div>
            <input type="range" min="10" max="500" step="5" :value="props.minBlobArea"
              @input="$emit('update:minBlobArea', +$event.target.value)">
          </div>

          <button class="sp-ghost-pill" @click="$emit('reset-detection')">Reset to defaults</button>
        </template>
      </div>

      <p class="sp-footer"><kbd>H</kbd> toggle &middot; <kbd>F</kbd> fullscreen &middot; <kbd>C</kbd> calibrate</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'

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
  spawnInterval:  { type: Number, default: 250 },
  ballSize:       { type: Number, default: 18 },
  bounciness:     { type: Number, default: 0.65 },
  gravity:        { type: Number, default: 1 },
  maxBalls:       { type: Number, default: 200 },
  hueMin:         { type: Number, default: 20 },
  hueMax:         { type: Number, default: 65 },
  satMin:         { type: Number, default: 35 },
  valMin:         { type: Number, default: 40 },
  minBlobArea:    { type: Number, default: 50 },
  calibStep:          { type: Number, default: 0 },
  calibTotal:         { type: Number, default: 1 },
  calibMessage:       { type: String, default: '' },
  calibrationQuality: { type: Object, default: null },
  targetFps:          { type: Number, default: 60 },
  showOutlines:       { type: Boolean, default: true },
})

const emit = defineEmits([
  'toggle', 'toggle-webcam', 'calibrate', 'manual-calibrate', 'skip-calibration', 'reset-calibration',
  'clear-balls', 'reset-physics', 'reset-detection', 'toggle-fullscreen', 'open-tour',
  'update:debug', 'update:showWebcamBg', 'update:showOutlines',
  'update:spawnInterval', 'update:ballSize', 'update:bounciness', 'update:gravity', 'update:maxBalls',
  'update:hueMin', 'update:hueMax', 'update:satMin', 'update:valMin', 'update:minBlobArea',
  'update:targetFps',
  'pick-color',
])

const physicsSliders = [
  { key: 'spawnInterval', label: 'Spawn interval', min: 50,  max: 1000, step: 10,   unit: 'ms' },
  { key: 'ballSize',      label: 'Ball size',       min: 5,   max: 50,   step: 1,    unit: 'px' },
  { key: 'bounciness',    label: 'Bounciness',      min: 0,   max: 1,    step: 0.05, unit: '', fmt: v => v.toFixed(2) },
  { key: 'gravity',       label: 'Gravity',         min: 0,   max: 3,    step: 0.05, unit: '', fmt: v => v.toFixed(2) },
  { key: 'maxBalls',      label: 'Max balls',       min: 10,  max: 500,  step: 10,   unit: '' },
]

const detectionSliders = [
  { key: 'hueMin',     label: 'Hue min',      min: 0,   max: 360, step: 1, unit: '°' },
  { key: 'hueMax',     label: 'Hue max',      min: 0,   max: 360, step: 1, unit: '°' },
  { key: 'satMin',     label: 'Saturation',   min: 0,   max: 100, step: 1, unit: '%' },
  { key: 'valMin',     label: 'Brightness',   min: 0,   max: 100, step: 1, unit: '%' },
  { key: 'minBlobArea',label: 'Min area',     min: 10,  max: 500, step: 5, unit: '' },
]

const advancedOpen = ref(false)

// Computed center/half-range from hueMin+hueMax
const hueCenter   = computed(() => Math.round((props.hueMin + props.hueMax) / 2))
const hueHalfRange = computed(() => Math.round((props.hueMax - props.hueMin) / 2))

function onHueCenterChange(center) {
  const half = hueHalfRange.value
  emit('update:hueMin', Math.max(0, center - half))
  emit('update:hueMax', Math.min(360, center + half))
}
function onHueTolChange(half) {
  const center = hueCenter.value
  emit('update:hueMin', Math.max(0, center - half))
  emit('update:hueMax', Math.min(360, center + half))
}

// Compute a CSS color from current hue range for the swatch
const stickyColorCss = computed(() => `hsl(${hueCenter.value}, 80%, 55%)`)
const statusMap = {
  idle:         { cls: 'idle',        text: 'Idle' },
  loading:      { cls: 'loading',     text: 'Loading…' },
  calibrating:  { cls: 'loading',     text: 'Calibrating…' },
  running:      { cls: 'running',     text: 'Running' },
  'cam-denied': { cls: 'error',       text: 'Camera denied' },
  error:        { cls: 'error',       text: 'Error' },
}
const statusClass = computed(() => statusMap[props.appState]?.cls || 'idle')
const statusText  = computed(() => statusMap[props.appState]?.text || props.appState)

onUnmounted(() => {
})
</script>

<style scoped>
/* ── Root ───────────────────────────────────────────────── */
.sp {
  position: fixed;
  top: 0; left: 0;
  height: 100vh;
  z-index: 9000;
  display: flex;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  font-size: 12px;
}

/* ── Hamburger tab ──────────────────────────────────────── */
.sp-tab {
  pointer-events: auto;
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  left: 0;
  z-index: 9001;
  width: 28px; height: 52px;
  border-radius: 0 8px 8px 0;
  border: 1px solid #27272a;
  border-left: none;
  background: #09090b;
  color: #a1a1aa;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s, left 0.3s cubic-bezier(0.4,0,0.2,1);
}
.sp.open .sp-tab {
  left: 268px;
}
.sp-tab:hover { background: #18181b; color: #fafafa; }

/* ── Panel body ─────────────────────────────────────────── */
.sp-body {
  pointer-events: auto;
  width: 268px;
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  background: #09090b;
  border-right: 1px solid #27272a;
  padding: 24px 0 24px;
  display: flex;
  flex-direction: column;
  color: #e4e4e7;
}
.sp-body::-webkit-scrollbar { width: 4px; }
.sp-body::-webkit-scrollbar-thumb { background: #27272a; border-radius: 2px; }

/* ── Header ─────────────────────────────────────────────── */
.sp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 12px;
}
.sp-title {
  font-size: 13px;
  font-weight: 600;
  color: #fafafa;
  letter-spacing: -0.01em;
}
.sp-status {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid #27272a;
}
.sp-status.idle    { color: #52525b; border-color: #27272a; }
.sp-status.loading { color: #a16207; border-color: #451a03; background: #1c1003; animation: pulse-text 1.2s infinite; }
.sp-status.running { color: #16a34a; border-color: #14532d; background: #052e16; }
.sp-status.error   { color: #dc2626; border-color: #7f1d1d; background: #1a0505; }
@keyframes pulse-text { 0%,100%{opacity:1} 50%{opacity:0.4} }

/* ── Stats bar ──────────────────────────────────────────── */
.sp-stats {
  display: flex;
  padding: 0 16px 14px;
  gap: 0;
}
.sp-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.sp-stat span {
  font-size: 20px;
  font-weight: 300;
  color: #fafafa;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.sp-stat label {
  font-size: 10px;
  color: #52525b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ── Divider ────────────────────────────────────────────── */
.sp-divider {
  height: 1px;
  background: #18181b;
  margin: 0;
  flex-shrink: 0;
}

/* ── Section ────────────────────────────────────────────── */
.sp-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 16px;
}
.sp-section-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #52525b;
  margin: 0 0 2px;
}
.sp-group-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #3f3f46;
  margin: 8px 0 4px;
}

/* ── Row (label + toggle) ───────────────────────────────── */
.sp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
}
.sp-row span {
  color: #a1a1aa;
  font-size: 12px;
}

/* ── Buttons ────────────────────────────────────────────── */
.sp-btn {
  width: 100%;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #27272a;
  background: #18181b;
  color: #e4e4e7;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  text-align: center;
}
.sp-btn:hover:not(:disabled) { background: #27272a; color: #fafafa; }
.sp-btn:disabled { opacity: 0.3; cursor: default; }

.sp-btn.ghost {
  background: transparent;
  color: #71717a;
  border-color: #27272a;
}
.sp-btn.ghost:hover:not(:disabled) { background: #18181b; color: #e4e4e7; }

.sp-btn.destructive {
  background: transparent;
  border-color: #27272a;
  color: #71717a;
}
.sp-btn.destructive:hover:not(:disabled) {
  background: #1a0505;
  border-color: #7f1d1d;
  color: #fca5a5;
}

.sp-btn-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.sp-ghost-pill {
  align-self: flex-start;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid #27272a;
  background: transparent;
  color: #52525b;
  cursor: pointer;
  font-family: inherit;
  transition: color 0.12s, border-color 0.12s;
}
.sp-ghost-pill:hover { color: #a1a1aa; border-color: #3f3f46; }
.sp-ghost-pill:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Color picker row ───────────────────────────────────── */
.sp-color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #a1a1aa;
  margin-bottom: 8px;
}
.sp-color-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sp-color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid #3f3f46;
}

/* ── Toggle switch ──────────────────────────────────────── */
.sp-toggle {
  width: 32px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid #3f3f46;
  background: #18181b;
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s;
  padding: 0;
}
.sp-toggle::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: #52525b;
  transition: transform 0.2s, background 0.2s;
}
.sp-toggle.on {
  background: #fafafa;
  border-color: #fafafa;
}
.sp-toggle.on::after {
  transform: translateX(14px);
  background: #09090b;
}

/* ── Sliders ────────────────────────────────────────────── */
.sp-slider { display: flex; flex-direction: column; gap: 4px; }
.sp-slider-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sp-slider-meta span:first-child { color: #71717a; }
.sp-slider-meta span:first-child:hover .sp-info { border-color: #52525b; color: #a1a1aa; }
.sp-slider-meta span:first-child:hover .sp-tooltip { opacity: 1; pointer-events: none; }
.sp-info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 1px solid transparent;
  background: transparent;
  color: transparent;
  font-size: 10px;
  font-style: normal;
  font-family: inherit;
  cursor: default;
  position: relative;
  vertical-align: middle;
  margin-left: 2px;
  padding: 0;
  line-height: 1;
}

.sp-tooltip {
  opacity: 0;
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  width: 180px;
  background: #18181b;
  border: 1px solid #27272a;
  color: #d4d4d8;
  font-size: 11px;
  font-style: normal;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  padding: 6px 8px;
  border-radius: 6px;
  z-index: 9999;
  line-height: 1.4;
  white-space: normal;
  pointer-events: none;
  transition: opacity 0.15s;
}
.sp-slider-val {
  font-variant-numeric: tabular-nums;
  color: #a1a1aa;
  font-size: 11px;
  min-width: 40px;
  text-align: right;
}
.sp-slider input[type="range"] {
  width: 100%;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: #27272a;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.sp-slider input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 13px; height: 13px;
  border-radius: 50%;
  background: #09090b;
  border: 1.5px solid #71717a;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.12s;
}
.sp-slider input[type="range"]::-webkit-slider-thumb:hover {
  border-color: #a1a1aa;
  transform: scale(1.15);
}
.sp-slider input[type="range"]::-moz-range-thumb {
  width: 13px; height: 13px;
  border-radius: 50%;
  background: #09090b;
  border: 1.5px solid #71717a;
  cursor: pointer;
}
.sp-slider input[type="range"]::-moz-range-track {
  background: #27272a;
  height: 3px;
  border-radius: 2px;
  border: none;
}

/* ── Calibration ────────────────────────────────────────── */
.sp-progress { display: flex; flex-direction: column; gap: 4px; }
.sp-progress-bar {
  height: 3px;
  background: #27272a;
  border-radius: 2px;
  overflow: hidden;
}
.sp-progress-fill {
  height: 100%;
  background: #fafafa;
  border-radius: 2px;
  transition: width 0.3s ease;
}
.sp-progress-msg { font-size: 11px; color: #52525b; }
.sp-calib-ok {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #4ade80;
}

/* ── Collapsible ────────────────────────────────────────── */
.sp-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
}
.sp-collapse-btn:hover .sp-section-label { color: #71717a; }
.sp-chevron { color: #3f3f46; transition: transform 0.2s; }
.sp-chevron.open { transform: rotate(180deg); }

/* ── Webcam ─────────────────────────────────────────────── */
.sp-video-wrap {
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #27272a;
}
.sp-video-wrap video {
  width: 100%;
  display: block;
  background: #000;
}

/* ── Footer ─────────────────────────────────────────────── */
.sp-footer {
  margin: auto 0 0;
  padding: 12px 16px 0;
  font-size: 10px;
  color: #3f3f46;
  text-align: center;
}
.sp-footer kbd {
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 10px;
  font-family: inherit;
}
</style>


