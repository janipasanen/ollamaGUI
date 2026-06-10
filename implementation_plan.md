# Implementation Plan: Ollama GUI

## Feature Analysis
Based on OpenAI and Claude GUIs:
- **Chat Experience**: Clean, centered chat area, markdown rendering, code highlighting, and streaming responses.
- **Sidebar**: History of conversations, easy navigation, and workspace management.
- **Model Control**: Ability to switch models on the fly, configure system prompts, and manage local model library.
- **UX/UI**: Minimalist design, keyboard shortcuts, and responsive layout.

## Technical Stack (Proposed)
- **Framework**: Electron or Tauri (Tauri preferred for smaller binaries and better performance on older macOS).
- **Frontend**: React or Vue with Tailwind CSS.
- **Backend**: TypeScript/Rust for interacting with Ollama's local API.

## Milestones & Issues

### Milestone 1: Core Infrastructure & Basic Chat ✅
- [x] Issue 1: Setup project structure (Tauri + React + Tailwind).
- [x] Issue 2: Implement basic Ollama API integration (Chat completion).
- [x] Issue 3: Build basic chat UI (Input field, message bubbles).
- [x] Issue 4: Implement streaming responses.

### Milestone 2: Model & Session Management ✅
- [x] Issue 5: Sidebar for conversation history (Local storage).
- [x] Issue 6: Model selection dropdown (Fetch models from Ollama).
- [x] Issue 7: System prompt configuration panel.
- [x] Issue 8: Implementation of "New Chat" and "Delete Chat".

### Milestone 3: Advanced UI & UX ✅
- [x] Issue 9: Markdown rendering and syntax highlighting for code blocks.
- [x] Issue 10: Theme support (Light/Dark mode).
- [x] Issue 11: Responsive design for different window sizes.
- [x] Issue 12: Keyboard shortcuts (e.g., Cmd/Ctrl+K for new chat).
- [x] Issue 22: Copy-to-clipboard button on code blocks with language label.
- [x] Issue 23: Streaming cursor while assistant response is generating.
- [x] Issue 24: Fix image attachment MIME type (hardcoded as JPEG, breaks PNG/GIF/WebP).

### Milestone 4: System Integration & Polishing ✅
- [x] Issue 13: Model management UI (Pull/Remove models) — wired into Settings overlay.
- [x] Issue 14: Cross-platform build pipeline (CI/CD for Linux, Windows, macOS).
- [x] Issue 15: Unit tests (vitest) for services and UI components.
- [x] Issue 16: Final UI polish, duplicate-code cleanup, type fixes.
- [x] Issue 17: Final UI polish and error state styling.
- [ ] Issue 16b: Comprehensive end-to-end testing (Playwright). — not yet done

### Milestone 5: Power User Features ✅
- [x] Issue 17: Configurable Ollama endpoint (replace hardcoded localhost:11434).
- [x] Issue 18: Message search across conversation history.
- [x] Issue 19: Export/import conversations as JSON.
- [x] Issue 20: File/image attachment support (for vision models like llava).
- [x] Issue 26: Cloud model indicator in dropdown and header badge.

### Milestone 6: Agentic Capabilities — CLI & MCP Tools
Turn the chat into an agent: Ollama tool-calling loop, CLI/shell tool with approval, MCP client (stdio + HTTP), MCP server management, and MCP OAuth authentication.

**Implementation order** (dependency-driven):

- [x] Issue 18: Agentic loop — Ollama tool-calling orchestration (agenticChatStream async generator).
- [x] Issue 19: Tool registry + render tool calls/results in chat (ToolRegistry class, inline rendering).
- [x] Issue 20: CLI/shell tool with approval gate (Rust backend, depends on tool registry).
  - Rust `run_cli` command: spawn process, capture stdout/stderr/exit code, timeout, cwd.
  - Frontend approval modal (allow once / always / deny).
  - Configurable allowlist/denylist.
  - Tauri capability/permission wired up.
- [ ] Issue 21: MCP client — stdio transport / process bridge (Rust, depends on agentic loop).
  - Rust bridge: spawn server process, write JSON-RPC to stdin, stream stdout via events.
  - TS MCP client: `initialize`, `tools/list`, `tools/call` over JSON-RPC 2.0.
  - Handles notifications, request IDs, errors, clean shutdown.
- [ ] Issue 22: MCP client — HTTP / streamable transport (depends on stdio interface).
  - Rust `mcp_http_request` proxy (avoids CORS, attaches auth headers).
  - TS transport implementing the same interface as stdio client.
  - Parses JSON and SSE-framed responses; handles `Mcp-Session-Id`.
- [ ] Issue 23: MCP OAuth 2.0 authentication — PKCE + metadata discovery (depends on HTTP transport).
  - Protected-resource / authorization-server metadata discovery.
  - PKCE (S256) code generation/verification.
  - Open system browser + loopback redirect capture (Rust).
  - Token exchange + refresh; tokens persisted securely.
- [ ] Issue 24: MCP server management UI (depends on Issues 21 + 22).
  - Add/edit/remove servers (stdio command or HTTP URL).
  - Connect/disconnect + live status.
  - Browse discovered tools; enable/disable individually.
  - Config persisted to localStorage/storage.
- [ ] Issue 25: Agentic feature test suite (covers all above).

## Testing Strategy
- **Unit Tests**: Test API wrappers and state management.
- **Integration Tests**: Test the flow from user input to Ollama response.
- **E2E Tests**: Use Playwright or Spectron to verify UI interactions.
- **Compatibility Tests**: Verify on Windows, Linux, and macOS 10.15.
