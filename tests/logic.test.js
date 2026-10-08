import test from 'node:test'
import assert from 'node:assert/strict'
import Matter from 'matter-js'
import { cameraViewport, cameraToCanvas, canvasToCamera } from '../src/utils/coordinates.js'
import { createBlobTracker, alignHull, resampleHull } from '../src/utils/tracking.js'
import { polygonArea, polygonBounds } from '../src/utils/geometry.js'
import { patternBits, cellCorrespondences, decodeCorrespondenceMap, binaryToGray } from '../src/utils/structuredLight.js'
import { fitCalibration, mappingCorners } from '../src/utils/calibrationFit.js'
import { sessionPolicy } from '../src/utils/session.js'
import { waitForVideoFrame, sleep } from '../src/utils/async.js'
import { usePhysics } from '../src/composables/usePhysics.js'
import { useCalibration } from '../src/composables/useCalibration.js'

const blob = (x, y = 20, size = 20) => ({ x, y, w: size, h: size, hull: [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }] })
function replaceGlobal(t, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] })
}

test('contained preview preserves the entire camera frame and rejects letterbox picks', () => {
  const viewport = cameraViewport(640, 480, 1920, 1080)
  assert.equal(viewport.scale, 2.25)
  for (const p of [{ x: 0, y: 0 }, { x: 640, y: 480 }, { x: 320, y: 240 }]) assert.deepEqual(canvasToCamera(cameraToCanvas(p, viewport), viewport), p)
  assert.equal(canvasToCamera({ x: 100, y: 540 }, viewport), null)
})

test('hull phase and winding changes do not shrink a static object', () => {
  const reference = resampleHull(blob(20).hull)
  const reversed = reference.slice(7).concat(reference.slice(0, 7)).reverse()
  assert.deepEqual(alignHull(reference, reversed), reference)
  const tracker = createBlobTracker()
  tracker.update([blob(20)], 0)
  const b = blob(20); b.hull = b.hull.slice(1).concat(b.hull.slice(0, 1)).reverse()
  const [track] = tracker.update([b], 100)
  assert.ok(Math.abs(polygonArea(track.hull) - 400) < 1e-6)
})

test('matching uses closest pairs regardless of incoming blob order', () => {
  const tracker = createBlobTracker()
  tracker.update([blob(0), blob(35)], 0)
  const initial = tracker.update([blob(0), blob(35)], 100)
  const next = tracker.update([blob(20), blob(1)], 200)
  assert.equal(next.length, 2)
  assert.ok(polygonBounds(next.find(t => t.id === initial[0].id).hull).x < 5)
})

test('tracking confirms consecutive observations, preserves short gaps, and expires by time', () => {
  const tracker = createBlobTracker()
  assert.equal(tracker.update([blob(0)], 0).length, 0)
  assert.equal(tracker.update([], 100).length, 0)
  assert.equal(tracker.update([blob(0)], 200).length, 0)
  const [track] = tracker.update([blob(0)], 300)
  assert.ok(track)
  assert.equal(tracker.update([], 500)[0].id, track.id)
  assert.equal(tracker.update([], 800).length, 0)
  assert.equal(tracker.update([blob(0)], 900).length, 0)
})

test('time-based smoothing has the same response across sampling rates', () => {
  function response(step) {
    const tracker = createBlobTracker()
    tracker.update([blob(0)], 0)
    tracker.update([blob(0)], 100)
    let tracks
    for (let time = 100 + step; time <= 500; time += step) tracks = tracker.update([blob(10)], time)
    return polygonBounds(tracks[0].hull).x
  }
  assert.ok(Math.abs(response(100) - response(200)) < 1e-6)
})

test('pattern resolution is bounded by camera sampling and coarsens on retry', () => {
  assert.equal(patternBits(1920, 640), 7)
  assert.equal(patternBits(3840, 640), 7)
  assert.ok(640 / 2 ** patternBits(3840, 640) >= 4)
  assert.equal(patternBits(1920, 640, 2), 6)
})

test('decoded cell centers match integer stripe drawing boundaries', () => {
  const decoded = decodeCorrespondenceMap([255], [0], [binaryToGray(1)], [0], 1, 1, 100, 80, 4, 4)
  assert.equal(decoded.mapX[0], (6 + 12) / 2)
})

test('cell sampling averages camera pixels instead of selecting one cell edge', () => {
  const size = 40, x = new Float32Array(size * size), y = new Float32Array(size * size), valid = new Uint8Array(size * size)
  for (let row = 10; row < 14; row++) for (let col = 10; col < 14; col++) { const i = row * size + col; x[i] = 100; y[i] = 200; valid[i] = 1 }
  const sample = cellCorrespondences(x, y, valid, size, size)
  assert.deepEqual(sample.srcPts, [[11.5, 11.5]])
  assert.deepEqual(sample.dstPts, [[100, 200]])
})

function correspondences() {
  const src = [], dst = []
  for (let y = 5; y < 100; y += 10) for (let x = 5; x < 100; x += 10) { src.push([x, y]); dst.push([x, y]) }
  return { src, dst }
}

test('calibration requires held-out accuracy and broad surface coverage', () => {
  const { src, dst } = correspondences()
  const result = fitCalibration(src, dst, 100, 100, 100, 100)
  assert.ok(result.quality.validationError < .1)
  const wrongValidation = dst.map(([x, y], i) => i % 4 === 0 ? [x + 40, y - 25] : [x, y])
  assert.throws(() => fitCalibration(src, wrongValidation, 100, 100, 100, 100), /independent validation/)
  const tiny = src.map(([x, y]) => [x / 10 + 45, y / 10 + 45])
  assert.throws(() => fitCalibration(tiny, tiny, 100, 100, 100, 100), /more of the projected area/)
})

test('mapping rejects a horizon crossing the projected surface', () => {
  assert.equal(mappingCorners([1,0,0,0,1,0,.02,0,-1], 100, 100, 100, 100), null)
})

test('session policy keeps camera, editing, errors, pause, and setup consistent', () => {
  const base = { started: true, ready: true, pending: false, mode: 'normal', guide: false, hidden: false, paused: false, detectionError: '', cameraError: '' }
  assert.deepEqual(sessionPolicy(base), { state: 'running', detect: true, simulate: true })
  for (const mode of ['calibrating', 'manual', 'picking']) assert.deepEqual(sessionPolicy({ ...base, mode }), { state: mode, detect: false, simulate: false })
  assert.deepEqual(sessionPolicy({ ...base, paused: true }), { state: 'paused', detect: true, simulate: false })
  assert.deepEqual(sessionPolicy({ ...base, ready: false }), { state: 'stopped', detect: false, simulate: false })
  assert.deepEqual(sessionPolicy({ ...base, detectionError: 'failed' }), { state: 'detection-error', detect: false, simulate: false })
  for (const field of ['hidden', 'guide', 'pending']) assert.equal(sessionPolicy({ ...base, [field]: true }).simulate, false)
})

test('fresh-frame timeout rejects stale input and cancels its callback', async () => {
  let cancelled
  const video = { readyState: 2, currentTime: 1, requestVideoFrameCallback: () => 42, cancelVideoFrameCallback: id => { cancelled = id } }
  await assert.rejects(waitForVideoFrame(video, 10), /timed out/)
  assert.equal(cancelled, 42)
})

test('fresh-frame waits and settling delays abort immediately', async () => {
  const controller = new AbortController()
  let cancelled = false
  const video = { readyState: 2, currentTime: 1, requestVideoFrameCallback: () => 1, cancelVideoFrameCallback: () => { cancelled = true } }
  const frame = waitForVideoFrame(video, 10000, controller.signal)
  const settle = sleep(10000, controller.signal)
  controller.abort()
  await assert.rejects(frame, { name: 'AbortError' })
  await assert.rejects(settle, { name: 'AbortError' })
  assert.equal(cancelled, true)
})

test('physics ball age and spawning use simulation time, independent of wall time', t => {
  replaceGlobal(t, 'window', { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} })
  const physics = usePhysics(() => 800, () => 600)
  physics.startPhysics(); physics.pausePhysics()
  physics.updateSettings({ spawnInterval: 100, gravity: 0 })
  const engine = physics.engine.value
  for (let i = 0; i < 7; i++) Matter.Engine.update(engine, 1000 / 60)
  const ball = engine.world.bodies.find(b => b.label === 'ball')
  assert.ok(ball)
  t.mock.method(performance, 'now', () => 1e9)
  Matter.Engine.update(engine, 1000 / 60)
  assert.equal(engine.world.bodies.includes(ball), true)
  assert.equal(ball._opacity, 1)
  const obstacle = blob(20)
  const rect = { id: 1, ...polygonBounds(obstacle.hull), hull: obstacle.hull }
  physics.syncStaticBodies([rect])
  const body = engine.world.bodies.find(b => b.isStatic)
  physics.syncStaticBodies([{ ...rect, hull: blob(22, 20, 25).hull }])
  assert.equal(engine.world.bodies.find(b => b.isStatic), body)
  physics.stopPhysics()
})

test('calibration persistence writes matrix, corners and context atomically', t => {
  const store = new Map()
  replaceGlobal(t, 'localStorage', { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) })
  const context = { width: 100, height: 100, cameraWidth: 100, cameraHeight: 100, deviceId: 'test' }
  const corners = blob(0, 0, 100).hull
  const calibration = useCalibration(() => context)
  assert.equal(calibration.applyManualCorners(corners, corners), true)
  assert.equal(store.size, 1)
  const restored = useCalibration(() => context)
  assert.equal(restored.validateContext(), true)
  assert.deepEqual(restored.transformPoint(45, 67), { x: 45, y: 67 })
})

test('automatic calibration survives camera downsampling, blur and mild brightness noise', async t => {
  replaceGlobal(t, 'localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  t.mock.method(globalThis, 'setTimeout', fn => { queueMicrotask(fn); return 1 })
  replaceGlobal(t, 'requestAnimationFrame', fn => { queueMicrotask(fn); return 1 })
  const width = 192, height = 128, cw = 128, ch = 96
  const pixels = new Uint8Array(width * height)
  const ctx = {
    fillStyle: '#000000',
    fillRect(x, y, w, h) { for (let row = y; row < y + h; row++) pixels.fill(this.fillStyle === '#FFFFFF' ? 220 : 20, row * width + x, row * width + x + w) },
  }
  const projector = { width, height, getContext: () => ctx }
  let seed = 7
  const capture = () => ({ width: cw, height: ch, getContext: () => ({ getImageData: () => {
    const data = new Uint8ClampedArray(cw * ch * 4)
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let brightness = 0
      for (const dy of [-.4, 0, .4]) for (const dx of [-.4, 0, .4]) {
        const px = Math.floor((x + dx - 16) * 2), py = Math.floor((y + dy - 16) * 2)
        brightness += px >= 0 && px < width && py >= 0 && py < height ? pixels[py * width + px] : 20
      }
      seed = (seed * 1664525 + 1013904223) >>> 0
      const v = brightness / 9 + seed % 5 - 2, i = (y * cw + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255
    }
    return { data, width: cw, height: ch }
  } }) })
  const c = useCalibration()
  const reports = []
  assert.equal(await c.calibrate(projector, capture, async () => {}, (_, __, message) => reports.push(message)), true, reports.join('\n'))
  for (const point of [{ x: 30, y: 30 }, { x: 90, y: 65 }]) {
    const mapped = c.transformPoint(point.x, point.y)
    assert.ok(Math.hypot(mapped.x - (point.x - 16) * 2, mapped.y - (point.y - 16) * 2) < 3)
  }
})
