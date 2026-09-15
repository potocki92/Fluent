import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { describeAuthError, type AuthErrorCode } from "@/lib/auth/errors";
import {
  AUTH_ROUTE,
  resolveSignedInDestination,
  sanitizeAuthRedirect,
} from "@/lib/auth/redirects";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The single landing point for every emailed link Fluent sends.
 *
 * WHAT ARRIVES HERE. Supabase produces two shapes depending on how a project's
 * email templates are written, and a real deployment can have both:
 *
 *   ?code=…                       the PKCE code (the default for links created
 *                                 by the browser SDK — sign-up confirmation,
 *                                 magic link, password recovery)
 *   ?token_hash=…&type=…          a customised template using the verify-OTP
 *                                 form documented for server-rendered apps
 *   ?error=…&error_code=…         the link was expired, already used, or the
 *                                 learner denied it
 *
 * All three are handled, because which one a project emits is a dashboard
 * setting this code cannot see and must not guess (§128).
 *
 * WHAT LEAVES HERE. On success: the sanitised `next`, with real auth cookies
 * written by the exchange. On failure: an auth screen with a CODE, never a raw
 * provider message and never the old `/learn?error=auth` — which told the
 * learner nothing and dropped them on a page that had no idea why they arrived
 * (§22, §74).
 *
 * `next` is re-sanitised here even though it was sanitised when the link was
 * built: this URL comes back from the outside world, and everything that comes
 * back from the outside world is untrusted.
 *
 * PASSWORD RECOVERY DOES NOT TRAVEL AS `next`. Its destination is inside
 * `/auth`, which the redirect sanitiser refuses by design — sending a learner
 * back to the auth screen after authenticating is normally a loop. So recovery
 * announces itself with `flow=recovery` and the destination is decided here,
 * from a constant, rather than carried on the URL where it would have to be
 * trusted.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = resolveOrigin(request);

  const next = sanitizeAuthRedirect(searchParams.get("next"));
  const isRecovery = searchParams.get("flow") === "recovery";

  // The provider already decided this link is no good.
  const providerError = searchParams.get("error_code") ?? searchParams.get("error");
  if (providerError) {
    return failure(origin, classifyLinkError(providerError), isRecovery);
  }

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (!code && !tokenHash) {
    // Somebody opened `/auth/callback` directly. Nothing to exchange.
    return failure(origin, "link_expired", isRecovery);
  }

  const supabase = await createServerSupabaseClient();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: otpType(type),
      });

  if (error) {
    return failure(origin, classifyLinkError(error.code ?? ""), isRecovery);
  }

  const destination = isRecovery
    ? RESET_PASSWORD_ROUTE
    : resolveSignedInDestination(next);

  return NextResponse.redirect(new URL(destination, origin));
}

/** The second half of password recovery. A constant, never a URL parameter. */
const RESET_PASSWORD_ROUTE = "/auth/reset-password";

/**
 * A failed link goes somewhere that can do something about it.
 *
 * Recovery failures land on "nie pamiętasz hasła?", because the only useful next
 * step for an expired reset link is asking for a fresh one (§74). Everything
 * else lands on the sign-in form with the reason rendered above it.
 */
function failure(origin: string, code: AuthErrorCode, isRecovery: boolean) {
  const path = isRecovery ? "/auth/forgot-password" : AUTH_ROUTE;
  const url = new URL(path, origin);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

/**
 * Supabase reports link failures as `error_code`/`error` on the URL. Anything
 * the taxonomy does not recognise (`access_denied`, a future code) is, from the
 * learner's side, the same event: this link no longer works.
 */
function classifyLinkError(raw: string): AuthErrorCode {
  const code = describeAuthError({ code: raw })?.code ?? "link_expired";
  // An unclassifiable failure ON A ONE-TIME LINK is, for the learner, the same
  // event as an expired one — and "link wygasł" comes with a way forward, which
  // "coś poszło nie tak" does not.
  return code === "unknown" ? "link_expired" : code;
}

/**
 * The OTP types Fluent's own emails can produce. An unrecognised value is
 * treated as a plain email confirmation rather than passed through — `type` is
 * attacker-controlled like everything else on this URL.
 */
const OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function otpType(raw: string | null): EmailOtpType {
  return OTP_TYPES.find((candidate) => candidate === raw) ?? "email";
}

/**
 * The origin to redirect to.
 *
 * Behind a load balancer `request.nextUrl.origin` is the internal address, so
 * the forwarded host wins when one is present — otherwise a production callback
 * would try to send the learner to a hostname only the platform can reach.
 */
function resolveOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost) return request.nextUrl.origin;

  const protocol = request.headers.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${forwardedHost}`;
}
