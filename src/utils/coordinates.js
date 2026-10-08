// One coordinate convention for previews, color picking, and uncalibrated mapping.
export function cameraViewport(cameraWidth, cameraHeight, width, height) {
  const scale = Math.min(width / cameraWidth, height / cameraHeight)
  return { scale, x: (width - cameraWidth * scale) / 2, y: (height - cameraHeight * scale) / 2, width: cameraWidth * scale, height: cameraHeight * scale }
}
export function cameraToCanvas(point, viewport) {
  return { x: viewport.x + point.x * viewport.scale, y: viewport.y + point.y * viewport.scale }
}
export function canvasToCamera(point, viewport) {
  if (point.x < viewport.x || point.x > viewport.x + viewport.width || point.y < viewport.y || point.y > viewport.y + viewport.height) return null
  return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale }
}
