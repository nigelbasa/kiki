import { useCallback, useEffect, useState } from 'react';
import { get, patch, post } from '@shared/api/client';

export function useAuth(portal) {
  const portalQuery = `portal=${encodeURIComponent(portal || '')}`;
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    get(`/api/auth/me?${portalQuery}`)
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
  }, [portalQuery]);

  const login = useCallback(async (username, password) => {
    const path = portal === 'admin' ? '/api/auth/admin/login' : '/api/auth/public/login';
    const u = await post(path, { username, password });
    setUser(u);
    return u;
  }, [portal]);

  const signup = useCallback(async (payload) => {
    const u = await post('/api/auth/public/signup', payload);
    setUser(u);
    return u;
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await get(`/api/auth/me?${portalQuery}`);
    setUser(u);
    return u;
  }, [portalQuery]);

  const saveProfile = useCallback(async (payload) => {
    const profile = await patch(`/api/auth/profile?${portalQuery}`, payload);
    setUser((current) => current ? { ...current, display_name: profile.display_name, role: profile.role, username: profile.username } : current);
    return profile;
  }, [portalQuery]);

  const logout = useCallback(async () => {
    try {
      await post(`/api/auth/logout?${portalQuery}`, {});
    } catch {
      // ignore; we still clear local state
    }
    setUser(null);
  }, [portalQuery]);

  return { user, login, signup, logout, loading, refreshUser, saveProfile };
}
