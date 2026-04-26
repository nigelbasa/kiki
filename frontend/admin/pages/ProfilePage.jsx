import React, { useCallback, useEffect, useState } from 'react';
import { get, patch } from '@shared/api/client';
import Spinner from '@shared/components/Spinner';

function Toast({ toast }) {
  if (!toast) return null;
  const bg = toast.kind === 'error' ? 'bg-signal-red' : 'bg-signal-green';
  return (
    <div className={`fixed right-6 top-6 z-50 rounded-md px-4 py-2 text-sm font-medium text-white shadow-lg ${bg}`}>
      {toast.message}
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await get('/api/auth/profile');
      setProfile(payload);
    } catch (error) {
      console.error('load profile failed', error);
      setToast({ kind: 'error', message: 'Failed to load profile' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function saveProfile() {
    if (!profile) return;
    try {
      const updated = await patch('/api/auth/profile', {
        display_name: profile.display_name,
        email: profile.email,
        job_title: profile.job_title,
        contact: profile.contact,
      });
      setProfile(updated);
      setToast({ kind: 'success', message: 'Profile saved' });
    } catch (error) {
      console.error(error);
      setToast({ kind: 'error', message: 'Failed to save profile' });
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-gray-50 p-6">
      <Toast toast={toast} />
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-800">Admin Profile</h1>
        <p className="text-sm text-gray-500">
          Update the account details shown across the admin portal.
        </p>
      </div>

      {loading ? (
        <div className="mt-6 flex items-center gap-3 text-sm text-gray-500">
          <Spinner size="sm" />
          Loading profile...
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ['display_name', 'Display name'],
              ['email', 'Email'],
              ['job_title', 'Job title'],
              ['contact', 'Contact'],
            ].map(([field, label]) => (
              <label key={field} className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                  {label}
                </span>
                <input
                  type="text"
                  value={profile?.[field] || ''}
                  onChange={(event) => setProfile((current) => ({ ...current, [field]: event.target.value }))}
                  className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-rwendo-accent focus:outline-none"
                />
              </label>
            ))}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={saveProfile}
              className="rounded-md bg-rwendo-accent px-6 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Save Profile
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
