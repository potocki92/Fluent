/** Matches the shelf's shape so the page does not jump when it arrives. */
export default function LibraryLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-40 animate-pulse rounded bg-[#2d3748]" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-[#2d3748]" />
        ))}
      </div>
    </div>
  );
}
