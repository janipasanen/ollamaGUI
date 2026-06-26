#!/bin/zsh
# Build helper for macOS 10.15 (Catalina) compatibility.
# Pins the deployment target before invoking the normal Tauri build pipeline.
set -e

export MACOSX_DEPLOYMENT_TARGET=10.15

# Ensure the frontend bundle is built first with the same environment.
npm run build

# Build the Tauri desktop app for the current architecture.
cd "$(dirname "$0")/.."
npm run tauri build
