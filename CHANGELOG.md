# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
#### M29 — Chat UX & Dialog Accessibility
- Delete-chat confirmation dialog now closes on Escape and on backdrop click.
- Tests covering confirm-delete removal, Escape/backdrop dismissal, and
  scroll-to-bottom click behaviour.

#### M28 — Third analysis pass fixes (#195–#201)
- Wired browser, artifacts, file-tree, and terminal panels into PanelShell.
- Fixed project model bindings, browser preview, checkpoints, and CDP commands.

#### M27 — Agent behavior & context gaps (#189–#194)
- Wired `@`-file mention and `#`-knowledge injection in the composer.
- Wired diff-review callback and diff-review modal.
- Registered terminal and image-diff as agent tools; propagated abort signal.
- Knowledge collection management UI in Settings.

#### M24–M26 — Secret store, remote Ollama, composer wiring (#173–#188)
- Secret store settings UI + secrets service (OS keychain encryption).
- Remote Ollama routing + local/remote model selector UX.
- Project model bindings, browser preview, checkpoints, CDP commands.

#### M20–M23 — Workspace, broken contracts, autonomy, MLX (#82–#91, #146)
- Filesystem commands, diff review, `@`-mention, workspace state, streaming terminal.
- Git integration panel. Agent autonomy & safety (Plan/Ask/Auto, guardrails).
- MLX re-check + model UX gaps.

#### M18 — Multi-format file editing (#138–#145)
- Office + ODF read/create/edit (xlsx→csv, xlsx cell-edit, ods read).
- PDF create/extract/merge/split via lopdf.
- Document artifacts panel + LibreOffice onboarding.

#### M14 — Knowledge, RAG & web grounding (#117–#122)
- Knowledge collections + hybrid BM25 + vector RAG pipeline.
- Web fetch/search, `#` context command, inline citations/sources.

#### M13 — MCP integrations & connectors (#112–#116)
- MCP connector catalog + transport headers + reference deployment.
- Connector: Filesystem MCP server (directory picker + quoted-path verification).

#### M12 — MCP bridge & sub-agents (#102, #104)
- MCP bridge service and sub-agent orchestration.

#### Chat & model parity (M11 + assorted #123–#148)
- Rich rendering: Mermaid diagrams + LaTeX math in messages (#135).
- Appearance settings: light/dark/system + accent + density (#136).
- Temporary/incognito chat (#134); thumbs feedback + message queue (#137).
- Chat organization: folders, tags, pin, archive (#133).
- Structured output via Ollama format (JSON / JSON Schema) (#148).
- Hardware-aware model fit indicator (#147); model presets + modelfile builder (#124, #125).
- OpenAI-compatible / LM Studio endpoints (#123); many-models fan-out (#126).
- OpenAPI tool servers (#129); custom Tools & Functions framework (#127).
- Local image generation (A1111/ComfyUI/DALL-E) (#130); in-app Python via Pyodide (#128).
- Speech-to-text via whisper.cpp (#131); hands-free voice call mode (#132).

### Changed
- Enhanced error handling, memoization, input validation throughout.
- Cross-platform build pipeline (CI for Linux, Windows, macOS).
- macOS 10.15 compatibility branch + binary-size budget spike.

### Fixed
- Agent infinite-loop guard, MCP transport flakiness, accessibility, edge cases.
- White-screen mount/CSP fixes; Tailwind v4 import; native window title-bar theme sync.
- Remote Ollama routing; model control width; image attachment MIME type (PNG/GIF/WebP).

## [0.1.0] - 2026-06-10

### Added
- Initial Ollama GUI implementation
- Basic chat functionality
- Model management
- Session management
- Markdown rendering with syntax highlighting
- Image attachments
- Responsive design
- Theme support (light/dark mode)
- Keyboard shortcuts

### Changed
- Upgraded to Tauri 2.0
- Improved code organization
- Enhanced TypeScript type safety
- Added comprehensive testing

### Fixed
- Fixed initial build issues
- Resolved responsive design problems
- Improved error handling
- Fixed memory leaks

## [0.0.1] - 2026-06-01

### Added
- Initial project setup
- Basic Tauri configuration
- React frontend skeleton
- Vite build system
- Initial test setup

[Unreleased]: https://github.com/janipasanen/ollamaGUI/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/janipasanen/ollamaGUI/releases/tag/v0.1.0
[0.0.1]: https://github.com/janipasanen/ollamaGUI/releases/tag/v0.0.1
