/**
 * Wise's error bodies, turned into Slipway errors so the exit code follows the
 * HTTP status and the model reads Wise's own words.
 *
 * Wise answers in more than one shape: `{ errors: [{ code, message, path }] }`
 * on validation, `{ error, error_description }` on auth, and `{ message }`
 * elsewhere. All three are read.
 */

import { httpError, type SlipwayError } from "@thenavidm/slipway";

type WiseErrorBody = {
  errors?: Array<{ code?: string; message?: string; path?: string }>;
  error?: string;
  error_description?: string;
  message?: string;
};

/** Hints for the failures people actually hit, keyed by words Wise uses. */
const HINTS: Array<[RegExp, string]> = [
  [
    /missing approval/i,
    "This business account has a Payment Approvals rule, and Wise does not accept transfers created over the API while one is on. Remove the rule in Wise's settings, or create the payment in the Wise app.",
  ],
  [/invalid_token|unauthori[sz]ed|expired/i, "Check the token: create a new one at wise.com/settings/api-tokens and run `wise-cli doctor --network`."],
  [/strong customer authentication|\bSCA\b/i, "Wise wants this done in the Wise app or website, where it can ask for your second factor."],
];

export function messageFrom(status: number, raw: string): { message: string; codes: string[] } {
  let body: WiseErrorBody | undefined;
  try {
    body = JSON.parse(raw) as WiseErrorBody;
  } catch {
    body = undefined;
  }
  const parts: string[] = [];
  const codes: string[] = [];
  for (const e of body?.errors ?? []) {
    if (e.code) codes.push(e.code);
    parts.push([e.path ? `${e.path}:` : "", e.message ?? e.code ?? ""].filter(Boolean).join(" "));
  }
  if (body?.error_description) parts.push(body.error_description);
  else if (body?.error) parts.push(body.error);
  if (body?.message) parts.push(body.message);
  const text = parts.filter(Boolean).join("; ") || raw.slice(0, 300) || "no details";
  return { message: `Wise answered ${status}: ${text}`, codes };
}

export function wiseError(status: number, raw: string): SlipwayError {
  const { message, codes } = messageFrom(status, raw);
  const hint = HINTS.find(([pattern]) => pattern.test(message))?.[1];
  return httpError(status, message, {
    status,
    ...(hint ? { hint } : {}),
    ...(codes.length ? { details: { codes } } : {}),
  });
}
