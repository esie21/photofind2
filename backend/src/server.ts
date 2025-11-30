import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection, initializeTables } from './config/database';
import authRoutes from './routes/auth';

dotenv.config();

const app: Express = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

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
