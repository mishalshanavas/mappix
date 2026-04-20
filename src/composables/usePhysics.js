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

const { Engine, Runner, Composite, Bodies, Body, Events } = Matter

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
  let _stickyBodies = []
  let _spawnAccum = 0
  let _lastTick = 0

  // Settings object — overwritten by updateSettings()
  let _settings = {
    spawnInterval: 250,
    ballSize: 18,
    bounciness: 0.65,
    gravity: 1,
    maxBalls: 200,
  }

  function startPhysics() {
    engine.value = Engine.create({
      gravity: { x: 0, y: _settings.gravity, scale: 0.0012 }
    })

    runner = Runner.create()
    Runner.run(runner, engine.value)

    Events.on(engine.value, 'afterUpdate', () => {
      const h = getHeight()
      const world = engine.value.world
      const bodies = world.bodies
      const now = performance.now()

      // Accumulator-based ball spawning (drift-free, replaces setInterval)
      if (_lastTick > 0) {
        _spawnAccum += now - _lastTick
        while (_spawnAccum >= _settings.spawnInterval) {
          _spawnBall()
          _spawnAccum -= _settings.spawnInterval
        }
      }
      _lastTick = now

      const toRemove = []
      let dynCount = 0
      for (const body of bodies) {
        if (body.isStatic) continue
        dynCount++
        if (body.position.y > h + 100) { toRemove.push(body); continue }
        const age = now - (body._spawnedAt || now)
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
    if (ballCount.value >= _settings.maxBalls) {
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
      _spawnedAt: performance.now(),
      _opacity: 1,
    })

    Body.setVelocity(ball, { x: randBetween(-0.1, 0.1), y: 0 })
    Composite.add(world, ball)
  }

  function updateSettings(s) {
    _settings = { ..._settings, ...s }
    if (engine.value) {
      engine.value.gravity.y = _settings.gravity
    }
  }

  function clearBalls() {
    if (!engine.value) return
    const world = engine.value.world
    const toRemove = world.bodies.filter(b => !b.isStatic)
    for (const b of toRemove) Composite.remove(world, b)
  }

  function stopPhysics() {
    _spawnAccum = 0; _lastTick = 0
    if (runner) { Runner.stop(runner); runner = null }
    engine.value = null
  }

  function syncStaticBodies(rects) {
    if (!engine.value) return
    const world = engine.value.world

    // Build map of incoming rect IDs
    const incomingById = new Map(rects.map(r => [r.id, r]))

    // Remove bodies whose rect is gone, keep existing
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

      // Check if hull has changed enough to warrant body recreation
      let needsRecreate = !existing
      if (existing && rect.hull && rect.hull.length >= 3 && existing._hullSnap) {
        const prev = existing._hullSnap
        const cur = rect.hull
        if (prev.length === cur.length) {
          let maxDrift = 0
          for (let i = 0; i < cur.length; i++) {
            const dx = cur[i].x - prev[i].x, dy = cur[i].y - prev[i].y
            maxDrift = Math.max(maxDrift, dx * dx + dy * dy)
          }
          // Recreate if any hull point moved > 4px (accumulated EMA drift)
          if (maxDrift > 16) needsRecreate = true
        } else {
          needsRecreate = true
        }
      }

      if (existing && !needsRecreate) {
        // Update position only — shape hasn't drifted enough
        Body.setPosition(existing, { x: rect.cx, y: rect.cy })
        _stickyBodies.push(existing)
      } else {
        // Remove old body if recreating
        if (existing) Composite.remove(world, existing)

        let body
        if (rect.hull && rect.hull.length >= 3) {
          const verts = rect.hull.map(p => ({ x: p.x, y: p.y }))
          body = Bodies.fromVertices(rect.cx, rect.cy, [verts], {
            isStatic: true,
            restitution: _settings.bounciness,
            friction: 0.05,
            label: 'sticky',
          })
        } else {
          body = Bodies.rectangle(rect.cx, rect.cy, rect.w, rect.h, {
            isStatic: true,
            angle: rect.angle,
            restitution: _settings.bounciness,
            friction: 0.05,
            label: 'sticky',
          })
        }
        if (body) {
          body._rectId = rect.id
          // Snapshot hull for drift detection
          body._hullSnap = rect.hull ? rect.hull.map(p => ({ x: p.x, y: p.y })) : null
          Composite.add(world, body)
          _stickyBodies.push(body)
        }
      }
    }
  }

  function pausePhysics() {
    if (runner) {
      Runner.stop(runner)
    }
  }

  function resumePhysics() {
    if (runner && engine.value) {
      Runner.run(runner, engine.value)
    }
  }

  return { engine, ballCount, startPhysics, stopPhysics, pausePhysics, resumePhysics, syncStaticBodies, updateSettings, clearBalls }
}
