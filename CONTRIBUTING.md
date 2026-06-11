# Contributing to Ollama GUI

## 🤝 How to Contribute

We welcome contributions from the community! Here's how you can help:

### 📝 Reporting Issues

Found a bug or have a feature request? Please [open an issue](https://github.com/janipasanen/ollamaGUI/issues) with:
- Clear description of the problem
- Steps to reproduce (for bugs)
- Screenshots if applicable

### 🔧 Developing

#### Prerequisites
- Node.js 18+
- Rust 1.60+
- npm/yarn/pnpm

#### Setup
```bash
# Install dependencies
npm install

# Build for development
npm run dev

# Build for production
npm run build
```

#### Code Style
- Follow existing patterns
- Use TypeScript for type safety
- Add tests for new features
- Document public APIs

### 🧪 Testing

Run tests with:
```bash
npm test
```

### 📦 Releasing

1. Update `CHANGELOG.md`
2. Create a GitHub release
3. Update version in `package.json`

## 🎉 Code of Conduct

Be respectful and inclusive. Follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
