import React from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import SimulationPage from './pages/SimulationPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import DetectionPage from './pages/DetectionPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import { useSimulation } from '@shared/hooks/useSimulation';
import { useDetection } from '@shared/hooks/useDetection';

function SignalIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="8" y="2" width="8" height="20" rx="3" fill="currentColor" />
      <circle cx="12" cy="7" r="2" fill="#f87171" />
      <circle cx="12" cy="12" r="2" fill="#fb923c" />
      <circle cx="12" cy="17" r="2" fill="#4ade80" />
    </svg>
  );
}

function SimIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 6h18M3 18h18" /><path d="M7 6v12M17 6v12" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 20h16" /><rect x="6" y="11" width="3" height="7" /><rect x="11" y="8" width="3" height="10" /><rect x="16" y="5" width="3" height="13" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7l1.2-2h3.6L15 7" /><circle cx="12" cy="13.5" r="3.3" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 9a6 6 0 1112 0v4l2 3H4l2-3z" />
      <path d="M10 19a2 2 0 004 0" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
      <path d="M10 13h6M10 17h6M10 9h2" />
    </svg>
  );
}

const NAV_ITEMS = [
  { id: 'simulation', label: 'Simulation', icon: SimIcon, path: '/simulation' },
  { id: 'analytics', label: 'Analytics', icon: ChartIcon, path: '/analytics' },
  { id: 'reports', label: 'Reports', icon: ReportIcon, path: '/reports' },
  { id: 'notifications', label: 'Notifications', icon: BellIcon, path: '/notifications' },
  { id: 'detection', label: 'Detection', icon: CameraIcon, path: '/detection' },
  { id: 'settings', label: 'Settings', icon: GearIcon, path: '/settings' },
  { id: 'profile', label: 'Profile', icon: GearIcon, path: '/profile' },
];

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export default function App({ user, onLogout }) {
  const { connected } = useSimulation();
  const detection = useDetection();

  return (
    <div className="flex h-screen w-screen bg-gray-100">
      <aside className="flex w-60 flex-col border-r border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-4">
          <div className="rounded-md bg-rwendo-accent/10 p-2 text-rwendo-accent">
            <SignalIcon className="h-5 w-5" />
          </div>
          <div className="text-lg font-bold text-rwendo-accent">Rwendo</div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.id}
                to={item.path}
                className={({ isActive }) =>
                  `flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-rwendo-accent text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                <Icon />
                <span>{item.label}</span>
                {item.id === 'detection' && detection.isProcessing && (
                  <span className="relative ml-auto flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-rwendo-accent opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rwendo-accent" />
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-gray-200 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-600">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? 'bg-signal-green' : 'bg-gray-400'}`} />
            {connected ? 'Live' : 'Offline'}
          </div>
          {user && (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-rwendo-accent/20 text-xs font-bold text-rwendo-accent">
                {initials(user.display_name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-800">{user.display_name}</div>
                <button onClick={onLogout} className="text-xs text-rwendo-accent hover:underline">Sign out</button>
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/simulation" element={<SimulationPage user={user} detection={detection} />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/notifications" element={<NotificationsPage user={user} />} />
          <Route path="/detection" element={<DetectionPage detection={detection} />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/simulation" replace />} />
        </Routes>
      </main>
    </div>
  );
}
