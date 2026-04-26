import React, { useState } from 'react';
import LoginCard from '@shared/components/LoginCard';

export default function LoginPage({ login, logout }) {
  const [error, setError] = useState(null);

  async function handleSubmit(username, password) {
    setError(null);
    try {
      const u = await login(username, password);
      if (u.role !== 'admin') {
        setError('Access denied - admin accounts only');
        await logout();
      }
    } catch (e) {
      if (e.status === 401) setError('Invalid credentials.');
      else setError(e.message || 'Sign in failed');
    }
  }

  return (
    <LoginCard
      heading="Admin Portal"
      subheading="Sign in with an administrator account to control the simulation."
      onSubmit={handleSubmit}
      error={error}
    />
  );
}
