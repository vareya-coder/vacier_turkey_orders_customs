# Vacier Turkey Orders Customs Updater

Automated customs value updater for Vacier's Turkey-bound orders via ShipHero API.

## Overview

This Next.js application automatically updates customs values for orders shipping to Turkey to comply with the €25 threshold requirement. It runs as a Vercel cron job every 5 minutes, processing eligible orders through the ShipHero GraphQL API.

**Key Features:**
- 🔄 Automated processing every 5 minutes via Vercel Cron
- 🇹🇷 Turkey-specific order filtering
- 💰 Smart customs value distribution (≤€25 total)
- 🏷️ Idempotent processing with order tagging
- 📊 Comprehensive logging to Axiom
- 📧 Email notifications via Resend
- 🛡️ Quota management for API rate limits
- 🧪 Dry-run mode for testing

## Architecture

```
Vercel Cron (every 5 min)
    ↓
API Route: /api/cron/customs-update
    ↓
Batch Processor
    ↓
┌─────────────────────────────────────┐
│  1. Query ShipHero orders           │
│  2. Filter Turkey-bound orders      │
│  3. Skip already-tagged orders      │
│  4. Calculate customs distribution  │
│  5. Update line items               │
│  6. Add "TR_CUSTOMS_SET" tag        │
│  7. Log to Axiom                    │
│  8. Save batch to Postgres          │
│  9. Send email notifications        │
└─────────────────────────────────────┘
```

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript (strict mode)
- **Database:** Vercel Postgres + Drizzle ORM
- **API Client:** ShipHero GraphQL
- **Logging:** Axiom
- **Notifications:** Resend
- **Testing:** Vitest
- **Deployment:** Vercel

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm (or npm/yarn)
- ShipHero API credentials
- Vercel account
- Vercel Postgres database
- Axiom account
- Resend account

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd vacier_turkey_orders_customs
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.local.example .env.local
   ```

4. **Configure environment variables** (see below)

5. **Run database migrations:**
   ```bash
   pnpm drizzle-kit generate
   pnpm drizzle-kit migrate
   ```

6. **Start development server:**
   ```bash
   pnpm dev
   ```

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in all required values:

### ShipHero API
```env
SHIPHERO_API_URL=https://public-api.shiphero.com/graphql
SHIPHERO_AUTH_URL=https://public-api.shiphero.com/auth/refresh
SHIPHERO_ACCESS_TOKEN=your_access_token
SHIPHERO_REFRESH_TOKEN=your_refresh_token
```

### Business Configuration
```env
VACIER_CUSTOMER_ACCOUNT_ID=12345
TARGET_COUNTRY=TR
MAX_TOTAL_CUSTOMS_VALUE=25.00
PROCESSED_TAG=TR_CUSTOMS_SET
PROCESSING_START_DATE=2024-12-28T00:00:00+01:00
```

### Database (Vercel Postgres)
```env
POSTGRES_URL=postgres://...
POSTGRES_PRISMA_URL=postgres://...
POSTGRES_URL_NON_POOLING=postgres://...
```

### Axiom Logging
```env
AXIOM_TOKEN=your_token
AXIOM_DATASET=your_dataset
```

### Resend Notifications
```env
RESEND_API_KEY=re_...
NOTIFICATION_EMAIL=ae@vareya.nl
```

### Feature Flags
```env
FEATURE_CUSTOMS_UPDATE=true
FEATURE_ORDER_TAGGING=true
FEATURE_VACIER_STATUS=true
FEATURE_UNFULFILLED_STATUS=false
FEATURE_ERROR_NOTIFICATIONS=true
FEATURE_SUCCESS_NOTIFICATIONS=false
FEATURE_DRY_RUN=false
```

## Feature Flags Explained

| Flag | Description | Recommended |
|------|-------------|-------------|
| `FEATURE_CUSTOMS_UPDATE` | Enable customs value updates | `true` |
| `FEATURE_ORDER_TAGGING` | Enable order tagging (required for idempotency) | `true` |
| `FEATURE_VACIER_STATUS` | Process orders with "Vacier" status | `true` |
| `FEATURE_UNFULFILLED_STATUS` | Process orders with "Unfulfilled" status | `false` |
| `FEATURE_ERROR_NOTIFICATIONS` | Send email on errors | `true` |
| `FEATURE_SUCCESS_NOTIFICATIONS` | Send email on success | `false` |
| `FEATURE_DRY_RUN` | Simulate without making changes | `false` in production |

## Testing

### Run Unit Tests
```bash
pnpm test              # Run once
pnpm test:watch        # Watch mode
pnpm test:ui           # UI mode
```

### Test Coverage
The customs value distributor has 19 comprehensive unit tests covering:
- Single and multiple item orders
- Billable and complimentary items
- Edge cases (empty, large datasets)
- Validation logic
- Randomness and distribution

### Manual Testing (Dry-Run Mode)

1. Set `FEATURE_DRY_RUN=true` in `.env.local`
2. Trigger the cron manually:
   ```bash
   curl http://localhost:3000/api/cron/customs-update
   ```
3. Check Axiom logs for simulation results
4. No actual changes will be made to ShipHero

## Deployment

### Deploy to Vercel

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Initial deployment"
   git push origin main
   ```

2. **Connect to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Select "Next.js" as the framework

3. **Configure Environment Variables:**
   - In Vercel dashboard → Settings → Environment Variables
   - Add all variables from `.env.local`
   - Deploy

4. **Verify Cron Job:**
   - Go to Vercel dashboard → Deployments → Cron
   - Verify `/api/cron/customs-update` appears
   - Schedule: `*/5 * * * *` (every 5 minutes)

5. **Monitor First Runs:**
   - Check Axiom logs
   - Check email notifications
   - Verify batch runs in Vercel Postgres

### Database Setup (Vercel Postgres)

1. Create Vercel Postgres database in your project
2. Copy connection strings to environment variables
3. Run migrations:
   ```bash
   vercel env pull .env.local
   pnpm drizzle-kit migrate
   ```

## Monitoring

### Axiom Dashboard

View structured logs:
- **Batch runs:** Filter by `event: batch_started, batch_completed`
- **Order processing:** Filter by `event: order_processing, order_completed`
- **Errors:** Filter by `level: error`
- **Quota:** Filter by `event: quota_warning`

### Database Queries

```sql
-- Recent batch runs
SELECT * FROM batch_runs
ORDER BY started_at DESC
LIMIT 10;

-- Failed batches
SELECT * FROM batch_runs
WHERE status = 'failed'
ORDER BY started_at DESC;

-- Summary statistics
SELECT
  status,
  COUNT(*) as count,
  SUM(orders_processed) as total_processed,
  SUM(credits_used) as total_credits
FROM batch_runs
GROUP BY status;
```

## Troubleshooting

### Common Issues

**1. "Environment validation failed"**
- Check all required environment variables are set
- Verify `.env.local` file exists
- Ensure no typos in variable names

**2. "ShipHero authentication failed"**
- Verify `SHIPHERO_ACCESS_TOKEN` and `SHIPHERO_REFRESH_TOKEN`
- Check tokens haven't expired
- Test tokens with ShipHero API directly

**3. "Quota exceeded"**
- Wait for credits to replenish (60 credits/second)
- Check Axiom logs for `quota_warning` events
- Consider reducing cron frequency if needed

**4. Orders not being processed**
- Check `FEATURE_CUSTOMS_UPDATE=true`
- Verify `PROCESSING_START_DATE` is before order dates
- Ensure orders aren't already tagged
- Check country is "TR"

**5. Database connection errors**
- Verify Vercel Postgres connection strings
- Check database is in the same region
- Ensure migrations have run

## Project Structure

```
/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── cron/
│   │   │       └── customs-update/
│   │   │           └── route.ts          # Main cron handler
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── lib/
│   │   ├── db/
│   │   │   ├── schema.ts                 # Drizzle schema
│   │   │   └── client.ts                 # DB connection
│   │   ├── shiphero/
│   │   │   ├── auth.ts                   # Token management
│   │   │   ├── client.ts                 # GraphQL client
│   │   │   ├── queries.ts                # GraphQL queries
│   │   │   ├── mutations.ts              # GraphQL mutations
│   │   │   ├── orders.ts                 # Order fetching
│   │   │   ├── types.ts                  # TypeScript types
│   │   │   ├── errors.ts                 # Error types
│   │   │   └── quota.ts                  # Quota manager
│   │   ├── customs/
│   │   │   ├── distributor.ts            # Value distribution
│   │   │   └── distributor.test.ts       # Unit tests
│   │   ├── processor/
│   │   │   ├── order.ts                  # Single order processor
│   │   │   └── batch.ts                  # Batch orchestration
│   │   ├── logging/
│   │   │   ├── axiom.ts                  # Axiom client
│   │   │   └── types.ts                  # Log event types
│   │   ├── notifications/
│   │   │   ├── resend.ts                 # Resend client
│   │   │   └── templates.ts              # Email templates
│   │   ├── utils/
│   │   │   └── timezone.ts               # Timezone utilities
│   │   ├── env.ts                        # Environment validation
│   │   └── config.ts                     # Feature flags & config
│   └── __tests__/
│       └── ...                           # Test files
├── drizzle/
│   └── migrations/                       # DB migrations
├── .env.local.example                    # Env template
├── .gitignore
├── drizzle.config.ts                     # Drizzle config
├── next.config.ts                        # Next.js config
├── package.json
├── tsconfig.json
├── vercel.json                           # Vercel cron config
├── vitest.config.mts                     # Vitest config
└── README.md
```

## Development Workflow

1. **Feature Development:**
   - Create feature branch
   - Implement changes
   - Write/update tests
   - Test in dry-run mode
   - Create pull request

2. **Testing:**
   - Run unit tests: `pnpm test`
   - Test dry-run mode locally
   - Deploy to preview branch on Vercel
   - Monitor Axiom logs

3. **Deployment:**
   - Merge to main
   - Auto-deploy to production
   - Monitor first few cron runs
   - Check email notifications

## Maintenance

### Regular Tasks

- **Weekly:** Review Axiom logs for errors
- **Weekly:** Check batch run statistics in database
- **Monthly:** Review API credit usage
- **Quarterly:** Update dependencies

### API Quota Management

- **Max Credits:** 4,004
- **Replenish Rate:** 60 credits/second
- **Typical Cost:** 30-50 credits per order
- **5-min interval:** Can handle ~4,000 credits (80-130 orders)

## Support

For issues or questions:
1. Check Axiom logs for detailed error messages
2. Review this README troubleshooting section
3. Contact technical support: ae@vareya.nl

## License

Proprietary - Vareya BV

---

**Last Updated:** December 2024
**Version:** 1.0.0
**Maintained by:** Vareya BV Development Team
