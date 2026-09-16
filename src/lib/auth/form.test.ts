import { describe, expect, it } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  confirmPasswordHint,
  hasErrors,
  isValidEmail,
  normalizeDisplayName,
  normalizeEmail,
  validateCredentials,
  validateNewPassword,
  validateRegistration,
} from "@/lib/auth/form";

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Mateusz@Przyklad.PL ")).toBe("mateusz@przyklad.pl");
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses, including untrimmed ones", () => {
    expect(isValidEmail("mateusz@przyklad.pl")).toBe(true);
    expect(isValidEmail(" MATEUSZ@PRZYKLAD.PL ")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects the mistakes people actually make", () => {
    expect(isValidEmail("mateusz@")).toBe(false);
    expect(isValidEmail("mateusz przyklad.pl")).toBe(false);
    expect(isValidEmail("mateusz@przyklad")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("normalizeDisplayName", () => {
  it("trims, collapses whitespace and bounds the length", () => {
    expect(normalizeDisplayName("  Jan   Kowalski  ")).toBe("Jan Kowalski");
    expect(normalizeDisplayName("x".repeat(200))).toHaveLength(60);
    expect(normalizeDisplayName("   ")).toBe("");
  });
});

describe("validateCredentials", () => {
  it("passes a complete pair", () => {
    expect(
      hasErrors(validateCredentials({ email: "a@b.pl", password: "secret123" })),
    ).toBe(false);
  });

  it("names the field that is wrong", () => {
    expect(validateCredentials({ email: "", password: "x" }).email).toBeTruthy();
    expect(validateCredentials({ email: "nope", password: "x" }).email).toBeTruthy();
    expect(
      validateCredentials({ email: "a@b.pl", password: "" }).password,
    ).toBeTruthy();
  });

  it("does not impose a length rule on an existing password", () => {
    // An account created before today's policy must still be able to sign in.
    expect(
      validateCredentials({ email: "a@b.pl", password: "old" }).password,
    ).toBeUndefined();
  });
});

describe("validateRegistration", () => {
  const valid = {
    email: "a@b.pl",
    password: "secret123",
    confirmPassword: "secret123",
    acceptedTerms: true,
  };

  it("passes a complete form", () => {
    expect(hasErrors(validateRegistration(valid))).toBe(false);
  });

  it("enforces the minimum password length", () => {
    const errors = validateRegistration({
      ...valid,
      password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
      confirmPassword: "a".repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(errors.password).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it("catches a mismatched confirmation", () => {
    expect(
      validateRegistration({ ...valid, confirmPassword: "secret124" })
        .confirmPassword,
    ).toBe("Hasła są różne.");
  });

  it("requires the terms box", () => {
    expect(validateRegistration({ ...valid, acceptedTerms: false }).terms)
      .toBeTruthy();
  });
});

describe("confirmPasswordHint", () => {
  it("stays quiet while the confirmation is still being typed", () => {
    expect(confirmPasswordHint("secret123", "")).toBeNull();
    expect(confirmPasswordHint("secret123", "s")).toBeNull();
    expect(confirmPasswordHint("secret123", "secret12")).toBeNull();
  });

  it("speaks up once the confirmation is long enough to be wrong", () => {
    expect(confirmPasswordHint("secret123", "secret124")).toBe("Hasła są różne.");
    expect(confirmPasswordHint("secret123", "secret123")).toBeNull();
  });
});

describe("validateNewPassword", () => {
  it("applies the same rules as registration", () => {
    expect(hasErrors(validateNewPassword("secret123", "secret123"))).toBe(false);
    expect(validateNewPassword("short", "short").password).toBeTruthy();
    expect(validateNewPassword("secret123", "secret124").confirmPassword).toBe(
      "Hasła są różne.",
    );
  });
});
