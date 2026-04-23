import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SingleVerifyTab } from './SingleVerifyTab';
import { BulkVerifyTab } from './BulkVerifyTab';
import { BatchHistoryList } from './BatchHistoryList';

type Tab = 'single' | 'bulk';

export function EmailVerifierPage() {
  const [tab, setTab] = useState<Tab>('single');
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem('auth_token');
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">✉️</span>
            <span className="font-bold text-lg tracking-tight">AI Email Verifier</span>
          </div>
          <button
            onClick={logout}
            className="text-slate-400 hover:text-white text-sm transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Email Verification</h1>
          <p className="text-gray-500 mt-2 max-w-xl mx-auto text-sm">
            SMTP-level verification — not just syntax. We perform a live handshake with the
            receiving mail server to confirm each address is real and deliverable.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-white mb-6 max-w-sm mx-auto shadow-sm">
          {([
            { key: 'single', label: 'Single Check', icon: '🔍' },
            { key: 'bulk',   label: 'Bulk Verify',  icon: '📋' },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          {tab === 'single' ? <SingleVerifyTab /> : <BulkVerifyTab />}
        </div>

        {/* History */}
        <BatchHistoryList />
      </main>
    </div>
  );
}
