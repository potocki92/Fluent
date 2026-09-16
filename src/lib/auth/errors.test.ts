import { describe, expect, it } from "vitest";

import { describeAuthError, isAuthErrorCode } from "@/lib/auth/errors";

describe("describeAuthError", () => {
  it("returns null for success", () => {
    expect(describeAuthError(null)).toBeNull();
    expect(describeAuthError(undefined)).toBeNull();
  });

  it("maps the stable Supabase codes to Polish copy", () => {
    expect(describeAuthError({ code: "invalid_credentials" })).toEqual({
      code: "invalid_credentials",
      message: "Nieprawidłowy e-mail lub hasło.",
      retryable: false,
    });
    expect(describeAuthError({ code: "email_not_confirmed" })?.code).toBe(
      "email_not_confirmed",
    );
    expect(describeAuthError({ code: "user_already_exists" })?.code).toBe(
      "email_taken",
    );
    expect(describeAuthError({ code: "weak_password" })?.code).toBe("weak_password");
    expect(describeAuthError({ code: "same_password" })?.code).toBe("same_password");
    expect(describeAuthError({ code: "signup_disabled" })?.code).toBe(
      "signup_disabled",
    );
  });

  it("collapses every dead-link code onto one outcome", () => {
    for (const code of [
      "otp_expired",
      "flow_state_expired",
      "flow_state_not_found",
      "bad_code_verifier",
    ]) {
      expect(describeAuthError({ code })?.code).toBe("link_expired");
    }
  });

  it("recognises a dead session", () => {
    expect(describeAuthError({ code: "refresh_token_not_found" })?.code).toBe(
      "session_expired",
    );
    expect(describeAuthError({ code: "session_not_found" })?.code).toBe(
      "session_expired",
    );
  });

  it("separates rate limiting, provider outages and the network", () => {
    expect(describeAuthError({ code: "over_email_send_rate_limit" })?.code).toBe(
      "rate_limited",
    );
    expect(describeAuthError({ status: 429 })?.code).toBe("rate_limited");
    expect(describeAuthError({ status: 503 })?.code).toBe("provider_error");
    expect(describeAuthError({ name: "AuthRetryableFetchError" })?.code).toBe(
      "network",
    );
    expect(describeAuthError({ status: 0 })?.code).toBe("network");
  });

  it("marks only transient failures as retryable", () => {
    expect(describeAuthError({ status: 429 })?.retryable).toBe(true);
    expect(describeAuthError({ name: "AuthRetryableFetchError" })?.retryable).toBe(
      true,
    );
    expect(describeAuthError({ code: "invalid_credentials" })?.retryable).toBe(
      false,
    );
  });

  it("still copes with the older code-less errors", () => {
    expect(
      describeAuthError({ message: "Invalid login credentials", status: 400 })?.code,
    ).toBe("invalid_credentials");
    expect(describeAuthError({ message: "Email not confirmed" })?.code).toBe(
      "email_not_confirmed",
    );
  });

  it("never leaks a provider message through the fallback", () => {
    const failure = describeAuthError({
      message: "AuthApiError: something internal at line 42",
      status: 400,
    });
    expect(failure?.code).toBe("unknown");
    expect(failure?.message).toBe("Coś poszło nie tak. Spróbuj ponownie za chwilę.");
  });
});

describe("isAuthErrorCode", () => {
  it("accepts our own codes only", () => {
    expect(isAuthErrorCode("link_expired")).toBe(true);
    expect(isAuthErrorCode("invalid_credentials")).toBe(true);
    expect(isAuthErrorCode("<script>alert(1)</script>")).toBe(false);
    expect(isAuthErrorCode("toString")).toBe(false);
    expect(isAuthErrorCode(undefined)).toBe(false);
  });
});
