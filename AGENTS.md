# Working on wise-mcp-cli

For agents editing this repository. Users read the README. Driving the server is
`SKILL.md`.

## Layout

```
src/app.ts        the Slipway app: settings, doctor, instructions
src/config.ts     the token (environment or macOS Keychain), live or sandbox
src/api/          client and Wise's error shapes
src/tools/        the tools, in README order
```

## Non-negotiables

**Commit as `n@navid.me`.** Never pass `-c user.email=`.

**No tool pays. Ever.** No funding endpoint, no "pay", "fund" or "send" tool,
no option on an existing tool that funds. The last step of every payment is a
person in Wise. `tests/cli.test.ts` fails if a tool name suggests otherwise.

**Approval on anything that reaches money.** `create_recipient`,
`create_transfer` and `cancel_transfer` are `destructive`, with a
`consequence` in plain words. A new write that saves bank details or sets up,
changes or cancels a payment gets the same.

**Never retry a write.** A timeout on `create_transfer` is reported, not
repeated. The caller repeats it with the same `payment_id`, which Wise keeps to
one transfer.

**Every failure from Wise goes through `api/errors.ts`**, so its status picks
the exit code and its message survives. Add a hint there for any failure a
person cannot act on from Wise's own words.

**Check the endpoint against Wise's docs** (`docs.wise.com/llms.txt`, each page
as `.md`) before adding or changing one, and keep the README's endpoint table in
step.

## Before claiming it works

```bash
npm run build && npm test && npm run typecheck
npx slipway check dist/app.js --bin dist/index.js --docs README.md,SKILL.md
```

A green suite is not a working server. Run the handshake, and try every write
against Wise's sandbox (`WISE_ENV=sandbox`) before a release.
