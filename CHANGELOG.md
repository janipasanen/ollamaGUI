# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive MCP infrastructure (stdio + HTTP transports)
- OAuth 2.0 + PKCE authentication for MCP servers
- MCP server management UI with connection functionality
- CLI tool integration with security approval system
- Comprehensive test suite (40+ tests)
- Complete documentation for all features

### Changed
- Enhanced error handling throughout the application
- Improved user experience with better error messages
- Optimized performance with memoization
- Stabilized flaky tests with timeout protection
- Added input validation for edge cases

### Fixed
- Fixed potential infinite loops in agentic chat
- Resolved MCP transport test flakiness
- Improved error message clarity
- Added edge case validation
- Enhanced accessibility features

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
