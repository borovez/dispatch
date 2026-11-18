/**
 * What under the pointer opens its own hover card, so an outer card can step aside for an inner one
 * (HoverCard / HoverCardTrigger wrappers) and the link card knows which links it serves.
 */

/** A link the link hover card (LinkHoverCard) shows a card for: absolute http(s), another origin, not opted out */
export function linkCardTarget(a: HTMLAnchorElement): boolean {
  return /^https?:\/\//i.test(a.getAttribute('href') ?? '') && a.origin !== location.origin && !a.closest('[data-no-link-preview]')
}

/** The innermost element from `target` up to (not including) `root` that opens its own hover card */
export function innerTrigger(target: EventTarget | null, root: Element): Element | null {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.matches('[data-slot=hover-card-trigger]') || (el instanceof HTMLAnchorElement && linkCardTarget(el))) return el
  }
  return null
}
