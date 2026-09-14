import { redirect } from "next/navigation";

/**
 * The entry point is Today.
 *
 * It used to be `/learn` — a catalogue of texts, i.e. the app asking the learner
 * to be their own curriculum designer before they had done anything. Today
 * answers that question for them; the catalogue is still there, one tap away,
 * for when they want to choose for themselves.
 */
export default function Home() {
  redirect("/today");
}
