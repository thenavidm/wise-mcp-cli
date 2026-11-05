/**
 * Where the token comes from, which Wise it talks to, and which profile acts.
 *
 * The token is read from WISE_API_TOKEN, or on macOS from the login Keychain,
 * so a person can keep it out of every config file and every chat:
 *
 *   security add-generic-password -a "$USER" -s wise-api-token -w
 *
 * Nothing here touches the network. Profiles are resolved by the client on the
 * first call that needs one.
 */

import { execFileSync } from "node:child_process";

export type WiseEnv = "live" | "sandbox";

export type Config = {
  token?: string;
  /** Where the token was found, for doctor. Never the token itself. */
  tokenSource: "WISE_API_TOKEN" | "keychain" | "none";
  keychainService: string;
  env: WiseEnv;
  baseUrl: string;
  /** Wise's calendar version, the first segment of every current path. */
  apiVersion: string;
  profileId?: number;
  timeoutMs: number;
};

export const BASE_URLS: Record<WiseEnv, string> = {
  live: "https://api.wise.com",
  sandbox: "https://api.wise-sandbox.com",
};

export const DEFAULT_API_VERSION = "2026Q4";
export const DEFAULT_KEYCHAIN_SERVICE = "wise-api-token";

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : fallback;
}

/** The token from the macOS login Keychain, or undefined when there is none. */
function fromKeychain(service: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const out = execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const keychainService = env.WISE_KEYCHAIN_SERVICE?.trim() || DEFAULT_KEYCHAIN_SERVICE;
  const fromEnv = env.WISE_API_TOKEN?.trim();
  const keychain = fromEnv ? undefined : fromKeychain(keychainService);
  const token = fromEnv || keychain;

  const wiseEnv: WiseEnv = env.WISE_ENV?.trim().toLowerCase() === "sandbox" ? "sandbox" : "live";
  const profile = env.WISE_PROFILE_ID?.trim();

  return {
    token,
    tokenSource: fromEnv ? "WISE_API_TOKEN" : keychain ? "keychain" : "none",
    keychainService,
    env: wiseEnv,
    baseUrl: BASE_URLS[wiseEnv],
    apiVersion: env.WISE_API_VERSION?.trim() || DEFAULT_API_VERSION,
    profileId: profile && /^\d+$/.test(profile) ? Number(profile) : undefined,
    timeoutMs: positiveInt(env.WISE_REQUEST_TIMEOUT_MS, 30_000),
  };
}
