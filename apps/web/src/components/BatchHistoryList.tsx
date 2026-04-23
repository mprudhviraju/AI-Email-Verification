import { useEmailVerificationBatchesQuery, useDeleteVerificationBatchMutation, type EmailVerificationBatchesQuery } from 'shared';

type Batch = NonNullable<EmailVerificationBatchesQuery['emailVerificationBatches']>[number];

const STATUS_BADGE: Record<string, string> = {
  DONE:    'bg-green-100 text-green-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  FAILED:  'bg-red-100 text-red-700',
};

export function BatchHistoryList() {
  const { data, refetch } = useEmailVerificationBatchesQuery({
    variables: { limit: 20, offset: 0 },
    fetchPolicy: 'network-only',
  });
  const [deleteBatch] = useDeleteVerificationBatchMutation();

  const batches = data?.emailVerificationBatches ?? [];

  if (batches.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
        Past Batches
      </h2>
      <div className="space-y-2">
        {batches.map((b: Batch) => (
          <div
            key={b.id}
            className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{b.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(b.createdAt).toLocaleString()} · {b.totalCount.toLocaleString()} emails
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              {b.status === 'DONE' && (
                <div className="flex gap-3 text-xs text-gray-500">
                  <span className="text-green-600 font-semibold">{b.validPct}% valid</span>
                  <span className="text-red-500">{b.invalidPct}% invalid</span>
                </div>
              )}
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[b.status] ?? 'bg-gray-100 text-gray-600'}`}
              >
                {b.status}
              </span>
              <a
                href={`/export/batch/${b.id}/csv`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-600 hover:underline"
              >
                CSV
              </a>
              <button
                onClick={async () => {
                  await deleteBatch({ variables: { id: b.id } });
                  refetch();
                }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                title="Delete batch"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
