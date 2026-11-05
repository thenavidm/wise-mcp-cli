# Install

One npm package, `@thenavidm/wise-mcp-cli`, contains two programs:

| | What it is | Who runs it |
|---|---|---|
| **`wise-mcp`** | the MCP server | your AI app launches it, you never do |
| **`wise-cli`** | the command line tool | you, in a terminal |

They are the same 36 tools. Install one, the other, or both.

This page is the complete guide. The README carries a short version of the three
most common routes, and they are repeated here so you never have to read both.

## Before you start

| What you need | Why |
|---|---|
| **Node 22 or newer** | the only thing you have to install |
| **A Wise personal API token** | from a Wise business account, needed for every tool |

Create the token first, in [the README](README.md#2-set-up-your-account). It takes a
minute on the Wise website.

**On a Mac, keep it in the Keychain** and every config below shrinks to the
command alone, with no token in any file:

```bash
security add-generic-password -a "$USER" -s wise-api-token -w
```

Elsewhere, put it in `WISE_API_TOKEN` as the configs below show.

---

# 1. The MCP server, for AI apps

Pick your app. Each one is a single command or a single pasted block, and they
all run `npx`, so **you do not have to install anything first**.

### Claude Code

```bash
claude mcp add wise -- npx -y @thenavidm/wise-mcp-cli
```

Without the Keychain:

```bash
claude mcp add wise -e WISE_API_TOKEN=your-token -- npx -y @thenavidm/wise-mcp-cli
```

### Claude Desktop

The easy way: download the [`.mcpb` extension](https://github.com/thenavidm/wise-mcp-cli/releases/latest) and double-click it. It asks for the token and keeps it in Claude Desktop's own secure storage.

Or by hand:

**1. Open the config file.**

In Claude Desktop, go to **Settings**, then **Developer**, then click **Edit Config**. That reveals `claude_desktop_config.json` in your file manager. Open it in any text editor.

If you would rather go straight there:

| System | Config file |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

On macOS you can open it from a terminal with:

```bash
open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**2. Add the server.**

If the file is empty or does not exist, paste this in:

```json
{
  "mcpServers": {
    "wise": {
      "command": "npx",
      "args": ["-y", "@thenavidm/wise-mcp-cli"],
      "env": {
        "WISE_API_TOKEN": "your-token"
      }
    }
  }
}
```

If you already have other servers, add only the `"wise": {{ ... }}` part inside your existing `"mcpServers"`, and put a comma after the entry before it. The file has to stay valid JSON. A single missing comma or a trailing one stops every server from loading, not just this one.

Replace the value with your token, or leave the whole `"env"` block out on a Mac with the token in the Keychain. [Section 2](README.md#2-set-up-your-account) covers where to get it.

**3. Restart properly.**

Quit Claude Desktop completely and reopen it. On macOS closing the window is not enough, use **Cmd+Q**. On Windows quit it from the system tray. Claude only reads that file at startup.

**4. Check it worked.**

Look for the tools icon in the message box and click it. You should see `wise` with its tools listed. Then ask it something from [the README](README.md#1-what-you-can-ask-it).

If nothing appears, Claude Desktop's own log is the fastest way in:

| System | Log file |
|---|---|
| macOS | `~/Library/Logs/Claude/mcp-server-wise.log` |
| Windows | `%APPDATA%\Claude\logs\mcp-server-wise.log` |

```bash
tail -n 50 ~/Library/Logs/Claude/mcp-server-wise.log
```

Two things account for most failures. Node is not installed, or not on the PATH that Claude Desktop sees, in which case use the full path to `node` as the `command`. Or the JSON is malformed, which you can check by pasting the file into any JSON validator.

### Cursor

Create `~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` inside a single project. Use the same JSON as Claude Desktop. Then reload the window, or open **Settings**, **MCP**, and toggle the server.

### Windsurf

`~/.codeium/windsurf/mcp_config.json`, same JSON, then reload.

### VS Code

`.vscode/mcp.json` in a project, or run **MCP: Add Server** from the command palette.

### Everything else

Zed, Cline, Continue and anything else that speaks MCP over stdio all work. They each keep their config somewhere different, but they all want the same things: the `command`, the `args`, and the `env`.

### Docker

```bash
docker build -t wise-mcp .
docker run --rm -i -e WISE_API_TOKEN \
  wise-mcp
```

### Self-hosting over HTTP

For a machine that is always on:

```bash
WISE_HTTP_PORT=8787 \
WISE_HTTP_TOKEN=$(openssl rand -hex 32) \
wise-mcp --http
```

Binds `127.0.0.1` by default. The token can save recipients and set up payments for your business, so put it behind a reverse proxy with TLS before you change `WISE_HTTP_HOST`, and set `WISE_HTTP_TOKEN` so the endpoint is not open. `GET /health` returns the tool count without authentication.

### Did it work

```bash
npx -y @thenavidm/wise-mcp-cli doctor --network
```

It says where the token came from, then lists the profiles it can see, and names the fix when either fails. It only reads.

---

# 2. The CLI, for your terminal

This one you do install, because a shell needs the binary on your `PATH`.

**Skip this if you only use an AI app.** The AI app configs above run `npx`,
which fetches the package on demand, so nothing has to be installed first.

Do this when you want `wise-cli` in your own terminal, or in a script or a
cron job. It puts both binaries on your `PATH`:

```bash
npm install -g @thenavidm/wise-mcp-cli
```

Other package managers:

```bash
pnpm add -g @thenavidm/wise-mcp-cli     # pnpm
yarn global add @thenavidm/wise-mcp-cli # yarn
bun add -g @thenavidm/wise-mcp-cli      # bun
```

Or run it without installing anything, which is what the client configs below
do. `@latest` means you get new versions with no action on your part:

```bash
npx -y @thenavidm/wise-mcp-cli@latest --version
bunx @thenavidm/wise-mcp-cli --version
```

| Command | What it is |
|---|---|
| `wise-mcp` | the MCP server. What Claude Desktop, Claude Code and Cursor launch, and not something you run yourself. |
| `wise-cli` | the same 36 tools as shell commands. This is the one you type. |

They are one program under two names, and the name only decides what happens
when you pass no arguments: `wise-mcp` waits for a client, `wise-cli`
lists the commands. Either name will run any command.

Check it:

```bash
wise-cli                    # lists every command
wise-cli list-profiles
```

### Building it yourself instead

```bash
git clone https://github.com/thenavidm/wise-mcp-cli.git
cd wise-mcp-cli
npm install
npm run build
npm link                       # puts both binaries on your PATH
```

Point a client at `node /path/to/wise-mcp-cli/dist/index.js` if you would
rather not link.

---

# Keeping it current

## Upgrading

```bash
npm install -g @thenavidm/wise-mcp-cli@latest   # npm
pnpm add -g @thenavidm/wise-mcp-cli@latest      # pnpm
yarn global upgrade @thenavidm/wise-mcp-cli     # yarn
bun add -g @thenavidm/wise-mcp-cli@latest       # bun
```

If your client config uses `npx -y ...@latest`, there is nothing to upgrade.
It fetches the current version the next time the server starts.

Restart your AI tool afterwards so it reconnects to the new server:

| Client | How to reconnect |
|---|---|
| Claude Code | `/mcp` to reconnect, or restart |
| Claude Desktop | quit and reopen, not just close the window |
| Cursor, Windsurf, VS Code | restart the application |

## Uninstalling

```bash
npm uninstall -g @thenavidm/wise-mcp-cli
```

Remove the server from any client that has it. In Claude Code:

```bash
claude mcp remove wise
```

Elsewhere, delete the `wise` entry from the config file you edited during
install.

Nothing else is left behind. This server keeps no cache, no database and no
state directory. The one file it can create is the audit log, and only if you
pointed `WISE_AUDIT_LOG` at a path, so delete that yourself if you set one. The token stays in the Keychain until you remove it:

```bash
security delete-generic-password -s wise-api-token
```

---

Back to [the README](README.md).
