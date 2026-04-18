<template>
  <canvas ref="canvasRef" class="projector-canvas" />
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import Matter from 'matter-js'

const { Composite } = Matter

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
  }
})

const emit = defineEmits(['canvas-ready', 'resize'])

const canvasRef = ref(null)
let rafId = null
let _lastFpsTime = performance.now()
let _frameCount = 0
let _fps = 0

// Expose the canvas element to parent
onMounted(() => {
  const canvas = canvasRef.value
  resizeCanvas(canvas)
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

  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height

  // --- FPS counter ---
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

  // === Draw physics bodies ===
  if (props.engine) {
    const bodies = Composite.allBodies(props.engine.world)

    for (const body of bodies) {
      if (body.label === 'ball') {
        drawBall(ctx, body)
      } else if (body.label === 'sticky' && props.debug) {
        drawStickyOutline(ctx, body)
      }
    }
  }

  // === Draw detected contour outlines (always visible, gray) ===
  if (props.detectedRects.length) {
    ctx.strokeStyle = 'rgba(180, 180, 180, 0.6)'
    ctx.lineWidth = 1.5
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

  // === Debug: FPS ===
  if (props.debug) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = '16px monospace'
    ctx.fillText(`${_fps} fps`, 14, 24)
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

function drawStickyOutline(ctx, body) {
  const verts = body.vertices
  if (!verts || verts.length < 3) return

  ctx.strokeStyle = 'rgba(160,160,160,0.6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(verts[0].x, verts[0].y)
  for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y)
  ctx.closePath()
  ctx.stroke()
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
