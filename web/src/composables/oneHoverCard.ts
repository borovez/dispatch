import { inject, onScopeDispose, provide, shallowRef, watch, type InjectionKey } from 'vue'

/**
 * One hover card open at a time, app wide: when a card opens, every other open card closes, except
 * the cards it sits inside (a card opened from within another card's content keeps its parents
 * open). Used by the shared `HoverCard` (components/ui/hover-card) and the link hover card.
 */
type Claim = { id: symbol; ancestors: ReadonlySet<symbol> }
const active = shallowRef<Claim | null>(null)
const PARENTS: InjectionKey<ReadonlySet<symbol>> = Symbol('hover-card-parents')

/**
 * `close` is called when another card (not a child of this one) opens. Call `claim()` when this card
 * opens and `release()` when it closes. Children (rendered inside this card) see this one as a parent.
 */
export function useOneHoverCard(close: () => void) {
  const id = Symbol('hover-card')
  const parents = inject(PARENTS, new Set<symbol>())
  provide(PARENTS, new Set([...parents, id]))

  watch(active, (a) => {
    if (a && a.id !== id && !a.ancestors.has(id)) close()
  })
  const release = () => {
    if (active.value?.id === id) active.value = null
  }
  onScopeDispose(release)
  return {
    claim: () => (active.value = { id, ancestors: parents }),
    release,
  }
}
