import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { DetectionLog } from '../types';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';
import { 
  Activity, AlertTriangle, CheckCircle, Clock, 
  Download, Filter, LayoutDashboard, List, Users 
} from 'lucide-react';
import { formatDate } from '../lib/utils';

export default function Dashboard() {
  const [logs, setLogs] = useState<DetectionLog[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    masks: 0,
    violations: 0,
    recentViolations: 0
  });

  useEffect(() => {
    const q = query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newLogs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as DetectionLog[];
      setLogs(newLogs);

      const masks = newLogs.filter(l => l.status === 'mask').length;
      const violations = newLogs.filter(l => l.status === 'no_mask').length;
      
      setStats({
        total: newLogs.length,
        masks,
        violations,
        recentViolations: newLogs.slice(0, 10).filter(l => l.status === 'no_mask').length
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'logs');
    });

    return () => unsubscribe();
  }, []);

  const chartData = [
    { name: 'Masks', value: stats.masks, color: '#10b981' },
    { name: 'Violations', value: stats.violations, color: '#ef4444' }
  ];

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Admin Dashboard</h1>
          <p className="text-zinc-400 mt-1">Real-time monitoring and violation analytics</p>
        </div>
        <div className="flex items-center space-x-3">
          <button className="flex items-center px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg border border-zinc-700 transition-colors text-sm font-medium">
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </button>
          <button className="flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors text-sm font-medium">
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </button>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Detections" 
          value={stats.total} 
          icon={<Activity className="w-6 h-6 text-blue-500" />} 
          trend="+12% from last hour"
        />
        <StatCard 
          title="Mask Compliance" 
          value={`${stats.total ? Math.round((stats.masks / stats.total) * 100) : 0}%`} 
          icon={<CheckCircle className="w-6 h-6 text-emerald-500" />} 
          trend="Stable"
        />
        <StatCard 
          title="Total Violations" 
          value={stats.violations} 
          icon={<AlertTriangle className="w-6 h-6 text-red-500" />} 
          trend="Critical"
        />
        <StatCard 
          title="Active Operators" 
          value="3" 
          icon={<Users className="w-6 h-6 text-purple-500" />} 
          trend="Online"
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-white mb-6">Compliance Overview</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="name" stroke="#71717a" />
                <YAxis stroke="#71717a" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl">
          <h3 className="text-lg font-semibold text-white mb-6">Recent Activity Logs</h3>
          <div className="overflow-hidden">
            <div className="overflow-y-auto max-h-80 space-y-3 pr-2 custom-scrollbar">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${log.status === 'mask' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                      {log.status === 'mask' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{log.status === 'mask' ? 'Compliance' : 'Violation'}</p>
                      <p className="text-xs text-zinc-500">{log.location}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-zinc-400">{formatDate(log.timestamp)}</p>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-tighter">{log.userName}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, trend }: { title: string, value: string | number, icon: React.ReactNode, trend: string }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl hover:border-zinc-700 transition-all group">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 bg-zinc-800 rounded-lg group-hover:scale-110 transition-transform">
          {icon}
        </div>
        <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">{trend}</span>
      </div>
      <h3 className="text-zinc-500 text-sm font-medium">{title}</h3>
      <p className="text-3xl font-bold text-white mt-1">{value}</p>
    </div>
  );
}
