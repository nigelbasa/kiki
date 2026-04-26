import React, { useState } from 'react';

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-rwendo-accent"
      />
    </label>
  );
}

export default function LandingPage({ login, signup }) {
  const [mode, setMode] = useState('signup');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signupForm, setSignupForm] = useState({
    username: '',
    password: '',
    display_name: '',
    email: '',
    contact: '',
  });
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        await signup(signupForm);
      } else {
        await login(loginForm.username, loginForm.password);
      }
    } catch (err) {
      if (err.status === 409) setError('That username already exists.');
      else if (err.status === 401) setError('Invalid credentials.');
      else setError(err.message || 'Could not continue.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="inline-flex rounded-full bg-rwendo-accent/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-rwendo-accent">
            Rwendo Public
          </div>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-900">
            Stay ahead of congestion before you leave.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            See live junction pressure, public alerts, and quick route guidance from the smart signal network.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ['Live road status', 'Track the busiest corridors in real time.'],
              ['Route guidance', 'Get simple alternatives when one side builds up.'],
              ['Public alerts', 'See emergency and congestion advisories quickly.'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-[22px] bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">{title}</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex rounded-full bg-slate-100 p-1 text-sm font-semibold">
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 rounded-full px-4 py-2 transition ${mode === 'signup' ? 'bg-rwendo-accent text-white' : 'text-slate-600'}`}
            >
              Sign up
            </button>
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 rounded-full px-4 py-2 transition ${mode === 'login' ? 'bg-rwendo-accent text-white' : 'text-slate-600'}`}
            >
              Sign in
            </button>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {mode === 'signup' ? (
              <>
                <Field label="Display name" value={signupForm.display_name} onChange={(value) => setSignupForm((current) => ({ ...current, display_name: value }))} />
                <Field label="Username" value={signupForm.username} onChange={(value) => setSignupForm((current) => ({ ...current, username: value }))} />
                <Field label="Email" value={signupForm.email} onChange={(value) => setSignupForm((current) => ({ ...current, email: value }))} />
                <Field label="Contact" value={signupForm.contact} onChange={(value) => setSignupForm((current) => ({ ...current, contact: value }))} />
                <Field label="Password" type="password" value={signupForm.password} onChange={(value) => setSignupForm((current) => ({ ...current, password: value }))} />
              </>
            ) : (
              <>
                <Field label="Username" value={loginForm.username} onChange={(value) => setLoginForm((current) => ({ ...current, username: value }))} />
                <Field label="Password" type="password" value={loginForm.password} onChange={(value) => setLoginForm((current) => ({ ...current, password: value }))} />
              </>
            )}

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-rwendo-accent px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="mt-4 text-xs leading-6 text-slate-500">
            Admin accounts are seeded by the backend. Public accounts are created here and stored in the shared database.
          </p>
        </section>
      </div>
    </div>
  );
}
