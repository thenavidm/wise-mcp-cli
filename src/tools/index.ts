/**
 * Every tool, in the order they appear in the README.
 *
 * Reads run freely. Saving a recipient and setting up a transfer need a person
 * to approve them, because both put bank details one tap away from being paid.
 * Nothing here pays: there is no funding tool, so the last step always happens
 * in the Wise app or website.
 */

import { createHash, randomUUID } from "node:crypto";
import { toolkit, z } from "@thenavidm/slipway";
import type { Context } from "../app.js";

const { defineTool } = toolkit<Context>();

const profileArg = {
  profile: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("The Wise profile id to act for. Defaults to WISE_PROFILE_ID, else the only business profile. See list_profiles."),
};

const currency = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "a three-letter currency code, such as EUR")
  .transform((c) => c.toUpperCase());

/**
 * Wise refuses a customerTransactionId that is not a UUID. Any other string,
 * such as an email's message id, becomes a UUID derived from it, so the same
 * payment request always maps to the same transfer and is never paid twice.
 */
export function transactionId(paymentId?: string): string {
  if (!paymentId) return randomUUID();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId)) return paymentId.toLowerCase();
  const h = createHash("sha256").update(`wise-mcp-cli:${paymentId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type Json = Record<string, any>;

function money(value: unknown, cur: unknown): string | undefined {
  return typeof value === "number" && typeof cur === "string" ? `${value} ${cur}` : undefined;
}

export function summarizeQuote(q: Json, payIn = "BANK_TRANSFER") {
  const options: Json[] = Array.isArray(q.paymentOptions) ? q.paymentOptions : [];
  const chosen =
    options.find((o) => o.payIn === payIn && o.payOut === q.payOut && !o.disabled) ??
    options.find((o) => o.payOut === q.payOut && !o.disabled);
  const total = chosen?.price?.total?.value ?? undefined;
  return {
    quote_id: q.id,
    source: money(chosen?.sourceAmount ?? q.sourceAmount, q.sourceCurrency),
    target: money(chosen?.targetAmount ?? q.targetAmount, q.targetCurrency),
    rate: q.rate,
    fee: total ? money(total.amount, total.currency) : money(chosen?.fee?.total, q.sourceCurrency),
    pay_in: chosen?.payIn,
    pay_out: q.payOut,
    arrives_by: chosen?.estimatedDelivery,
    expires: q.expirationTime,
    recipient_id: q.targetAccount ?? undefined,
  };
}

function summarizeTransfer(t: Json) {
  return {
    id: t.id,
    status: t.status,
    recipient_id: t.targetAccount,
    source: money(t.sourceValue, t.sourceCurrency),
    target: money(t.targetValue, t.targetCurrency),
    rate: t.rate,
    reference: t.details?.reference ?? t.reference ?? undefined,
    created: t.created,
    payment_id: t.customerTransactionId,
    has_issues: t.hasActiveIssues || undefined,
  };
}

function summarizeRecipient(r: Json) {
  return {
    id: r.id,
    name: r.name?.fullName ?? r.accountHolderName ?? undefined,
    currency: r.currency,
    type: r.type,
    account: r.longAccountSummary ?? r.accountSummary ?? undefined,
    owned_by_you: r.ownedByCustomer ?? undefined,
    active: r.active ?? undefined,
  };
}

export const listProfiles = defineTool({
  name: "list_profiles",
  title: "List profiles",
  description:
    "List the Wise profiles this token can act for, personal and business, with their ids. Call this first when more than one profile may exist, then pass the id as `profile`.",
  input: z.object({}),
  risk: "read",
  handler: async (_args, ctx) => ({ profiles: await ctx.client.listProfiles(ctx.signal) }),
});

export const listBalances = defineTool({
  name: "list_balances",
  title: "List balances",
  description: "List the profile's currency balances: what is available to pay from, and what is reserved.",
  input: z.object({
    ...profileArg,
    include_jars: z.boolean().optional().describe("Also list savings balances (Jars)."),
  }),
  risk: "read",
  handler: async ({ profile, include_jars }, ctx) => {
    const id = await ctx.client.profileId(profile, ctx.signal);
    const raw = await ctx.client.request<Json[]>("GET", ctx.client.path(`/profiles/${id}/balances`), {
      query: { types: include_jars ? "STANDARD,SAVINGS" : "STANDARD" },
      signal: ctx.signal,
    });
    return {
      profile: id,
      balances: raw.map((b) => ({
        id: b.id,
        currency: b.currency,
        type: b.type,
        name: b.name ?? undefined,
        available: b.amount?.value,
        reserved: b.reservedAmount?.value || undefined,
      })),
    };
  },
});

export const listRecipients = defineTool({
  name: "list_recipients",
  title: "List recipients",
  description:
    "List saved recipients (people and businesses this account can pay), newest first, with a masked account summary. Use this to find the recipient id for a payment request: pay only recipients already saved here, and match by name and currency.",
  input: z.object({
    ...profileArg,
    currency: z.string().optional().describe("Only recipients in these currencies, comma-separated: EUR,GBP."),
    size: z.number().int().min(1).max(20).optional().describe("How many per page, 1-20."),
    cursor: z.number().int().optional().describe("The `next` value from the previous page."),
  }),
  risk: "read",
  handler: async ({ profile, currency: cur, size, cursor }, ctx) => {
    const id = await ctx.client.profileId(profile, ctx.signal);
    const raw = await ctx.client.request<Json>("GET", ctx.client.path("/accounts"), {
      query: { profileId: id, currency: cur?.toUpperCase(), size: size ?? 20, seekPosition: cursor, sort: "id,desc" },
      signal: ctx.signal,
    });
    const list: Json[] = Array.isArray(raw) ? raw : (raw.content ?? []);
    return { recipients: list.map(summarizeRecipient), next: Array.isArray(raw) ? undefined : (raw.seekPositionForNext ?? undefined) };
  },
});

/** Lowercase, accents off, punctuation to spaces: "Müller-Bau GmbH" and "muller bau gmbh" are the same name. */
const fold = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Bank fields compare without spaces, dashes or case: "DE89 3704 0044" is "de8937040044". */
const bankValue = (v: unknown) => String(v ?? "").replace(/[\s-]/g, "").toLowerCase();

/** The last four characters only, so a comparison never prints a whole account number. */
const mask = (v: unknown) => {
  const s = String(v ?? "");
  return s.length > 4 ? `…${s.slice(-4)}` : s;
};

export const findRecipient = defineTool({
  name: "find_recipient",
  title: "Find a recipient",
  description:
    "Search every saved recipient, not just one page, by name (any order, accents and case ignored), currency, or the last digits of their account. Use it to match a payment request to the recipient to pay. Best matches first.",
  input: z.object({
    ...profileArg,
    name: z.string().optional().describe("All or part of their name, such as 'jane supplier' or 'Müller'."),
    currency: z.string().optional().describe("Only recipients in this currency, such as EUR."),
    account_ending: z.string().optional().describe("The last digits of their account number or IBAN, such as 3000."),
  }),
  risk: "read",
  positional: ["name"],
  handler: async ({ profile, name, currency: cur, account_ending }, ctx) => {
    if (!name && !account_ending) throw new Error("Pass name or account_ending.");
    const id = await ctx.client.profileId(profile, ctx.signal);
    const all: Json[] = [];
    let seek: number | undefined;
    for (let page = 0; page < 50; page++) {
      const raw = await ctx.client.request<Json>("GET", ctx.client.path("/accounts"), {
        query: { profileId: id, currency: cur?.toUpperCase(), size: 20, seekPosition: seek },
        signal: ctx.signal,
      });
      const list: Json[] = Array.isArray(raw) ? raw : (raw.content ?? []);
      all.push(...list);
      seek = Array.isArray(raw) ? undefined : (raw.seekPositionForNext ?? undefined);
      if (!seek || !list.length) break;
    }
    const words = fold(name).split(" ").filter(Boolean);
    const ending = bankValue(account_ending);
    const scored = all
      .map((r) => {
        const who = fold(r.name?.fullName ?? r.accountHolderName);
        const account = bankValue(`${r.longAccountSummary ?? ""} ${r.accountSummary ?? ""} ${JSON.stringify(r.details ?? {})}`);
        const nameHits = words.filter((w) => who.includes(w)).length;
        const nameOk = !words.length || nameHits === words.length;
        const endingOk = !ending || account.includes(ending);
        return { r, ok: nameOk && endingOk, score: (who === words.join(" ") ? 2 : 0) + nameHits };
      })
      .filter((x) => x.ok)
      .sort((a, b) => b.score - a.score);
    return { searched: all.length, matches: scored.slice(0, 20).map((x) => summarizeRecipient(x.r)) };
  },
});

export const checkBankDetails = defineTool({
  name: "check_bank_details",
  title: "Check bank details against a recipient",
  description:
    "Compare the name and bank details in a payment request or invoice with a saved recipient, field by field, and say which match and which differ. Run it before setting up a payment from an invoice: any difference means stop and confirm with the payee another way, never update the recipient from the invoice. Only reads; account numbers come back masked to their last four characters.",
  input: z.object({
    recipient_id: z.number().int().positive().describe("The saved recipient, from find_recipient."),
    name: z.string().optional().describe("The payee's name as the request gives it."),
    details: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('The bank details as the request gives them, such as {"iban":"DE89 3704 0044 0532 0130 00"}.'),
  }),
  risk: "read",
  handler: async ({ recipient_id, name, details }, ctx) => {
    const saved = await ctx.client.request<Json>("GET", `/v1/accounts/${recipient_id}`, { signal: ctx.signal });
    const savedDetails: Json = saved.details ?? {};
    const same: string[] = [];
    const different: Array<{ field: string; saved: string; given: string }> = [];
    const unknown: string[] = [];
    if (name !== undefined) {
      const a = fold(saved.accountHolderName);
      const b = fold(name);
      if (a === b) same.push("name");
      else different.push({ field: "name", saved: String(saved.accountHolderName ?? ""), given: name });
    }
    for (const [field, given] of Object.entries(details ?? {})) {
      if (given && typeof given === "object") continue;
      if (!(field in savedDetails)) {
        unknown.push(field);
        continue;
      }
      if (bankValue(savedDetails[field]) === bankValue(given)) same.push(field);
      else different.push({ field, saved: mask(savedDetails[field]), given: mask(given) });
    }
    return {
      recipient_id,
      verdict: different.length ? "DIFFERENT: do not pay from this request; confirm with the payee another way" : same.length ? "matches" : "nothing to compare",
      same,
      different,
      not_on_file: unknown.length ? unknown : undefined,
    };
  },
});

export const getRecipient = defineTool({
  name: "get_recipient",
  title: "Get a recipient",
  description: "One saved recipient by id, with its full account details as Wise holds them.",
  input: z.object({ id: z.number().int().positive().describe("The recipient id.") }),
  risk: "read",
  positional: ["id"],
  handler: async ({ id }, ctx) => ctx.client.request("GET", ctx.client.path(`/accounts/${id}`), { signal: ctx.signal }),
});

/** How far back list_transfers looks when no `since` is given. */
export const DEFAULT_WINDOW_DAYS = 90;
/** Wise's largest page, and how many pages one call reads at most. */
const PAGE = 100;
const MAX_PAGES = 10;

export const listTransfers = defineTool({
  name: "list_transfers",
  title: "List transfers",
  description:
    `List the profile's transfers, newest first, from the last ${DEFAULT_WINDOW_DAYS} days unless \`since\` says otherwise. Filter by status: \`incoming_payment_waiting\` is every payment set up and waiting to be paid.`,
  input: z.object({
    ...profileArg,
    status: z
      .string()
      .optional()
      .describe("Comma-separated statuses: incoming_payment_waiting, processing, funds_converted, outgoing_payment_sent, cancelled, funds_refunded."),
    since: z.string().optional().describe(`Only transfers created on or after this date, YYYY-MM-DD. Defaults to ${DEFAULT_WINDOW_DAYS} days ago.`),
    until: z.string().optional().describe("Only transfers created before this date, YYYY-MM-DD."),
    limit: z.number().int().min(1).max(100).optional().describe("How many to return, 1-100. Defaults to 20."),
    offset: z.number().int().min(0).optional().describe("Skip this many, for the next page."),
    oldest_first: z.boolean().optional().describe("Oldest first instead of newest first."),
  }),
  risk: "read",
  /*
   * Wise's /v1/transfers answers oldest first and pages forward with an offset, so its first page is the account's
   * oldest transfers, not its latest. There is no documented sort. So this reads the whole window, page by page, and
   * sorts it here: newest first by Wise's own id, which only grows.
   */
  handler: async ({ profile, status, since, until, limit, offset, oldest_first }, ctx) => {
    const id = await ctx.client.profileId(profile, ctx.signal);
    const start = since ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const all: Json[] = [];
    let complete = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const raw = await ctx.client.request<Json[]>("GET", "/v1/transfers", {
        query: { profile: id, status, createdDateStart: start, createdDateEnd: until, limit: PAGE, offset: page * PAGE },
        signal: ctx.signal,
      });
      all.push(...raw);
      if (raw.length < PAGE) {
        complete = true;
        break;
      }
    }
    all.sort((a, b) => (oldest_first ? a.id - b.id : b.id - a.id));
    const from = offset ?? 0;
    const shown = all.slice(from, from + (limit ?? 20));
    return {
      profile: id,
      since: start,
      order: oldest_first ? "oldest first" : "newest first",
      transfers: shown.map(summarizeTransfer),
      more: from + shown.length < all.length || undefined,
      ...(complete ? {} : { note: `More than ${PAGE * MAX_PAGES} transfers since ${start}; only those were read. Pass a later since.` }),
    };
  },
});

export const getTransfer = defineTool({
  name: "get_transfer",
  title: "Get a transfer",
  description: "One transfer by id: its status, amounts, rate and reference.",
  input: z.object({ id: z.number().int().positive().describe("The transfer id.") }),
  risk: "read",
  positional: ["id"],
  handler: async ({ id }, ctx) => summarizeTransfer(await ctx.client.request<Json>("GET", ctx.client.path(`/transfers/${id}`), { signal: ctx.signal })),
});

const amountArgs = {
  source_currency: currency.describe("The currency paid from, such as EUR."),
  target_currency: currency.describe("The currency the recipient receives."),
  amount: z.number().positive().describe("The amount."),
  amount_is: z
    .enum(["target", "source"])
    .optional()
    .describe("`target` (default): the recipient receives exactly this, as on an invoice. `source`: this is what leaves the account."),
  pay_in: z
    .enum(["BANK_TRANSFER", "BALANCE"])
    .optional()
    .describe("How it will be paid: BALANCE from a Wise balance, BANK_TRANSFER from a bank. Changes the fee shown."),
};

function quoteBody(args: { source_currency: string; target_currency: string; amount: number; amount_is?: string; pay_in?: string }, recipient?: number) {
  return {
    sourceCurrency: args.source_currency,
    targetCurrency: args.target_currency,
    ...(args.amount_is === "source" ? { sourceAmount: args.amount } : { targetAmount: args.amount }),
    ...(recipient ? { targetAccount: recipient } : {}),
    ...(args.pay_in ? { preferredPayIn: args.pay_in } : {}),
  };
}

export const createQuote = defineTool({
  name: "create_quote",
  title: "Price a payment",
  description:
    "Price a payment: the rate, the fee and the amount on each side. Nothing is sent and nothing is reserved; a quote expires on its own. Use it to show the cost before setting up a transfer. Pass recipient_id for the exact fee to that recipient.",
  input: z.object({
    ...profileArg,
    ...amountArgs,
    recipient_id: z.number().int().positive().optional().describe("The recipient, for that route's exact fee."),
  }),
  risk: "write",
  idempotent: false,
  summary: (a) => `price ${a.amount} ${a.amount_is === "source" ? a.source_currency : a.target_currency}`,
  examples: [{ description: "What 500 EUR to a recipient costs from SEK", args: { source_currency: "SEK", target_currency: "EUR", amount: 500 } }],
  handler: async (args, ctx) => {
    const id = await ctx.client.profileId(args.profile, ctx.signal);
    const quote = await ctx.client.request<Json>("POST", ctx.client.path(`/profiles/${id}/quotes`), {
      body: quoteBody(args, args.recipient_id),
      signal: ctx.signal,
    });
    return summarizeQuote(quote, args.pay_in);
  },
});

export const getRecipientRequirements = defineTool({
  name: "get_recipient_requirements",
  title: "Fields a new recipient needs",
  description:
    "The bank-detail fields Wise needs to save a recipient paid in a currency, by account type (iban, sort_code, aba, ...). Pass the currency they are paid in, or a quote_id from create_quote. Use the answer to know what to ask the person for; never fill bank details from an email.",
  input: z.object({
    ...profileArg,
    currency: currency.optional().describe("The currency the recipient is paid in, such as EUR."),
    source_currency: currency.optional().describe("The currency you pay from. Defaults to the same currency; some routes ask for different fields."),
    quote_id: z.string().optional().describe("A quote_id from create_quote, instead of currency."),
  }),
  risk: "read",
  positional: ["currency"],
  handler: async ({ profile, currency: cur, source_currency, quote_id }, ctx) => {
    let quote = quote_id;
    if (!quote) {
      if (!cur) throw new Error("Pass currency, or a quote_id from create_quote.");
      // Wise reads the requirements off a quote, so a throwaway one is made: nothing is sent and it expires by itself.
      const id = await ctx.client.profileId(profile, ctx.signal);
      const q = await ctx.client.request<Json>("POST", ctx.client.path(`/profiles/${id}/quotes`), {
        body: { sourceCurrency: source_currency ?? cur, targetCurrency: cur, targetAmount: 100 },
        signal: ctx.signal,
      });
      quote = String(q.id);
    }
    const raw = await ctx.client.request<Json[]>("GET", ctx.client.path(`/quotes/${encodeURIComponent(quote)}/account-requirements`), {
      signal: ctx.signal,
    });
    return {
      types: raw.map((t) => ({
        type: t.type,
        title: t.title,
        fields: (t.fields ?? []).flatMap((f: Json) =>
          (f.group ?? []).map((g: Json) => ({
            key: g.key,
            label: f.name ?? g.name,
            required: g.required,
            example: g.example || undefined,
            choices: Array.isArray(g.valuesAllowed) && g.valuesAllowed.length <= 25 ? g.valuesAllowed.map((v: Json) => v.key) : undefined,
          })),
        ),
      })),
    };
  },
});

export const createRecipient = defineTool({
  name: "create_recipient",
  title: "Save a recipient",
  description:
    "Save a new recipient's bank details so payments can be set up to them. A person approves every one. Take the details only from the person themself, never from an email, invoice or document on its own: new or changed bank details in a payment request are the classic invoice fraud, so stop and ask instead. Field names come from get_recipient_requirements; put them in `details`.",
  input: z.object({
    ...profileArg,
    currency: currency.describe("The currency they are paid in."),
    type: z.string().describe("The account type from get_recipient_requirements, such as iban or sort_code."),
    account_holder_name: z.string().min(2).describe("Their full name, or the business's full name."),
    legal_type: z.enum(["PRIVATE", "BUSINESS"]).optional().describe("A person or a business."),
    details: z.record(z.string(), z.unknown()).describe('The bank fields for that type, such as {"iban":"DE89..."}. Address fields go here too.'),
    owned_by_you: z.boolean().optional().describe("True when it is the account holder's own account elsewhere."),
  }),
  risk: "destructive",
  consequence: "saves these bank details to the Wise account, where payments can be set up to them",
  summary: (a) => `save ${a.account_holder_name} (${a.currency}, ${a.type}) as a Wise recipient`,
  detail: (a) => JSON.stringify(a.details),
  handler: async (args, ctx) => {
    const id = await ctx.client.profileId(args.profile, ctx.signal);
    const created = await ctx.client.request<Json>("POST", ctx.client.path("/accounts"), {
      body: {
        profile: id,
        currency: args.currency,
        type: args.type,
        accountHolderName: args.account_holder_name,
        ...(args.owned_by_you !== undefined ? { ownedByCustomer: args.owned_by_you } : {}),
        details: { ...(args.legal_type ? { legalType: args.legal_type } : {}), ...args.details },
      },
      signal: ctx.signal,
    });
    return summarizeRecipient(created);
  },
});

export const updateRecipient = defineTool({
  name: "update_recipient",
  title: "Change a recipient's details",
  description:
    "Change a saved recipient's name or bank details. Wise has no edit for recipients, so this saves a new recipient with the changes merged into the current details and then deactivates the old one; payments already set up to the old one are not moved. A person approves it. Take the new details only from the person themself, never from an email or invoice on its own: a request to change bank details is the classic invoice fraud.",
  input: z.object({
    id: z.number().int().positive().describe("The recipient to change, from list_recipients."),
    account_holder_name: z.string().min(2).optional().describe("A new name, if it changes."),
    type: z.string().optional().describe("A new account type, such as iban or sort_code. When it changes, `details` must hold every field of the new type."),
    details: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Only the fields that change, such as {"iban":"DE89..."}. The rest are kept.'),
  }),
  risk: "destructive",
  consequence: "replaces this recipient's saved bank details with a new recipient and deactivates the old one",
  positional: ["id"],
  summary: (a) => `change Wise recipient ${a.id}${a.account_holder_name ? ` to ${a.account_holder_name}` : ""}`,
  detail: (a) => JSON.stringify({ ...(a.type ? { type: a.type } : {}), ...(a.details ?? {}) }),
  handler: async ({ id, account_holder_name, type, details }, ctx) => {
    if (!account_holder_name && !type && !details) throw new Error("Nothing to change: pass account_holder_name, type or details.");
    // v1 returns the raw details the new recipient is built from; recipient ids are the same in v1 and v2.
    const old = await ctx.client.request<Json>("GET", `/v1/accounts/${id}`, { signal: ctx.signal });
    const typeChanged = Boolean(type && type !== old.type);
    const created = await ctx.client.request<Json>("POST", ctx.client.path("/accounts"), {
      body: {
        profile: old.profile ?? old.business ?? undefined,
        currency: old.currency,
        type: type ?? old.type,
        accountHolderName: account_holder_name ?? old.accountHolderName,
        ...(old.ownedByCustomer !== undefined ? { ownedByCustomer: old.ownedByCustomer } : {}),
        details: typeChanged
          ? { ...(old.details?.legalType ? { legalType: old.details.legalType } : {}), ...(details ?? {}) }
          : { ...(old.details ?? {}), ...(details ?? {}) },
      },
      signal: ctx.signal,
    });
    await ctx.client.request("DELETE", ctx.client.path(`/accounts/${id}`), { signal: ctx.signal });
    return {
      recipient: summarizeRecipient(created),
      replaced: id,
      note: `Saved as recipient ${created.id}; ${id} is deactivated. Payments already set up to ${id} still go to the old details: cancel and set them up again if needed.`,
    };
  },
});

export const deleteRecipient = defineTool({
  name: "delete_recipient",
  title: "Remove a recipient",
  description: "Deactivate a saved recipient, so no new payment can be set up to it. Payments already set up are not affected. A person approves it.",
  input: z.object({ id: z.number().int().positive().describe("The recipient id.") }),
  risk: "destructive",
  consequence: "removes this recipient from the account's saved recipients",
  positional: ["id"],
  summary: (a) => `remove Wise recipient ${a.id}`,
  handler: async ({ id }, ctx) => {
    await ctx.client.request("DELETE", ctx.client.path(`/accounts/${id}`), { signal: ctx.signal });
    return { removed: id };
  },
});

export const createTransfer = defineTool({
  name: "create_transfer",
  title: "Set up a payment",
  description:
    "Set up a payment to a saved recipient, ready for the person to pay in Wise. This prices it and creates the transfer; it does not pay it. It waits as `incoming_payment_waiting` until paid in the Wise app or website, and Wise cancels it if unpaid for 14 days. A person approves every one. Pass payment_id (an email's message id, an invoice number) so asking twice never sets it up twice.",
  input: z.object({
    ...profileArg,
    recipient_id: z.number().int().positive().describe("A saved recipient's id, from list_recipients."),
    source_currency: currency.describe("The currency paid from, such as EUR."),
    target_currency: currency.optional().describe("The currency they receive. Defaults to the recipient's currency."),
    amount: amountArgs.amount,
    amount_is: amountArgs.amount_is,
    pay_in: amountArgs.pay_in,
    reference: z.string().max(140).optional().describe("What the recipient sees on their statement, such as an invoice number. Wise shortens the limit on some routes."),
    payment_id: z
      .string()
      .min(1)
      .optional()
      .describe("A stable id for this payment request, such as the email's message id. The same id never creates a second transfer."),
  }),
  risk: "destructive",
  consequence: "sets up a payment on the Wise account, unpaid, for a person to pay in Wise",
  summary: (a) =>
    `set up ${a.amount} ${a.amount_is === "source" ? a.source_currency : (a.target_currency ?? "in the recipient's currency")} to Wise recipient ${a.recipient_id}, unpaid`,
  detail: (a) => [a.reference ? `Reference: ${a.reference}` : "", a.payment_id ? `Payment id: ${a.payment_id}` : ""].filter(Boolean).join("\n"),
  examples: [
    {
      description: "An invoice for 1200 EUR, paid from the EUR balance",
      args: { recipient_id: 12345678, source_currency: "EUR", amount: 1200, reference: "INV-0042", payment_id: "INV-0042" },
    },
  ],
  handler: async (args, ctx) => {
    const id = await ctx.client.profileId(args.profile, ctx.signal);
    const recipient = await ctx.client.request<Json>("GET", ctx.client.path(`/accounts/${args.recipient_id}`), { signal: ctx.signal });
    const target = args.target_currency ?? recipient.currency;
    if (!target) throw new Error("The recipient has no currency; pass target_currency.");

    const quote = await ctx.client.request<Json>("POST", ctx.client.path(`/profiles/${id}/quotes`), {
      body: quoteBody({ ...args, target_currency: target }, args.recipient_id),
      signal: ctx.signal,
    });
    const transfer = await ctx.client.request<Json>("POST", ctx.client.path("/transfers"), {
      body: {
        targetAccount: args.recipient_id,
        quoteUuid: quote.id,
        customerTransactionId: transactionId(args.payment_id),
        ...(args.reference ? { details: { reference: args.reference } } : {}),
      },
      signal: ctx.signal,
    });
    return {
      transfer: summarizeTransfer(transfer),
      recipient: summarizeRecipient(recipient),
      price: summarizeQuote(quote, args.pay_in),
      next_step: "Not paid yet. Pay it in the Wise app or at wise.com; it is waiting there. Wise cancels it if unpaid for 14 days.",
    };
  },
});

export const cancelTransfer = defineTool({
  name: "cancel_transfer",
  title: "Cancel a payment",
  description:
    "Cancel a transfer that has not been paid yet (status incoming_payment_waiting). Once Wise has the money it can no longer be cancelled here. A cancelled transfer cannot be restarted, only set up again.",
  input: z.object({ id: z.number().int().positive().describe("The transfer id.") }),
  risk: "destructive",
  consequence: "cancels this payment for good; it can only be set up again as a new one",
  positional: ["id"],
  summary: (a) => `cancel Wise transfer ${a.id}`,
  handler: async ({ id }, ctx) => summarizeTransfer(await ctx.client.request<Json>("PUT", ctx.client.path(`/transfers/${id}/cancel`), { signal: ctx.signal })),
});

export const ALL_TOOLS = [
  listProfiles,
  listBalances,
  listRecipients,
  findRecipient,
  checkBankDetails,
  getRecipient,
  listTransfers,
  getTransfer,
  createQuote,
  getRecipientRequirements,
  createRecipient,
  updateRecipient,
  deleteRecipient,
  createTransfer,
  cancelTransfer,
];
