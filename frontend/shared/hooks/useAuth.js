import { useCallback, useEffect, useState } from 'react';
import { get, patch, post } from '@shared/api/client';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    get('/api/auth/me')
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    const u = await post('/api/auth/login', { username, password });
    setUser(u);
    return u;
  }, []);

  const signup = useCallback(async (payload) => {
    const u = await post('/api/auth/signup', payload);
    setUser(u);
    return u;
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await get('/api/auth/me');
    setUser(u);
    return u;
  }, []);

  const saveProfile = useCallback(async (payload) => {
    const profile = await patch('/api/auth/profile', payload);
    setUser((current) => current ? { ...current, display_name: profile.display_name, role: profile.role, username: profile.username } : current);
    return profile;
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/api/auth/logout', {});
    } catch {
      // ignore; we still clear local state
    }
    setUser(null);
  }, []);

  return { user, login, signup, logout, loading, refreshUser, saveProfile };
}
