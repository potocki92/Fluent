/**
 * Client-side validation for the auth forms.
 *
 * This is UX, not security (§58). It exists so a learner finds out about a typo
 * without a round trip; the provider re-validates everything, and the provider's
 * answer wins. Nothing here may ever be the reason something is allowed.
 */

/**
 * The floor Supabase enforces by default. If a project raises its password
 * policy, the provider rejects the weak password and `describeAuthError` turns
 * that into Polish — this constant is the hint, not the rule (§29).
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Deliberately permissive. The only email address that matters is the one the
 * confirmation link reaches, so the job here is to catch "mateusz@" and
 * "mateusz gmail.com", not to re-litigate RFC 5322.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Trim and lower-case an address.
 *
 * Mail domains are case-insensitive and a trailing space from an autofill or a
 * paste is the single most common way a correct address fails to log in. The
 * PASSWORD is never touched this way — whitespace in a password is part of the
 * password (§59).
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

/** A display name, bounded and trimmed before it is stored as user metadata. */
export const MAX_NAME_LENGTH = 60;

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

/** Field-level messages, keyed by the field id the form renders. */
export type FieldErrors = Record<string, string>;

export interface CredentialsInput {
  email: string;
  password: string;
}

/** What the login form checks before it is willing to spend a request. */
export function validateCredentials({ email, password }: CredentialsInput): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = "Podaj adres e-mail.";
  else if (!isValidEmail(email)) errors.email = "To nie wygląda na adres e-mail.";
  if (!password) errors.password = "Podaj hasło.";
  return errors;
}

export interface RegistrationInput extends CredentialsInput {
  confirmPassword: string;
  acceptedTerms: boolean;
}

/** What the registration form checks. Same rules, plus the two extra fields. */
export function validateRegistration({
  email,
  password,
  confirmPassword,
  acceptedTerms,
}: RegistrationInput): FieldErrors {
  const errors: FieldErrors = {};

  if (!email.trim()) errors.email = "Podaj adres e-mail.";
  else if (!isValidEmail(email)) errors.email = "To nie wygląda na adres e-mail.";

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`;
  }

  // Only complain once the learner has typed enough for "różne" to be a real
  // claim rather than a certainty about an unfinished field (§30).
  if (confirmPassword && confirmPassword !== password) {
    errors.confirmPassword = "Hasła są różne.";
  } else if (!confirmPassword) {
    errors.confirmPassword = "Powtórz hasło.";
  }

  if (!acceptedTerms) {
    errors.terms = "Zaakceptuj warunki, aby założyć konto.";
  }

  return errors;
}

/** The live hint under "powtórz hasło", before anything has been submitted. */
export function confirmPasswordHint(
  password: string,
  confirmPassword: string,
): string | null {
  if (!confirmPassword || confirmPassword.length < password.length) return null;
  return confirmPassword === password ? null : "Hasła są różne.";
}

/** What the recovery screen checks. */
export function validateNewPassword(
  password: string,
  confirmPassword: string,
): FieldErrors {
  const errors: FieldErrors = {};

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.`;
  }
  if (confirmPassword !== password) {
    errors.confirmPassword = "Hasła są różne.";
  }

  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
