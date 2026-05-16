import { useCallback, useEffect, useState } from 'react';
import { api, get, patch, post } from '@shared/api/client';

export function useAuth(portal) {
  const portalQuery = `portal=${encodeURIComponent(portal || '')}`;
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const confirmSession = useCallback(async () => {
    try {
      const confirmedUser = await get(`/api/auth/me?${portalQuery}`);
      setUser(confirmedUser);
      return confirmedUser;
    } catch (error) {
      setUser(null);
      const sessionError = new Error(
        'Login succeeded, but the session was not available on the next request. Check that the app and API are opened on the same host.'
      );
      sessionError.status = 440;
      sessionError.cause = error;
      throw sessionError;
    }
  }, [portalQuery]);

  useEffect(() => {
    let cancelled = false;
    api.setUnauthorizedHandler(() => {
      if (!cancelled) setUser(null);
    });
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
      api.setUnauthorizedHandler(null);
    };
  }, [portalQuery]);

  const login = useCallback(async (username, password) => {
    const path = portal === 'admin' ? '/api/auth/admin/login' : '/api/auth/public/login';
    await post(path, { username, password });
    return confirmSession();
  }, [confirmSession, portal]);

  const signup = useCallback(async (payload) => {
    await post('/api/auth/public/signup', payload);
    return confirmSession();
  }, [confirmSession]);

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
