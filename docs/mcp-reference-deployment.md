# MCP Reference Deployment — 8 GB Laptop

Verified setup for running the Ollama GUI MCP connectors on a machine with 8 GB RAM,
using a small tool-calling-capable local model. Covers prerequisites, per-connector
setup, memory guidance, and a manual tool-calling validation step.

---

## Prerequisites

### 1. Verify and pull the model

The following small models are confirmed to support Ollama-native tool calling (structured
`tool_calls` in the streamed response). Pick one and verify it before proceeding:

| Model | Pull tag | Memory (quantised) | Tool-call support |
|---|---|---|---|
| Qwen2.5-3B | `qwen2.5:3b` | ~2 GB | ✅ confirmed |
| Llama 3.2 3B | `llama3.2:3b` | ~2 GB | ✅ confirmed |
| Mistral 7B | `mistral:7b-instruct-q4_0` | ~4 GB | ✅ confirmed |

> **Do not use `ministral-3:3b`** — that tag does not exist in the Ollama library.

Pull and verify:

```sh
# Pull (substitute your chosen tag)
ollama pull qwen2.5:3b

# Confirm tool-call support: the model must emit a tool_calls block, not plain text
ollama run qwen2.5:3b --verbose \
  "Call the tool get_weather with location='London'. Return only the tool call."
# Expected: a response containing tool_calls, not a plain-text sentence.
# If the model returns plain text instead of a tool call, choose a different model.
```

If the chosen model does not reliably produce well-formed tool-call JSON, fall back to
`mistral:7b-instruct-q4_0` which has the most consistent Ollama tool-call support.

### 2. Node (for npx presets)

```sh
node -v   # 18+ required
```

### 3. uv / uvx (for Jira, Database, custom-stdio presets)

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
uvx --version
```

### 4. Docker (optional, for GitHub Docker variant)

```sh
docker --version
```

---

## Memory guidance for 8 GB

- Set `num_ctx` to **2048–4096** in the model settings. A large context multiplies KV-cache
  memory; 2 k is enough for most MCP-tool loops.
- Run **one heavy MCP server at a time**. Each connected server keeps a stdio process alive.
- Prefer the `qwen2.5:3b` or `llama3.2:3b` model — they leave ~5–6 GB for the OS and
  MCP server processes.

---

## Connector setup

### Filesystem

```sh
# No extra install needed — npx pulls the package on first connect.
```

In the GUI: **Add MCP server** → select **Filesystem** → edit the path → Connect.

Verify: ask the agent "list the tools available from the connected filesystem server."

### GitHub

**Remote HTTP (PAT):** Settings → MCP → GitHub → set `auth.token` to a fine-grained PAT
(or use OAuth). Connect.

**Docker (local):** Select the **Local (Docker)** variant. Set `GITHUB_PERSONAL_ACCESS_TOKEN`.
Docker must be running.

### GitLab

Remote HTTP (OAuth) via the built-in MCP endpoint. Connect → browser opens for consent.

For self-managed instances: edit the URL from `https://gitlab.com/api/v4/mcp` to your host.

Optional: set `X-Gitlab-Mcp-Server-Tool-Name-Prefix` in the server's headers map to namespace
tool names.

### Jira / Confluence (mcp-atlassian)

Requires `uvx`. Set `JIRA_URL`, `JIRA_USERNAME`, `JIRA_API_TOKEN`. Optionally set the three
`CONFLUENCE_*` env vars to also expose Confluence tools. For Jira Server/DC, use the
"Jira Server / Data Center (PAT)" variant and set `JIRA_PERSONAL_TOKEN`.

### Atlassian Rovo

Remote HTTP — select **Atlassian Rovo** → Connect → OAuth browser consent.

### Database (PostgreSQL)

Requires `uvx`. Set `DATABASE_URI` as a secret (it is stored in the OS keychain, not
in localStorage). The `postgres-mcp` default runs in `restricted` (read-only) mode.

### Custom HTTP MCP

Set the URL and optionally an `auth.token` for bearer authentication. The token is sent
as `Authorization: Bearer <token>` on every request.

### Custom stdio MCP / Inkeep

Set the command (e.g. `uvx my-kb-server`) and the `MCP_API_KEY` env var (stored as a
secret). Select the **Inkeep** variant for the Inkeep knowledge-base server.

---

## Manual tool-calling validation

After connecting the Filesystem server and confirming the model is pulled, run this prompt:

> "List the tools available from the connected filesystem server, then read the file
> README.md and summarise it in two sentences."

**Expected behavior:** the model emits a `tools/list` call (visible in the tool-call log),
then a `read_file` call, then a two-sentence summary.

**If the model returns plain text instead of tool calls:** the model does not support
Ollama-native tool calling at this context size. Lower `num_ctx` further or switch to
`mistral:7b-instruct-q4_0`.

---

## Local fixture server (manual end-to-end check)

A minimal Node script implementing `initialize` / `tools/list` / `tools/call` for one
`echo` tool lives at `scripts/fixture-mcp-server.mjs`. Run it:

```sh
node scripts/fixture-mcp-server.mjs
```

Then add a stdio MCP server in the GUI with command `node scripts/fixture-mcp-server.mjs`.
Call the `echo` tool with `{ "message": "hello" }` — expected result: `{ "echo": "hello" }`.
