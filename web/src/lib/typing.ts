/**
 * Where keys belong to what's being typed: fields, and any contenteditable (the live Markdown editor is
 * `contenteditable="plaintext-only"`, so `[contenteditable="true"]` alone missed it). Global shortcuts
 * (arrow keys through lists, Slack's D / J / R, /, F, Alt+arrows…) leave these alone.
 */
export const TYPING_TARGETS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

export const isTyping = (target: EventTarget | null): boolean => !!(target as Element | null)?.closest?.(TYPING_TARGETS)
