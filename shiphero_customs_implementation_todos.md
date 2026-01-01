# ShipHero Customs Value Update - Implementation Plan for Claude Code

## Project Summary

**Client:** Vareya BV (3PL) → Customer: Vacier  
**Goal:** Update `customs_value` on Turkey-bound orders to total ≤€25 before shipment  
**Order Volume:** 50-300 Vacier orders/day, ~10-15% to Turkey (5-45 orders/day)  
**Processing Window:** Orders arrive 24/7  

---

## Key Clarifications Applied

| Item | Decision |
|------|----------|
| **Order Status Filter** | `fulfillment_status: "Vacier"` (custom status), with feature flag for `"Unfulfilled"` |
| **Queue Processing** | Phase 2 - NOT in initial implementation |
| **Database** | Vercel Postgres + Drizzle ORM (for batch runs only, not order caching) |
| **Order ID Caching** | Not needed - use tagging + idempotent processing |
| **Idempotency** | Check tag `TR_CUSTOMS_SET` before processing |
| **Failure Handling** | Resilient design, acceptable to retry on next cron interval |

---

## Architecture (Phase 1 - Without Queue)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PHASE 1: SIMPLE CRON ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Vercel Cron (Every 5 minutes)                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  /api/cron/customs-update                                         │ │
│  │                                                                   │ │
│  │  1. Check feature flags (enabled? dry-run?)                      │ │
│  │  2. Log batch start to Axiom                                     │ │
│  │  3. Query ShipHero orders:                                       │ │
│  │     - customer_account_id = VACIER_ID                            │ │
│  │     - fulfillment_status = "Vacier" (or "Unfulfilled" via flag)  │ │
│  │     - order_date_from = START_DATE                               │ │
│  │  4. For each order (with pagination):                            │ │
│  │     a. Check: shipping_address.country === "TR"                  │ │
│  │     b. Check: !tags.includes("TR_CUSTOMS_SET")                   │ │
│  │     c. Check: has billable line items (price > 0)                │ │
│  │     d. Calculate customs distribution (≤€25 total)               │ │
│  │     e. Update line items customs_value                           │ │
│  │     f. Add tag "TR_CUSTOMS_SET"                                  │ │
│  │     g. Log success                                               │ │
│  │  5. Handle quota limits (wait if needed, or stop gracefully)     │ │
│  │  6. Log batch completion to Axiom                                │ │
│  │  7. Save batch run to Vercel Postgres                            │ │
│  │  8. Send notification if errors occurred                         │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Claude Code Model Selection Guide

| Model | Best For | Cost | Use In This Project |
|-------|----------|------|---------------------|
| **Opus** | Complex architecture, debugging, research | High | Research phases, complex logic |
| **Sonnet** | Implementation, code generation, testing | Medium | Most implementation work |
| **Haiku** | Simple tasks, formatting, small fixes | Low | Quick fixes, formatting |

---

## Implementation ToDos

### TODO 1: Project Setup & Configuration
**Model:** Sonnet  
**Estimated Time:** 30-45 minutes  
**PR:** Yes - "feat: initial project setup"

#### Research
- Verify Next.js 14 App Router best practices
- Confirm Vercel Postgres + Drizzle setup steps
- Review Axiom Next.js integration docs

#### Plan
1. Initialize Next.js 14 project with TypeScript
2. Configure ESLint, Prettier
3. Set up folder structure
4. Create environment variable schema
5. Install core dependencies

#### Implement
```bash
# Dependencies to install
next@14
typescript
@types/node
@types/react
drizzle-orm
@vercel/postgres
@axiomhq/nextjs
date-fns
date-fns-tz
zod  # For env validation
```

#### Files to Create
- `package.json` - Dependencies
- `tsconfig.json` - TypeScript config
- `.env.local.example` - Environment template
- `src/lib/env.ts` - Environment validation with Zod
- `src/lib/config.ts` - Feature flags and config
- `drizzle.config.ts` - Drizzle configuration
- `README.md` - Project documentation

#### Human Validation Checklist
- [ ] `npm run dev` starts without errors
- [ ] TypeScript compilation passes
- [ ] Environment validation works (test with missing vars)
- [ ] Folder structure matches plan

---

### TODO 2: Database Schema & Drizzle Setup
**Model:** Sonnet  
**Estimated Time:** 20-30 minutes  
**PR:** Yes - "feat: database schema and drizzle setup"

#### Research
- Vercel Postgres connection pooling
- Drizzle migration workflow

#### Plan
1. Define batch_runs table schema
2. Create Drizzle client
3. Generate migrations
4. Test database connection

#### Implement
```typescript
// Schema for batch_runs table
{
  id: serial primary key,
  batch_id: varchar(50) unique,
  started_at: timestamp with timezone,
  completed_at: timestamp with timezone,
  orders_queried: integer,
  orders_processed: integer,
  orders_skipped: integer,
  errors_count: integer,
  error_details: jsonb,
  credits_used: integer,
  status: varchar(20), // 'running' | 'completed' | 'failed'
}
```

#### Files to Create/Modify
- `src/lib/db/schema.ts` - Drizzle schema
- `src/lib/db/client.ts` - Database client
- `drizzle/migrations/` - Migration files

#### Human Validation Checklist
- [ ] Can connect to Vercel Postgres locally
- [ ] Migration runs successfully
- [ ] Can insert/read batch_runs record
- [ ] Schema matches requirements

---

### TODO 3: Axiom Logging Setup
**Model:** Sonnet  
**Estimated Time:** 20-30 minutes  
**PR:** Yes - "feat: axiom logging integration"

#### Research
- @axiomhq/nextjs latest API
- Structured logging best practices
- Log levels for different events

#### Plan
1. Configure Axiom client
2. Create logger factory with context
3. Define log event types
4. Test logging to Axiom

#### Implement
```typescript
// Log events to implement
type LogEvent = 
  | 'batch_started'
  | 'orders_queried'
  | 'order_processing'
  | 'order_skipped'
  | 'customs_calculated'
  | 'line_items_updated'
  | 'order_tagged'
  | 'order_completed'
  | 'quota_warning'
  | 'batch_completed'
  | 'batch_error';
```

#### Files to Create/Modify
- `src/lib/logging/axiom.ts` - Axiom setup
- `src/lib/logging/types.ts` - Log event types
- `next.config.js` - withAxiom wrapper

#### Human Validation Checklist
- [ ] Logs appear in Axiom dashboard
- [ ] Structured data is searchable
- [ ] Log levels work correctly (debug, info, warn, error)
- [ ] Batch context (batchId) included in all logs

---

### TODO 4: ShipHero API Client - Authentication
**Model:** Sonnet  
**Estimated Time:** 30-40 minutes  
**PR:** Yes - "feat: shiphero api client with auth"

#### Research
- ShipHero token refresh mechanism
- GraphQL client options (graphql-request vs urql vs fetch)
- Error handling patterns

#### Plan
1. Create ShipHero auth manager
2. Implement token refresh logic
3. Create base GraphQL client
4. Add request/response logging

#### Implement
```typescript
// Auth manager interface
interface ShipHeroAuth {
  getValidToken(): Promise<string>;
  refreshToken(): Promise<void>;
  isTokenExpired(): boolean;
}

// Client should handle:
// - Automatic token refresh on 401
// - Request logging (without sensitive data)
// - Error code mapping
```

#### Files to Create
- `src/lib/shiphero/auth.ts` - Token management
- `src/lib/shiphero/client.ts` - GraphQL client
- `src/lib/shiphero/errors.ts` - Error types

#### Human Validation Checklist
- [ ] Can authenticate with ShipHero API
- [ ] Token refresh works when token expires
- [ ] API errors are properly caught and typed
- [ ] No tokens logged to console/Axiom

---

### TODO 5: ShipHero API Client - Queries & Types
**Model:** Sonnet  
**Estimated Time:** 40-50 minutes  
**PR:** Yes - "feat: shiphero graphql queries and types"

#### Research
- ShipHero GraphQL schema for orders
- Pagination (cursor-based) patterns
- TypeScript type generation options

#### Plan
1. Define TypeScript types for orders, line items
2. Implement orders query with filters
3. Implement pagination helper
4. Add query complexity estimation

#### Implement
```graphql
# Main query to implement
query GetVacierOrders($cursor: String, $status: String!, $startDate: ISODateTime!, $customerId: String!) {
  orders(
    first: 25
    after: $cursor
    customer_account_id: $customerId
    fulfillment_status: $status
    order_date_from: $startDate
  ) {
    request_id
    complexity
    data {
      pageInfo { hasNextPage, endCursor }
      edges {
        node {
          id
          order_number
          tags
          shipping_address { country }
          line_items(first: 20) {
            edges {
              node {
                id, sku, product_name, price, quantity, customs_value
              }
            }
          }
        }
      }
    }
  }
}
```

#### Files to Create
- `src/lib/shiphero/types.ts` - TypeScript types
- `src/lib/shiphero/queries.ts` - GraphQL queries
- `src/lib/shiphero/orders.ts` - Order fetching with pagination

#### Human Validation Checklist
- [ ] Types match ShipHero API response
- [ ] Pagination works correctly (fetch all pages)
- [ ] Filters applied correctly (status, customer_id, date)
- [ ] Complexity is tracked for quota management

---

### TODO 6: ShipHero API Client - Mutations
**Model:** Sonnet  
**Estimated Time:** 30-40 minutes  
**PR:** Yes - "feat: shiphero mutations for line items and tags"

#### Research
- order_update_line_items mutation schema
- order_add_tags mutation schema
- Mutation error handling

#### Plan
1. Implement line items update mutation
2. Implement add tags mutation
3. Add mutation result validation
4. Create combined "process order" function

#### Implement
```typescript
// Mutations to implement
async function updateLineItemsCustomsValue(
  orderId: string, 
  lineItems: { id: string; customs_value: string }[]
): Promise<MutationResult>;

async function addOrderTag(
  orderId: string, 
  tag: string
): Promise<MutationResult>;
```

#### Files to Create/Modify
- `src/lib/shiphero/mutations.ts` - GraphQL mutations
- `src/lib/shiphero/types.ts` - Add mutation types

#### Human Validation Checklist
- [ ] Can update customs_value on test order
- [ ] Can add tag to test order
- [ ] Mutations are idempotent (running twice doesn't error)
- [ ] Errors are properly caught and typed

---

### TODO 7: Quota Manager
**Model:** Sonnet  
**Estimated Time:** 25-35 minutes  
**PR:** Yes - "feat: shiphero api quota manager"

#### Research
- ShipHero quota response headers
- Credit calculation formula
- Throttling error codes

#### Plan
1. Create quota tracking class
2. Implement credit estimation
3. Add wait-for-credits logic
4. Integrate with client

#### Implement
```typescript
interface QuotaManager {
  // Track credits from API responses
  updateFromResponse(complexity: number, remaining?: number): void;
  
  // Check if we have enough credits
  canProceed(estimatedCost: number): { ok: boolean; waitMs?: number };
  
  // Get current status
  getStatus(): { remaining: number; replenishRate: number };
}

// Constants
const MAX_CREDITS = 4004;
const REPLENISH_RATE = 60; // per second
```

#### Files to Create
- `src/lib/shiphero/quota.ts` - Quota manager

#### Human Validation Checklist
- [ ] Credits tracked correctly after API calls
- [ ] Wait time calculated correctly
- [ ] Graceful handling when quota exhausted
- [ ] Logging of quota warnings

---

### TODO 8: Customs Value Distributor
**Model:** Opus (complex logic)  
**Estimated Time:** 40-50 minutes  
**PR:** Yes - "feat: smart customs value distribution"

#### Research
- Natural-looking value distribution algorithms
- Edge cases (single item, all free items, many items)

#### Plan
1. Design distribution algorithm
2. Handle edge cases
3. Ensure total ≤ €25
4. Add randomization for natural appearance
5. Write comprehensive unit tests

#### Implement
```typescript
interface LineItemInput {
  id: string;
  sku: string;
  price: string;  // "89.00"
  quantity: number;
}

interface CustomsDistribution {
  lineItemId: string;
  newCustomsValue: string;  // "7.50"
  isComplimentary: boolean;
}

function distributeCustomsValues(
  lineItems: LineItemInput[],
  maxTotal: number = 25.00
): CustomsDistribution[];

// Rules:
// 1. Zero-price items get €0.00
// 2. Total customs ≤ maxTotal
// 3. Values randomized (look natural)
// 4. Min €0.50 per billable item
// 5. Max €8.00 per item
```

#### Files to Create
- `src/lib/customs/distributor.ts` - Distribution logic
- `src/lib/customs/distributor.test.ts` - Unit tests

#### Human Validation Checklist
- [ ] Total never exceeds €25
- [ ] Zero-price items get €0.00
- [ ] Values look natural (not all same)
- [ ] Edge cases handled (1 item, 10 items, all free)
- [ ] All unit tests pass

---

### TODO 9: Feature Flags & Configuration
**Model:** Haiku  
**Estimated Time:** 15-20 minutes  
**PR:** Combine with TODO 10

#### Plan
1. Define all feature flags
2. Create typed config object
3. Add runtime validation

#### Implement
```typescript
const features = {
  // Core
  ENABLE_CUSTOMS_UPDATE: boolean,
  ENABLE_ORDER_TAGGING: boolean,
  
  // Status filters
  ENABLE_VACIER_STATUS: boolean,      // "Vacier" status
  ENABLE_UNFULFILLED_STATUS: boolean, // "Unfulfilled" status
  
  // Notifications
  ENABLE_ERROR_NOTIFICATIONS: boolean,
  ENABLE_SUCCESS_NOTIFICATIONS: boolean,
  
  // Safety
  DRY_RUN_MODE: boolean,  // Log but don't mutate
};
```

#### Files to Modify
- `src/lib/config.ts` - Add feature flags

#### Human Validation Checklist
- [ ] All flags read from environment
- [ ] Defaults are safe (disabled)
- [ ] DRY_RUN prevents mutations

---

### TODO 10: Timezone Utilities
**Model:** Haiku  
**Estimated Time:** 10-15 minutes  
**PR:** Yes - "feat: feature flags and timezone utilities"

#### Plan
1. Create Europe/Amsterdam timezone helpers
2. Format functions for logs
3. Date comparison utilities

#### Implement
```typescript
const TIMEZONE = 'Europe/Amsterdam';

function getNow(): Date;
function formatForLog(date: Date): string;
function isAfterStartDate(orderDate: string): boolean;
```

#### Files to Create
- `src/lib/utils/timezone.ts` - Timezone utilities

#### Human Validation Checklist
- [ ] Dates formatted in CET/CEST
- [ ] Start date comparison works correctly
- [ ] Logs show European time

---

### TODO 11: Main Cron Handler
**Model:** Opus (orchestration logic)  
**Estimated Time:** 60-90 minutes  
**PR:** Yes - "feat: main cron handler for customs update"

#### Research
- Vercel cron best practices
- Error recovery patterns
- Idempotency strategies

#### Plan
1. Create API route structure
2. Implement main processing loop
3. Add error handling and recovery
4. Integrate all components
5. Add batch run logging

#### Implement
```typescript
// /api/cron/customs-update/route.ts

export async function GET(request: Request) {
  // 1. Verify cron secret
  // 2. Check feature flags
  // 3. Start batch, log to Axiom
  // 4. Query orders with pagination
  // 5. For each order:
  //    - Filter (country, tag, billable items)
  //    - Calculate customs values
  //    - Update line items (if not dry-run)
  //    - Add tag (if not dry-run)
  //    - Log result
  // 6. Handle quota limits
  // 7. Save batch run to DB
  // 8. Send notifications if needed
  // 9. Return summary
}
```

#### Files to Create
- `src/app/api/cron/customs-update/route.ts` - Main handler
- `src/lib/processor/batch.ts` - Batch processing logic
- `src/lib/processor/order.ts` - Single order processing

#### Human Validation Checklist
- [ ] Cron executes on schedule
- [ ] Only Turkey orders processed
- [ ] Tagged orders skipped (idempotent)
- [ ] Batch run saved to database
- [ ] Errors logged and notified
- [ ] DRY_RUN mode works correctly

---

### TODO 12: Email Notifications (Resend)
**Model:** Sonnet  
**Estimated Time:** 25-35 minutes  
**PR:** Yes - "feat: email notifications via resend"

#### Research
- Resend API for Next.js
- Email template best practices

#### Plan
1. Set up Resend client
2. Create error notification template
3. Create success summary template
4. Add feature flag control

#### Implement
```typescript
async function sendErrorNotification(params: {
  orderId?: string;
  orderNumber?: string;
  error: Error;
  batchId: string;
}): Promise<void>;

async function sendSuccessSummary(params: {
  batchId: string;
  processed: number;
  skipped: number;
  errors: number;
}): Promise<void>;
```

#### Files to Create
- `src/lib/notifications/resend.ts` - Resend client
- `src/lib/notifications/templates.ts` - Email templates

#### Human Validation Checklist
- [ ] Error emails received at ae@vareya.nl
- [ ] Success summaries received (when enabled)
- [ ] Emails contain useful information
- [ ] Feature flags control sending

---

### TODO 13: Vercel Configuration & Deployment
**Model:** Sonnet  
**Estimated Time:** 30-40 minutes  
**PR:** Yes - "feat: vercel deployment configuration"

#### Plan
1. Create vercel.json with cron config
2. Document environment variables
3. Set up preview vs production config
4. Deploy and verify

#### Implement
```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/customs-update",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

#### Files to Create/Modify
- `vercel.json` - Vercel configuration
- `.env.local.example` - Updated with all variables
- `README.md` - Deployment instructions

#### Human Validation Checklist
- [ ] Deploys successfully to Vercel
- [ ] Environment variables configured
- [ ] Cron job appears in Vercel dashboard
- [ ] Health endpoint accessible

---

### TODO 14: Integration Testing
**Model:** Sonnet  
**Estimated Time:** 45-60 minutes  
**PR:** Yes - "test: integration tests for customs update"

#### Plan
1. Create test utilities
2. Write integration tests
3. Test with real ShipHero API (test orders)
4. Document test procedures

#### Implement
```typescript
// Tests to write:
describe('Customs Update Integration', () => {
  it('should skip non-Turkey orders');
  it('should skip already-tagged orders');
  it('should skip orders with only free items');
  it('should update customs values correctly');
  it('should add tag after processing');
  it('should handle quota limits gracefully');
  it('should be idempotent on retry');
});
```

#### Files to Create
- `src/__tests__/integration/customs-update.test.ts`
- `src/__tests__/utils/test-helpers.ts`

#### Human Validation Checklist
- [ ] All integration tests pass
- [ ] Tests run against real API (sandbox/test orders)
- [ ] Idempotency verified
- [ ] Quota handling verified

---

### TODO 15: Documentation & Handover
**Model:** Haiku  
**Estimated Time:** 30-40 minutes  
**PR:** Yes - "docs: operational documentation"

#### Plan
1. Complete README with setup instructions
2. Document environment variables
3. Create runbook for operations
4. Document monitoring and alerts

#### Files to Create/Modify
- `README.md` - Complete documentation
- `docs/RUNBOOK.md` - Operational procedures
- `docs/MONITORING.md` - Axiom dashboard setup

#### Human Validation Checklist
- [ ] New developer can set up project from README
- [ ] Runbook covers common scenarios
- [ ] Monitoring documentation complete

---

## Pull Request Schedule

| PR # | TODO(s) | Description | When |
|------|---------|-------------|------|
| 1 | TODO 1 | Initial project setup | After TODO 1 validation |
| 2 | TODO 2 | Database schema | After TODO 2 validation |
| 3 | TODO 3 | Axiom logging | After TODO 3 validation |
| 4 | TODO 4 | ShipHero auth | After TODO 4 validation |
| 5 | TODO 5 | ShipHero queries | After TODO 5 validation |
| 6 | TODO 6 | ShipHero mutations | After TODO 6 validation |
| 7 | TODO 7 | Quota manager | After TODO 7 validation |
| 8 | TODO 8 | Customs distributor | After TODO 8 + tests pass |
| 9 | TODO 9, 10 | Feature flags & timezone | After TODO 10 validation |
| 10 | TODO 11 | Main cron handler | After TODO 11 validation |
| 11 | TODO 12 | Notifications | After TODO 12 validation |
| 12 | TODO 13 | Deployment config | After successful deploy |
| 13 | TODO 14 | Integration tests | After all tests pass |
| 14 | TODO 15 | Documentation | Final PR |

---

## Environment Variables (Complete List)

```bash
# ShipHero
SHIPHERO_API_URL=https://public-api.shiphero.com/graphql
SHIPHERO_AUTH_URL=https://public-api.shiphero.com/auth/refresh
SHIPHERO_ACCESS_TOKEN=
SHIPHERO_REFRESH_TOKEN=

# Business Config
VACIER_CUSTOMER_ACCOUNT_ID=     # 5-digit number
TARGET_COUNTRY=TR
MAX_TOTAL_CUSTOMS_VALUE=25.00
PROCESSED_TAG=TR_CUSTOMS_SET
PROCESSING_START_DATE=2024-12-28T00:00:00+01:00

# Database (Vercel Postgres)
POSTGRES_URL=
POSTGRES_PRISMA_URL=
POSTGRES_URL_NON_POOLING=

# Axiom
AXIOM_TOKEN=
AXIOM_DATASET=

# Resend
RESEND_API_KEY=
NOTIFICATION_EMAIL=ae@vareya.nl

# Feature Flags
FEATURE_CUSTOMS_UPDATE=true
FEATURE_ORDER_TAGGING=true
FEATURE_VACIER_STATUS=true
FEATURE_UNFULFILLED_STATUS=false
FEATURE_ERROR_NOTIFICATIONS=true
FEATURE_SUCCESS_NOTIFICATIONS=true
FEATURE_DRY_RUN=false

# Vercel
CRON_SECRET=                    # Auto-generated
TZ=Europe/Amsterdam
```

---

## Order Volume Analysis

| Metric | Value |
|--------|-------|
| Total Vacier orders/day | 50-300 |
| Turkey orders (10-15%) | 5-45/day |
| Peak hours | Throughout 24h |
| 5-min cron intervals | 288/day |
| Orders per interval (avg) | 0.02-0.16 |
| Orders per interval (peak) | 1-3 |

**Conclusion:** 5-minute intervals are more than sufficient. Even at peak, we'll process 1-3 orders per run, well within quota limits.

---

## Ready to Start

Begin with **TODO 1: Project Setup & Configuration** using **Claude Code with Sonnet**.

**Command to start:**
```
Create a new Next.js 14 project with TypeScript for the ShipHero customs value updater. 
Follow the implementation plan in the project files.
```
