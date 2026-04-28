import React, { useEffect, useState } from 'react';
import LandingPage from './pages/LandingPage.jsx';
import LiveMapPage from './pages/LiveMapPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import { useAuth } from '@shared/hooks/useAuth';

export default function App() {
  const { user, login, signup, logout, loading, saveProfile } = useAuth('public');
  const [view, setView] = useState('map');

  useEffect(() => {
    if (!user) {
      setView('map');
    }
  }, [user]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 text-slate-600">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <LandingPage login={login} signup={signup} />;
  }

  if (view === 'profile') {
    return <ProfilePage user={user} onLogout={logout} onBack={() => setView('map')} onSave={saveProfile} />;
  }

  return <LiveMapPage user={user} onLogout={logout} onOpenProfile={() => setView('profile')} />;
}
