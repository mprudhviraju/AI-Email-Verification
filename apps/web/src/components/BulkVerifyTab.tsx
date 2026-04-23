import { useState, useCallback } from 'react';
import {
  useCreateVerificationBatchMutation,
  useEmailVerificationBatchQuery,
} from 'shared';
import { VerificationResultsTable } from './VerificationResultsTable';

type BatchSummary = {
  id: string;
  label: string;
  status: string;
  currentStage?: string | null;
  totalCount: number;
  completedCount: number;
  validCount: number;
  invalidCount: number;
  riskyCount: number;
  unknownCount: number;
  syntaxDone: number;
  dnsDone: number;
  smtpDone: number;
  enrichmentDone: number;
  validPct: number;
  invalidPct: number;
  riskyPct: number;
  unknownPct: number;
};

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className={`rounded-xl p-4 ${color}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs mt-0.5 opacity-70">{label}</div>
    </div>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs text-gray-500 mb-1.5">
        <span>Verifying emails…</span>
        <span>{completed} / {total} ({pct}%)</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const STAGES = [
  { key: 'syntax',     label: 'Syntax',     field: 'syntaxDone' },
  { key: 'dns',        label: 'DNS',        field: 'dnsDone' },
  { key: 'smtp',       label: 'SMTP',       field: 'smtpDone' },
  { key: 'enrichment', label: 'Enrichment', field: 'enrichmentDone' },
] as const;

function StagePipeline({ batch }: { batch: BatchSummary }) {
  const total = batch.totalCount;
  const active = batch.currentStage;
  return (
    <div className="space-y-2.5 mb-5">
      {STAGES.map((s) => {
        const done = Number(batch[s.field] ?? 0);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const isDone = total > 0 && done >= total;
        const isActive = active === s.key && !isDone;
        const bar = isDone ? 'bg-green-500' : isActive ? 'bg-indigo-500' : 'bg-gray-300';
        const lbl = isActive
          ? 'text-indigo-700 font-semibold'
          : isDone
            ? 'text-green-700'
            : 'text-gray-600';
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className={`w-24 text-xs ${lbl}`}>{s.label}</div>
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${bar} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="w-24 text-right text-xs text-gray-500 tabular-nums">
              {done}/{total} {isDone ? '✓' : isActive ? '…' : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BatchResults({ batchId }: { batchId: string }) {
  const { data } = useEmailVerificationBatchQuery({
    variables: { id: batchId },
    pollInterval: 2000,
    fetchPolicy: 'network-only',
  });

  const batch = data?.emailVerificationBatch as BatchSummary | null | undefined;
  if (!batch) return <div className="text-sm text-gray-400 text-center py-4">Loading batch…</div>;

  const isRunning = batch.status === 'RUNNING' || batch.status === 'PENDING';

  return (
    <div>
      {isRunning && (
        <>
          <ProgressBar completed={batch.completedCount} total={batch.totalCount} />
          <StagePipeline batch={batch} />
        </>
      )}

      {batch.status === 'DONE' && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          <StatCard label="Valid" value={`${batch.validPct}%`} color="bg-green-50 text-green-700" />
          <StatCard label="Invalid" value={`${batch.invalidPct}%`} color="bg-red-50 text-red-700" />
          <StatCard label="Risky" value={`${batch.riskyPct}%`} color="bg-yellow-50 text-yellow-700" />
          <StatCard label="Unknown" value={`${batch.unknownPct}%`} color="bg-gray-50 text-gray-700" />
        </div>
      )}

      <VerificationResultsTable batchId={batchId} />
    </div>
  );
}

export function BulkVerifyTab() {
  const [dragOver, setDragOver] = useState(false);
  const [label, setLabel] = useState('');
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [createBatch, { loading }] = useCreateVerificationBatchMutation();

  const processFile = useCallback(
    async (file: File) => {
      setError('');
      const csvContent = await file.text();
      const batchLabel = label || file.name.replace(/\.[^/.]+$/, '');
      try {
        const result = await createBatch({ variables: { label: batchLabel, csvContent } });
        const id = result.data?.createVerificationBatch.id;
        if (id) setActiveBatchId(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      }
    },
    [createBatch, label],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }

  return (
    <div>
      {!activeBatchId ? (
        <div className="max-w-lg mx-auto">
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Batch label <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. March campaign list"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <label
            className={`block border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-indigo-400 bg-indigo-50'
                : 'border-gray-300 hover:border-indigo-300 bg-gray-50'
            } ${loading ? 'opacity-50 pointer-events-none' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <input
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={onFileChange}
              disabled={loading}
            />
            <div className="text-4xl mb-3">📋</div>
            <p className="text-sm font-medium text-gray-700">
              {loading ? 'Uploading…' : 'Drop your CSV or TXT file here'}
            </p>
            <p className="text-xs text-gray-400 mt-1">or click to browse — up to 50,000 emails</p>
          </label>

          {error && (
            <p className="mt-3 text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">Verification Progress</h3>
            <button
              onClick={() => setActiveBatchId(null)}
              className="text-xs text-indigo-600 hover:underline"
            >
              ← New batch
            </button>
          </div>
          <BatchResults batchId={activeBatchId} />
        </div>
      )}
    </div>
  );
}
