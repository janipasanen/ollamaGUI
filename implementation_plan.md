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
- [x] Issue 11: Responsive design for different window sizes. 🔄 [IN PROGRESS — other computer]
- [x] Issue 12: Keyboard shortcuts (e.g., Cmd/Ctrl+K for new chat).
- [x] Issue 22: Copy-to-clipboard button on code blocks with language label.
- [x] Issue 23: Streaming cursor while assistant response is generating.
- [x] Issue 24: Fix image attachment MIME type (hardcoded as JPEG, breaks PNG/GIF/WebP).

### Milestone 4: System Integration & Polishing ✅
- [x] Issue 13: Model management UI (Pull/Remove models) — wired into Settings overlay.
- [x] Issue 14: Cross-platform build pipeline (CI/CD for Linux, Windows, macOS).
- [x] Issue 15: Unit tests (vitest) for services and UI components.
- [x] Issue 16: Final UI polish, duplicate-code cleanup, type fixes.

### Milestone 5: Power User Features ✅
- [x] Issue 17: Configurable Ollama endpoint (replace hardcoded localhost:11434).
- [x] Issue 18: Message search across conversation history.
- [x] Issue 19: Export/import conversations as JSON.
- [x] Issue 20: File/image attachment support (for vision models like llava).

### Milestone 6: CLI and MCP Tools Integration
- [ ] Issue 21: Add ability to use CLI and MCP tools.

## Testing Strategy
- **Unit Tests**: Test API wrappers and state management.
- **Integration Tests**: Test the flow from user input to Ollama response.
- **E2E Tests**: Use Playwright or Spectron to verify UI interactions.
- **Compatibility Tests**: Verify on Windows, Linux, and macOS 10.15.
