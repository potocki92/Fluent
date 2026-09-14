/**
 * The skeleton stands in for the real layout, not for a spinner.
 *
 * Today needs a round trip to the database before it knows anything, and the
 * alternative to this is a second of "0 min", "brak planu" or `undefined` — text
 * that is not merely ugly but WRONG, and that a learner can easily act on before
 * it is replaced.
 */
export default function TodayLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Ładowanie planu">
      <header className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-4 w-36 animate-pulse rounded bg-secondary" />
      </header>

      <div className="space-y-1.5">
        <div className="h-4 w-32 animate-pulse rounded bg-secondary" />
        <div className="h-2 w-full animate-pulse rounded-full bg-secondary" />
      </div>

      <div className="h-10 w-full animate-pulse rounded-md bg-secondary" />

      <div className="space-y-2">
        <div className="h-4 w-28 animate-pulse rounded bg-secondary" />
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-xl bg-secondary" />
        ))}
      </div>
    </div>
  );
}
