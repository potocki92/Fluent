import Link from "next/link";
import { AlertTriangle, BookOpen, Check, FileText, Loader2 } from "lucide-react";

import type { BookImportSummary } from "@/lib/import/queries";
import { STATUS_LABELS } from "@/lib/import/state";
import { cn } from "@/lib/utils";

/**
 * The imports a learner has, and where each of them got to.
 *
 * WHY IT IS A LIST AND NOT A NOTIFICATION. An import can outlive the tab that
 * started it — a big book is still being processed when the learner closes the
 * page, and an import that failed at midnight is something they find in the
 * morning. Without somewhere to find them, "it disappeared" is the only
 * available conclusion.
 *
 * Every row links to the import's own screen, which knows how to continue
 * whatever it was doing.
 */
export function ImportHistory({ imports }: { imports: readonly BookImportSummary[] }) {
  if (imports.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted2">
        Twoje importy
      </h2>
      <ul className="space-y-2">
        {imports.map((record) => (
          <li key={record.id}>
            <ImportRow record={record} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ImportRow({ record }: { record: BookImportSummary }) {
  const title = record.title ?? record.detectedTitle ?? record.fileName;
  const working =
    record.status === "extracting" ||
    record.status === "analyzing" ||
    record.status === "importing" ||
    record.status === "processing";

  // A ready import links to the BOOK, not back to the importer: the importer is
  // finished with it, and the thing the learner wants is the reading.
  const href =
    record.status === "ready" && record.finalSlug
      ? `/library/${record.finalSlug}`
      : `/library/import/${record.id}`;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-gold/50"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          record.status === "ready" && "bg-green/15 text-green",
          record.status === "failed" && "bg-red/15 text-red",
          working && "bg-gold/15 text-gold",
          !working && record.status !== "ready" && record.status !== "failed"
            ? "bg-[#374151] text-muted2"
            : "",
        )}
      >
        {record.status === "ready" ? (
          <Check className="size-4" />
        ) : record.status === "failed" ? (
          <AlertTriangle className="size-4" />
        ) : working ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileText className="size-4" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-main">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted2">
          {record.fileType.toUpperCase()} · {STATUS_LABELS[record.status]}
          {record.status === "processing" &&
            ` · ${record.processedChapters}/${record.totalChapters}`}
          {record.status === "awaiting_review" &&
            record.chapterCount > 0 &&
            ` · ${record.chapterCount} rozdziałów`}
        </p>
      </div>

      {record.status === "ready" && (
        <BookOpen className="size-4 shrink-0 text-muted2" />
      )}
    </Link>
  );
}
