# Stripe Deposit Integration — Setup Checklist

**Status (2026-05-09):** Endpoint code scaffolded, NOT yet wired. Mac action required to activate.

Once these steps are complete, `/api/deposit-checkout` and `/api/stripe-webhook` go live and customers approving an estimate via the cash path will get a Checkout link automatically.

## 1. Stripe account

If Plus Ultra doesn't have a Stripe account yet:
1. Sign up at https://dashboard.stripe.com/register
2. Complete business verification (CRA business number, banking)
3. Activate Canadian payouts (CAD currency)

## 2. Get API keys

In Stripe Dashboard → Developers → API keys:
- Copy the **Secret key** (starts with `sk_live_...` for production, `sk_test_...` for test mode)

## 3. Install SDK

```powershell
cd "C:\Users\macke\OneDrive\Desktop\Ryujin\ryujin-os"
npm install stripe
git add package.json package-lock.json
git commit -m "deps: add stripe sdk"
git push
```

## 4. Configure webhook endpoint

In Stripe Dashboard → Developers → Webhooks:
1. Click "Add endpoint"
2. Endpoint URL: `https://ryujin-os.vercel.app/api/stripe-webhook`
3. Events to listen to:
   - `checkout.session.completed`
   - `checkout.session.expired`
4. Copy the **Signing secret** (starts with `whsec_...`)

## 5. Add env vars

Add to **both** `.env.local` (for Claude Code) and Vercel project env (for prod):

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_BASE_URL=https://ryujin-os.vercel.app
```

Vercel CLI:
```powershell
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_WEBHOOK_SECRET production
```

## 6. Smoke test

1. Run a test estimate through the proposal accept flow with cash path
2. Verify estimate transitions to `state='deposit_pending'`
3. Hit `POST /api/deposit-checkout` with `{ estimate_id: ... }` (owner auth)
4. Open the returned `checkout_url`, complete a Stripe test payment
5. Verify webhook fires and estimate transitions to `state='schedule_pending'`,
   `deposit_status='cleared'`, `schedule_due_by` set 3 business days out
6. Check `activity_log` for `action='deposit_cleared'` row with payment_intent

## 7. Test mode → live mode

Until business verification completes, use Stripe test keys (`sk_test_...`).
Test card: `4242 4242 4242 4242` any future date, any CVC, any postal code.

When ready to go live:
1. Switch keys in env vars to `sk_live_...` + new `whsec_...`
2. Re-run the smoke test on a real (small) test estimate
3. Verify webhook fires in production logs

## Hard rules locked into code

Per Manus peer review §5 + Bible v0.2 §2:

1. `deposit_amount` is **integer cents only**. Endpoint rejects non-integers.
2. Webhook is **the only authority** allowed to set `deposit_status='cleared'`.
3. Webhook is **idempotent on payment_intent** — duplicate Stripe retries are safe.
4. Webhook **verifies Stripe signature** before trusting any payload.
5. Webhook **verifies metadata** (`ryujin_estimate_id`, `ryujin_tenant_id`) match the estimate.
6. Webhook **verifies session amount** matches `estimate.deposit_amount` exactly.
7. Webhook uses `assertTransition('estimate', 'deposit_pending', 'schedule_pending')` before any update.
8. Endpoint requires **owner/admin auth** (Bearer token via `lib/auth-server.js`).
9. **No hardcoded trust claims** in any Stripe-adjacent surface (payment surfaces stay restrained per Bible v0.2 §4).
