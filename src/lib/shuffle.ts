/**
 * Fisher–Yates shuffle. Returns the shuffled items plus `order`, where
 * `order[displayedIdx]` is the item's original index — used to map a learner's
 * displayed choice back to the stored option order (grading compares against the
 * original `correct_idx`). The reverse mapping (original → displayed) is
 * `order.indexOf(originalIdx)`.
 */
export function shuffleWithOrder<T>(items: T[]): { items: T[]; order: number[] } {
  const order = items.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { items: order.map((o) => items[o]), order };
}
