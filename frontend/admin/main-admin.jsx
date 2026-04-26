import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import LoginPage from './pages/LoginPage.jsx';
import { useAuth } from '@shared/hooks/useAuth';
import '@shared/styles.css';

function AuthGate() {
  const { user, login, logout, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-gray-300">
        Loading...
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return <LoginPage login={login} logout={logout} />;
  }

  return <App user={user} onLogout={logout} />;
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthGate />
  </BrowserRouter>
);
