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
| `PAYMONGO_SECRET_KEY` | PayMongo API secret | `sk_live_...` |
| `PAYMONGO_PUBLIC_KEY` | PayMongo API public | `pk_live_...` |

### Frontend (.env)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `https://api.photofind.com/api` |

---

## Post-Deployment Checklist

- [ ] Backend health check: `https://your-backend.railway.app/api/health`
- [ ] Database tables initialized (check logs)
- [ ] Frontend loads correctly
- [ ] User registration works
- [ ] Login/logout works
- [ ] File uploads work (images)
- [ ] Real-time chat works (WebSocket)
- [ ] Payments work (if using PayMongo)

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
