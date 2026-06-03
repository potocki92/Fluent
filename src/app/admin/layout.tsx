import { isCurrentUserAdmin } from "@/lib/admin";

/**
 * Gate the whole admin subtree once. Non-admins (including signed-out users)
 * get a Polish "Brak dostępu" message instead of the panel. Real enforcement is
 * the database RLS — this is the user-facing guard. Child pages stay focused on
 * content.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isCurrentUserAdmin())) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg font-semibold text-main">Brak dostępu</p>
        <p className="mt-2 text-sm text-muted2">
          Ta sekcja jest dostępna tylko dla administratorów.
        </p>
      </div>
    );
  }

  return <div className="space-y-6">{children}</div>;
}
