import { AuthForm } from "@/components/auth/AuthForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Logowanie · Fluent" };

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const defaultMode = mode === "register" ? "register" : "login";

  return (
    <div className="flex justify-center py-6">
      <Card className="w-full max-w-md bg-[#2d3748]">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Witaj w Fluent</CardTitle>
          <CardDescription>
            Załóż konto lub zaloguj się, aby zapisywać słowa, powtórki i postępy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForm defaultMode={defaultMode} />
        </CardContent>
      </Card>
    </div>
  );
}
