import test from 'node:test'
import assert from 'node:assert/strict'
import Matter from 'matter-js'
import { computeHomography, applyHomography } from '../src/utils/homography.js'
import { isValidQuad } from '../src/utils/geometry.js'
import { loadSettings, saveSettings, physicsDefaults, hueMatches, wrapHue } from '../src/utils/settings.js'
import { binaryToGray, grayToBinary, decodeCorrespondenceMap } from '../src/utils/structuredLight.js'
import { findBlobs } from '../src/utils/imageUtils.js'
import { useCalibration } from '../src/composables/useCalibration.js'
import { usePhysics } from '../src/composables/usePhysics.js'
import { useWebcam } from '../src/composables/useWebcam.js'
import { useDetection } from '../src/composables/useDetection.js'

function replaceGlobal(t, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] })
}

function storage(t, initial = {}) {
  const values = new Map(Object.entries(initial))
  replaceGlobal(t, 'localStorage', {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  })
  return values
}
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]

test('homography maps perspective points and rejects invalid correspondences', () => {
  const src = [[0, 0], [640, 0], [640, 480], [0, 480], [300, 200]]
  const expected = [2, .1, 50, .2, 1.5, 30, .0002, .0001, 1]
  const dst = src.map(([x, y]) => { const p = applyHomography(expected, x, y); return [p.x, p.y] })
  const H = computeHomography(src, dst)
  src.forEach(([x, y], i) => {
    const p = applyHomography(H, x, y)
    assert.ok(Math.hypot(p.x - dst[i][0], p.y - dst[i][1]) < 1e-6)
  })
  assert.throws(() => computeHomography(src, dst.slice(1)))
  assert.throws(() => computeHomography([[NaN, 0], ...src.slice(1)], dst))
  assert.throws(() => computeHomography([[0, 0], [1, 0], [2, 0], [3, 0]], dst.slice(0, 4)))
})

test('manual calibration rejects crossing, concave and collapsed corners', t => {
  storage(t)
  const c = useCalibration()
  assert.equal(c.applyManualCorners(square, square), true)
  for (const invalid of [[square[0], square[2], square[1], square[3]], [square[0], square[1], square[1], square[3]], [square[0], square[1], { x: 30, y: 30 }, square[3]]]) {
    assert.equal(isValidQuad(invalid), false)
    assert.equal(c.applyManualCorners(invalid, square), false)
    assert.equal(c.isCalibrated.value, true)
    assert.deepEqual(c.transformPoint(50, 50), { x: 50, y: 50 })
  }
  assert.equal(c.calibrationQuality.value, null)
})

test('saved mapping is invalidated when camera or output dimensions change', t => {
  storage(t)
  let context = { width: 100, height: 100, cameraWidth: 640 }
  const c = useCalibration(() => context)
  c.applyManualCorners(square, square)
  assert.equal(c.validateContext(), true)
  context = { ...context, width: 200 }
  assert.equal(c.validateContext(), false)
  assert.equal(c.isCalibrated.value, false)
})

test('cancelled calibration retains a valid previous mapping', async t => {
  storage(t)
  const c = useCalibration()
  c.applyManualCorners(square, square)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(c.calibrate({ width: 100, height: 100, getContext: () => ({}) }, () => null, () => {}, null, controller.signal), { name: 'AbortError' })
  assert.equal(c.isCalibrated.value, true)
})

test('saved settings clamp unsafe values and ignore wrong types', t => {
  storage(t, { phys: JSON.stringify({ spawnInterval: 0, ballSize: 'huge', bounciness: null, maxBalls: 10000, extra: 1 }) })
  const result = loadSettings('phys', physicsDefaults)
  assert.equal(result.spawnInterval, 50)
  assert.equal(result.ballSize, physicsDefaults.ballSize)
  assert.equal(result.bounciness, physicsDefaults.bounciness)
  assert.equal(result.maxBalls, 500)
  assert.equal(result.extra, undefined)
  t.mock.method(localStorage, 'setItem', () => { throw new Error('blocked') })
  assert.doesNotThrow(() => saveSettings('phys', result))
})

test('red hue wraps correctly across 0 degrees', () => {
  const min = wrapHue(-25), max = wrapHue(25)
  assert.equal(hueMatches(350, min, max), true)
  assert.equal(hueMatches(10, min, max), true)
  assert.equal(hueMatches(180, min, max), false)
  assert.equal(hueMatches(60, 15, 70), true)
})

test('Gray codes round-trip and low contrast pixels are excluded', () => {
  for (let n = 0; n < 2048; n++) assert.equal(grayToBinary(binaryToGray(n)), n)
  const result = decodeCorrespondenceMap([200, 20], [0, 15], [binaryToGray(3), 0], [binaryToGray(2), 0], 2, 1, 8, 8, 3, 3)
  assert.deepEqual([...result.valid], [1, 0])
  assert.equal(result.mapX[0], 3.5)
  assert.equal(result.mapY[0], 2.5)
})

test('blob detection separates disconnected objects and filters small noise', () => {
  const mask = new Uint8Array(100)
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) mask[y * 10 + x] = 1
  mask[88] = 1
  const blobs = findBlobs(mask, 10, 10, 4)
  assert.equal(blobs.length, 1)
  assert.equal(blobs[0].area, 9)
  assert.equal(blobs[0].hull.length, 4)
})

test('collision vertices retain world coordinates for irregular outlines', t => {
  replaceGlobal(t, 'window', { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} })
  const p = usePhysics(() => 1000, () => 800)
  p.startPhysics()
  p.pausePhysics()
  const hull = [{ x: 10, y: 20 }, { x: 200, y: 20 }, { x: 80, y: 130 }, { x: 10, y: 90 }]
  const cx = hull.reduce((sum, p) => sum + p.x, 0) / 4
  const cy = hull.reduce((sum, p) => sum + p.y, 0) / 4
  p.syncStaticBodies([{ id: 1, cx, cy, hull }])
  let body = p.engine.value.world.bodies[0]
  for (const vertex of hull) assert.ok(body.vertices.some(p => Math.hypot(p.x - vertex.x, p.y - vertex.y) < 1e-6))
  const shifted = hull.map(p => ({ x: p.x + 1, y: p.y + 1 }))
  p.syncStaticBodies([{ id: 1, cx: cx + 1, cy: cy + 1, hull: shifted }])
  body = p.engine.value.world.bodies[0]
  for (const vertex of shifted) assert.ok(body.vertices.some(p => Math.hypot(p.x - vertex.x, p.y - vertex.y) < 1e-6))
  p.updateSettings({ bounciness: .2 })
  assert.equal(body.restitution, .2)
  Matter.Composite.add(p.engine.value.world, Matter.Bodies.circle(20, 20, 10))
  p.clearBalls()
  assert.equal(p.ballCount.value, 0)
  assert.equal(p.engine.value.world.bodies.length, 1)
  p.stopPhysics()
})

test('camera requests are deduplicated and a late stream is stopped after cancellation', async t => {
  let resolve, stopped = 0, requests = 0
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia: () => { requests++; return new Promise(r => { resolve = r }) } } })
  const cam = useWebcam()
  const first = cam.startWebcam()
  assert.equal(first, cam.startWebcam())
  assert.equal(requests, 1)
  cam.stopWebcam()
  resolve({ getTracks: () => [{ stop: () => stopped++ }] })
  await assert.rejects(first, { name: 'AbortError' })
  assert.equal(stopped, 1)
  assert.equal(cam.ready.value, false)
})

test('camera tracks are released when playback fails', async t => {
  let stopped = 0
  const acquired = { getTracks: () => [{ stop: () => stopped++ }] }
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia: async () => acquired } })
  replaceGlobal(t, 'document', { createElement: () => ({ play: async () => { throw new Error('playback failed') } }) })
  const cam = useWebcam()
  await assert.rejects(cam.startWebcam(), /playback failed/)
  assert.equal(stopped, 1)
  assert.equal(cam.stream.value, null)
})

test('bitmap completing after detection restart is closed and never sent to the new worker', async t => {
  let tick, resolve, closed = 0, posts = 0
  t.mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1 })
  t.mock.method(globalThis, 'clearInterval', () => {})
  replaceGlobal(t, 'Worker', class { terminate() {} postMessage() { posts++ } })
  replaceGlobal(t, 'createImageBitmap', () => new Promise(r => { resolve = r }))
  const detection = useDetection()
  t.after(() => detection.stopDetection())
  const video = { readyState: 2 }
  detection.startDetection(() => video, (x, y) => ({ x, y }))
  const capture = tick()
  detection.stopDetection()
  detection.startDetection(() => video, (x, y) => ({ x, y }))
  resolve({ close: () => closed++ })
  await capture
  assert.equal(closed, 1)
  assert.equal(posts, 0)
})

test('structured light accepts an exact synthetic mapping and preserves it after three failed attempts', async t => {
  storage(t)
  t.mock.method(globalThis, 'setTimeout', fn => { queueMicrotask(fn); return 1 })
  replaceGlobal(t, 'requestAnimationFrame', fn => { queueMicrotask(fn); return 1 })
  const size = 64
  const rgba = new Uint8ClampedArray(size * size * 4)
  const ctx = {
    fillStyle: '#000000',
    fillRect(x, y, w, h) {
      const value = this.fillStyle === '#FFFFFF' ? 255 : 0
      for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
        const index = (row * size + col) * 4
        rgba[index] = rgba[index + 1] = rgba[index + 2] = value
        rgba[index + 3] = 255
      }
    },
    getImageData: () => ({ width: size, height: size, data: rgba }),
  }
  const canvas = { width: size, height: size, getContext: () => ctx }
  const calibration = useCalibration()
  assert.equal(await calibration.calibrate(canvas, () => canvas, async () => {}), true)
  const point = calibration.transformPoint(30, 30)
  assert.ok(Math.hypot(point.x - 30.5, point.y - 30.5) < 1e-6)
  const attempts = []
  ctx.getImageData = () => ({ width: size, height: size, data: new Uint8ClampedArray(rgba.length) })
  assert.equal(await calibration.calibrate(canvas, () => canvas, async () => {}, (_, __, message) => { if (message.includes('warming')) attempts.push(message) }), false)
  assert.equal(attempts.length, 3)
  assert.deepEqual(calibration.transformPoint(30, 30), point)
})


test('corrupt stored calibration is not reported as calibrated', t => {
  storage(t, { 'mappix:calibration-v2': JSON.stringify({ version: 2, H: [0,0,0,0,0,0,0,0,0], corners: square }) })
  assert.equal(useCalibration().isCalibrated.value, false)
})
