import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection, initializeTables } from './config/database';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import debugRoutes from './routes/debug';
import usersRoutes from './routes/users';
import providersRoutes from './routes/providers';
import bookingsRoutes from './routes/bookings';
import path from 'path';

dotenv.config();

const app: Express = express();



// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/providers', providersRoutes);
app.use('/api/bookings', bookingsRoutes);
// Register debug routes only in non-production
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/debug', debugRoutes);
}

// Serve uploaded media from local 'uploads' directory
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'Server is running' });
});

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // Test database connection
    await testConnection();

    // Initialize tables
    await initializeTables();

    app.listen(PORT, () => {
      console.log(`\n✅ Server running on http://localhost:${PORT}`);
      console.log(`📱 Frontend connects to: http://localhost:${PORT}/api`);
      console.log(`🗄️  Database: ${process.env.DB_NAME}`);
      console.log(`📊 Server: ${process.env.DB_HOST}\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
