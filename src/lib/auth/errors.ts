/**
 * Supabase Auth failures, in Polish, in one place.
 *
 * Two rules, both learned the hard way:
 *
 *  1. The learner never reads `AuthApiError: Invalid login credentials`. Every
 *     message below is product copy.
 *  2. The mapping keys on the STABLE `code` that supabase-js returns on
 *     `AuthError.code`, not on `message.includes(...)` scattered through the
 *     forms. English message text is not an API — it changes between releases
 *     and differs per endpoint — so string matching survives only as the last
 *     fallback, for the handful of older errors that still ship without a code.
 */

/** What went wrong, in terms a form can act on. */
export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "email_taken"
  | "weak_password"
  | "same_password"
  | "rate_limited"
  | "link_expired"
  | "session_expired"
  | "signup_disabled"
  | "validation_failed"
  | "network"
  | "provider_error"
  | "unknown";

export interface AuthFailure {
  code: AuthErrorCode;
  /** Ready-to-render Polish copy. */
  message: string;
  /** Whether trying the exact same thing again could plausibly work. */
  retryable: boolean;
}

/** The copy. Short, specific, and free of technical detail. */
const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: "Nieprawidłowy e-mail lub hasło.",
  email_not_confirmed:
    "Potwierdź adres e-mail — wysłaliśmy link na Twoją skrzynkę.",
  email_taken: "Konto z tym adresem e-mail już istnieje.",
  weak_password: "To hasło jest zbyt słabe. Użyj co najmniej 8 znaków.",
  same_password: "Nowe hasło musi być inne niż dotychczasowe.",
  rate_limited: "Zbyt wiele prób. Spróbuj ponownie za chwilę.",
  link_expired: "Ten link wygasł lub został już użyty.",
  session_expired: "Twoja sesja wygasła. Zaloguj się ponownie.",
  signup_disabled: "Rejestracja jest chwilowo niedostępna.",
  validation_failed: "Sprawdź wprowadzone dane i spróbuj ponownie.",
  network: "Nie udało się połączyć. Sprawdź internet i spróbuj ponownie.",
  provider_error: "Usługa logowania jest chwilowo niedostępna.",
  unknown: "Coś poszło nie tak. Spróbuj ponownie za chwilę.",
};

/** Retrying the identical request is only sensible for transient failures. */
const RETRYABLE: ReadonlySet<AuthErrorCode> = new Set<AuthErrorCode>([
  "network",
  "provider_error",
  "rate_limited",
]);

/**
 * Supabase error codes → our taxonomy.
 *
 * Kept as data rather than a switch so the list reads as the contract it is.
 * Anything absent falls through to the status/message heuristics below and,
 * failing those, to `unknown` — which is a safe, non-leaking default.
 */
const CODE_MAP: Record<string, AuthErrorCode> = {
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  user_already_exists: "email_taken",
  email_exists: "email_taken",
  user_banned: "invalid_credentials",
  weak_password: "weak_password",
  same_password: "same_password",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  over_sms_send_rate_limit: "rate_limited",
  email_address_invalid: "validation_failed",
  validation_failed: "validation_failed",
  signup_disabled: "signup_disabled",
  email_provider_disabled: "signup_disabled",
  provider_disabled: "signup_disabled",
  // Every way a one-time link can fail to become a session. They are one thing
  // to the learner — "ten link już nie działa" — and one screen handles them.
  otp_expired: "link_expired",
  otp_disabled: "link_expired",
  flow_state_expired: "link_expired",
  flow_state_not_found: "link_expired",
  bad_code_verifier: "link_expired",
  // The session itself is gone: the app must fall back to a clean logged-out
  // state rather than keep retrying with a dead token.
  session_expired: "session_expired",
  session_not_found: "session_expired",
  refresh_token_not_found: "session_expired",
  refresh_token_already_used: "session_expired",
};

/** The subset of an `AuthError` this module reads. */
export interface AuthErrorLike {
  name?: string;
  code?: string | null;
  status?: number | null;
  message?: string | null;
}

/**
 * Classify a Supabase auth error into something the UI can render and branch on.
 * `null` in means success — callers pass the error through unconditionally.
 */
export function describeAuthError(
  error: AuthErrorLike | null | undefined,
): AuthFailure | null {
  if (!error) return null;
  return failure(classify(error));
}

/** Build the failure for a code we determined ourselves (e.g. client validation). */
export function authFailure(code: AuthErrorCode): AuthFailure {
  return failure(code);
}

/** The Polish copy for a code, for callers that only need the sentence. */
export function authErrorMessage(code: AuthErrorCode): string {
  return MESSAGES[code];
}

/**
 * Whether a string is one of our codes.
 *
 * The callback route reports a failure by putting a code in the URL, and the
 * auth screen renders the matching sentence. Validating it here is what keeps
 * that from being a way to put arbitrary text on the sign-in page.
 */
export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  // `in` would also answer yes to `toString` and everything else on the object
  // prototype, and `authErrorMessage` would then hand a function to the UI.
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MESSAGES, value)
  );
}

function failure(code: AuthErrorCode): AuthFailure {
  return { code, message: MESSAGES[code], retryable: RETRYABLE.has(code) };
}

function classify(error: AuthErrorLike): AuthErrorCode {
  // supabase-js raises this specific class when the request never reached the
  // Auth server at all — offline, DNS failure, a captive portal. It is the one
  // case where "spróbuj ponownie" is genuinely the right advice.
  if (error.name === "AuthRetryableFetchError") return "network";

  const code = error.code?.trim();
  if (code && CODE_MAP[code]) return CODE_MAP[code];

  if (error.status === 429) return "rate_limited";
  if (typeof error.status === "number" && error.status >= 500) {
    return "provider_error";
  }
  // A status of 0 means the fetch itself failed.
  if (error.status === 0) return "network";

  return fromMessage(error.message);
}

/**
 * Last resort for errors that predate `AuthError.code`. Deliberately small: it
 * exists so an old Supabase deployment still gets decent copy, not as a place
 * to keep adding patterns.
 */
function fromMessage(message: string | null | undefined): AuthErrorCode {
  if (!message) return "unknown";
  const m = message.toLowerCase();

  if (m.includes("invalid login credentials")) return "invalid_credentials";
  if (m.includes("email not confirmed")) return "email_not_confirmed";
  if (m.includes("already registered")) return "email_taken";
  if (m.includes("password should be at least")) return "weak_password";
  if (m.includes("rate limit") || m.includes("too many")) return "rate_limited";
  if (m.includes("failed to fetch") || m.includes("network")) return "network";

  return "unknown";
}
