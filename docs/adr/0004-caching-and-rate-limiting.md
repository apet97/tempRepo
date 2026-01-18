# 0004. Caching and rate limiting strategy

Date: 2026-01-18

## Status
Proposed

## Context
Large workspaces (100+ members) need fast report generation. Clockify API calls have rate limits.
We also need graceful behavior on partial failures and a way to retry failed fetches.

## Decision
Rate limiting:
- Implement a request scheduler enforcing addon limits when using X-Addon-Token.
- On HTTP 429: exponential backoff + jitter and retry up to a capped maximum.

Caching:
- Cache profiles, holidays (and time off, when enabled) in localStorage, workspace-scoped.
- Use TTL (time-based) and versioned cache keys.
- Cache only what’s required for computation; avoid storing large raw payloads when possible.

Fetching strategy:
- Batch fetches per dataset (users/profiles/holidays/time entries).
- Support cancellation via AbortController.
- Track per-dataset errors and enable “Retry failed fetches” without rerunning all steps.

## Consequences
- Significant speedup for repeated reporting.
- Lower risk of 429s and better recovery when they occur.
- Requires careful cache invalidation/versioning discipline.
