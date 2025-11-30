# PhotoFind - Database Integration Guide

## ✅ Frontend Setup Complete

Your React frontend is now connected and ready to communicate with a backend API. The dev server is running at **http://localhost:3000**

## 📱 Frontend Configuration

### Files Created
1. **`.env.local`** - Environment configuration
   - `VITE_API_URL=http://localhost:3001/api`

2. **`src/api/config.ts`** - API endpoint configuration
   - Centralized management of all API endpoints

3. **`src/api/client.ts`** - API client with auth handling
   - Handles all HTTP requests
   - Manages JWT tokens
   - Automatic token refresh on 401 errors

4. **`src/api/services/authService.ts`** - Authentication API calls
   - `login()` - User login
   - `signup()` - User registration
   - `logout()` - User logout
   - `getCurrentUser()` - Fetch current user
   - Token management

5. **`src/api/services/bookingService.ts`** - Booking operations
   - List, create, update, delete bookings

6. **`src/api/services/userService.ts`** - User management
   - List, fetch, update, delete users

7. **`src/api/services/serviceService.ts`** - Service management
   - List, create, update, delete services

### Updated Components
- **`AuthModal.tsx`** - Now integrated with API
  - Real login/signup authentication
  - Error handling
  - Loading states

## 🗄️ Database Information

Your PostgreSQL database:
- **Server:** capstone
- **Database:** photofind
- **User:** postgres
- **Host:** localhost (default)
- **Port:** 5432 (default)

## 🚀 Next Steps: Create Backend Server

### Step 1: Create Backend Project
```bash
mkdir photofind-backend
cd photofind-backend
npm init -y
```

### Step 2: Install Dependencies
```bash
npm install express cors dotenv pg bcryptjs jsonwebtoken
npm install --save-dev typescript ts-node @types/express @types/node @types/pg @types/bcryptjs @types/jsonwebtoken nodemon
```

### Step 3: Create Environment File (.env)
```env
NODE_ENV=development
PORT=3001

# PostgreSQL Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_NAME=photofind

# JWT
JWT_SECRET=your_super_secret_jwt_key_change_this
```

### Step 4: Create Project Structure
```
photofind-backend/
├── src/
│   ├── config/
│   │   └── database.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── errorHandler.ts
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── users.ts
│   │   ├── bookings.ts
│   │   └── services.ts
│   ├── controllers/
│   ├── server.ts
├── .env
├── tsconfig.json
├── package.json
└── nodemon.json
```

### Step 5: TypeScript Configuration (tsconfig.json)
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### Step 6: Nodemon Configuration (nodemon.json)
```json
{
  "watch": ["src"],
  "ext": "ts",
  "exec": "ts-node",
  "env": { "NODE_ENV": "development" }
}
```

### Step 7: Package.json Scripts
Add to package.json:
```json
"scripts": {
  "dev": "nodemon src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js"
}
```

## 📋 Sample Backend Files

Sample backend code is available in the `BACKEND_SAMPLES` folder:
- `database.ts` - PostgreSQL connection setup
- `server.ts` - Express server configuration
- `auth-middleware.ts` - JWT authentication middleware
- `auth-routes.ts` - Authentication endpoints

## 🔌 API Endpoints Reference

### Authentication
```
POST   /api/auth/login          - Login with email/password
POST   /api/auth/signup         - Register new user
POST   /api/auth/logout         - Logout user
GET    /api/auth/me             - Get current user
```

### Users
```
GET    /api/users               - Get all users
GET    /api/users/:id           - Get user by ID
PUT    /api/users/:id           - Update user
DELETE /api/users/:id           - Delete user
```

### Bookings
```
GET    /api/bookings            - Get all bookings
POST   /api/bookings            - Create new booking
GET    /api/bookings/:id        - Get booking by ID
PUT    /api/bookings/:id        - Update booking
DELETE /api/bookings/:id        - Delete booking
```

### Services
```
GET    /api/services            - Get all services
POST   /api/services            - Create new service
GET    /api/services/:id        - Get service by ID
PUT    /api/services/:id        - Update service
DELETE /api/services/:id        - Delete service
```

## 🔐 Authentication Flow

```
1. User enters credentials in AuthModal
2. Frontend calls authService.login() or authService.signup()
3. Request sent to Backend API (http://localhost:3001/api/auth/...)
4. Backend validates against PostgreSQL database
5. Backend returns JWT token
6. Frontend stores token in localStorage
7. Token automatically included in all subsequent requests
8. Backend verifies token before allowing access
```

## 📡 Database Schema

Your backend should create these tables in the `photofind` database:

### users
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('client', 'provider', 'admin')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### services
```sql
CREATE TABLE services (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  category VARCHAR(100),
  images TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### bookings
```sql
CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  total_price DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🧪 Testing Your Setup

### 1. Test Frontend is Running
- Open http://localhost:3000 in your browser
- Try the login/signup modal

### 2. Create Backend Server
- Follow the "Create Backend Server" steps above

### 3. Start Backend
```bash
npm run dev
```
The backend will run on http://localhost:3001

### 4. Test Connection
- Try logging in through the frontend
- Check browser console for any errors
- Check backend console for request logs

## 🐛 Troubleshooting

### Frontend can't connect to backend
- Ensure backend is running on port 3001
- Check `.env.local` has correct `VITE_API_URL`
- Check browser console for CORS errors

### Database connection fails
- Verify PostgreSQL is running
- Check credentials in `.env`
- Ensure `photofind` database exists
- Run database initialization queries

### Authentication token issues
- Clear browser localStorage and try again
- Check JWT_SECRET is consistent
- Verify token expiration time

## 📞 Quick Start Summary

1. ✅ Frontend is configured and running
2. ⏳ Create backend server (use sample files as reference)
3. ⏳ Connect backend to PostgreSQL
4. ⏳ Test API endpoints
5. ⏳ Deploy to production

Your frontend is ready to connect to any backend that follows the API endpoints specification!
