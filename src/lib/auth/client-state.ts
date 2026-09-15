import type { QueryClient } from "@tanstack/react-query";

import { useAbility } from "@/hooks/useAbility";

/**
 * EVERYTHING THE BROWSER REMEMBERS ABOUT A LEARNER, AND HOW IT IS FORGOTTEN.
 *
 * The logout bug had three ingredients, and this file addresses two of them.
 * The QueryClient was created once per browser session with a five-minute
 * `staleTime`, and every user-scoped query key was identity-free:
 *
 *   ["profile"]                     the learner's profile row
 *   ["isAdmin"]                     their role
 *   ["saved_words"] / [..., "due"]  their deck
 *   ["completedTexts"]              which passages they have passed
 *   ["learning-preferences"]        their day length and timezone
 *   ["word-goal"]                   their daily goal and streak
 *   ["notebook", "entries", ...]    their notes
 *   ["notebook", "books"]           the books they have notes in
 *   ["notebook", "sentence", id]    one sentence's notes
 *   ["notebook", "chapter", id]     one chapter's notes
 *   ["calibration-questions"]       their placement test items
 *   ["adminWords" | "adminTexts" | "adminQuestions" | "adminSuggestions", ...]
 *
 * None of those keys mentions WHO they belong to, so after a sign-out — or a
 * switch from A to B — every mounted component kept rendering the previous
 * learner's rows, and within `staleTime` no refetch was even attempted.
 *
 * THE STRATEGY (§14, option B, chosen for correctness over refetch economy).
 * Rather than thread a user id through a dozen query keys and every
 * `invalidateQueries` call that references them — a change where one missed
 * call site is a leak — an identity change ABANDONS THE WHOLE QUERY CLIENT.
 * A fresh, empty client takes its place, and the old one is cancelled and
 * cleared. That is a stronger guarantee than key scoping: a request that was
 * already in flight for user A can only ever resolve into the abandoned client,
 * which nothing is subscribed to any more, so it cannot appear on B's screen
 * even as a flash (§87, §88).
 *
 * The cost is that public, shared data — the dictionary, the shelf — is refetched
 * too. That is the trade §95 asks for, and it is a handful of requests once per
 * sign-in.
 */

/**
 * Abandon a QueryClient that belonged to a previous identity.
 *
 * Call this with the OLD client, then render a new one. Cancelling first stops
 * retries and in-flight fetches; clearing drops the cached rows so nothing can
 * be read back out of it before it is garbage collected.
 */
export function abandonQueryClient(previous: QueryClient): void {
  void previous.cancelQueries();
  previous.clear();
}

/**
 * Reset the client-only stores that hold user-specific state.
 *
 * Only `useAbility` qualifies today: it holds the learner's ability, rating
 * deviation, answer count and CEFR estimate, and the header's level ring reads
 * it — so a stale store is a previous learner's level rendered next to the new
 * one's name.
 *
 * DELIBERATELY NOT `localStorage.clear()` (§16). Nothing in this app persists
 * user-private state to browser storage (reader typography lives on the profile
 * row, precisely so it follows the learner between devices), and clearing the
 * whole origin would destroy unrelated, harmless preferences. When a store does
 * gain persistence, it is reset HERE, by name.
 */
export function resetUserScopedStores(): void {
  useAbility.getState().reset();
}
