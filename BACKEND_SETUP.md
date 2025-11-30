# PhotoFind Backend Setup Guide

To connect your React frontend to the PostgreSQL database, you need to create a Node.js/Express backend server.

## Prerequisites
- Node.js and npm installed
- PostgreSQL running with the "capstone" server and "photofind" database

## Setup Instructions

### 1. Create a new backend directory (outside your React project)

```bash
mkdir photofind-backend
cd photofind-backend
npm init -y
```

### 2. Install required dependencies

```bash
npm install express cors dotenv pg bcryptjs jsonwebtoken
npm install --save-dev typescript ts-node @types/express @types/node @types/pg nodemon
```

### 3. Create environment file (.env)

```env
NODE_ENV=development
PORT=3001

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=photofind

# JWT
JWT_SECRET=7ca507d90c19eda4896da78f9d8425c5f3e7d8b94e950dab339e03f6cd2ed09d
```

### 4. Create TypeScript configuration (tsconfig.json)

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
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### 5. Backend folder structure

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
│   │   ├── authController.ts
│   │   ├── userController.ts
│   │   ├── bookingController.ts
│   │   └── serviceController.ts
│   ├── types/
│   │   └── index.ts
│   └── server.ts
├── .env
├── tsconfig.json
├── package.json
└── nodemon.json
```

### 6. Start the backend

```bash
npm run dev
```

The backend will run on http://localhost:3001

## Frontend Configuration

Your React app is already configured to connect to `http://localhost:3001/api` through the `.env.local` file.

## Database Connection Flow

```
React Frontend (localhost:3000)
        ↓
   API Client (src/api/*)
        ↓
Express Backend (localhost:3001)
        ↓
PostgreSQL Database (photofind)
```

## Available API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/signup` - Sign up
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Users
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Bookings
- `GET /api/bookings` - Get all bookings
- `POST /api/bookings` - Create booking
- `GET /api/bookings/:id` - Get booking by ID
- `PUT /api/bookings/:id` - Update booking
- `DELETE /api/bookings/:id` - Delete booking

### Services
- `GET /api/services` - Get all services
- `POST /api/services` - Create service
- `GET /api/services/:id` - Get service by ID
- `PUT /api/services/:id` - Update service
- `DELETE /api/services/:id` - Delete service

## Next Steps

1. Create the backend server with the sample files provided
2. Update the database credentials in .env
3. Run database migrations to set up tables
4. Test API endpoints with Postman or similar tools
5. The React frontend will automatically connect once the backend is running

