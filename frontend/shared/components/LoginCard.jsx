import React, { useState } from 'react';

export default function LoginCard({ heading, subheading, onSubmit, error }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(username, password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl"
      >
        <div className="mb-6 flex items-center gap-2">
          <div className="rounded-md bg-rwendo-accent/10 p-2 text-rwendo-accent">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <rect x="8" y="2" width="8" height="20" rx="3" fill="currentColor" />
              <circle cx="12" cy="7" r="2" fill="#f87171" />
              <circle cx="12" cy="12" r="2" fill="#fb923c" />
              <circle cx="12" cy="17" r="2" fill="#4ade80" />
            </svg>
          </div>
          <div>
            <div className="text-lg font-bold text-rwendo-accent">Rwendo</div>
            <div className="text-xs text-gray-500">{heading}</div>
          </div>
        </div>

        {subheading && <p className="mb-4 text-sm text-gray-600">{subheading}</p>}

        <label className="block text-xs font-medium uppercase text-gray-500">Username</label>
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rwendo-accent focus:outline-none"
          required
        />

        <label className="mt-3 block text-xs font-medium uppercase text-gray-500">
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rwendo-accent focus:outline-none"
          required
        />

        {error && (
          <div className="mt-3 rounded bg-signal-red/10 px-3 py-2 text-sm text-signal-red">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-md bg-rwendo-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {busy ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
