# Wise MCP Server & CLI changelog

| Component | Version | Last Updated |
|-----------|---------|--------------|
| wise-mcp-cli | 1.0.0 | 2026-11-05 |
| @thenavidm/slipway | 0.1.24 | 2026-11-05 |
| Wise API | 2026Q4 | 2026-11-05 |

---

## 1.0.0, 2026-11-05

The first release, built on [Slipway](https://github.com/thenavidm/slipway) 0.1.24. 11 tools on a Wise business account, each an MCP tool and a `wise-cli` command.

### Tools

11. Seven reads: `list_profiles`, `list_balances`, `list_recipients`,
`get_recipient`, `list_transfers`, `get_transfer` and
`get_recipient_requirements`. `create_quote` prices a payment and sends
nothing. `create_recipient`, `create_transfer` and `cancel_transfer` change the
account, each approved by a person.

### Payments

`create_transfer` reads the recipient, prices the payment against it and sets
it up unpaid, as `incoming_payment_waiting`, for a person to pay in the Wise
app or website. `payment_id`, such as an email's message id or an invoice
number, becomes Wise's `customerTransactionId` through a SHA-256 derived UUID,
so the same request never becomes two transfers and a retry is safe.

### Safety

No tool pays. There is no funding call anywhere in the server, and a test fails
if a tool with a paying name appears. `create_recipient`, `create_transfer` and
`cancel_transfer` need approval, each naming what it is about to do in plain
words. `WISE_READ_ONLY=1` leaves the 7 reads. `WISE_ALLOW_DESTRUCTIVE=0` keeps
pricing and refuses the rest. `WISE_AUDIT_LOG` records every attempted write
and who approved it. Every tool carries MCP annotations.

### Credentials

The token comes from the macOS Keychain item `wise-api-token` when
`WISE_API_TOKEN` is not set, so it never has to sit in a config file.
`WISE_ENV=sandbox` points at Wise's sandbox. The token is removed from every
error and result.

### Profiles

`WISE_PROFILE_ID` decides which profile acts when a call names none, else the
only business profile, else the only profile. With two business profiles and
neither, a call refuses and names them rather than guess.

### Wise API

Every path carries Wise's quarterly version, `2026Q4`, except listing
transfers, which keeps `/v1/transfers` until Wise documents a current one.
`WISE_API_VERSION` moves it. A Payment Approvals rule on the account, which
Wise does not allow alongside API transfers, is named with what to do instead
of Wise's bare "missing approval". No write is retried.
