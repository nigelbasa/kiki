import React, { useState } from 'react';
import LoginCard from '@shared/components/LoginCard';

export default function LoginPage({ login }) {
  const [error, setError] = useState(null);

  async function handleSubmit(username, password) {
    setError(null);
    if (!username || !password) {
      setError('Username and password are required.');
      return;
    }
    try {
      await login(username, password);
    } catch (e) {
      if (e.status === 401) {
        setError('Invalid credentials.');
      } else if (e.status === 403) {
        setError(e.detail || 'Access denied — admin accounts only.');
      } else if (e.status === 440) {
        setError(e.message);
      } else {
        setError(e.detail || e.message || 'Sign in failed.');
      }
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

