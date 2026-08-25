#!/bin/bash

# Build script for Ollama GUI with macOS 10.15 compatibility
# Set minimum deployment target to Catalina (macOS 10.15)

export MACOSX_DEPLOYMENT_TARGET=10.15

cd /Users/jani/Documents/Developer/AI/ollamaGUI

echo "=== Building Tauri app with macOS 10.15 compatibility ==="
echo "MACOSX_DEPLOYMENT_TARGET=$MACOSX_DEPLOYMENT_TARGET"

# Clean previous builds
rm -rf src-tauri/target/release/bundle
rm -rf dist

# Build frontend
echo "Building frontend..."
npm run build

# Build Rust backend with deployment target
echo "Building Rust backend..."
cd src-tauri
cargo build --release

# Bundle app
echo "Bundling app..."
cd ..
npx tauri build

echo "=== Build complete! ==="
echo "App bundle available at:"
find src-tauri/target/release/bundle -name "*.dmg" -o -name "*.app" 2>/dev/null
