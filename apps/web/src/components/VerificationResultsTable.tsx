import { useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { useEmailVerificationResultsQuery, type EmailVerificationStatus } from 'shared';

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  VALID:       { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Valid' },
  INVALID:     { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Invalid' },
  RISKY:       { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Risky' },
  CATCH_ALL:   { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Catch-All' },
  DISPOSABLE:  { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Disposable' },
  ROLE_BASED:  { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Role-Based' },
  UNKNOWN:     { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'Unknown' },
};

type Row = {
  id: string;
  email: string;
  domain: string;
  status: string;
  score: number;
  confidence: string;
  mxFound: boolean;
  mxHost?: string | null;
  smtpReachable: boolean;
  smtpCode?: number | null;
  isDisposable: boolean;
  isRoleBased: boolean;
  isCatchAll: boolean;
  isHoneypot: boolean;
  verifiedAt: string;
  responseTimeMs?: number | null;
  errorMessage?: string | null;
};

const col = createColumnHelper<Row>();

const columns = [
  col.accessor('email', {
    header: 'Email',
    cell: (info) => (
      <span className="font-mono text-xs text-gray-800">{info.getValue()}</span>
    ),
  }),
  col.accessor('status', {
    header: 'Status',
    cell: (info) => {
      const s = STATUS_BADGE[info.getValue()] ?? STATUS_BADGE['UNKNOWN']!;
      return (
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>
          {s.label}
        </span>
      );
    },
  }),
  col.accessor('score', {
    header: 'Score',
    cell: (info) => {
      const v = info.getValue();
      const color = v >= 80 ? 'text-green-600' : v >= 50 ? 'text-yellow-600' : 'text-red-500';
      return <span className={`font-bold text-sm ${color}`}>{v}</span>;
    },
  }),
  col.accessor('mxFound', {
    header: 'MX',
    cell: (info) => (
      <span className={`text-xs ${info.getValue() ? 'text-green-500' : 'text-red-400'}`}>
        {info.getValue() ? '✓' : '✗'}
      </span>
    ),
  }),
  col.accessor('smtpReachable', {
    header: 'SMTP',
    cell: (info) => (
      <span className={`text-xs ${info.getValue() ? 'text-green-500' : 'text-red-400'}`}>
        {info.getValue() ? '✓' : '✗'}
      </span>
    ),
  }),
  col.accessor('smtpCode', {
    header: 'Code',
    cell: (info) => (
      <span className="font-mono text-xs text-gray-500">{info.getValue() ?? '—'}</span>
    ),
  }),
  col.accessor('isDisposable', {
    header: 'Disposable',
    cell: (info) => (
      <span className={`text-xs ${info.getValue() ? 'text-orange-500 font-semibold' : 'text-gray-300'}`}>
        {info.getValue() ? 'Yes' : 'No'}
      </span>
    ),
  }),
  col.accessor('isCatchAll', {
    header: 'Catch-All',
    cell: (info) => (
      <span className={`text-xs ${info.getValue() ? 'text-purple-500 font-semibold' : 'text-gray-300'}`}>
        {info.getValue() ? 'Yes' : 'No'}
      </span>
    ),
  }),
  col.accessor('verifiedAt', {
    header: 'Verified',
    cell: (info) => (
      <span className="text-xs text-gray-400">
        {new Date(info.getValue()).toLocaleTimeString()}
      </span>
    ),
  }),
];

const STATUS_OPTIONS = ['', 'VALID', 'INVALID', 'RISKY', 'CATCH_ALL', 'DISPOSABLE', 'ROLE_BASED', 'UNKNOWN'];
const PAGE_SIZE = 100;

export function VerificationResultsTable({ batchId }: { batchId: string }) {
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([]);

  const { data, loading } = useEmailVerificationResultsQuery({
    variables: {
      batchId,
      status: statusFilter ? (statusFilter as EmailVerificationStatus) : undefined,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    },
    pollInterval: 3000,
    fetchPolicy: 'network-only',
  });

  const rows = (data?.emailVerificationResults.results ?? []) as Row[];
  const total = data?.emailVerificationResults.total ?? 0;

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-3 items-center justify-between">
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            placeholder="Search email or domain…"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s || 'All statuses'}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{total} results</span>
          <button
            onClick={() => window.open(`/export/batch/${batchId}/csv`)}
            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === 'asc' ? ' ↑' : h.column.getIsSorted() === 'desc' ? ' ↓' : ''}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-8 text-gray-400 text-sm">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-8 text-gray-400 text-sm">
                    No results yet
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2.5 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex justify-between items-center mt-3">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="text-sm text-indigo-600 disabled:text-gray-300 hover:underline"
          >
            ← Previous
          </button>
          <span className="text-xs text-gray-400">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="text-sm text-indigo-600 disabled:text-gray-300 hover:underline"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
