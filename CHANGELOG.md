# Wise MCP Server & CLI changelog

| Component | Version | Last Updated |
|-----------|---------|--------------|
| wise-mcp-cli | 1.1.0 | 2026-11-06 |
| @thenavidm/slipway | 0.1.24 | 2026-11-05 |
| Wise API | 2026Q4 | 2026-11-05 |

---

## 1.1.0, 2026-11-06

Recipients, the part of a payment run that takes the time. 15 tools, from 11.

- **`find_recipient`** searches every saved recipient, not one page of 20: by name with the words in any order and accents and case ignored, by currency, or by the last digits of the account. Best match first.
- **`check_bank_details`** compares the name and bank details in an invoice with a saved recipient, field by field, ignoring spaces and case, and says which match and which differ, account numbers masked to their last four. A difference is the invoice-fraud signal, so the verdict says to stop and confirm another way. It only reads.
- **`update_recipient`** changes a recipient's name or bank details. Wise has no edit for recipients, so it saves a new one with the changes merged into the current details and then deactivates the old one, in that order, so a change Wise refuses leaves the recipient as it was. A changed account type starts the details afresh.
- **`delete_recipient`** deactivates a recipient.
- **`get_recipient_requirements` takes a currency.** It asked for a quote id; it now makes the throwaway quote itself, which sends nothing.
- Both writes need a person's approval, like the other three.
- **`list_transfers` returns the newest transfers first**, as it always said. Wise's `/v1/transfers` answers oldest first and pages forward, and 1.0.0 passed that order through, so `limit 20` showed the account's 20 oldest transfers. It now reads the window, by default the last 90 days, page by page up to 1,000 transfers, and sorts it newest first by Wise's id before `limit` and `offset`. The result names the window and the order, and says when there are more.
- **`oldest_first`** gives the old order back when wanted.
- **A test pins it**: 150 transfers in Wise's order come back 150, 149, 148, and the next page 147, 146, 145.

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
