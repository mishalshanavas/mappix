import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const url = 'http://127.0.0.1:5175/'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5175', '--strictPort'], { stdio: 'pipe' })
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Test server could not start; ensure port 5175 is free')
    try { if ((await fetch(url)).ok) { ready = true; break } } catch {}
    await delay(100)
  }
  assert.ok(ready, 'Test server started')
  browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', err => errors.push(err.message))
  try {
    await page.goto(url)
    await page.getByRole('button', { name: "Let's go" }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Allow Camera' }).click()
    await page.getByRole('heading', { name: 'Camera ready' }).waitFor()
    assert.ok(await page.locator('video').isVisible())
    const cameraOptions = await page.getByRole('combobox', { name: 'Camera device' }).locator('option').all()
    assert.ok(cameraOptions.length > 1)
    await page.getByRole('combobox', { name: 'Camera device' }).selectOption({ index: 1 })
    await page.getByRole('heading', { name: 'Camera ready' }).waitFor()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Skip for now', exact: false }).click()
    await page.getByRole('button', { name: 'Show settings', exact: true }).click()
    await page.getByRole('button', { name: 'Manual', exact: true }).click()
    await page.keyboard.press(']')
    const before = await page.locator('.mc-handle').first().getAttribute('style')
    await page.mouse.move(300, 300)
    assert.equal(await page.locator('.mc-handle').first().getAttribute('style'), before)
    await page.keyboard.press('ArrowRight')
    assert.notEqual(await page.locator('.mc-handle').first().getAttribute('style'), before)
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await page.getByText('Calibrated', { exact: true }).waitFor()
    await page.getByRole('switch', { name: 'Show camera background' }).waitFor()
    assert.equal(await page.getByRole('switch', { name: 'Show camera background' }).getAttribute('aria-checked'), 'false')
    await page.getByRole('button', { name: 'Advanced', exact: true }).click()
    await page.getByRole('button', { name: 'Pick', exact: true }).click()
    await page.mouse.click(10, 400)
    assert.equal(await page.locator('.pick-overlay').count(), 1)
    await page.getByText('Choose a color inside the camera image.', { exact: false }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.pick-overlay').count(), 0)
    await page.getByRole('slider', { name: 'Color', exact: true }).fill('0')
    const hue = await page.getByRole('slider', { name: 'Color', exact: true }).inputValue()
    assert.equal(hue, '0')

    await page.getByRole('button', { name: 'Re-calibrate', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByText('Calibration cancelled.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click()
    await page.waitForFunction(() => !document.fullscreenElement)
    await page.setViewportSize({ width: 1100, height: 720 })
    await page.getByText('Display size changed.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Stop Webcam', exact: true }).click()
    await page.getByText('Camera stopped', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: "Let's go" }).count(), 0)
    await page.getByRole('button', { name: 'Start Webcam', exact: true }).click()
    await page.getByRole('button', { name: 'Pause simulation', exact: true }).click()
    await page.getByText('Paused', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Resume simulation', exact: true }).click()
    await page.getByText('Running', { exact: true }).waitFor()

    assert.deepEqual(errors, [])
    console.log('PASS: onboarding, camera, skip, manual selection/nudge/apply, background restore, color pick cancel, red hue, calibration cancel, resize invalidation, camera stop; no page errors')
    const denied = await browser.newContext({ viewport: { width: 1024, height: 600 }, permissions: [] })
    await denied.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError') }
    })
    const deniedPage = await denied.newPage()
    deniedPage.on('pageerror', err => errors.push(err.message))
    await deniedPage.goto(url)
    await deniedPage.getByRole('button', { name: "Let's go" }).click()
    await deniedPage.getByRole('button', { name: 'Continue', exact: true }).click()
    await deniedPage.getByRole('button', { name: 'Allow Camera' }).click()
    await deniedPage.getByRole('heading', { name: 'Access denied' }).waitFor()
    assert.equal(await deniedPage.getByRole('button', { name: 'Try again' }).isEnabled(), true)
    assert.deepEqual(errors, [])
    console.log('PASS: camera denial recovery at 1024×600')
  } finally { await context.close() }
} finally { await browser?.close(); server.kill() }
