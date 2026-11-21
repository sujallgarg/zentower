# Deploying "Stack & Balance: Zen Towers" (Supabase + Dodo Payments)

Follow these 4 steps to deploy the full-stack database, Dodo Payments checkout functions, and web app for production go-live.

---

### Step 1: Link Project & Push Database Migration

Push the PostgreSQL tables (`leaderboard_entries`, `sponsor_bids`), escalating floor trigger (`validate_sponsor_bid_floor`), RPC functions (`submit_high_score`), Row Level Security policies, and the `sponsor-logos` storage bucket:

```bash
npx supabase login
npx supabase link --project-ref <YOUR_SUPABASE_PROJECT_REF>
npx supabase db push
```

---

### Step 2: Set Dodo Payments & Supabase Secrets

Configure your production secrets in Supabase Edge Functions:

```bash
npx supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY="<YOUR_SUPABASE_SERVICE_ROLE_KEY>" \
  DODO_PAYMENTS_API_KEY="dodo_live_..." \
  DODO_PAYMENTS_WEBHOOK_SECRET="whsec_..." \
  DODO_PAYMENTS_ENV="live_mode" \
  VITE_APP_URL="https://your-domain.com"
```

*Note: For testing/staging, set `DODO_PAYMENTS_API_KEY="dodo_test_..."` and `DODO_PAYMENTS_ENV="test_mode"`.*

---

### Step 3: Deploy the Supabase Edge Functions

Deploy the checkout creator and the cryptographically-verified webhook handler:

```bash
npx supabase functions deploy create-sponsor-checkout --no-verify-jwt
npx supabase functions deploy dodo-webhook --no-verify-jwt
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

#### Register Webhook in Dodo Payments Dashboard:
1. Navigate to **Dodo Payments Dashboard** &rarr; **Developers** &rarr; **Webhooks**.
2. Click **Add Endpoint**.
3. **Endpoint URL:** `https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/functions/v1/dodo-webhook`
4. **Events to listen for:** Check `payment.succeeded` (and `checkout.session.completed`).
5. Copy the generated Webhook Secret (`whsec_...`) and set it via `npx supabase secrets set DODO_PAYMENTS_WEBHOOK_SECRET="whsec_..."`.

---

### Step 4: Build & Deploy Frontend (Vercel or Cloudflare Pages)

#### Option A: Vercel CLI
```bash
vercel --prod \
  -e VITE_SUPABASE_URL="https://<YOUR_PROJECT_REF>.supabase.co" \
  -e VITE_SUPABASE_ANON_KEY="<YOUR_ANON_KEY>" \
  -e VITE_APP_URL="https://your-domain.com"
```

#### Option B: Cloudflare Pages
```bash
npm run build
npx wrangler pages deploy dist --project-name zen-towers
```

---

### Graceful Offline / Zero-Config Mode
If `VITE_SUPABASE_URL` is omitted, the application runs automatically in **graceful offline mode**, backed by browser `IndexedDB` & `localStorage` with zero demo/mock data (slots start genuinely empty).
