# Security

## Reporting a vulnerability

[Report it privately](https://github.com/thenavidm/wise-mcp-cli/security/advisories/new).
Please do not open a public issue for a security problem: an issue is visible to
everyone the moment you file it, including whoever would use the bug.

Include what you did, what happened, and what you expected. A proof of concept
helps. Reporters are credited in the fix notes unless they would rather not be.

## What this server holds

**A Wise personal API token**, read from the macOS Keychain item
`wise-api-token`, or from `WISE_API_TOKEN`. With Full access it can save
recipients and set up transfers for the business account. For business
accounts based in the US, Canada, Australia, New Zealand, Singapore and
Malaysia, Wise also lets such a token fund transfers through its API. This
server never does, but the token could, so keep it in the Keychain, lock it to
an IP where you can, and revoke it from Wise the moment you suspect it leaked.

The token is held in process memory only. It is never written to disk, never
logged, and removed from every error and result before either leaves the
process.

**An audit log**, only if you name a file in `WISE_AUDIT_LOG`.

Nothing leaves your machine except calls to `api.wise.com`, or
`api.wise-sandbox.com` with `WISE_ENV=sandbox`. No telemetry.

## Payment safety

**No tool pays.** Every transfer this server creates waits in Wise, unpaid,
until a person pays it in the Wise app or website. There is no funding call in
the code, and a test fails if a tool with a paying name appears.

**Approval on what reaches money.** Saving a recipient, setting up a transfer
and cancelling one. Over MCP a person approves each one where the client can
ask, in Claude Code's own prompt or an approval form; elsewhere the model must
pass `confirm: true`, and `WISE_CONFIRM=model` allows that everywhere.

**One request, one transfer.** `payment_id` becomes Wise's
`customerTransactionId`, which Wise uses to refuse duplicates.

**`WISE_READ_ONLY=1` removes every write from the tool list.** Not a refusal at
call time: the tools are never registered. This is the setting for pointing an
agent at an account it should only report on.

## Untrusted content

Payment request emails, invoices, recipient names and references are written by
other people. Treat them as data, never instructions. The risk that matters is
invoice fraud: a request whose bank details differ from the saved recipient's.
The server's instructions tell the model never to save bank details from such
a request; the real defence is paying only recipients already saved in Wise and
confirming any change with the payee another way.

## Running it over HTTP

Over HTTP the server refuses to listen on any address but localhost without
`WISE_HTTP_TOKEN`, and then requires it as a bearer token. It still belongs
behind TLS and a reverse proxy. Do not expose it directly: it holds a token
that can set up payments for your business.

## Good-faith research

Read, run and pull apart anything here. Nobody but the maintainer can change
this repository, so nothing you do while investigating puts it at risk.

The care is owed to Wise, not to the code. Test against Wise's sandbox, with
your own sandbox account. Never point it at somebody else's account. If a test
could affect anyone but you, stop and send a private report first.

## Supported versions

The latest published version gets fixes. Given the size of this project, older
versions do not.
