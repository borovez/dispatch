import type { InjectionKey } from 'vue'

/** HoverCard ↔ HoverCardTrigger: the pointer is on an inner trigger, or back on this card's own area */
export const HOVER_CARD_INNER: InjectionKey<{ set(inner: boolean): void; reopen(): void; openDelay(): number }> = Symbol('hover-card-inner')
