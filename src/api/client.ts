/**
 * The one way this server reaches Wise.
 *
 * Current endpoints sit under Wise's calendar version (`/2026Q4/...`). Listing
 * transfers has no current-version page yet, so that one call keeps its legacy
 * `/v1` path, which Wise's versioning policy says stays supported.
 *
 * There is deliberately no method for funding a transfer. A transfer this
 * server creates waits in Wise until a person pays it there.
 */

import { NotConfiguredError, UsageError } from "@thenavidm/slipway";
import type { Config } from "../config.js";
import { wiseError } from "./errors.js";

type Query = Record<string, string | number | boolean | undefined>;

export type Profile = { id: number; type: string; name: string };

const LOGIN_HINT = "Run `wise-cli login` for how to create and store a token.";

export class WiseClient {
  private profiles?: Profile[];

  constructor(
    readonly config: Config,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** A current-version path: `/profiles` becomes `/2026Q4/profiles`. */
  path(p: string): string {
    return `/${this.config.apiVersion}${p}`;
  }

  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options: { query?: Query; body?: unknown; contentType?: string; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (!this.config.token) {
      throw new NotConfiguredError("No Wise API token found.", { hint: LOGIN_HINT });
    }
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      Accept: "application/json",
      "User-Agent": "wise-mcp-cli (https://github.com/thenavidm/wise-mcp-cli)",
    };
    if (options.body !== undefined) headers["Content-Type"] = options.contentType ?? "application/json";

    const response = await this.fetcher(url, {
      method,
      headers,
      redirect: "error",
      signal,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    if (!response.ok) throw wiseError(response.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** A file Wise serves, such as a receipt PDF, as bytes. */
  async download(path: string, signal?: AbortSignal): Promise<{ bytes: Buffer; type: string }> {
    if (!this.config.token) throw new NotConfiguredError("No Wise API token found.", { hint: LOGIN_HINT });
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const response = await this.fetcher(new URL(path, this.config.baseUrl), {
      headers: { Authorization: `Bearer ${this.config.token}`, Accept: "application/pdf, */*" },
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw wiseError(response.status, await response.text());
    return { bytes: Buffer.from(await response.arrayBuffer()), type: response.headers.get("content-type") ?? "application/octet-stream" };
  }

  async listProfiles(signal?: AbortSignal): Promise<Profile[]> {
    if (!this.profiles) {
      const raw = await this.request<Array<Record<string, any>>>("GET", this.path("/profiles"), { signal });
      this.profiles = raw.map((p) => ({
        id: p.id,
        type: String(p.type ?? "").toUpperCase(),
        name: p.businessName ?? p.details?.name ?? ([p.firstName, p.lastName].filter(Boolean).join(" ") || p.fullName || String(p.id)),
      }));
    }
    return this.profiles;
  }

  /**
   * The profile a call acts for: the one named, else WISE_PROFILE_ID, else the
   * only business profile, else the only profile. Anything else is ambiguous,
   * and a payment from the wrong profile is not a guess worth making.
   */
  async profileId(hint?: number, signal?: AbortSignal): Promise<number> {
    if (hint) return hint;
    if (this.config.profileId) return this.config.profileId;
    const profiles = await this.listProfiles(signal);
    const business = profiles.filter((p) => p.type === "BUSINESS");
    if (business.length === 1) return business[0]!.id;
    if (profiles.length === 1) return profiles[0]!.id;
    const known = profiles.map((p) => `${p.id} (${p.type.toLowerCase()}, ${p.name})`).join(", ");
    throw new UsageError(`More than one Wise profile: ${known || "none"}. Pass --profile, or set WISE_PROFILE_ID.`);
  }
}
