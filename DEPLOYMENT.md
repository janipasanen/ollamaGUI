# Ollama GUI - Deployment Guide

## 🚀 Production Deployment Checklist

### Prerequisites
- [ ] Node.js 18+ installed
- [ ] Rust 1.60+ with Tauri 2.0 support
- [ ] Git for version control
- [ ] npm/yarn/pnpm for package management

### Backend Setup

#### 1. Install Dependencies
```bash
# In src-tauri directory
cargo build --release
```

#### 2. Required Dependencies
- `tauri`: ^2.0.0
- `tauri-plugin-opener`: ^2.0.0
- `serde`: ^1.0 with derive feature
- `serde_json`: ^1.0
- `lazy_static`: ^1.4.0
- `reqwest`: ^0.11 with json, stream features
- `tokio`: ^1.0 with full features

#### 3. Configuration
- Review `src-tauri/tauri.conf.json`
- Set appropriate app identifier
- Configure build settings
- Set update settings if needed

### Frontend Setup

#### 1. Install Dependencies
```bash
# In project root
npm install
```

#### 2. Required Dependencies
- `react`: ^18.2.0
- `react-dom`: ^18.2.0
- `@tauri-apps/api`: ^2.0.0
- `react-markdown`: ^9.0.0
- `remark-gfm`: ^4.0.0
- `react-syntax-highlighter`: ^15.5.0
- `vitest`: ^1.0.0 for testing
- `@testing-library/react`: ^14.0.0 for testing

#### 3. Configuration
- Review `vite.config.ts`
- Set base URL if needed
- Configure test settings
- Set build optimization flags

### Building for Production

#### 1. Build Frontend
```bash
npm run build
```

#### 2. Build Backend
```bash
cd src-tauri
cargo build --release
```

#### 3. Create Installers
```bash
cd src-tauri
cargo tauri build
```

### Deployment Platforms

#### Windows
- **Output**: `.msi` installer in `src-tauri/target/release/bundle/msi/`
- **Requirements**: Windows 10+ (10.15+ for macOS-like experience)
- **Signing**: Consider code signing for production

#### macOS
- **Output**: `.app` bundle and `.dmg` in `src-tauri/target/release/bundle/dmg/`
- **Requirements**: macOS 10.15+
- **Build**: Export `MACOSX_DEPLOYMENT_TARGET=10.15` or run `scripts/build-macos-10.15.sh`. The deployment target is also pinned in `src-tauri/.cargo/config.toml`.
- **Notarization**: Required for Gatekeeper approval

#### Linux
- **Output**: `.AppImage` and `.deb` in `src-tauri/target/release/bundle/`
- **Requirements**: Modern glibc (Ubuntu 20.04+, Fedora 33+, etc.)
- **Dependencies**: May require libwebkit2gtk-4.0

### Testing

#### 1. Run Unit Tests
```bash
npm test
```

#### 2. Run E2E Tests
```bash
npm run test:e2e
```

#### 3. Manual Testing
- Test core chat functionality
- Test MCP server management
- Test OAuth authentication
- Test CLI tool execution
- Test responsive design

### Security Checklist

#### 1. CLI Tool Security
- [ ] Review allowlist in `src-tauri/src/lib.rs`
- [ ] Review denylist in `src-tauri/src/lib.rs`
- [ ] Ensure approval callback is working
- [ ] Test command validation

#### 2. OAuth Security
- [ ] Verify token storage security
- [ ] Test OAuth flow in production
- [ ] Review redirect URI handling
- [ ] Check state parameter validation

#### 3. MCP Server Security
- [ ] Review server validation
- [ ] Test connection error handling
- [ ] Verify authentication flows
- [ ] Check tool discovery security

### Performance Optimization

#### 1. Frontend Optimization
- [ ] Enable production mode in Vite
- [ ] Verify memoization is working
- [ ] Check bundle size
- [ ] Optimize image assets

#### 2. Backend Optimization
- [ ] Review Rust release optimizations
- [ ] Check process management
- [ ] Verify memory usage
- [ ] Test concurrent connections

### Monitoring and Logging

#### 1. Error Monitoring
- [ ] Set up error tracking
- [ ] Configure logging levels
- [ ] Test error recovery
- [ ] Verify user feedback

#### 2. Performance Monitoring
- [ ] Monitor initial load time
- [ ] Track message processing time
- [ ] Measure tool execution time
- [ ] Check memory usage

### Updates and Maintenance

#### 1. Update Strategy
- Decide on update mechanism (manual vs auto)
- Configure update server if using auto-updates
- Test update process

#### 2. Version Management
- Follow semantic versioning
- Document breaking changes
- Maintain changelog
- Communicate updates to users

### Troubleshooting

#### Common Issues

**Issue: App won't start**
- Check Rust/Tauri versions
- Verify all dependencies installed
- Check build logs for errors

**Issue: MCP connection fails**
- Verify server URL
- Check network connectivity
- Review server logs
- Test with different transports

**Issue: OAuth authentication fails**
- Verify OAuth configuration
- Check redirect URI
- Test token exchange
- Review auth server logs

**Issue: CLI commands blocked**
- Check allowlist/denylist
- Review approval callback
- Test command validation
- Verify user permissions

### Production Checklist

- [ ] All tests passing
- [ ] Security review completed
- [ ] Performance optimized
- [ ] Error handling verified
- [ ] Documentation updated
- [ ] Backup strategy in place
- [ ] Monitoring configured
- [ ] Update process tested
- [ ] Rollback plan ready

### Post-Deployment

1. **Monitor**: Watch for errors and performance issues
2. **Gather Feedback**: Collect user feedback
3. **Iterate**: Plan next improvements
4. **Document**: Update documentation based on feedback
5. **Maintain**: Regular updates and security patches

## 📚 Additional Resources

### Tauri Documentation
- [Tauri Official Docs](https://tauri.app/v1/guides/)
- [Tauri API Reference](https://tauri.app/v1/api/js/)
- [Tauri Best Practices](https://tauri.app/v1/guides/security/)

### React Documentation
- [React Official Docs](https://react.dev/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [React Performance](https://react.dev/learn/optimizing-performance)

### Security Resources
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [MCP Security Spec](https://github.com/ollama/mcp)
- [OAuth 2.1 Spec](https://datatracker.ietf.org/doc/html/rfc6749)

## 🆘 Support

For issues and questions:
- **GitHub Issues**: [janipasanen/ollamaGUI](https://github.com/janipasanen/ollamaGUI/issues)
- **Documentation**: Check the docs folder
- **Community**: Tauri Discord community

## 📝 Changelog

See `CHANGELOG.md` for detailed version history and release notes.
