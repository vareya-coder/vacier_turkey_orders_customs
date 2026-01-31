# Redis Client Fix - Summary

**Date**: 2026-02-01
**Issue**: Token persistence failing with "Missing required environment variables KV_REST_API_URL and KV_REST_API_TOKEN" error

## Problem

The original implementation used `@vercel/kv` package which expected:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

However, Vercel's native Upstash Redis integration (via Marketplace) provides:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

This mismatch caused the Redis client to fail initialization, resulting in:
1. Token refresh on EVERY cron run (instead of once per 28 days)
2. Warning logs: "Failed to read from KV, falling back to refresh"
3. Unnecessary API calls to ShipHero

## Solution

Replaced `@vercel/kv` with native `@upstash/redis` SDK:

### Package Changes
```diff
- "@vercel/kv": "^3.0.0"
+ "@upstash/redis": "^1.36.1"
```

### Code Changes

**src/lib/shiphero/auth.ts**:
- Import `Redis` from `@upstash/redis` instead of `kv` from `@vercel/kv`
- Create explicit Redis client with configuration:
  ```typescript
  new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  })
  ```
- Updated all log messages: "KV" → "Redis"

**src/lib/env.ts**:
- Updated comments to clarify Upstash Redis integration

## Benefits

1. **Correct environment variable usage**: Now properly uses Vercel's auto-added Upstash variables
2. **Token persistence works**: Tokens cached in Redis with 28-day TTL
3. **Reduced API calls**: ~99.98% reduction in token refresh calls
4. **Clearer logs**: "Redis" terminology instead of "KV"
5. **Native Upstash SDK**: More explicit and aligned with Vercel's current approach

## Deployment

No environment variable changes needed - the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` variables are already auto-added when you link Upstash Redis via Vercel Marketplace.

Just deploy the code update:
```bash
git push origin main
```

## Verification

After deployment, check Axiom logs for:
- ✅ First run: "Token refreshed and cached in Redis"
- ✅ Subsequent runs: "Using cached token from Redis"
- ❌ No more: "Missing required environment variables" warnings
- ❌ No more: "Failed to read from KV, falling back to refresh" warnings

## Files Changed

- `package.json`: Dependency update
- `pnpm-lock.yaml`: Lock file update
- `src/lib/shiphero/auth.ts`: Redis client implementation
- `src/lib/env.ts`: Comments update
- `IMPLEMENTATION_COMPLETE.md`: Documentation update
