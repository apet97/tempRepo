# Changelog

All notable changes to OTPLUS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- TypeScript support with full type definitions
- ESLint with security-focused rules
- Prettier for consistent code formatting
- esbuild for fast, modern bundling
- Web Worker for offloading calculations
- Detailed table pagination for large datasets
- Logger module with configurable log levels
- Content Security Policy (CSP) headers
- "Clear All Data" privacy feature
- CI/CD workflow with GitHub Actions
- Performance benchmarks
- Comprehensive integration tests

### Changed
- Migrated all JavaScript files to TypeScript
- Split `ui.js` into modular sub-components
- Improved build process with production optimizations
- Enhanced error handling and diagnostics

### Security
- Added CSP meta tag to prevent XSS attacks
- Implemented structured logging to prevent sensitive data leaks
- Enhanced CSV export formula injection protection

## [2.0.0] - 2024-01-15

### Added
- Profile-based capacity tracking per user
- Holiday integration with Clockify calendar
- Time-off request integration
- Billable/non-billable hour breakdown
- Tiered overtime multipliers (Tier 2 support)
- User overrides for capacity and multipliers
- Per-day override mode for granular control
- Summary grouping by user/project/client/task/date/week
- Decimal time display option
- Amount display modes (earned/cost/profit)
- Export to CSV with formula injection protection

### Changed
- Complete rewrite with modular architecture
- Improved API rate limiting and retry logic
- Enhanced error handling with user-friendly messages
- Optimized rendering for large datasets

### Fixed
- Timezone handling for date calculations
- Midnight-spanning entry attribution
- Break and PTO entry classification

## [1.0.0] - 2023-06-01

### Added
- Initial release
- Basic overtime calculation
- Simple CSV export
- Date range selection
