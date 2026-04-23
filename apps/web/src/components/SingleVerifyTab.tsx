import { useState } from 'react';
import { useVerifySingleEmailMutation } from 'shared';
import { VerificationResultCard } from './VerificationResultCard';

export function SingleVerifyTab() {
  const [email, setEmail] = useState('');
  const [verify, { data, loading, error }] = useVerifySingleEmailMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    await verify({ variables: { email: email.trim() } });
  }

  return (
    <div className="max-w-lg mx-auto">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter an email address to verify…"
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={loading || !email.trim()}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap"
        >
          {loading ? 'Verifying…' : 'Verify'}
        </button>
      </form>

      {error && (
        <p className="mt-3 text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">
          {error.message}
        </p>
      )}

      {data?.verifySingleEmail && (
        <VerificationResultCard result={data.verifySingleEmail} />
      )}
    </div>
  );
}
