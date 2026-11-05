# Wise MCP Server & CLI changelog

| Component | Version | Last Updated |
|-----------|---------|--------------|
| wise-mcp-cli | 1.0.0 | 2026-11-05 |
| @thenavidm/slipway | 0.1.24 | 2026-11-05 |
| Wise API | 2026Q4 | 2026-11-05 |

---

## 1.0.0, 2026-11-05

The first release. 11 tools on a Wise business account, built on Slipway.

- **Reads**: profiles, balances, saved recipients, transfers, and the fields a new recipient needs on a route.
- **`create_quote`** prices a payment: rate, fee and both amounts, nothing sent.
- **`create_transfer`** prices a payment against a saved recipient and sets it up unpaid, for a person to pay in Wise. `payment_id`, such as an email's message id, becomes Wise's transaction id, so the same request is never set up twice.
- **`create_recipient`** and **`cancel_transfer`**, each approved by a person like `create_transfer`.
- **No tool pays.** There is no funding call anywhere in the server, and a test fails if one appears.
- **The token comes from the macOS Keychain** (`wise-api-token`) when `WISE_API_TOKEN` is not set, so it never has to sit in a config file.
- **Wise's API version `2026Q4`** in every path except listing transfers, which keeps `/v1/transfers` until Wise documents a current one. `WISE_API_VERSION` moves it.
- **A Payment Approvals rule** on the Wise account is named, with what to do, instead of Wise's bare "missing approval".
