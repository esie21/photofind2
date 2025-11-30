import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection, initializeTables } from './config/database';

dotenv.config();

const app: Express = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes placeholder (import your routes here)
// import authRoutes from './routes/auth';
// app.use('/api/auth', authRoutes);

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
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Frontend connects to: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
