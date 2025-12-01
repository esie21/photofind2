import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface AuthRequest extends Request {
  userId?: string;
  role?: string;
}

// Middleware to verify JWT token
export function verifyToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded: any = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your_secret_key'
    );
    // Keep userId as string (UUID or numeric string) for consistent comparisons with route params
    req.userId = String(decoded.userId);
    req.role = decoded.role;
    if (process.env.NODE_ENV !== 'production') {
      console.log('[verifyToken] decoded user:', { userId: req.userId, role: req.role });
    }
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware to check user role
export function checkRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.role || !allowedRoles.includes(req.role)) {
      return res
        .status(403)
        .json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

export default { verifyToken, checkRole };
