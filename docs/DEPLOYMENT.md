# OTPLUS Deployment Guide

This document covers the build, release, and deployment process for the OTPLUS Clockify addon.

## Prerequisites

- Node.js 20.x or later
- npm 9.x or later
- Git with push access to the repository

## Build Process

### Development Build

For local development with source maps and no minification:

```bash
npm run build:dev
```

This creates unminified bundles in `dist/` with source maps for debugging.

### Production Build

For production deployment with minification:

```bash
npm run build:prod
```

This creates optimized bundles in `dist/`:
- `app.bundle.js` - Minified application bundle
- `calc.worker.js` - Minified Web Worker
- `index.html` - HTML with injected version
- `css/` - Stylesheets
- `manifest.json` - Addon manifest with version

## Pre-Release Checklist

Before releasing, ensure:

1. **All tests pass**
   ```bash
   npm test
   ```

2. **E2E tests pass**
   ```bash
   npm run test:e2e
   ```

2. **Type checking passes**
   ```bash
   npm run typecheck
   ```

3. **Linting passes**
   ```bash
   npm run lint
   ```

4. **Build succeeds**
   ```bash
   npm run build:prod
   ```

5. **No uncommitted changes**
   ```bash
   git status
   ```

## Release Process

### Automated Release

Use the release script for a streamlined process:

```bash
# Patch release (1.0.0 → 1.0.1)
npm run release

# Minor release (1.0.0 → 1.1.0)
npm run release minor

# Major release (1.0.0 → 2.0.0)
npm run release major
```

The script will:
1. Bump version in `package.json` and `manifest.json`
2. Update `CHANGELOG.md` with commit history
3. Run all quality checks (tests, lint, typecheck)
4. Build production assets
5. Create git commit and tag
6. Generate ZIP artifact

### Manual Release

If you need more control:

1. **Update version**
   ```bash
   npm version patch  # or minor/major
   ```

2. **Build**
   ```bash
   npm run build:prod
   ```

3. **Create ZIP**
   ```bash
   cd dist && zip -r ../otplus-vX.Y.Z.zip .
   ```

4. **Tag release**
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   ```

5. **Push**
   ```bash
   git push && git push --tags
   ```

## Deployment to Clockify

### Marketplace Deployment

1. Log in to the Clockify Developer Portal
2. Navigate to your addon management page
3. Upload the generated ZIP file (`otplus-vX.Y.Z.zip`)
4. Fill in release notes from `CHANGELOG.md`
5. Submit for review (if required)

### Self-Hosted Deployment

For self-hosted installations:

1. Extract `dist/` contents to your web server
2. Ensure HTTPS is configured
3. Update CSP headers if using custom domain
4. Register the addon URL in Clockify workspace settings

## Environment Configuration

### Build-Time Configuration

The build process injects configuration via `build.js`:

- `VERSION` - From `package.json`
- `DEBUG` - Set via environment variable

### Runtime Configuration

Users configure the addon through:

- URL parameters (`auth_token`, `workspace_id`)
- In-app settings panel (persisted to localStorage)

## Continuous Integration

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push and PR:

1. **Lint** - ESLint with security rules
2. **Type Check** - TypeScript compilation
3. **Test** - Jest with coverage enforcement
4. **Build** - Production build verification
5. **Mutation Testing** - Runs nightly or manually (not on every PR)

Artifacts are uploaded for successful builds on `main` branch.

## Rollback Procedure

If a release has issues:

1. **Revert to previous version**
   ```bash
   git checkout vX.Y.Z-1  # Previous version tag
   npm run build:prod
   ```

2. **Upload hotfix** to Clockify Marketplace

3. **Investigate and fix** the issue in a new branch

## Security Considerations

- Never commit API tokens or secrets
- Keep dependencies updated (`npm audit`)
- Review CSP headers before deployment
- Test with production-like data volumes

## Troubleshooting

### Build Fails

- Clear `node_modules` and reinstall: `rm -rf node_modules && npm ci`
- Check Node.js version: `node --version` (should be 20.x+)

### Tests Fail

- Run in verbose mode: `npm test -- --verbose`
- Check for flaky tests: `npm test -- --runInBand`
- E2E artifacts are written to `playwright-report/` and `test-results/` (ignored in git)

### Worker Doesn't Load

- Check browser console for CSP violations
- Verify `calc.worker.js` is served with correct MIME type
- Test fallback by disabling Web Workers in browser

## Support

For deployment issues:
- Check existing issues on GitHub
- Review `docs/guide.md` for operational details
- Open a new issue with build/deployment logs
