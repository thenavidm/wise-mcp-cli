/**
 * What the tools send to Wise, against a stubbed network.
 *
 * The point of this server is the payment flow: a quote tied to the recipient,
 * then a transfer that waits unpaid. These tests pin the exact requests, that
 * one payment request can never become two transfers, and that nothing ever
 * calls a funding endpoint.
 */

import { describe, expect, it } from "vitest";
import { connect, resultData } from "@thenavidm/slipway/testing";
import { WiseClient } from "../src/api/client.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { transactionId } from "../src/tools/index.js";

type Call = { method: string; path: string; query: Record<string, string>; body?: any };

function stub(routes: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = [];
  const fetcher = (async (input: URL, init: RequestInit) => {
    const url = new URL(input);
    const call: Call = {
      method: init.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);
    const key = `${call.method} ${call.path}`;
    const route = Object.entries(routes).find(([pattern]) => new RegExp(`^${pattern}$`).test(key));
    if (!route) return new Response(JSON.stringify({ errors: [{ code: "not.found", message: `no stub for ${key}` }] }), { status: 404 });
    const out = route[1](call);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  }) as unknown as typeof fetch;
  const app = createApp({
    context: (env) => {
      const config = loadConfig({ ...env, WISE_API_TOKEN: "test-token" });
      return { config, client: new WiseClient(config, fetcher) };
    },
  });
  return { app, calls };
}

const PROFILES = [
  { id: 111, type: "PERSONAL", firstName: "Ann", lastName: "Example" },
  { id: 222, type: "BUSINESS", businessName: "Example Studio" },
];
const RECIPIENT = { id: 900, currency: "EUR", type: "iban", name: { fullName: "Jane Supplier" }, longAccountSummary: "IBAN ending 1234" };
const QUOTE = {
  id: "q-1",
  sourceCurrency: "EUR",
  targetCurrency: "EUR",
  targetAmount: 1200,
  rate: 1,
  payOut: "BANK_TRANSFER",
  targetAccount: 900,
  paymentOptions: [
    { payIn: "BANK_TRANSFER", payOut: "BANK_TRANSFER", sourceAmount: 1201.5, targetAmount: 1200, price: { total: { value: { amount: 1.5, currency: "EUR" } } } },
  ],
};

const approve = { elicit: () => ({ action: "accept" as const, content: { approve: true } }) };

describe("setting up a payment", () => {
  it("prices it against the recipient, then creates the transfer unpaid, and never funds it", async () => {
    const { app, calls } = stub({
      "GET /2026Q4/profiles": () => PROFILES,
      "GET /2026Q4/accounts/900": () => RECIPIENT,
      "POST /2026Q4/profiles/222/quotes": () => QUOTE,
      "POST /2026Q4/transfers": (c) => ({ id: 55, status: "incoming_payment_waiting", targetAccount: 900, ...c.body }),
    });
    const mcp = await connect(app, { env: {}, ...approve });
    const out = resultData(
      await mcp.callTool("create_transfer", { recipient_id: 900, source_currency: "eur", amount: 1200, reference: "INV-0042", payment_id: "INV-0042" }),
    ) as any;
    await mcp.close();

    const quote = calls.find((c) => c.path.endsWith("/quotes"))!;
    expect(quote.body).toEqual({ sourceCurrency: "EUR", targetCurrency: "EUR", targetAmount: 1200, targetAccount: 900 });
    const transfer = calls.find((c) => c.path === "/2026Q4/transfers")!;
    expect(transfer.body).toEqual({
      targetAccount: 900,
      quoteUuid: "q-1",
      customerTransactionId: transactionId("INV-0042"),
      details: { reference: "INV-0042" },
    });
    expect(calls.some((c) => /payments|fund/i.test(c.path))).toBe(false);
    expect(out.transfer.status).toBe("incoming_payment_waiting");
    expect(out.price.fee).toBe("1.5 EUR");
    expect(out.next_step).toMatch(/Not paid yet/);
  });

  it("sends the source amount when the amount is what leaves the account", async () => {
    const { app, calls } = stub({
      "GET /2026Q4/profiles": () => PROFILES,
      "POST /2026Q4/profiles/222/quotes": () => QUOTE,
    });
    const mcp = await connect(app, { env: {} });
    await mcp.callTool("create_quote", { source_currency: "SEK", target_currency: "EUR", amount: 500, amount_is: "source", pay_in: "BALANCE" });
    await mcp.close();
    expect(calls.at(-1)!.body).toEqual({ sourceCurrency: "SEK", targetCurrency: "EUR", sourceAmount: 500, preferredPayIn: "BALANCE" });
  });
});

describe("changing recipients", () => {
  const OLD = { id: 900, profile: 222, currency: "EUR", type: "iban", accountHolderName: "Jane Supplier", details: { legalType: "BUSINESS", iban: "DE89370400440532013000", address: { city: "Berlin" } } };

  it("saves the changes as a new recipient, merged into the current details, then deactivates the old one", async () => {
    const { app, calls } = stub({
      "GET /v1/accounts/900": () => OLD,
      "POST /2026Q4/accounts": (c) => ({ id: 901, currency: c.body.currency, type: c.body.type, accountHolderName: c.body.accountHolderName }),
      "DELETE /2026Q4/accounts/900": () => new Response(null, { status: 204 }),
    });
    const mcp = await connect(app, { env: {}, ...approve });
    const out = resultData(await mcp.callTool("update_recipient", { id: 900, details: { iban: "NL91ABNA0417164300" } })) as any;
    await mcp.close();
    const created = calls.find((c) => c.method === "POST")!;
    expect(created.body).toEqual({
      profile: 222,
      currency: "EUR",
      type: "iban",
      accountHolderName: "Jane Supplier",
      details: { legalType: "BUSINESS", iban: "NL91ABNA0417164300", address: { city: "Berlin" } },
    });
    // The new one exists before the old one goes, so a failure in between never leaves no recipient.
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "DELETE"]);
    expect(out.recipient.id).toBe(901);
    expect(out.replaced).toBe(900);
  });

  it("starts the details afresh when the account type changes", async () => {
    const { app, calls } = stub({
      "GET /v1/accounts/900": () => OLD,
      "POST /2026Q4/accounts": () => ({ id: 902 }),
      "DELETE /2026Q4/accounts/900": () => new Response(null, { status: 204 }),
    });
    const mcp = await connect(app, { env: {}, ...approve });
    await mcp.callTool("update_recipient", { id: 900, type: "sort_code", details: { sortCode: "040075", accountNumber: "37778842" } });
    await mcp.close();
    expect(calls.find((c) => c.method === "POST")!.body.details).toEqual({ legalType: "BUSINESS", sortCode: "040075", accountNumber: "37778842" });
  });

  it("keeps the old recipient when Wise refuses the new details", async () => {
    const { app, calls } = stub({
      "GET /v1/accounts/900": () => OLD,
      "POST /2026Q4/accounts": () => new Response(JSON.stringify({ errors: [{ code: "NOT_VALID", path: "iban", message: "Please specify a valid IBAN." }] }), { status: 422 }),
    });
    const mcp = await connect(app, { env: {}, ...approve });
    const result = await mcp.callTool("update_recipient", { id: 900, details: { iban: "nope" } });
    await mcp.close();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("valid IBAN");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("reads the fields a recipient needs from just a currency", async () => {
    const { app, calls } = stub({
      "GET /2026Q4/profiles": () => PROFILES,
      "POST /2026Q4/profiles/222/quotes": () => ({ id: "q-req" }),
      "GET /2026Q4/quotes/q-req/account-requirements": () => [
        { type: "iban", title: "IBAN", fields: [{ name: "IBAN", group: [{ key: "iban", required: true, example: "DE89..." }] }] },
      ],
    });
    const mcp = await connect(app, { env: {} });
    const out = resultData(await mcp.callTool("get_recipient_requirements", { currency: "eur" })) as any;
    await mcp.close();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ sourceCurrency: "EUR", targetCurrency: "EUR", targetAmount: 100 });
    expect(out.types[0].fields[0]).toMatchObject({ key: "iban", required: true });
  });
});

describe("matching a payment request", () => {
  it("finds a recipient across every page, by name in any order and case", async () => {
    const page1 = { content: [{ id: 1, name: { fullName: "Anna Other" }, currency: "EUR" }], seekPositionForNext: 1 };
    const page2 = { content: [{ id: 2, name: { fullName: "Müller-Bau GmbH" }, currency: "EUR", longAccountSummary: "IBAN ending 3000" }] };
    const { app, calls } = stub({
      "GET /2026Q4/accounts": (c) => (c.query.seekPosition ? page2 : page1),
    });
    const mcp = await connect(app, { env: { WISE_PROFILE_ID: "222" } });
    const byName = resultData(await mcp.callTool("find_recipient", { name: "gmbh muller" })) as any;
    const byEnding = resultData(await mcp.callTool("find_recipient", { account_ending: "3000" })) as any;
    await mcp.close();
    expect(byName.searched).toBe(2);
    expect(byName.matches.map((m: any) => m.id)).toEqual([2]);
    expect(byEnding.matches.map((m: any) => m.id)).toEqual([2]);
    expect(calls.filter((c) => c.path === "/2026Q4/accounts").length).toBe(4);
  });

  it("flags bank details that differ from the saved recipient, masked", async () => {
    const { app } = stub({
      "GET /v1/accounts/900": () => ({ id: 900, accountHolderName: "Jane Supplier", details: { iban: "DE89370400440532013000", bic: "COBADEFFXXX" } }),
    });
    const mcp = await connect(app, { env: {} });
    const ok = resultData(await mcp.callTool("check_bank_details", { recipient_id: 900, name: "jane  SUPPLIER", details: { iban: "DE89 3704 0044 0532 0130 00" } })) as any;
    const bad = resultData(await mcp.callTool("check_bank_details", { recipient_id: 900, details: { iban: "GB33BUKB20201555555555", swift: "X" } })) as any;
    await mcp.close();
    expect(ok.verdict).toBe("matches");
    expect(ok.same).toEqual(["name", "iban"]);
    expect(bad.verdict).toMatch(/^DIFFERENT/);
    expect(bad.different).toEqual([{ field: "iban", saved: "…3000", given: "…5555" }]);
    expect(bad.not_on_file).toEqual(["swift"]);
    expect(JSON.stringify(bad)).not.toContain("GB33BUKB");
  });
});

describe("one payment request, one transfer", () => {
  it("turns the same payment id into the same UUID every time", () => {
    const id = transactionId("<CAF=abc123@mail.gmail.com>");
    expect(id).toBe(transactionId("<CAF=abc123@mail.gmail.com>"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id).not.toBe(transactionId("<CAF=abc124@mail.gmail.com>"));
  });

  it("keeps a UUID it is given, and makes a fresh one with none", () => {
    expect(transactionId("54A6BC09-CEF9-49A8-9041-F1F0C654CD88")).toBe("54a6bc09-cef9-49a8-9041-f1f0c654cd88");
    expect(transactionId()).not.toBe(transactionId());
  });
});

describe("which profile acts", () => {
  it("uses the only business profile when none is named", async () => {
    const { app, calls } = stub({ "GET /2026Q4/profiles": () => PROFILES, "GET /2026Q4/profiles/222/balances": () => [] });
    const mcp = await connect(app, { env: {} });
    await mcp.callTool("list_balances", {});
    await mcp.close();
    expect(calls.at(-1)!.query).toEqual({ types: "STANDARD" });
    expect(calls.at(-1)!.path).toBe("/2026Q4/profiles/222/balances");
  });

  it("refuses to guess between two business profiles", async () => {
    const { app } = stub({ "GET /2026Q4/profiles": () => [...PROFILES, { id: 333, type: "BUSINESS", businessName: "Other Ltd" }] });
    const mcp = await connect(app, { env: {} });
    const result = await mcp.callTool("list_balances", {});
    await mcp.close();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("WISE_PROFILE_ID");
  });

  it("lists transfers on the legacy path with Wise's own filter names", async () => {
    const { app, calls } = stub({ "GET /v1/transfers": () => [{ id: 1, status: "incoming_payment_waiting", sourceValue: 10, sourceCurrency: "EUR" }] });
    const mcp = await connect(app, { env: { WISE_PROFILE_ID: "222" } });
    const out = resultData(await mcp.callTool("list_transfers", { status: "incoming_payment_waiting", since: "2026-11-01" })) as any;
    await mcp.close();
    expect(calls[0]!.query).toEqual({ profile: "222", status: "incoming_payment_waiting", createdDateStart: "2026-11-01", limit: "100", offset: "0" });
    expect(out.transfers[0].source).toBe("10 EUR");
  });

  /* Wise answers oldest first. 1.0.0 passed that through, so a limit of 20 showed the account's 20 oldest transfers. */
  it("returns the newest transfers first, across Wise's oldest-first pages", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => i + 1); // Wise's order: 1 is the oldest
    const { app, calls } = stub({
      "GET /v1/transfers": (c) => ids.slice(Number(c.query.offset), Number(c.query.offset) + Number(c.query.limit)).map((id) => ({ id, status: "outgoing_payment_sent" })),
    });
    const mcp = await connect(app, { env: { WISE_PROFILE_ID: "222" } });
    const newest = resultData(await mcp.callTool("list_transfers", { limit: 3 })) as any;
    const next = resultData(await mcp.callTool("list_transfers", { limit: 3, offset: 3 })) as any;
    const oldest = resultData(await mcp.callTool("list_transfers", { limit: 2, oldest_first: true })) as any;
    await mcp.close();
    expect(newest.transfers.map((t: any) => t.id)).toEqual([150, 149, 148]);
    expect(newest.more).toBe(true);
    expect(next.transfers.map((t: any) => t.id)).toEqual([147, 146, 145]);
    expect(oldest.transfers.map((t: any) => t.id)).toEqual([1, 2]);
    expect(calls[0]!.query.createdDateStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(calls.filter((c) => c.path === "/v1/transfers").length).toBe(6);
  });
});

describe("Wise's errors", () => {
  it("explains a Payment Approvals rule instead of a bare 4xx", async () => {
    const { app } = stub({
      "GET /2026Q4/profiles": () => PROFILES,
      "GET /2026Q4/accounts/900": () => RECIPIENT,
      "POST /2026Q4/profiles/222/quotes": () => QUOTE,
      "POST /2026Q4/transfers": () =>
        new Response(JSON.stringify({ errors: [{ code: "error.quote.approval", message: "Quote cannot be accepted with this request due to missing approval." }] }), {
          status: 422,
        }),
    });
    const mcp = await connect(app, { env: {}, ...approve });
    const result = await mcp.callTool("create_transfer", { recipient_id: 900, source_currency: "EUR", amount: 10 });
    await mcp.close();
    const text = JSON.stringify(result.content);
    expect(result.isError).toBe(true);
    expect(text).toContain("missing approval");
    expect(text).toContain("Payment Approvals");
  });

  it("never lets the token into a result", async () => {
    const { app } = stub({ "GET /2026Q4/profiles": () => new Response('{"error":"invalid_token","error_description":"bad token test-token"}', { status: 401 }) });
    const mcp = await connect(app, { env: {} });
    const result = await mcp.callTool("list_profiles", {});
    await mcp.close();
    expect(JSON.stringify(result.content)).not.toContain("test-token");
  });
});
