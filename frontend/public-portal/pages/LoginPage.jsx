import React, { useState } from 'react';
import LoginCard from '@shared/components/LoginCard';

export default function LoginPage({ login, logout }) {
  const [error, setError] = useState(null);

  async function handleSubmit(username, password) {
    setError(null);
    try {
      const u = await login(username, password);
      if (u.role !== 'public' && u.role !== 'admin') {
        setError('Access denied.');
        await logout();
      }
    } catch (e) {
      if (e.status === 401) setError('Invalid credentials.');
      else setError(e.message || 'Sign in failed');
    }
  }

  return (
    <LoginCard
      heading="Rwendo Traffic - Harare"
      subheading="Sign in to view the live traffic network."
      onSubmit={handleSubmit}
      error={error}
    />
  );
}
