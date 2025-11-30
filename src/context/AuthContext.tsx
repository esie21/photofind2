import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import authService, { User } from '../api/services/authService';

interface AuthContextProps {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<User>;
  signup: (data: { email: string; password: string; name: string; role: 'client' | 'provider' | 'admin' }) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextProps | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('authToken'));

  useEffect(() => {
    // If token exists, try to fetch current user
    if (token) {
      (async () => {
        try {
          authService.setToken(token);
          const currentUser = await authService.getCurrentUser();
          setUser(currentUser);
        } catch (e) {
          // Token invalid or user not found
          setUser(null);
          setToken(null);
          authService.setToken(null);
        }
      })();
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    const response = await authService.login({ email, password });
    authService.setToken(response.token);
    setToken(response.token);
    const user = response.user;
    setUser(user);
    return user;
  };

  const signup = async (data: { email: string; password: string; name: string; role: 'client' | 'provider' | 'admin' }) => {
    const response = await authService.signup(data as any);
    authService.setToken(response.token);
    setToken(response.token);
    const user = response.user;
    setUser(user);
    return user;
  };

  const logout = async () => {
    await authService.logout();
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
      return currentUser;
    } catch (e) {
      setUser(null);
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
