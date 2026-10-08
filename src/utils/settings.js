export const physicsDefaults = { spawnInterval: 430, ballSize: 11, bounciness: 0.8, gravity: 0.85, maxBalls: 300 }
export const detectionDefaults = { hueMin: 15, hueMax: 70, satMin: 8, valMin: 55, minBlobArea: 50 }
export const performanceDefaults = { targetFps: 60 }
const ranges = {
  spawnInterval: [50, 1000], ballSize: [5, 50], bounciness: [0, 1], gravity: [0, 3], maxBalls: [10, 500],
  hueMin: [0, 360], hueMax: [0, 360], satMin: [0, 100], valMin: [0, 100], minBlobArea: [10, 500], targetFps: [10, 60],
}
export function loadSettings(key, defaults) {
  let stored
  try { stored = JSON.parse(localStorage.getItem(key)) } catch { /* storage is optional */ }
  return normalizeSettings(stored, defaults)
}
export function normalizeSettings(stored, defaults) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const value = stored?.[key]
    const [min, max] = ranges[key]
    return [key, Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback]
  }))
}
export function saveSettings(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* keep session settings */ }
}
export const wrapHue = hue => ((hue % 360) + 360) % 360
export function hueMatches(hue, min, max) {
  return min <= max ? hue >= min && hue <= max : hue >= min || hue <= max
}
