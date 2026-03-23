import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import Auth from './components/Auth';
import CameraView from './components/CameraView';
import Dashboard from './components/Dashboard';
import ErrorBoundary from './components/ErrorBoundary';
import { Shield, Camera, LayoutDashboard, LogOut, User as UserIcon } from 'lucide-react';
import { cn } from './lib/utils';

type View = 'camera' | 'dashboard';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<View>('camera');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500 border border-emerald-500/20">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">Mask Check </h1>
              <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold">Security  Systems</p>
            </div>
          </div>

          <div className="hidden md:flex items-center bg-zinc-900/50 p-1 rounded-xl border border-zinc-800">
            <NavButton 
              active={activeView === 'camera'} 
              onClick={() => setActiveView('camera')}
              icon={<Camera className="w-4 h-4" />}
              label="Live Monitor"
            />
            <NavButton 
              active={activeView === 'dashboard'} 
              onClick={() => setActiveView('dashboard')}
              icon={<LayoutDashboard className="w-4 h-4" />}
              label="Analytics"
            />
          </div>

          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex items-center space-x-3 px-3 py-1.5 bg-zinc-900 rounded-lg border border-zinc-800">
              <div className="w-6 h-6 bg-zinc-800 rounded-full flex items-center justify-center">
                <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
              </div>
              <span className="text-xs font-medium text-zinc-300">{user.displayName || user.email}</span>
            </div>
            <button 
              onClick={() => signOut(auth)}
              className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      <div className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 p-1.5 rounded-2xl shadow-2xl flex items-center space-x-1">
        <NavButton 
          active={activeView === 'camera'} 
          onClick={() => setActiveView('camera')}
          icon={<Camera className="w-4 h-4" />}
          label="Monitor"
        />
        <NavButton 
          active={activeView === 'dashboard'} 
          onClick={() => setActiveView('dashboard')}
          icon={<LayoutDashboard className="w-4 h-4" />}
          label="Analytics"
        />
      </div>

      <main className="pb-24 md:pb-8">
        {activeView === 'camera' ? <CameraView /> : <Dashboard />}
      </main>

      <footer className="py-8 border-t border-zinc-900 text-center">
        <p className="text-xs text-zinc-600">© 2026 Mask Check Security Systems. All rights reserved.</p>
      </footer>
      </div>
    </ErrorBoundary>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center space-x-2 px-4 py-2 rounded-lg transition-all text-sm font-medium",
        active 
          ? "bg-emerald-600 text-white shadow-lg shadow-emerald-900/20" 
          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
