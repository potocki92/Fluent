import { CalibrationRunner } from "@/components/level/CalibrationRunner";

export const metadata = { title: "Test poziomujący · Fluent" };

export default function CalibrationPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Test poziomujący</h1>
        <p className="text-sm text-muted2">
          Odpowiedz na kilka pytań — dobierzemy trudność do Twoich odpowiedzi i
          ustawimy Twój poziom niemieckiego.
        </p>
      </div>

      <CalibrationRunner />
    </div>
  );
}
