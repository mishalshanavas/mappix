<template>
  <label class="camera-select">
    <span>Camera</span>
    <select aria-label="Camera device" :value="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.value)">
      <option value="">System default</option>
      <option v-for="(camera, index) in devices" :key="camera.deviceId" :value="camera.deviceId">{{ camera.label || `Camera ${index + 1}` }}</option>
    </select>
  </label>
</template>
<script setup>
defineProps({ devices: { type: Array, default: () => [] }, modelValue: { type: String, default: '' }, disabled: Boolean })
defineEmits(['update:modelValue'])
</script>
<style scoped>
.camera-select { display: flex; flex-direction: column; gap: 6px; width: 100%; color: #a1a1aa; font: 12px/1.5 system-ui; text-align: left; }
select { width: 100%; padding: 8px; border: 1px solid #3f3f46; border-radius: 6px; background: #18181b; color: #fafafa; font: inherit; }
</style>
