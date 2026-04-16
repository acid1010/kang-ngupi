"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { User, getUser, setUser as saveUser, removeUser, setToken, removeToken, getMe } from "@/lib/api";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  loginSuccess: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  loginSuccess: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getUser();
    if (stored) {
      // Verify token is still valid
      getMe()
        .then((u) => {
          setUser(u);
          saveUser(u);
        })
        .catch(() => {
          removeToken();
          removeUser();
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const loginSuccess = useCallback((token: string, u: User) => {
    setToken(token);
    saveUser(u);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    removeToken();
    removeUser();
    setUser(null);
    window.location.href = "/app/login";
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, loginSuccess, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
