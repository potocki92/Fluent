import { cn } from "@/lib/utils";

/**
 * The surface an auth form is drawn on.
 *
 * Deliberately not `Card` from `ui/`: those are the dashboard's cards, sized and
 * shadowed for a list of them on one screen. This is the only object on its
 * screen and carries the extra depth described in `globals.css`.
 */
export function AuthCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "auth-surface auth-enter w-full rounded-2xl p-5 sm:p-6",
        className,
      )}
    >
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-main">{title}</h2>
        {description ? (
          <p className="text-pretty text-sm text-muted2">{description}</p>
        ) : null}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}
