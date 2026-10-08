<template>
  <div class="tour-wrap">
    <div class="tour-card">
      <!-- Close button (mid-session revisit only) -->
      <button v-if="closeable" class="tour-close" @click="$emit('close')" title="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      <Transition :name="'slide-' + slideDir" mode="out-in">

        <!-- ── Step 1: Welcome ── -->
        <div v-if="step === 1" key="1" class="tour-step">
          <div class="tour-hero">
            <img src="/mepii.svg" width="34" height="34" alt="" />
          </div>
          <h1 class="tour-h1">Mappix</h1>
          <p class="tour-sub">Physics balls that bounce off real objects — stick a note on a surface, watch them react.</p>

          <p class="tour-mode-label">How are you set up?</p>
          <div class="mode-opts">
            <button class="mode-opt" :class="{ selected: setupMode === 'projector' }" :aria-pressed="setupMode === 'projector'" @click="setupMode = 'projector'">
              <span class="mode-opt-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="7" width="20" height="12" rx="2"/>
                  <circle cx="9" cy="13" r="2.5"/>
                  <line x1="18" y1="7" x2="14" y2="3"/><line x1="6" y1="7" x2="10" y2="3"/>
                </svg>
              </span>
              <span class="mode-opt-body">
                <span class="mode-opt-title">I have a projector</span>
                <span class="mode-opt-desc">Project onto a wall or flat surface.</span>
              </span>
              <span class="mode-check" :class="{ visible: setupMode === 'projector' }">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            </button>
            <button class="mode-opt" :class="{ selected: setupMode === 'laptop' }" :aria-pressed="setupMode === 'laptop'" @click="setupMode = 'laptop'">
              <span class="mode-opt-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <line x1="2" y1="20" x2="22" y2="20"/>
                </svg>
              </span>
              <span class="mode-opt-body">
                <span class="mode-opt-title">No projector <span class="mode-badge">Experimental</span></span>
                <span class="mode-opt-desc">Use an external webcam pointed at your screen. Stick physical notes on it.</span>
              </span>
              <span class="mode-check" :class="{ visible: setupMode === 'laptop' }">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            </button>
          </div>

          <div class="tour-actions single">
            <button class="btn-primary" @click="goTo(2)">Let's go</button>
          </div>
        </div>

        <!-- ── Step 2: Hardware setup ── -->
        <div v-else-if="step === 2" key="2" class="tour-step">
          <h2 class="tour-h2">Set up your space</h2>
          <p class="tour-sub">
            <template v-if="setupMode === 'projector'">Position the projector and webcam so they both face the same wall area.</template>
            <template v-else>Angle your webcam so the entire screen is visible in frame — like this.</template>
          </p>

          <!-- Projector + wall illustration -->
          <div v-if="setupMode === 'projector'" class="illus-wrap">
            <svg viewBox="0 0 320 156" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- Wall surface -->
              <rect x="20" y="8" width="280" height="76" rx="3" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
              <!-- Projected area on wall (taller) -->
              <rect x="34" y="15" width="188" height="62" rx="2" fill="rgba(255,255,255,0.04)"/>
              <!-- Sticky notes -->
              <rect x="50" y="26" width="22" height="22" rx="3" fill="rgba(234,179,8,0.22)" stroke="rgba(234,179,8,0.5)" stroke-width="1"/>
              <text x="61" y="41" text-anchor="middle" font-size="5.5" fill="rgba(234,179,8,0.7)" font-family="system-ui,sans-serif">note</text>
              <rect x="93" y="36" width="20" height="20" rx="3" fill="rgba(234,179,8,0.22)" stroke="rgba(234,179,8,0.5)" stroke-width="1"/>
              <text x="103" y="49" text-anchor="middle" font-size="5.5" fill="rgba(234,179,8,0.7)" font-family="system-ui,sans-serif">note</text>
              <rect x="144" y="22" width="22" height="26" rx="3" fill="rgba(234,179,8,0.22)" stroke="rgba(234,179,8,0.5)" stroke-width="1"/>
              <text x="155" y="38" text-anchor="middle" font-size="5.5" fill="rgba(234,179,8,0.7)" font-family="system-ui,sans-serif">note</text>
              <!-- wall label -->
              <text x="236" y="52" font-size="8" fill="rgba(255,255,255,0.2)" font-family="system-ui,sans-serif">wall</text>
              <!-- Ground line -->
              <line x1="10" y1="122" x2="310" y2="122" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
              <!-- Projector beam polygon -->
              <polygon points="122,122 34,77 222,77" fill="rgba(255,255,255,0.018)"/>
              <line x1="122" y1="122" x2="34" y2="77" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
              <line x1="122" y1="122" x2="222" y2="77" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
              <!-- Projector body -->
              <rect x="96" y="122" width="52" height="17" rx="5" fill="#18181b" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
              <circle cx="108" cy="130.5" r="5.5" fill="#0c0c0e" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
              <circle cx="108" cy="130.5" r="2.5" fill="rgba(255,255,255,0.08)"/>
              <line x1="120" y1="126" x2="140" y2="126" stroke="rgba(255,255,255,0.1)" stroke-width="0.75"/>
              <line x1="120" y1="130.5" x2="140" y2="130.5" stroke="rgba(255,255,255,0.1)" stroke-width="0.75"/>
              <line x1="120" y1="135" x2="140" y2="135" stroke="rgba(255,255,255,0.1)" stroke-width="0.75"/>
              <text x="122" y="152" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,0.22)" font-family="system-ui,sans-serif">projector</text>
              <!-- Webcam mounted on top of projector, dashed sight line up to wall -->
              <line x1="122" y1="112" x2="128" y2="46" stroke="rgba(59,130,246,0.4)" stroke-width="1" stroke-dasharray="4,3"/>
              <!-- Webcam body (sitting on top of projector) -->
              <rect x="110" y="104" width="24" height="13" rx="3" fill="#18181b" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
              <circle cx="122" cy="110.5" r="4" fill="#0c0c0e" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
              <circle cx="122" cy="110.5" r="1.8" fill="rgba(255,255,255,0.1)"/>
              <text x="122" y="100" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,0.22)" font-family="system-ui,sans-serif">webcam</text>
            </svg>
          </div>

          <!-- Laptop screen illustration (external webcam in front) -->
          <div v-else class="illus-wrap">
            <svg viewBox="0 0 320 160" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="sGlow2" cx="50%" cy="50%" r="55%">
                  <stop offset="0%" stop-color="rgba(255,255,255,0.05)"/>
                  <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
                </radialGradient>
              </defs>
              <!-- Laptop screen bezel -->
              <rect x="75" y="6" width="190" height="108" rx="6" fill="#0f0f12" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>
              <!-- Screen display area -->
              <rect x="83" y="13" width="174" height="95" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
              <rect x="83" y="13" width="174" height="95" rx="2" fill="url(#sGlow2)"/>
              <!-- Sticky notes on screen -->
              <rect x="96" y="28" width="24" height="24" rx="3" fill="rgba(234,179,8,0.28)" stroke="rgba(234,179,8,0.55)" stroke-width="1"/>
              <text x="108" y="43" text-anchor="middle" font-size="5.5" fill="rgba(234,179,8,0.8)" font-family="system-ui,sans-serif">note</text>
              <rect x="155" y="44" width="22" height="22" rx="3" fill="rgba(234,179,8,0.28)" stroke="rgba(234,179,8,0.55)" stroke-width="1"/>
              <text x="166" y="58" text-anchor="middle" font-size="5.5" fill="rgba(234,179,8,0.8)" font-family="system-ui,sans-serif">note</text>
              <rect x="213" y="22" width="24" height="28" rx="3" fill="rgba(234,179,8,0.28)" stroke="rgba(234,179,8,0.55)" stroke-width="1"/>
              <text x="225" y="39" text-anchor="middle" font-size="5.5" fill="rgba(234,179,8,0.8)" font-family="system-ui,sans-serif">note</text>
              <!-- screen label -->
              <text x="170" y="95" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,0.12)" font-family="system-ui,sans-serif">screen</text>
              <!-- Laptop base / keyboard -->
              <rect x="60" y="116" width="220" height="14" rx="4" fill="#0f0f12" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
              <rect x="148" y="120" width="44" height="6" rx="2" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.07)" stroke-width="0.5"/>
              <text x="170" y="148" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,0.22)" font-family="system-ui,sans-serif">laptop</text>
              <!-- External webcam on stand on desk, in front of screen -->
              <!-- Stand base -->
              <rect x="14" y="128" width="30" height="4" rx="2" fill="#18181b" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
              <!-- Stand neck -->
              <line x1="29" y1="128" x2="29" y2="112" stroke="rgba(255,255,255,0.18)" stroke-width="2" stroke-linecap="round"/>
              <!-- Webcam body -->
              <rect x="18" y="104" width="22" height="12" rx="3" fill="#18181b" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
              <circle cx="29" cy="110" r="4" fill="#0c0c0e" stroke="rgba(255,255,255,0.32)" stroke-width="1"/>
              <circle cx="29" cy="110" r="1.8" fill="rgba(255,255,255,0.12)"/>
              <text x="29" y="99" text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.28)" font-family="system-ui,sans-serif">webcam</text>
              <!-- FOV lines from webcam to screen edges -->
              <line x1="33" y1="108" x2="83" y2="14" stroke="rgba(59,130,246,0.38)" stroke-width="1" stroke-dasharray="4,3"/>
              <line x1="33" y1="112" x2="83" y2="108" stroke="rgba(59,130,246,0.38)" stroke-width="1" stroke-dasharray="4,3"/>
              <!-- FOV fill -->
              <polygon points="33,110 83,14 83,108" fill="rgba(59,130,246,0.04)"/>
            </svg>
          </div>

          <ul class="tour-tips">
            <template v-if="setupMode === 'projector'">
              <li>Point the projector at a flat wall or white surface</li>
              <li>Mount the webcam off to the side so it sees the full projected area</li>
              <li>Keep both stable — you'll need to re-calibrate if either moves</li>
            </template>
            <template v-else>
              <li>Place your external webcam on a stand in front of your screen</li>
              <li>Angle it so the whole screen fills the camera frame</li>
              <li>Physically stick yellow notes onto your screen surface</li>
            </template>
          </ul>

          <div class="tour-actions">
            <button class="btn-ghost" @click="goTo(1)">Back</button>
            <button class="btn-primary" @click="goTo(3)">Continue</button>
          </div>
        </div>

        <!-- ── Step 3: Camera access ── -->
        <div v-else-if="step === 3" key="3" class="tour-step">
          <div class="tour-hero" :class="heroClass">
            <svg v-if="cameraState === 'loading'" class="spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
            </svg>
            <svg v-else-if="cameraState === 'ready'" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <svg v-else-if="cameraState === 'denied'" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            <svg v-else width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
          </div>
          <h2 class="tour-h2">{{ cameraTitle }}</h2>
          <p class="tour-sub">{{ cameraSub }}</p>
          <CameraSelect v-if="cameras.length" :devices="cameras" :modelValue="selectedCamera" :disabled="cameraState === 'loading'" @update:modelValue="$emit('select-camera', $event)" />
          <video v-if="cameraState === 'ready'" class="camera-preview" :srcObject.prop="videoStream" autoplay muted playsinline aria-label="Live camera preview" />
          <div class="tour-actions">
            <button class="btn-ghost" @click="goTo(2)">Back</button>
            <button v-if="cameraState !== 'ready'" class="btn-primary"
                    :disabled="cameraState === 'loading'"
                    @click="$emit('request-camera')">
              {{ cameraState === 'loading' ? 'Requesting…' : cameraState === 'denied' ? 'Try again' : 'Allow Camera' }}
            </button>
            <button v-else class="btn-primary" @click="goTo(4)">Continue</button>
          </div>
        </div>

        <!-- ── Step 4: Calibration ── -->
        <div v-else-if="step === 4" key="4" class="tour-step">
          <div class="tour-hero">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
              <line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
            </svg>
          </div>
          <h2 class="tour-h2">Align projector & camera</h2>
          <p class="tour-sub">Maps the projector output to what the webcam sees for accurate tracking.</p>
          <div class="calib-opts">
            <button class="calib-opt recommended" @click="startCalibCountdown()">
              <div class="calib-opt-title">
                Auto Calibrate
                <span class="badge">Recommended</span>
              </div>
              <div class="calib-opt-desc">Projects flashing patterns to align the camera. Allow 20–30 seconds per attempt; retries take longer.</div>
            </button>
            <button class="calib-opt" @click="$emit('skip-calibration')">
              <div class="calib-opt-title">{{ isCalibrated ? 'Use saved calibration' : 'Skip for now' }}</div>
              <div class="calib-opt-desc">{{ isCalibrated ? 'Continue with the saved mapping. Recalibrate if the camera or projector has moved.' : 'Proportional scaling. Works when the camera is roughly centred.' }}</div>
            </button>
          </div>
          <div class="tour-actions">
            <button class="btn-ghost" @click="goTo(3)">Back</button>
            <button class="btn-primary" @click="startCalibCountdown()">Start calibration</button>
          </div>
        </div>

        <!-- ── Step 5: Countdown before calibration ── -->
        <div v-else-if="step === 5" key="5" class="tour-step">
          <div class="tour-hero calib-hero-warn">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <h2 class="tour-h2 calib-warning-title">Don't Move Anything</h2>
          <p class="calib-warning-sub">Keep the projector, webcam, and surface <strong>perfectly still</strong>.<br>Ensure everything is <strong>aligned</strong> before calibration starts.</p>
          <button class="btn-ghost" @click="goTo(4)">Cancel calibration</button>
          <div class="calib-countdown">{{ countdown }}</div>
          <p class="calib-countdown-sub">second{{ countdown !== 1 ? 's' : '' }}</p>
          <p class="calib-duration-hint">Allow 20–30 seconds per attempt; up to 3 attempts. Press Esc to cancel once patterns start.</p>
        </div>

      </Transition>

      <!-- Step dots at bottom of card (hidden during countdown) -->
      <div v-if="step < 5" class="tour-dots">
        <div v-for="i in 4" :key="i" class="tour-dot" :class="{ active: step === i, past: step > i }" />
      </div>
    </div>

    <p class="tour-hint"><kbd>H</kbd> settings after setup</p>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import CameraSelect from './CameraSelect.vue'

const props = defineProps({
  cameras: { type: Array, default: () => [] },
  selectedCamera: { type: String, default: '' },
  videoStream: { default: null },
  isCalibrated: { type: Boolean, default: false },
  cameraState: { type: String, default: 'idle' }, // 'idle' | 'loading' | 'ready' | 'denied'
  closeable:   { type: Boolean, default: false },
})

const emit = defineEmits(['select-camera', 'request-camera', 'calibrate', 'skip-calibration', 'close'])

const step = ref(1)
const slideDir = ref('left')
const setupMode = ref('projector') // 'projector' | 'laptop'
const countdown = ref(5)
let _countdownTimer = null

function startCalibCountdown() {
  if (props.cameraState !== 'ready') { goTo(3); return }
  goTo(5)
  countdown.value = 5
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }
  _countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      clearInterval(_countdownTimer)
      emit('calibrate')
    }
  }, 1000)
}

function goTo(n) {
  clearInterval(_countdownTimer)
  slideDir.value = n > step.value ? 'left' : 'right'
  step.value = n
}

onUnmounted(() => {
  if (_countdownTimer) clearInterval(_countdownTimer)
})

const cameraTitle = computed(() => {
  if (props.cameraState === 'ready')  return 'Camera ready'
  if (props.cameraState === 'denied') return 'Access denied'
  if (props.cameraState === 'error') return 'Camera unavailable'
  return 'Allow camera access'
})

const cameraSub = computed(() => {
  if (props.cameraState === 'ready')  return 'Webcam is active. Hit Continue to set up calibration.'
  if (props.cameraState === 'denied') return 'Camera permission was denied. Check your browser settings and try again.'
  if (props.cameraState === 'error') return 'Check that a camera is connected and available. Close other camera apps, then try again.'
  return 'Mappix uses your webcam to detect objects on the wall in real time.'
})

const heroClass = computed(() => ({
  success: props.cameraState === 'ready',
  error:   ['denied', 'error'].includes(props.cameraState),
  loading: props.cameraState === 'loading',
}))
</script>

<style scoped>
.camera-preview { width: 100%; max-height: 180px; object-fit: contain; margin-top: 12px; background: #000; border-radius: 8px; }
/* ── Wrap ─────────────────────────────────────────────────── */
.tour-wrap {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #000;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  padding: 16px;
}

/* ── Card ─────────────────────────────────────────────────── */
.tour-card {
  position: relative;
  width: 100%;
  max-width: 420px;
  max-height: calc(100dvh - 72px);
  overflow-y: auto;
  background: #0c0c0e;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  padding: 36px 36px 24px;
}

/* ── Close button ─────────────────────────────────────────── */
.tour-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: #a1a1aa;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
}
.tour-close:hover { color: #a1a1aa; background: rgba(255, 255, 255, 0.08); }

/* ── Step ─────────────────────────────────────────────────── */
.tour-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  min-height: 430px;
}

/* ── Hero icon ────────────────────────────────────────────── */
.tour-hero {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
  color: rgba(255, 255, 255, 0.6);
  transition: background 0.35s, border-color 0.35s, color 0.35s;
}
.tour-hero.success {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.25);
  color: #4ade80;
}
.tour-hero.error {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.25);
  color: #f87171;
}

.spin {
  animation: spin 1s linear infinite;
  color: rgba(255, 255, 255, 0.35);
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Typography ───────────────────────────────────────────── */
.tour-h1 {
  font-size: 26px;
  font-weight: 700;
  color: #fafafa;
  margin: 0 0 6px;
  letter-spacing: -0.03em;
}
.tour-h2 {
  font-size: 19px;
  font-weight: 600;
  color: #fafafa;
  margin: 0 0 6px;
  letter-spacing: -0.02em;
}
.tour-sub {
  font-size: 13px;
  color: #a1a1aa;
  margin: 0 0 20px;
  line-height: 1.55;
  max-width: 310px;
}

/* ── Setup illustration ───────────────────────────────────── */
.illus-wrap {
  width: 100%;
  margin-bottom: 18px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.06);
  padding: 12px 8px 6px;
}
.illus-wrap svg {
  width: 100%;
  height: auto;
  display: block;
}

/* ── Setup tips list ──────────────────────────────────────── */
.tour-tips {
  list-style: none;
  padding: 0;
  margin: 0 0 22px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
.tour-tips-spaced {
  gap: 11px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 16px;
  margin-bottom: 24px;
}
.tour-tips li {
  font-size: 12px;
  color: #a1a1aa;
  padding-left: 14px;
  position: relative;
  line-height: 1.4;
}
.tour-tips-spaced li {
  font-size: 13px;
  color: #a1a1aa;
}
.tour-tips li::before {
  content: '–';
  position: absolute;
  left: 0;
  color: #a1a1aa;
}
/* ── Mode badge (experimental) ───────────────────────────── */
.mode-badge {
  display: inline-block;
  font-size: 9px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(234,179,8,0.1);
  color: rgba(234,179,8,0.7);
  border: 1px solid rgba(234,179,8,0.2);
  vertical-align: middle;
  margin-left: 4px;
}
/* ── Setup mode selector ─────────────────────────────────── */
.tour-mode-label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #a1a1aa;
  margin: 0 0 8px;
  width: 100%;
  text-align: left;
}
.mode-opts {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  margin-bottom: 22px;
}
.mode-opt {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 11px 13px;
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.mode-opt:hover {
  border-color: rgba(255, 255, 255, 0.13);
  background: rgba(255, 255, 255, 0.04);
}
.mode-opt.selected {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
}
.mode-opt-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a1a1aa;
  flex-shrink: 0;
  transition: color 0.15s;
}
.mode-opt.selected .mode-opt-icon { color: #a1a1aa; }
.mode-opt-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.mode-opt-title {
  font-size: 13px;
  font-weight: 600;
  color: #e4e4e7;
  line-height: 1.3;
}
.mode-opt-desc {
  font-size: 11px;
  color: #a1a1aa;
  line-height: 1.3;
}
.mode-opt.selected .mode-opt-desc { color: #a1a1aa; }
.mode-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.07);
  color: transparent;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.mode-check.visible {
  background: #fafafa;
  color: #09090b;
}

/* ── Calibration countdown ────────────────────────────────── */
.calib-hero-warn {
  background: rgba(250, 204, 21, 0.1) !important;
  border-color: rgba(250, 204, 21, 0.3) !important;
  color: #facc15 !important;
}
.calib-warning-title {
  font-size: 22px !important;
  color: #facc15 !important;
  letter-spacing: -0.02em;
}
.calib-warning-sub {
  font-size: 14px;
  color: #d4d4d8;
  margin: 0 0 20px;
  line-height: 1.6;
  max-width: 300px;
  text-align: center;
}
.calib-warning-sub strong {
  color: #fafafa;
  font-weight: 600;
}
.calib-countdown {
  font-size: 72px;
  font-weight: 700;
  color: #fafafa;
  letter-spacing: -0.04em;
  line-height: 1;
  margin: 12px 0 4px;
  animation: countPulse 1s ease-in-out infinite;
}
.calib-countdown-sub {
  font-size: 13px;
  color: #a1a1aa;
  margin: 0 0 8px;
}
.calib-duration-hint {
  font-size: 12px;
  color: #a1a1aa;
  margin: 0 0 24px;
  letter-spacing: 0.01em;
}
@keyframes countPulse {
  0%, 100% { transform: scale(1);    opacity: 1; }
  50%       { transform: scale(1.08); opacity: 0.85; }
}

/* ── Calibration options ──────────────────────────────────── */
.calib-opts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-bottom: 20px;
  text-align: left;
}
.calib-opt {
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.calib-opt:hover {
  border-color: rgba(255, 255, 255, 0.13);
  background: rgba(255, 255, 255, 0.05);
}
.calib-opt.recommended {
  border-color: rgba(255, 255, 255, 0.11);
  background: rgba(255, 255, 255, 0.04);
}
.calib-opt-title {
  font-size: 13px;
  font-weight: 600;
  color: #e4e4e7;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
.calib-opt-desc {
  font-size: 12px;
  color: #a1a1aa;
  line-height: 1.4;
}
.badge {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
  color: #a1a1aa;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* ── Actions ──────────────────────────────────────────────── */
.tour-actions {
  display: flex;
  gap: 8px;
  width: 100%;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  padding-top: 20px;
}
.tour-actions.single { justify-content: center; }

.btn-primary {
  padding: 10px 26px;
  border-radius: 10px;
  border: none;
  background: #fafafa;
  color: #09090b;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.btn-primary:hover:not(:disabled) { background: #e4e4e7; }
.btn-primary:active:not(:disabled) { transform: scale(0.97); }
.btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

.btn-ghost {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: transparent;
  color: #a1a1aa;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.btn-ghost:hover { color: #a1a1aa; border-color: rgba(255, 255, 255, 0.17); }

/* ── Progress dots (inside card, bottom) ─────────────────── */
.tour-dots {
  display: flex;
  justify-content: center;
  gap: 7px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
.tour-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  transition: background 0.3s, transform 0.3s;
}
.tour-dot.active { background: #fafafa; transform: scale(1.35); }
.tour-dot.past   { background: rgba(255, 255, 255, 0.3); }

/* ── Hint line below card ─────────────────────────────────── */
.tour-hint {
  margin-top: 18px;
  font-size: 11px;
  color: #a1a1aa;
}
.tour-hint kbd {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  font-family: inherit;
  color: #a1a1aa;
}

/* ── Slide transitions ────────────────────────────────────── */
.slide-left-enter-active,  .slide-left-leave-active,
.slide-right-enter-active, .slide-right-leave-active {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
}
.slide-left-enter-from  { transform: translateX(28px); opacity: 0; }
.slide-left-leave-to    { transform: translateX(-28px); opacity: 0; }
.slide-right-enter-from { transform: translateX(-28px); opacity: 0; }
.slide-right-leave-to   { transform: translateX(28px); opacity: 0; }

@media (max-width: 768px), (hover: none) and (pointer: coarse) {
  .tour-wrap { display: none; }
}
</style>
