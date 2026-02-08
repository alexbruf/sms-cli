---
name: sms
description: "CLI to manage SMS messages from the terminal — send, receive, search, and organize text messages through a Cloudflare Workers backend connected to an Android phone"
homepage: https://github.com/alexbruf/sms-cli
metadata: {"clawdbot":{"emoji":"📱","requires":{"bins":["sms"]},"install":[{"os":"macos","arch":"arm64","steps":["curl -fsSL https://github.com/alexbruf/sms-cli/releases/latest/download/sms-darwin-arm64 -o /usr/local/bin/sms","chmod +x /usr/local/bin/sms"]},{"os":"macos","arch":"x64","steps":["curl -fsSL https://github.com/alexbruf/sms-cli/releases/latest/download/sms-darwin-x64 -o /usr/local/bin/sms","chmod +x /usr/local/bin/sms"]},{"os":"linux","arch":"x64","steps":["curl -fsSL https://github.com/alexbruf/sms-cli/releases/latest/download/sms-linux-x64 -o /usr/local/bin/sms","chmod +x /usr/local/bin/sms"]},{"os":"linux","arch":"arm64","steps":["curl -fsSL https://github.com/alexbruf/sms-cli/releases/latest/download/sms-linux-arm64 -o /usr/local/bin/sms","chmod +x /usr/local/bin/sms"]}]}}
---

# sms

A terminal-first SMS client. Send, receive, search, and organize text messages from your command line through a Cloudflare Workers backend connected to your Android phone via the SMS Gateway app.

## Configuration

The CLI needs the URL of your SMS server (a Cloudflare Worker that bridges between this CLI and the Android SMS Gateway app on your phone).

After installing, configure the server URL once — it's saved to `~/.config/sms/config.json`:

```bash
sms config server_url https://your-server.example.com
```

You can also override via environment variable (takes priority over the config file):

```bash
export SMS_SERVER_URL=https://your-server.example.com
```

**Resolution order:** `SMS_SERVER_URL` env var > `~/.config/sms/config.json` > `http://127.0.0.1:5555`

## Commands

### Check unread count (default)

```bash
sms
```

Shows the number of unread messages, or "No unread messages."

### List messages

```bash
sms list                    # Incoming messages (default)
sms list --unread           # Unread only
sms list --sent             # Sent messages only
sms list --all              # All messages (incoming + outgoing)
sms list --limit 50         # Show 50 messages (default: 20)
```

### Conversations

```bash
sms conversations           # List all conversation threads with unread counts
sms conv                    # Alias for conversations
```

### Read messages

```bash
sms read +14155551234       # Read conversation thread with a phone number
sms read abc123             # Read a single message by ID prefix
sms read +14155551234 --no-mark   # Read without marking as read
```

Reading a conversation or message automatically marks it as read unless `--no-mark` is passed.

### Send a message

```bash
sms send +14155551234 Hello world           # Inline message
echo "Hello world" | sms send +14155551234  # Pipe from stdin
sms send +14155551234 --sim 2               # Use SIM card 2
```

### Reply to a conversation

```bash
sms reply +14155551234 Got it, thanks!      # Reply inline
echo "On my way" | sms reply +14155551234   # Pipe from stdin
```

### Mark messages

```bash
sms mark-read abc123 def456      # Mark messages as read by ID
sms mark-unread abc123           # Mark messages as unread by ID
```

### Delete messages

```bash
sms delete abc123 def456         # Delete messages (prompts for confirmation)
sms delete abc123 --force        # Skip confirmation
```

### Search

```bash
sms search "meeting tomorrow"    # Full-text search across all messages
```

### Contacts

```bash
sms contact --list                          # List all contacts
sms contact                                 # Same as --list
sms contact --add +14155551234 John Doe     # Add a contact
sms contact --delete +14155551234           # Delete a contact
```

### Config

```bash
sms config                              # Show all config
sms config server_url                   # Get server URL
sms config server_url https://sms.example.com   # Set server URL
```

## Architecture

The CLI talks to a Cloudflare Workers backend over HTTP. The backend stores messages in D1 (SQLite) and relays outbound SMS through an Android phone running the SMS Gateway app. Incoming messages are forwarded to the backend via webhook.

```
CLI (sms) → Cloudflare Worker (D1) ↔ Android SMS Gateway App
```
