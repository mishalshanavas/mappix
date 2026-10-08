/**
 * usePhysics — Matter.js engine composable.
 *
 * Manages:
 *  - Engine + Runner with gravity
 *  - Ball rain (spawnBall every spawnInterval ms)
 *  - Off-screen body cleanup
 *  - Static sticky-note bodies (syncStaticBodies)
 *
 * Settings object (reactive) is read each tick so sliders are live.
 */
import { shallowRef, ref } from 'vue'
import Matter from 'matter-js'
import { physicsDefaults, normalizeSettings } from '../utils/settings.js'

const { Engine, Runner, Composite, Bodies, Body, Events, Vertices } = Matter

const BALL_COLOR = '#ffffff'
const BALL_LIFETIME_MS = 30_000  // balls fade out and die after 30 s
const BALL_FADE_MS     = 4_000   // last 4 s of life spent fading

function randBetween(a, b) {
  return a + Math.random() * (b - a)
}

export function usePhysics(getWidth, getHeight) {
  const engine = shallowRef(null)
  const ballCount = ref(0)
  let runner = null
  let running = false
  let _stickyBodies = []
  let _spawnAccum = 0

  // Settings object — overwritten by updateSettings()
  let _settings = { ...physicsDefaults }

  function startPhysics() {
    if (engine.value) return
    engine.value = Engine.create({
      gravity: { x: 0, y: _settings.gravity, scale: 0.0012 }
    })

    runner = Runner.create()
    Runner.run(runner, engine.value)
    running = true

    Events.on(engine.value, 'afterUpdate', event => {
      const h = getHeight()
      const world = engine.value.world
      const bodies = world.bodies
      const now = engine.value.timing.timestamp

      // Simulation time freezes during pause and advances with actual physics steps.
      _spawnAccum += event.delta
      while (_spawnAccum >= _settings.spawnInterval) {
        _spawnBall()
        _spawnAccum -= _settings.spawnInterval
      }

      const toRemove = []
      let dynCount = 0
      for (const body of bodies) {
        if (body.isStatic) continue
        dynCount++
        if (body.position.y > h + 100) { toRemove.push(body); continue }
        const age = now - (body._spawnedAt ?? now)
        if (age >= BALL_LIFETIME_MS) { toRemove.push(body); continue }
        const fadeStart = BALL_LIFETIME_MS - BALL_FADE_MS
        body._opacity = age < fadeStart ? 1 : 1 - (age - fadeStart) / BALL_FADE_MS
      }
      for (const b of toRemove) Composite.remove(world, b)
      ballCount.value = dynCount - toRemove.length
    })
  }

  function _spawnBall() {
    if (!engine.value) return
    const world = engine.value.world
    if (world.bodies.filter(b => !b.isStatic).length >= _settings.maxBalls) {
      for (const b of world.bodies) {
        if (!b.isStatic) { Composite.remove(world, b); break }
      }
    }

    const w = getWidth()
    const radius = _settings.ballSize
    // Narrow column (~2% of width) centred at top for predictable fall
    const spread = w * 0.02
    const cx = w / 2
    const x = cx + randBetween(-spread, spread)

    const ball = Bodies.circle(x, -radius * 2, radius, {
      restitution: _settings.bounciness,
      friction: 0.05,
      frictionAir: 0.008,
      density: 0.002,
      label: 'ball',
      _color: BALL_COLOR,
      _spawnedAt: engine.value.timing.timestamp,
      _opacity: 1,
    })

    Body.setVelocity(ball, { x: randBetween(-0.1, 0.1), y: 0 })
    Composite.add(world, ball)
  }

  function updateSettings(s) {
    _settings = normalizeSettings({ ..._settings, ...s }, physicsDefaults)
    if (engine.value) {
      engine.value.gravity.y = _settings.gravity
      for (const body of engine.value.world.bodies) body.restitution = _settings.bounciness
      const balls = engine.value.world.bodies.filter(b => !b.isStatic)
      for (const body of balls.slice(0, Math.max(0, balls.length - _settings.maxBalls))) Composite.remove(engine.value.world, body)
      ballCount.value = Math.min(balls.length, _settings.maxBalls)
    }
  }

  function clearBalls() {
    if (!engine.value) return
    const world = engine.value.world
    const toRemove = world.bodies.filter(b => !b.isStatic)
    for (const b of toRemove) Composite.remove(world, b)
    ballCount.value = 0
    _spawnAccum = 0
  }

  function stopPhysics() {
    _spawnAccum = 0
    if (runner) { Runner.stop(runner); runner = null }
    if (engine.value) { Events.off(engine.value); Composite.clear(engine.value.world, false); Engine.clear(engine.value) }
    running = false
    _stickyBodies = []
    ballCount.value = 0
    engine.value = null
  }

  function syncStaticBodies(rects) {
    if (!engine.value) return
    const world = engine.value.world

    const incomingById = new Map(rects.map(r => [r.id, r]))

    const kept = new Map()
    for (const b of _stickyBodies) {
      if (incomingById.has(b._rectId)) {
        kept.set(b._rectId, b)
      } else {
        Composite.remove(world, b)
      }
    }

    _stickyBodies = []
    for (const rect of rects) {
      const existing = kept.get(rect.id)
      if (rect.hull && (rect.hull.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || Vertices.area(rect.hull) < 1)) {
        if (existing) Composite.remove(world, existing)
        continue
      }
      const center = rect.hull?.length >= 3 ? Vertices.centre(rect.hull) : { x: rect.cx, y: rect.cy }

      const verts = rect.hull?.length >= 3 ? rect.hull.map(p => ({ ...p })) : [
        { x: rect.cx - rect.w / 2, y: rect.cy - rect.h / 2 },
        { x: rect.cx + rect.w / 2, y: rect.cy - rect.h / 2 },
        { x: rect.cx + rect.w / 2, y: rect.cy + rect.h / 2 },
        { x: rect.cx - rect.w / 2, y: rect.cy + rect.h / 2 },
      ]
      if (existing) {
        Body.setVertices(existing, verts)
        Body.setPosition(existing, center)
        _stickyBodies.push(existing)
      } else {
        const body = Bodies.fromVertices(center.x, center.y, [verts], {
          isStatic: true, restitution: _settings.bounciness, friction: 0.05, label: 'sticky',
        })
        if (body) {
          body._rectId = rect.id
          Composite.add(world, body)
          _stickyBodies.push(body)
        }
      }
    }
  }

  function pausePhysics() {
    if (runner && running) {
      Runner.stop(runner)
      running = false
    }
  }

  function resumePhysics() {
    if (runner && engine.value && !running) {
      Runner.run(runner, engine.value)
      running = true
    }
  }

  return { engine, ballCount, startPhysics, stopPhysics, pausePhysics, resumePhysics, syncStaticBodies, updateSettings, clearBalls }
}
