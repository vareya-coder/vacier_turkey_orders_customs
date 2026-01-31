# ShipHero Token Refresh & Backfill Implementation - COMPLETE ✅

**Implementation Date**: 2026-01-31
**Last Updated**: 2026-02-01 (Redis client fix)
**Status**: Ready for deployment

---

## ⚠️ CRITICAL FIX (2026-02-01): Redis Client Update

**Issue**: The code was using `@vercel/kv` which expected `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables, but Vercel's native Upstash integration provides `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

**Root Cause**: After Vercel deprecated their own KV service, they migrated to native Upstash Redis integration. The `@vercel/kv` package still expected the old variable names, causing the error:
```
@vercel/kv: Missing required environment variables KV_REST_API_URL and KV_REST_API_TOKEN
```

**Solution**:
- Replaced `@vercel/kv` package with native `@upstash/redis` SDK
- Updated `src/lib/shiphero/auth.ts` to use `Redis` client from `@upstash/redis`
- Now properly reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from environment
- All log messages updated: "KV" → "Redis" for clarity

**Files Changed**:
- `package.json`: Replaced `@vercel/kv` with `@upstash/redis`
- `src/lib/shiphero/auth.ts`: Updated Redis client initialization
- `src/lib/env.ts`: Updated comments for Upstash Redis variables

---

## Summary

This implementation fixes the token refresh error and adds manual backfill capability to process orders missed during the outage period (2026-01-29 to present).

### Root Cause Fixed

**Error**: `ShipHeroAuthError: Invalid token response: missing tokens`

**Cause**: Code expected `refresh_token` in the response, but ShipHero's `/auth/refresh` endpoint only returns:
- `access_token`
- `expires_in` (28 days in seconds)
- `scope`
- `token_type`

**Solution**:
1. Fixed `TokenResponse` interface to match actual API response
2. Added Vercel KV persistence to cache tokens across serverless invocations
3. Proper expiry calculation using `expires_in` field (28 days instead of hardcoded 12 hours)

---

## Files Modified

| File | Changes | Description |
|------|---------|-------------|
| `package.json` | Replaced `@vercel/kv` with `@upstash/redis: ^1.36.1` | Native Upstash Redis client for token caching |
| `src/lib/env.ts` | Added 5 env vars | KV config + backfill feature flags |
| `src/lib/config.ts` | Added backfill config | Expose backfill flags to app |
| `src/lib/shiphero/auth.ts` | 131 lines modified | Core token refresh fix + KV integration |
| `src/lib/processor/batch.ts` | Added 33 lines | Backfill date range logic |
| `src/lib/processor/order.ts` | Added 10 lines | Backfill logging |
| `src/lib/shiphero/queries.ts` | Added `$endDate` param | Support date range queries |

**Total**: 11 files, ~210 lines changed

---

## Environment Variables Required

### Production (Vercel Dashboard)

```bash
# ============================================================
# 1. Upstash Redis Configuration (Required for token persistence)
# ============================================================
# These are AUTO-ADDED when you connect Upstash Redis via Vercel Marketplace
# No manual configuration needed - just link the database in Vercel Dashboard
# Note: Vercel also adds UPSTASH_REDIS_REST_READ_ONLY_TOKEN (not used by our app)
UPSTASH_REDIS_REST_URL=https://your-redis-instance.upstash.io  # Auto-added
UPSTASH_REDIS_REST_TOKEN=your-upstash-token-here                # Auto-added

# ============================================================
# 2. Backfill Configuration (For manual backfill mode)
# ============================================================
# STEP 1: PAUSE the cron job first (prevents interference)
FEATURE_CUSTOMS_UPDATE=false

# STEP 2: Configure backfill with FULL ISO datetime format
FEATURE_MANUAL_BACKFILL=true
BACKFILL_START_DATE=2026-01-29T00:00:00Z   # ✅ Must include time + timezone
BACKFILL_END_DATE=2026-01-31T23:59:59Z     # ✅ Must include time + timezone

# STEP 3: Re-enable customs update to run backfill
# (After setting above, change this to true)
# FEATURE_CUSTOMS_UPDATE=true

# STEP 4: After backfill completes, disable it
# FEATURE_MANUAL_BACKFILL=false
# FEATURE_CUSTOMS_UPDATE=true  # Keep true for normal operation
```

### Critical Format Notes

**DateTime Format MUST be ISO 8601 with timezone**:
```bash
# ✅ CORRECT - Full datetime with UTC timezone
BACKFILL_START_DATE=2026-01-29T00:00:00Z
BACKFILL_START_DATE=2026-01-29T14:20:28Z

# ❌ WRONG - Date only (unreliable)
BACKFILL_START_DATE=2026-01-29

# ❌ WRONG - Missing timezone
BACKFILL_START_DATE=2026-01-29 14:20:28
```

**Why**: ShipHero GraphQL API expects `ISODateTime` type, not just dates.

---

## Deployment Steps

### Phase 1: Deploy Token Fix (Without Backfill)

1. **Link Upstash Redis Database**
   - Go to Vercel project → Storage → Connect Database
   - Select "Upstash Redis" from Marketplace (NOT "KV Database")
   - Create new database or link existing one
   - Vercel auto-adds `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` environment variables

2. **Deploy to Production**
   ```bash
   git add -A
   git commit -m "fix(shiphero): resolve token refresh error and add KV persistence

   - Fix TokenResponse interface (remove incorrect refresh_token expectation)
   - Add Vercel KV caching for access tokens (28-day TTL)
   - Parse expires_in field for accurate expiry calculation
   - Add manual backfill mode for processing missed orders
   - Graceful degradation when KV unavailable

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

   git push origin main
   ```

3. **Verify Token Refresh Works**
   - Wait for next cron run (within 10 minutes)
   - Check Axiom logs for: `"Token refreshed and cached in KV"`
   - Verify no more "Invalid token response" errors
   - Next cron run should log: `"Using cached token from KV"`

### Phase 2: Run Manual Backfill (After Token Fix Verified)

**IMPORTANT**: The cron job runs EVERY 10 MINUTES automatically. You MUST pause it during backfill.

#### Step 1: Pause the Cron Job

```bash
# In Vercel Dashboard → Settings → Environment Variables
FEATURE_CUSTOMS_UPDATE=false

# Redeploy (or wait for next deployment)
vercel --prod
```

**What this does**: Cron still runs every 10 minutes but returns immediately without processing orders.

**Verify**: Next cron run should show in Axiom: `"Customs update feature is disabled"`

#### Step 2: Configure Backfill Mode

```bash
# In Vercel Dashboard → Settings → Environment Variables
FEATURE_MANUAL_BACKFILL=true

# CRITICAL: Use full ISO datetime format (not just dates!)
BACKFILL_START_DATE=2026-01-29T00:00:00Z   # Start of Jan 29 UTC
BACKFILL_END_DATE=2026-01-31T23:59:59Z     # End of Jan 31 UTC

# Adjust end date to current date if needed
# Example: BACKFILL_END_DATE=2026-02-01T23:59:59Z
```

#### Step 3: Re-enable Customs Update

```bash
# Now that backfill is configured, enable processing
FEATURE_CUSTOMS_UPDATE=true

# Redeploy
vercel --prod
```

#### Step 4: Trigger Backfill

**Option A: Manual Trigger (Recommended - Immediate execution)**
```bash
# Get your cron secret from Vercel env vars
export CRON_SECRET="your-cron-secret-here"

# Trigger backfill immediately
curl https://your-app.vercel.app/api/cron/customs-update \
  -H "Authorization: Bearer $CRON_SECRET" \
  -v

# Expected response: 200 OK with JSON result
```

**Option B: Wait for Scheduled Cron (Passive - Within 10 minutes)**
- Cron will run automatically
- Less control over timing
- Still works, but manual trigger is faster

**Execution Limits**:
- Max execution time: 5 minutes (Vercel Pro plan)
- If backfill times out, resume by adjusting `BACKFILL_START_DATE` to last processed order

#### Step 5: Monitor Backfill in Axiom

Query:
```
['batch_started', 'order_processing']
| where message contains 'BACKFILL'
| project timestamp, message, orderNumber, orderDate, orderId
| sort by timestamp asc
```

Expected logs:
```
🔄 MANUAL BACKFILL MODE ACTIVE
  backfillStartDate: 2026-01-29T00:00:00Z
  backfillEndDate: 2026-01-31T23:59:59Z
  mode: BACKFILL

🔄 BACKFILL: Processing order
  orderNumber: VAC-12345
  orderDate: 2026-01-29T15:30:00Z
  mode: BACKFILL
  orderId: abc123...
```

#### Step 6: Export Order Numbers for Review

From Axiom logs, export all order numbers processed during backfill:
```
['batch_started']
| where mode == 'BACKFILL' and message contains 'Processing order'
| project orderNumber, orderDate
| summarize orderNumbers = make_list(orderNumber)
```

Save this list to investigate shipped orders with incorrect customs values.

#### Step 7: Handle Timeout (If Backfill Times Out)

If backfill hits 5-minute Vercel timeout:

1. **Find last processed order in Axiom**:
   ```
   ['batch_started']
   | where mode == 'BACKFILL'
   | project orderDate, orderNumber
   | sort by orderDate desc
   | take 1
   ```

2. **Resume from that point**:
   ```bash
   # Example: Last processed was 2026-01-30T15:45:32
   BACKFILL_START_DATE=2026-01-30T15:45:32Z
   BACKFILL_END_DATE=2026-01-31T23:59:59Z  # Keep same end date

   # Redeploy and re-trigger
   vercel --prod
   curl https://your-app.vercel.app/api/cron/customs-update \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

3. **Repeat** until all orders processed

#### Step 8: Disable Backfill, Resume Normal Operation

```bash
# After backfill completes (check Axiom for "batch_completed")
FEATURE_MANUAL_BACKFILL=false

# Optional: Clear date vars (not required, but cleaner)
# BACKFILL_START_DATE=
# BACKFILL_END_DATE=

# KEEP THIS TRUE (normal operation)
FEATURE_CUSTOMS_UPDATE=true

# Redeploy
vercel --prod
```

**Verify normal mode resumed**: Next cron run (within 10 minutes) should show:
```
Normal processing mode
  since: [last 24 hours timestamp]
  mode: NORMAL
```

---

## How Token Persistence Works

### Before (In-Memory Only) ❌

```
Cron Run #1 (00:00)
├─ New ShipHeroAuth instance created
├─ Tokens from env vars → memory
├─ Token refreshed → stored in memory
└─ Function exits → MEMORY CLEARED ❌

Cron Run #2 (00:10)
├─ New instance again
├─ Uses ORIGINAL env tokens (not refreshed)
├─ Token refresh fails (expired)
└─ ERROR: Invalid token response ❌
```

### After (With Upstash Redis) ✅

```
Cron Run #1 (00:00)
├─ Check Redis → empty
├─ Refresh token → get new access_token + expires_in
├─ Store in Redis with 28-day TTL
├─ Log: "Token refreshed and cached in Redis"
└─ Function exits → token PERSISTED in Redis ✅

Cron Run #2 (00:10)
├─ Check Redis → found valid token
├─ Log: "Using cached token from Redis"
└─ Return cached token (no refresh needed) ✅

... (repeat for 28 days)

Cron Run #4032 (28 days later)
├─ Check Redis → expired
├─ Refresh token → new access_token
├─ Store in Redis with new 28-day TTL
└─ Cycle continues ✅
```

**Performance Impact**:
- **Before**: Token refresh every cold start (~4,320 refreshes/month)
- **After**: Token refresh once per 28 days (~1 refresh/month)
- **Improvement**: 99.98% reduction in API calls

---

## Backfill Workflow

```
┌─────────────────────────────────────────────────────┐
│ 1. Deploy token fix to production                  │
│    → Verify no more "Invalid token response" errors│
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 2. PAUSE the cron job                              │
│    Set FEATURE_CUSTOMS_UPDATE=false                 │
│    → Prevents interference during backfill setup    │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 3. Enable backfill mode with datetime range        │
│    FEATURE_MANUAL_BACKFILL=true                      │
│    BACKFILL_START_DATE=2026-01-29T00:00:00Z        │
│    BACKFILL_END_DATE=2026-01-31T23:59:59Z          │
│    FEATURE_CUSTOMS_UPDATE=true (re-enable)          │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 4. Trigger backfill manually                       │
│    curl + Authorization header                      │
│    → Processes orders between start/end             │
│    → Max 5 minutes execution time                   │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 5. Monitor completion in Axiom                     │
│    → Check for "batch_completed"                    │
│    → Export order numbers for review                │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 6. If timeout: Resume from last processed order    │
│    → Adjust BACKFILL_START_DATE                     │
│    → Re-trigger                                     │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 7. Disable backfill, resume normal mode            │
│    FEATURE_MANUAL_BACKFILL=false                     │
│    FEATURE_CUSTOMS_UPDATE=true                      │
│    → Resumes processing last 24h every 10 min       │
└─────────────────────────────────────────────────────┘
```

---

## Verification Checklist

### Token Refresh Fix

- [ ] Upstash Redis database linked to project via Vercel Marketplace
- [ ] `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` auto-added to Vercel env vars
- [ ] Code deployed to production
- [ ] First cron run logs: `"Token refreshed and cached in Redis"`
- [ ] Subsequent cron runs log: `"Using cached token from Redis"`
- [ ] No more "Invalid token response" or "Missing required environment variables" errors
- [ ] Orders fetched successfully
- [ ] Redis keys visible in Upstash dashboard: `shiphero:access_token`, `shiphero:expires_at`

### Backfill Feature

- [ ] Cron paused with `FEATURE_CUSTOMS_UPDATE=false`
- [ ] Backfill mode enabled with correct datetime format
- [ ] Backfill triggered manually or via scheduled cron
- [ ] Axiom logs show `"🔄 MANUAL BACKFILL MODE ACTIVE"`
- [ ] All backfill orders logged with `"🔄 BACKFILL: Processing order"`
- [ ] Order numbers exported from Axiom
- [ ] Backfill completed (or resumed after timeout)
- [ ] Backfill disabled and normal mode resumed
- [ ] Subsequent cron runs show `"Normal processing mode"`

---

## Troubleshooting

### Issue: "Invalid token response" or "Missing required environment variables" still appearing

**Check**:
1. Is Upstash Redis database linked? (Vercel → Storage → Upstash Redis)
2. Are `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` set in Vercel env vars?
3. Check Axiom for "Failed to cache token in Redis" warnings
4. Verify you're using `@upstash/redis` package, NOT `@vercel/kv`

**Solution**: If Redis fails, code falls back to in-memory (less efficient but functional)

### Issue: Cron ran during backfill setup

**Symptom**: Normal processing logs appear while configuring backfill

**Cause**: Didn't pause cron first

**Solution**:
1. Set `FEATURE_CUSTOMS_UPDATE=false` immediately
2. Wait 10 minutes for running cron to complete
3. Verify in Axiom: "Customs update feature is disabled"
4. Then configure backfill

### Issue: Backfill datetime parsing error

**Symptom**: GraphQL error: "Invalid datetime format"

**Cause**: Using date-only format instead of full ISO datetime

**Solution**:
```bash
# ❌ Wrong
BACKFILL_START_DATE=2026-01-29

# ✅ Correct
BACKFILL_START_DATE=2026-01-29T00:00:00Z
```

### Issue: Backfill times out after 5 minutes

**Solution**: Resume from last processed order (see Step 7 above)

### Issue: Concurrent backfill executions

**Symptom**: Multiple "BACKFILL MODE ACTIVE" logs at same time

**Cause**: Manual trigger while scheduled cron also ran

**Prevention**: Always pause cron first (`FEATURE_CUSTOMS_UPDATE=false`)

---

## Rollback Plan

### Pause Everything
```bash
FEATURE_CUSTOMS_UPDATE=false  # Stop all processing
```

### Rollback Backfill Only (Keep Token Fix)
```bash
FEATURE_MANUAL_BACKFILL=false
FEATURE_CUSTOMS_UPDATE=true  # Resume normal processing
```

### Full Rollback (Token Fix + Backfill)
```bash
# 1. Pause
FEATURE_CUSTOMS_UPDATE=false

# 2. Revert code
git revert HEAD
pnpm remove @vercel/kv
git commit -m "revert: rollback token refresh and backfill changes"
git push origin main

# 3. Resume with old code
FEATURE_CUSTOMS_UPDATE=true
```

---

## Success Metrics

### Token Refresh
- ✅ Zero "Invalid token response" errors
- ✅ Token refresh frequency: ~once per 28 days (down from ~every 10 min)
- ✅ Faster cron execution (no refresh delay on most runs)

### Backfill
- ✅ All orders from 2026-01-29 to present processed
- ✅ Order numbers logged and exportable
- ✅ Normal mode resumed automatically
- ✅ No duplicate processing (idempotent via `TR_CUSTOMS_SET` tag)

---

## Next Steps

1. **Phase 1**: Deploy token fix, verify it works for 24 hours
2. **Phase 2**: Run manual backfill to process missed orders
3. **Phase 3**: Review exported order numbers, identify shipped orders
4. **Phase 4**: Void incorrect shipments if needed (separate task)
5. **Phase 5**: Monitor normal operation for 1 week

---

**Implementation Status**: ✅ COMPLETE - Ready for production deployment

**Estimated Deployment Time**:
- Phase 1 (Token Fix): 10 minutes
- Phase 2 (Backfill): 30-60 minutes (depends on order volume)

**Risk Level**: LOW
- Graceful degradation if KV unavailable
- Idempotent processing (won't double-process orders)
- Easy rollback path
- No breaking changes
