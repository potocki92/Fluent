/**
 * Error taxonomy for the learning engine.
 *
 * The critical flows (starting a test, answering, finalizing) can fail in ways
 * the UI must react to differently — a completed session should send the learner
 * to their result, an expired login should send them to sign in, a database
 * hiccup should offer a retry. `catch { setError(true) }` cannot express that.
 *
 * Two rules hold everywhere these codes are used:
 *
 *  1. The learner only ever sees {@link FLUENT_ERROR_MESSAGES} — short Polish
 *     copy. Postgres messages, SQLSTATEs and stack traces stay on the server.
 *  2. Server Actions RETURN these codes rather than throwing them. Next.js
 *     redacts thrown Server Action errors in production, so a thrown error
 *     would reach the browser as an opaque digest and the UI could not branch
 *     on it at all.
 */

/** What went wrong, in terms the UI can act on. */
export type FluentErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "session_completed"
  | "question_not_in_session"
  | "session_incomplete"
  | "invalid_input"
  | "stale_state"
  | "database_error"
  | "config_error";

/**
 * SQLSTATEs raised by the `FL***` exceptions in the session functions. Custom
 * SQLSTATEs survive PostgREST and arrive on `PostgrestError.code`, which is what
 * makes a precise mapping possible instead of string-matching messages.
 */
const SQLSTATE_TO_CODE: Record<string, FluentErrorCode> = {
  FL401: "unauthorized",
  FL403: "forbidden",
  FL404: "not_found",
  FL409: "session_completed",
  FL410: "question_not_in_session",
  FL412: "session_incomplete",
  FL422: "invalid_input",
  FL423: "stale_state",
  // Postgres' own "insufficient privilege" — reached if a client role tries a
  // write that RLS or a grant forbids.
  "42501": "forbidden",
};

/** Polish copy shown to the learner. Deliberately free of technical detail. */
export const FLUENT_ERROR_MESSAGES: Record<FluentErrorCode, string> = {
  unauthorized: "Zaloguj się, aby kontynuować naukę.",
  forbidden: "Nie masz dostępu do tego testu.",
  not_found: "Nie znaleźliśmy tego testu.",
  session_completed: "Ten test został już zakończony.",
  question_not_in_session: "To pytanie nie należy do tego testu.",
  session_incomplete: "Odpowiedz na wszystkie pytania, aby zakończyć test.",
  invalid_input: "Nieprawidłowa odpowiedź. Spróbuj ponownie.",
  stale_state: "Twój postęp się zmienił. Spróbuj ponownie.",
  database_error: "Coś poszło nie tak. Spróbuj ponownie za chwilę.",
  config_error: "Usługa jest chwilowo niedostępna. Spróbuj ponownie później.",
};

/** The failure half of every learning-engine Server Action result. */
export interface FluentFailure {
  ok: false;
  code: FluentErrorCode;
  /** Ready-to-render Polish message. */
  message: string;
}

/** A Server Action result: the payload, or a classified failure. */
export type ActionResult<T> = ({ ok: true } & T) | FluentFailure;

/** The shape supabase-js returns on `{ data, error }`. */
interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** Classify a Supabase/Postgres error into a {@link FluentErrorCode}. */
export function classifyError(error: PostgrestLikeError | null): FluentErrorCode {
  if (!error?.code) return "database_error";
  return SQLSTATE_TO_CODE[error.code] ?? "database_error";
}

/**
 * Build the failure result for a Server Action, logging the technical detail
 * server-side so a production incident is still diagnosable from the logs while
 * the learner sees nothing but the Polish sentence.
 */
export function fail(
  code: FluentErrorCode,
  context: string,
  detail?: unknown,
): FluentFailure {
  console.error(`[fluent:${code}] ${context}`, detail ?? "");
  return { ok: false, code, message: FLUENT_ERROR_MESSAGES[code] };
}

/** Classify and report a Supabase error in one step. */
export function failFrom(
  error: PostgrestLikeError | null,
  context: string,
): FluentFailure {
  return fail(classifyError(error), context, error);
}
