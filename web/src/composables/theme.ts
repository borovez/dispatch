import { useColorMode } from '@vueuse/core'

/** 'auto' follows the OS; toggles the `.dark` class on <html> that the shadcn tokens key off. */
// The key was 'prdeck-theme' before the rename
try {
  const old = localStorage.getItem('prdeck-theme')
  if (old !== null && localStorage.getItem('dispatch-theme') === null) localStorage.setItem('dispatch-theme', old)
  localStorage.removeItem('prdeck-theme')
} catch {
  /* storage blocked */
}
export const useTheme = () => useColorMode({ storageKey: 'dispatch-theme', emitAuto: true })
