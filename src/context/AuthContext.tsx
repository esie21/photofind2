import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import authService, { User } from '../api/services/authService';
import { API_CONFIG } from '../api/config';

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
          setUser(normalizeUserImages(currentUser));
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
    const user = normalizeUserImages(response.user);
    setUser(user);
    return user;
  };

  const signup = async (data: { email: string; password: string; name: string; role: 'client' | 'provider' | 'admin' }) => {
    const response = await authService.signup(data as any);
    authService.setToken(response.token);
    setToken(response.token);
    const user = normalizeUserImages(response.user);
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
      setUser(normalizeUserImages(currentUser));
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

function normalizeUserImages(user: User) {
  if (!user) return user;
  const apiBase = API_CONFIG.BASE_URL.replace(/\/api$/i, '');
  const resolveUrl = (url?: string | null) => {
    if (!url) return url;
    // If already an absolute URL, just return
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/uploads')) return `${apiBase}${url}`;
    return url;
  };

  return {
    ...user,
    profile_image: resolveUrl(user.profile_image as any) as any,
    portfolio_images: (user.portfolio_images || []).map((p) => resolveUrl(p) as any),
  } as User;
}
