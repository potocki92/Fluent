"use client";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  FONT_FAMILY_LABEL_PL,
  FONT_SIZE_LABEL_PL,
  LINE_HEIGHT_LABEL_PL,
  THEME_LABEL_PL,
  type ReaderFontFamily,
  type ReaderFontSize,
  type ReaderLineHeight,
  type ReaderPreferences,
  type ReaderTheme,
} from "@/lib/reading/preferences";
import { cn } from "@/lib/utils";

/**
 * Reader settings.
 *
 * Four choices, no more: size, leading, theme, and serif vs sans. Everything a
 * long-form reader actually changes, and nothing that needs explaining. Each one
 * applies instantly — the values are CSS custom properties on the reading
 * surface, so nothing re-renders — and is persisted to the profile in the
 * background, which is why the same book looks the same on a phone and a laptop.
 */
export function ReaderSettingsSheet({
  open,
  preferences,
  onChange,
  onClose,
}: {
  open: boolean;
  preferences: ReaderPreferences;
  onChange: (patch: Partial<ReaderPreferences>) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        className="gap-0 rounded-t-2xl border-t border-[#374151] bg-[#2d3748] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 text-main"
      >
        <div
          aria-hidden
          className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-[#4b5563]"
        />
        <SheetTitle className="mb-4 text-base font-semibold">
          Ustawienia czytania
        </SheetTitle>

        <div className="space-y-5">
          <Group<ReaderFontSize>
            label="Wielkość tekstu"
            value={preferences.fontSize}
            options={FONT_SIZE_LABEL_PL}
            onSelect={(fontSize) => onChange({ fontSize })}
          />
          <Group<ReaderLineHeight>
            label="Interlinia"
            value={preferences.lineHeight}
            options={LINE_HEIGHT_LABEL_PL}
            onSelect={(lineHeight) => onChange({ lineHeight })}
          />
          <Group<ReaderTheme>
            label="Tło"
            value={preferences.theme}
            options={THEME_LABEL_PL}
            onSelect={(theme) => onChange({ theme })}
          />
          <Group<ReaderFontFamily>
            label="Krój pisma"
            value={preferences.fontFamily}
            options={FONT_FAMILY_LABEL_PL}
            onSelect={(fontFamily) => onChange({ fontFamily })}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Group<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: Readonly<Record<T, string>>;
  onSelect: (value: T) => void;
}) {
  const entries = Object.entries(options) as [T, string][];

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted2">
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">
        {entries.map(([key, optionLabel]) => (
          <button
            key={key}
            type="button"
            aria-pressed={key === value}
            onClick={() => onSelect(key)}
            className={cn(
              // 44px minimum target: this sheet is used on a phone first.
              "min-h-11 flex-1 rounded-lg px-3 py-2 text-sm transition-colors",
              key === value
                ? "bg-gold font-semibold text-[#1a202c]"
                : "bg-[#374151] text-muted2 hover:text-main",
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
