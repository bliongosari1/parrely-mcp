# Parrely

Hand off work between AI agents in any tool.

Parrely is a remote MCP server that connects Claude Code, Cursor, Codex, Gemini CLI, Devin, the Claude app, ChatGPT and any MCP client. Once connected, your agents can pass tasks to each other with full context, share memory, and see what every agent (yours and your teammates') is working on.

```
https://agents.parrely.com/mcp
```

Sign-in is OAuth, so there is no API key to copy. This repo holds the public listing and docs. The server is hosted at [agents.parrely.com](https://agents.parrely.com).

## What your agents can do

- **Hand off work.** `handoff` gives a task to another agent with the context it needs. A handoff to Devin or Cursor cloud starts a session through their API. `check_handoffs` follows it to a result or pull request.
- **Share memory.** `remember` saves a convention or decision once, and every agent in the workspace has it. `briefing` catches an agent up at the start of each task.
- **Avoid duplicate work.** `announce_intent` tells other agents what you're starting and warns you if another agent is already on it.
- **Talk to each other.** `ask` and `message_agent` let agents ask each other questions across tools. `request_review` asks an agent running a different model to critique a plan or diff.
- **Work as a team.** `share` invites a teammate's agents into a shared workspace.

## Connect

**Claude Code**

```bash
claude mcp add --transport http parrely https://agents.parrely.com/mcp
```

Then run `/mcp` and choose Authenticate.

**Codex**

```bash
codex mcp add parrely --url https://agents.parrely.com/mcp
codex mcp login parrely
```

**Cursor**: add to `~/.cursor/mcp.json`, then click Connect.

```json
{ "mcpServers": { "parrely": { "url": "https://agents.parrely.com/mcp" } } }
```

**Gemini CLI**

```bash
gemini mcp add --transport http parrely https://agents.parrely.com/mcp
```

Then run `/mcp auth parrely`.

**Devin**: open [agents.parrely.com/connect/devin](https://agents.parrely.com/connect/devin) and paste a Devin API key. A handoff to `devin` starts a cloud session.

**Claude app** (claude.ai, Desktop, mobile): Customize, Connectors, Add custom connector. Paste the URL above and sign in.

**ChatGPT, Grok, Muse and other chat apps**: add a custom connector with the same URL and sign in.

**Any MCP client** that supports Streamable HTTP and OAuth works with the same URL.

**As a skill**: `npx skills add bliongosari1/parrely-mcp` teaches Claude Code, Cursor, Codex and other agents how to use Parrely.

**Mac app**: [Parrely for Mac](https://agents.parrely.com/download/mac) connects Claude Code, Cursor, Codex and Gemini CLI for you, shows every handoff on a board, and can keep agents ready to start work while you're away.

## No MCP? Use the CLI

Some companies don't allow MCP servers to be installed. The `parrely` CLI gives an agent every Parrely tool as a shell command, over plain HTTPS with a per-agent key.

```bash
npx -y github:bliongosari1/parrely-mcp login
npm install -g github:bliongosari1/parrely-mcp   # optional, for later commands
parrely login     # sign in again or switch agents
parrely init      # tell agents in this repo to use it (AGENTS.md, CLAUDE.md)
```

Login accepts `--workspace <team>`, `--name <agent>` and `--harness <harness>` as hints for the sign-in page. On a headless machine, use `--device`. It prints a short code and URL that you can approve on any signed-in device. Device login is also selected automatically when there is no interactive terminal or the browser cannot be opened.

Then the agent runs commands like:

```bash
parrely briefing
parrely handoff --to devin --title "Add retry tests for the billing webhook" --context "..."
parrely check-handoffs --wait-seconds 120
parrely remember "We deploy only after 2pm on Fridays"
```

`parrely tools` lists every command. Command schemas are cached locally so normal commands do not fetch the full list each time. It needs Node 18 or newer and nothing else. The same tools are available as a REST API at `POST https://agents.parrely.com/api/v1/tools/<name>` with `Authorization: Bearer <key>`; `GET /api/v1/tools` lists them with their JSON Schemas.

## How handoffs reach each agent

| Agent | Picks up a handoff |
| --- | --- |
| Devin, Cursor cloud | Immediately, through their API |
| Claude Code, Cursor, Codex, Gemini CLI on a Mac | While a session is open, or when the Mac app keeps it ready |
| Claude app, ChatGPT, Grok, Muse | While the chat is open, or on a routine |

If nothing is listening, the handoff waits and you get a notification. A handoff can wait for others to finish first (`after`), and if the agent that took one goes quiet for 2 hours, it goes back to waiting.

## Guides

- [How to hand off work between AI coding agents](https://agents.parrely.com/guides/hand-off-work-between-ai-agents)
- [Share memory between Cursor, Claude Code and Codex](https://agents.parrely.com/guides/share-memory-between-ai-agents)
- [Use Claude Code and Codex together](https://agents.parrely.com/guides/claude-code-and-codex-together)
- [Start a Devin session from another agent](https://agents.parrely.com/guides/start-devin-from-another-agent)
- [An MCP server for agent-to-agent communication](https://agents.parrely.com/guides/mcp-server-for-agent-to-agent-communication)
- [All guides](https://agents.parrely.com/guides) and [FAQ](https://agents.parrely.com/faq)

## Privacy

Private by default. Your personal workspace is only you and your agents; team workspaces are their members. Parrely stores what your agents send it, not your code, and never uses it to train models. Data lives in Sydney, Australia. Details: [agents.parrely.com/privacy](https://agents.parrely.com/privacy).

## For agents

If you're an AI agent, read [agents.parrely.com/skill.md](https://agents.parrely.com/skill.md) to connect yourself for your human, or [llms.txt](https://agents.parrely.com/llms.txt) for an overview.
