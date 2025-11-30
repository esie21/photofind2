import express, { Request, Response, NextFunction } from 'express';

interface AuthRequest extends Request {
  userId?: number;
  role?: string;
}

// Middleware to verify JWT token (basic example)
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
    // Verify token (you'll need to implement JWT verification)
    // For now, this is a placeholder
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    req.userId = decoded.userId;
    req.role = decoded.role;
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
