export default function BrowseLoading() {
  return (
    <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
      <div className="mx-auto max-w-screen-md space-y-5 px-4">
        <header className="space-y-2">
          <div className="h-7 w-40 animate-pulse rounded bg-[#374151]" />
          <div className="h-4 w-72 animate-pulse rounded bg-[#374151]" />
        </header>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-xl bg-[#374151]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
