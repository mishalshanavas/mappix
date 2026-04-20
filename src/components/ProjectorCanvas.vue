<template>
  <canvas ref="canvasRef" class="projector-canvas" />
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Matter from 'matter-js'

const props = defineProps({
  engine: {        // Matter.js engine instance (shallowRef value)
    type: Object,
    default: null
  },
  debug: {         // show sticky-body outlines
    type: Boolean,
    default: false
  },
  appState: {      // 'idle' | 'calibrating' | 'running'
    type: String,
    default: 'idle'
  },
  calibrationMarkers: {
    type: Array,
    default: () => []
  },
  showMarkers: {   // always show alignment tracking markers
    type: Boolean,
    default: true
  },
  detectedRects: { // detected sticky rects (for drawing outlines always)
    type: Array,
    default: () => []
  },
  showWebcamBg: {
    type: Boolean,
    default: false
  },
  videoEl: {
    type: Object,
    default: null
  },
  calibrationQuality: {
    type: Object,
    default: null
  },
  maxBalls: {
    type: Number,
    default: null
  },
  physicsPaused: {
    type: Boolean,
    default: false
  },
  targetFps: {
    type: Number,
    default: 60
  }
})

const emit = defineEmits(['canvas-ready', 'resize'])

const canvasRef = ref(null)
let rafId = null
let _lastFpsTime = performance.now()
let _frameCount = 0
let _fps = 0
let _ctx = null
let _lastRafTime = performance.now()
let _frameMs = 16.7  // EMA of frame delta

// Expose the canvas element to parent
onMounted(() => {
  const canvas = canvasRef.value
  resizeCanvas(canvas)
  _ctx = canvas.getContext('2d')
  emit('canvas-ready', canvas)
  rafId = requestAnimationFrame(renderLoop)
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  window.removeEventListener('resize', onResize)
})

function onResize() {
  const canvas = canvasRef.value
  if (!canvas) return
  resizeCanvas(canvas)
  emit('resize', { width: canvas.width, height: canvas.height })
}

function resizeCanvas(canvas) {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}

function renderLoop(now) {
  rafId = requestAnimationFrame(renderLoop)

  // --- Frame-rate limiter ---
  const minInterval = 1000 / (props.targetFps || 60)
  if (now - _lastRafTime < minInterval * 0.92) return

  const canvas = canvasRef.value
  if (!canvas || !_ctx) return
  const ctx = _ctx
  const W = canvas.width
  const H = canvas.height

  // --- FPS counter + frame time ---
  _frameMs = _frameMs * 0.85 + (now - _lastRafTime) * 0.15
  _lastRafTime = now
  _frameCount++
  if (now - _lastFpsTime >= 1000) {
    _fps = _frameCount
    _frameCount = 0
    _lastFpsTime = now
  }

  // === Clear with black ===
  // During calibration, canvas is controlled by useCalibration (structured light patterns)
  // — do NOT clear or draw anything that would overwrite the patterns
  if (props.appState === 'calibrating') return

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)

  // === Webcam background (aspect-ratio preserving, zoom to fill) ===
  if (props.showWebcamBg && props.videoEl && props.videoEl.readyState >= 2) {
    const vw = props.videoEl.videoWidth || 640
    const vh = props.videoEl.videoHeight || 480
    const scale = Math.max(W / vw, H / vh)
    const dw = vw * scale
    const dh = vh * scale
    const dx = (W - dw) / 2
    const dy = (H - dh) / 2
    ctx.globalAlpha = 0.35
    ctx.drawImage(props.videoEl, dx, dy, dw, dh)
    ctx.globalAlpha = 1.0
  }

  // === Draw physics bodies ===
  if (props.engine) {
    const bodies = props.engine.world.bodies

    for (const body of bodies) {
      if (body.label === 'ball') {
        drawBall(ctx, body)
      }
    }
  }

  // === Draw detected object outlines ===
  if (props.detectedRects.length) {
    ctx.strokeStyle = props.debug ? 'rgba(0, 200, 255, 0.6)' : 'rgba(160,160,160,0.6)'
    ctx.lineWidth = props.debug ? 1.5 : 2
    for (const rect of props.detectedRects) {
      const pts = rect.hull || rect.corners
      if (!pts || pts.length < 3) continue
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.closePath()
      ctx.stroke()
    }
  }

  // === Permanent tracking markers (4 corners + centre cross) ===
  if (props.showMarkers) {
    drawTrackingMarkers(ctx, W, H)
  }

  // === Debug overlay (F3-style) ===
  if (props.debug) {
    drawDebugOverlay(ctx, W, H)
  }
}

function drawBall(ctx, body) {
  const { x, y } = body.position
  const radius = body.circleRadius || 6
  const opacity = body._opacity ?? 1

  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(255,255,255,${opacity.toFixed(3)})`
  ctx.fill()
}

/** Draw permanent corner brackets + centre cross for position tracking */
function drawTrackingMarkers(ctx, W, H) {
  const M = 20    // marker arm length
  const P = 12    // inset from edge
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 1

  // Corner bracket helper
  function bracket(x, y, dx, dy) {
    ctx.beginPath()
    ctx.moveTo(x + dx * M, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + dy * M)
    ctx.stroke()
  }

  bracket(P, P, 1, 1)               // top-left
  bracket(W - P, P, -1, 1)          // top-right
  bracket(W - P, H - P, -1, -1)     // bottom-right
  bracket(P, H - P, 1, -1)          // bottom-left

  // Centre cross
  const cx = W / 2, cy = H / 2, cs = 10
  ctx.beginPath()
  ctx.moveTo(cx - cs, cy); ctx.lineTo(cx + cs, cy)
  ctx.moveTo(cx, cy - cs); ctx.lineTo(cx, cy + cs)
  ctx.stroke()

  // Edge midpoint ticks
  const tick = 8
  ctx.beginPath()
  ctx.moveTo(W / 2, P); ctx.lineTo(W / 2, P + tick)          // top mid
  ctx.moveTo(W / 2, H - P); ctx.lineTo(W / 2, H - P - tick)  // bottom mid
  ctx.moveTo(P, H / 2); ctx.lineTo(P + tick, H / 2)          // left mid
  ctx.moveTo(W - P, H / 2); ctx.lineTo(W - P - tick, H / 2)  // right mid
  ctx.stroke()
}

/** Minecraft F3-style debug overlay */
function drawDebugOverlay(ctx, W, H) {
  ctx.save()
  ctx.textBaseline = 'top'
  const FONT = '11px monospace'
  ctx.font = FONT
  const LH = 13   // line height
  const PX = 3    // horizontal pad
  const PY = 1    // vertical pad

  // --- gather data ---
  let dynCount = 0, staticCount = 0
  if (props.engine?.world) {
    for (const b of props.engine.world.bodies) {
      if (b.isStatic) staticCount++
      else dynCount++
    }
  }
  const cq  = props.calibrationQuality
  const mem = (typeof performance !== 'undefined') && performance.memory
  const fpsColor = _fps >= 50 ? '#55FF55' : _fps >= 25 ? '#FFFF55' : '#FF5555'

  // Lines: array of [{t, c}] — empty array = blank spacer
  const left = [
    [{ t: `${_fps} fps`, c: fpsColor }, { t: `  (${_frameMs.toFixed(1)} ms)`, c: '#aaaaaa' }],
    [{ t: `${W} × ${H} px`, c: '#ffffff' }],
    [],
    [{ t: 'state: ', c: '#aaaaaa' }, { t: props.appState, c: '#55FFFF' }, ...(props.physicsPaused ? [{ t: '  PAUSED', c: '#FFFF00' }] : [])],
    [{ t: 'webcam bg: ', c: '#aaaaaa' }, { t: props.showWebcamBg ? 'on' : 'off', c: props.showWebcamBg ? '#55FF55' : '#aaaaaa' }],
    [{ t: 'markers: ', c: '#aaaaaa' }, { t: props.showMarkers ? 'on' : 'off', c: props.showMarkers ? '#55FF55' : '#aaaaaa' }],
    [],
    ...(mem ? [[{ t: 'heap: ', c: '#aaaaaa' }, { t: `${(mem.usedJSHeapSize / 1e6).toFixed(1)} MB`, c: '#ffffff' }, { t: ` / ${(mem.jsHeapSizeLimit / 1e6).toFixed(0)} MB`, c: '#555555' }]] : []),
  ]

  const right = [
    [{ t: 'balls: ', c: '#aaaaaa' }, { t: `${dynCount}`, c: '#ffffff' }, { t: ` / ${props.maxBalls ?? '?'}`, c: '#555555' }],
    [{ t: 'stickies: ', c: '#aaaaaa' }, { t: `${staticCount}`, c: '#ffffff' }],
    [{ t: 'blobs: ', c: '#aaaaaa' }, { t: `${props.detectedRects.length}`, c: '#ffffff' }],
    [],
    cq
      ? [{ t: 'calib err: ', c: '#aaaaaa' }, { t: `${cq.error} px`, c: '#55FF55' }]
      : [{ t: 'calibration: ', c: '#aaaaaa' }, { t: 'none', c: '#FF5555' }],
    ...(cq ? [
      [{ t: 'inliers: ', c: '#aaaaaa' }, { t: `${cq.inliers}/${cq.total}`, c: '#ffffff' }],
      [{ t: 'coverage: ', c: '#aaaaaa' }, { t: `${cq.validPct}%`, c: '#ffffff' }],
    ] : []),
    [],
    [{ t: 'detection: ', c: '#aaaaaa' }, { t: '5 Hz', c: '#ffffff' }],
    [{ t: 'bodies total: ', c: '#aaaaaa' }, { t: `${dynCount + staticCount}`, c: '#ffffff' }],
    [],
    [{ t: 'DEBUG KEYS:', c: '#FFFF55' }],
    [{ t: 'R', c: '#55FFFF' }, { t: '=clear  ', c: '#aaaaaa' }, { t: 'B', c: '#55FFFF' }, { t: '=bg  ', c: '#aaaaaa' }, { t: 'M', c: '#55FFFF' }, { t: '=markers', c: '#aaaaaa' }],
    [{ t: 'SPC', c: '#55FFFF' }, { t: '=pause  ', c: '#aaaaaa' }, { t: 'ESC', c: '#55FFFF' }, { t: '=reset', c: '#aaaaaa' }],
  ]

  function drawLines(lines, startX, rightAlign, offsetY = 0) {
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i]
      if (!parts.length) continue   // blank spacer
      const y = (offsetY || 8) + i * LH
      let totalW = 0
      for (const p of parts) totalW += ctx.measureText(p.t).width
      const x0 = rightAlign ? W - 8 - totalW - PX : startX - PX
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(x0, y - PY, totalW + PX * 2, LH + PY)
      let tx = x0 + PX
      for (const p of parts) {
        ctx.fillStyle = p.c
        ctx.fillText(p.t, tx, y)
        tx += ctx.measureText(p.t).width
      }
    }
  }

  drawLines(left, 8, false)
  const rightStartY = Math.max(left.length * LH + 16, 8)
  drawLines(right, 0, true, rightStartY)
  ctx.restore()
}

// Expose canvas ref and fps for parent
defineExpose({ canvasRef, getFps: () => _fps })
</script>

<style scoped>
.projector-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: block;
  background: #000;
}
</style>
