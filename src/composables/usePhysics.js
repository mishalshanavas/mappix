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
import { shallowRef } from 'vue'
import Matter from 'matter-js'

const { Engine, Runner, Composite, Bodies, Body, Events } = Matter

const BALL_COLOR = '#ffffff'

function randBetween(a, b) {
  return a + Math.random() * (b - a)
}

export function usePhysics(getWidth, getHeight) {
  const engine = shallowRef(null)
  let runner = null
  let spawnTimer = null
  let _stickyBodies = []

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
      const toRemove = []
      for (const body of Composite.allBodies(world)) {
        if (!body.isStatic && body.position.y > h + 100) toRemove.push(body)
      }
      for (const b of toRemove) Composite.remove(world, b)
    })

    _scheduleSpawn()
  }

  function _scheduleSpawn() {
    if (spawnTimer) clearInterval(spawnTimer)
    spawnTimer = setInterval(() => _spawnBall(), _settings.spawnInterval)
  }

  function _spawnBall() {
    if (!engine.value) return
    const world = engine.value.world
    const dynamicBodies = Composite.allBodies(world).filter(b => !b.isStatic)

    if (dynamicBodies.length >= _settings.maxBalls) {
      Composite.remove(world, dynamicBodies[0])
    }

    const w = getWidth()
    const radius = _settings.ballSize
    // Tap: spawn in a narrow column (~5% of width) centred at top
    const spread = w * 0.05
    const cx = w / 2
    const x = cx + randBetween(-spread, spread)

    const ball = Bodies.circle(x, -radius * 2, radius, {
      restitution: _settings.bounciness,
      friction: 0.05,
      frictionAir: 0.008,
      density: 0.002,
      label: 'ball',
      _color: BALL_COLOR,
    })

    Body.setVelocity(ball, { x: randBetween(-0.4, 0.4), y: 0 })
    Composite.add(world, ball)
  }

  function updateSettings(s) {
    const intervalChanged = s.spawnInterval !== _settings.spawnInterval
    _settings = { ..._settings, ...s }

    if (engine.value) {
      engine.value.gravity.y = _settings.gravity
    }
    if (intervalChanged && spawnTimer) _scheduleSpawn()
  }

  function clearBalls() {
    if (!engine.value) return
    const world = engine.value.world
    const toRemove = Composite.allBodies(world).filter(b => !b.isStatic)
    for (const b of toRemove) Composite.remove(world, b)
  }

  function stopPhysics() {
    if (spawnTimer) { clearInterval(spawnTimer); spawnTimer = null }
    if (runner) { Runner.stop(runner); runner = null }
    engine.value = null
  }

  function syncStaticBodies(rects) {
    if (!engine.value) return
    const world = engine.value.world
    for (const b of _stickyBodies) Composite.remove(world, b)
    _stickyBodies = []

    for (const rect of rects) {
      let body
      if (rect.hull && rect.hull.length >= 3) {
        // Use actual contour shape
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
        Composite.add(world, body)
        _stickyBodies.push(body)
      }
    }
  }

  return { engine, startPhysics, stopPhysics, syncStaticBodies, updateSettings, clearBalls }
}
