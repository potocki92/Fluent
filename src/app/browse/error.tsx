"use client";

export default function BrowseError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <p className="text-lg font-semibold text-[#e2e8f0]">
        Nie udało się załadować słownika
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-[#d4a574] px-4 py-2 text-sm font-semibold text-[#1a202c] transition-colors hover:bg-[#c39463]"
      >
        Spróbuj ponownie
      </button>
    </div>
  );
}
