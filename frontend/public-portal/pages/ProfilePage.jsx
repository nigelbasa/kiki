import React, { useEffect, useMemo, useState } from 'react';
import { get } from '@shared/api/client';

export default function ProfilePage({ user, onSave, onBack, onLogout }) {
  const [form, setForm] = useState({
    display_name: user.display_name || '',
    email: '',
    contact: '',
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    let cancelled = false;
    get('/api/auth/profile')
      .then((profile) => {
        if (!cancelled) {
          setForm({
            display_name: profile.display_name || '',
            email: profile.email || '',
            contact: profile.contact || '',
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const initials = useMemo(
    () => (user.display_name || '?').split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase(),
    [user.display_name],
  );

  async function handleSave() {
    setBusy(true);
    setSaved('');
    try {
      await onSave(form);
      setSaved('Profile updated');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <button type="button" onClick={onBack} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Back to map
            </button>
            <button type="button" onClick={onLogout} className="rounded-full border border-rwendo-accent px-4 py-2 text-sm font-medium text-rwendo-accent hover:bg-rwendo-accent hover:text-white">
              Sign out
            </button>
          </div>

          <div className="mt-6 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rwendo-accent/10 text-xl font-bold text-rwendo-accent">
              {initials}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Public Profile</h1>
              <p className="text-sm text-slate-500">Manage the account used by the public traffic portal.</p>
            </div>
          </div>
        </div>

        <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ['display_name', 'Display name'],
              ['email', 'Email'],
              ['contact', 'Contact'],
            ].map(([field, label]) => (
              <label key={field} className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
                <input
                  type="text"
                  value={form[field] || ''}
                  onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-rwendo-accent"
                />
              </label>
            ))}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Username</span>
              <input type="text" value={user.username} disabled className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500" />
            </label>
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <div className="text-sm text-emerald-700">{saved}</div>
            <button type="button" onClick={handleSave} disabled={busy} className="rounded-xl bg-rwendo-accent px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
              {busy ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
