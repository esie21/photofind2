# PhotoFind Deployment Guide

## Recommended: Railway Deployment (Easiest)

Railway can host your frontend, backend, and PostgreSQL database all in one place.

### Step 1: Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub

### Step 2: Deploy Backend

1. **Create a new project** in Railway
2. Click **"New Service"** → **"GitHub Repo"**
3. Select your repository
4. Railway will auto-detect it's a Node.js app
5. Set the **Root Directory** to `backend`
6. Add environment variables:

```
NODE_ENV=production
JWT_SECRET=<generate-a-random-64-char-string>
FRONTEND_URL=<your-frontend-url>
PAYMONGO_SECRET_KEY=<your-key>
PAYMONGO_PUBLIC_KEY=<your-key>
PAYMONGO_WEBHOOK_SECRET=<your-key>
PLATFORM_COMMISSION_RATE=0.15
# Payments: see "Payments Go-Live Checklist" below before switching to live keys.
MINIMUM_PAYOUT_AMOUNT=500
```

### Step 3: Add PostgreSQL Database

1. In your Railway project, click **"New Service"** → **"Database"** → **"PostgreSQL"**
2. Railway will automatically set `DATABASE_URL` for your backend
3. The backend will auto-connect using this URL

### Step 4: Deploy Frontend

1. Click **"New Service"** → **"GitHub Repo"** again
2. Select the same repository
3. Set **Root Directory** to `.` (root - for frontend)
4. Add environment variable:

```
VITE_API_URL=https://<your-backend-service>.railway.app/api
```

5. Set build command: `npm run build`
6. Set start command: `npm run preview` (or configure as static site)

### Step 5: Configure Domains

1. Go to each service's **Settings** → **Networking**
2. Click **"Generate Domain"** for a free `.railway.app` subdomain
3. Or add your custom domain

---

## Alternative: Vercel (Frontend) + Railway (Backend + DB)

### Frontend on Vercel

1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repo
3. Set **Root Directory** to `.`
4. Add environment variable:
   - `VITE_API_URL`: Your Railway backend URL
5. Deploy

### Backend on Railway (same as above)

---

## Alternative: Render

### Backend + Database

1. Go to [render.com](https://render.com)
2. Create a **PostgreSQL** database (free tier available)
3. Create a **Web Service** for the backend
4. Set **Root Directory** to `backend`
5. Set **Build Command**: `npm install && npm run build`
6. Set **Start Command**: `npm start`
7. Add environment variables (same as Railway)

### Frontend on Render

1. Create a **Static Site**
2. Set **Build Command**: `npm install && npm run build`
3. Set **Publish Directory**: `dist`
4. Add `VITE_API_URL` environment variable

---

## Environment Variables Reference

### Backend (.env)

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port (auto-set by Railway) | `3001` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `JWT_SECRET` | Secret for JWT tokens | Random 64+ chars |
| `FRONTEND_URL` | Frontend URL for CORS | `https://photofind.vercel.app` |
| `PAYMONGO_SECRET_KEY` | PayMongo API secret (required in production) | `sk_live_...` |
| `PAYMONGO_PUBLIC_KEY` | PayMongo API public (required in production) | `pk_live_...` |
| `PAYMONGO_WEBHOOK_SECRET` | Secret of the registered webhook (required in production) | `whsk_...` |
| `PAYMONGO_QRPH_ENABLED` | `false` = break-glass fallback to card/e-wallets | `true` |
| `PAYMONGO_QRPH_EXPIRY_SECONDS` | How long a QR code stays scannable | `900` |
| `PAYMONGO_TIMEOUT_MS` | Per-call timeout for PayMongo | `15000` |
| `PAYMENT_RECONCILE_AFTER_MINUTES` | When the sweep checks a stuck payment | `20` |

### Frontend (.env)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `https://api.photofind.com/api` |

---

## Post-Deployment Checklist

- [ ] Backend health check: `https://your-backend.railway.app/api/health` (or `/health`)
- [ ] Database tables initialized (check logs)
- [ ] Frontend loads correctly
- [ ] User registration works
- [ ] Login/logout works
- [ ] File uploads work (images)
- [ ] Real-time chat works (WebSocket)
- [ ] Payments go-live checklist below is complete

---

## Payments Go-Live Checklist (PayMongo)

Work through this in order the first time real money is switched on. Steps 1-3 can be done
before the deploy; nothing here is undone by a redeploy.

### 1. PayMongo account
- [ ] Account is fully activated for **live** mode (business verification approved).
- [ ] **QR Ph is enabled on the live account.** It is the only payment method offered, so if
      it is not enabled, nobody can pay. Ask PayMongo support if it is not listed.
- [ ] **Ask PayMongo whether QR Ph payments can be refunded through the API.** The platform
      refunds automatically when a booking is cancelled after payment, or when a client pays
      for a booking that was already cancelled. If QR Ph refunds are not supported, those
      refunds fail safely - nothing is credited to the provider and every admin gets a
      "needs a manual refund" notification - but they will have to be done by hand from the
      PayMongo dashboard.

### 2. Live webhook
- [ ] In the PayMongo dashboard (Developers > Webhooks), in **live** mode, create a webhook:
      - URL: `https://<your-backend>/api/payments/webhook`
      - Events: **`payment.paid`** and **`qrph.expired`** (required). Also select
        `payment_intent.succeeded` and `payment_intent.failed` if the dashboard offers them;
        they are handled, but not required.
      - `payment.failed` is not handled by the webhook. Failures are recorded by the client's
        payment screen and by the reconciliation sweep instead, so selecting it does no harm
        and leaving it out loses nothing.
- [ ] Copy that webhook's secret (`whsk_...`). The live webhook's secret is different from the
      test one.

### 3. Production database: historical payments
- [ ] Run this once and review every row it returns:

      SELECT p.id, p.booking_id, p.gross_amount, p.paid_at, b.status AS booking_status
      FROM payments p
      JOIN bookings b ON b.id::text = p.booking_id::text
      WHERE p.status = 'succeeded'
        AND p.wallet_credited_at IS NULL
        AND b.status IN ('cancelled', 'rejected');

      Each row is a client who paid for a booking that was then cancelled or rejected, and was
      never credited to a provider. They most likely predate the automatic cancellation refund,
      which means the client was probably never refunded either. The automatic refund
      deliberately does **not** touch these - decide on each one and refund it from the PayMongo
      dashboard where needed.

### 4. Switch the keys
- [ ] Set on the backend service, all at once:
      `PAYMONGO_SECRET_KEY=sk_live_...`, `PAYMONGO_PUBLIC_KEY=pk_live_...`,
      `PAYMONGO_WEBHOOK_SECRET=<live webhook secret>`, `FRONTEND_URL=https://<your site>`,
      `NODE_ENV=production`.
- [ ] Deploy, and check the startup log:
      - `PayMongo mode: live` - correct.
      - `PayMongo configuration problems: ... Refusing to start` - read the listed problem; the
        server will not run until it is fixed.
      - `*** PayMongo is in TEST mode on a production build ***` - the test keys are still set.

### 5. One real payment, end to end
- [ ] Make a booking for a small real amount as a client, have the provider accept it, and pay
      with a real QR Ph scan from a banking or e-wallet app.
- [ ] The payment screen reaches "Payment successful", the booking shows as paid, and the
      provider's wallet shows the amount (minus commission) as pending.
- [ ] In the PayMongo dashboard (Developers > Webhooks > your webhook), the `payment.paid`
      delivery shows as **200**. A 400 means `PAYMONGO_WEBHOOK_SECRET` does not match this
      webhook.
- [ ] Cancel that booking and confirm the refund appears in the PayMongo dashboard (this is
      also the answer to the QR Ph refund question in step 1).

### 6. Monitoring
Search the backend logs for these regularly, or set up alerts on them. Each one means money
needs a person:

| Log text | Meaning |
|----------|---------|
| `was NOT recorded - reconcile it manually` | PayMongo reported a payment that matched no payment record. |
| `AMOUNT_MISMATCH` | Paid amount differs from the booking price. Held, provider not credited. Admins are notified. |
| `[refundLatePayment] FAILED` | A refund for a late payment failed. Retried every 10 minutes; admins notified once. |
| `[settleCancelledBooking] SHORTFALL` | A cancellation refund found less in the provider's escrow than expected. |
| `PayMongo ... timed out` / `-> HTTP 5xx` | PayMongo slow or down. Payments recover via the sweep once it is back. |

**If QR Ph stops working entirely** (PayMongo outage, capability removed): set
`PAYMONGO_QRPH_ENABLED=false` and restart. Clients are offered card and e-wallets instead.
Set it back to `true` when QR Ph is restored.

---

## Troubleshooting

### CORS Errors
- Ensure `FRONTEND_URL` is set correctly in backend
- Check that the URL includes `https://`

### Database Connection Failed
- Verify `DATABASE_URL` is set
- Check if database service is running

### WebSocket Not Connecting
- Railway/Render support WebSockets by default
- Ensure frontend is using correct backend URL

### Build Failures
- Check Node.js version (requires 18+)
- Run `npm install` locally to check for errors
