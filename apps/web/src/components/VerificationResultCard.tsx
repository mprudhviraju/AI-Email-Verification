import type { VerifySingleEmailMutation } from 'shared';

type Result = NonNullable<VerifySingleEmailMutation['verifySingleEmail']>;

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  VALID:       { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Valid' },
  INVALID:     { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Invalid' },
  RISKY:       { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Risky' },
  CATCH_ALL:   { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Catch-All' },
  DISPOSABLE:  { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Disposable' },
  ROLE_BASED:  { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Role-Based' },
  UNKNOWN:     { bg: 'bg-gray-100',   text: 'text-gray-700',   label: 'Unknown' },
};

const CONFIDENCE_STYLES: Record<string, string> = {
  HIGH:   'bg-green-50 text-green-600 border border-green-200',
  MEDIUM: 'bg-yellow-50 text-yellow-600 border border-yellow-200',
  LOW:    'bg-gray-50 text-gray-500 border border-gray-200',
};

function ScoreRing({ score }: { score: number }) {
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const filled = (score / 100) * circ;
  const color =
    score >= 80 ? '#16a34a' : score >= 50 ? '#ca8a04' : '#dc2626';

  return (
    <div className="flex flex-col items-center">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
          fontSize="20" fontWeight="bold" fill={color}>{score}</text>
      </svg>
      <span className="text-xs text-gray-500 -mt-1">Score</span>
    </div>
  );
}

// positive=true  → green Yes / red No   (good when true,  e.g. MX Found)
// positive=false → red Yes / green No   (bad  when true,  e.g. Disposable)
function Flag({ label, value, positive = false }: { label: string; value: boolean; positive?: boolean }) {
  const isGood = positive ? value : !value;
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-gray-50">
      <span className="text-xs text-gray-600">{label}</span>
      <span className={`text-xs font-semibold ${isGood ? 'text-green-500' : 'text-red-500'}`}>
        {value ? 'Yes' : 'No'}
      </span>
    </div>
  );
}

export function VerificationResultCard({ result }: { result: Result }) {
  const style = STATUS_STYLES[result.status] ?? STATUS_STYLES['UNKNOWN']!;

  return (
    <div className="border border-gray-200 rounded-2xl p-5 bg-white shadow-sm mt-4">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-gray-800 truncate">{result.email}</p>
          <p className="text-xs text-gray-400 mt-0.5">{result.domain}</p>
        </div>
        <span
          className={`shrink-0 text-xs font-bold px-3 py-1 rounded-full ${style.bg} ${style.text}`}
        >
          {style.label}
        </span>
      </div>

      <div className="flex gap-5 items-center mb-5">
        <ScoreRing score={result.score} />
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Confidence</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CONFIDENCE_STYLES[result.confidence] ?? ''}`}>
              {result.confidence}
            </span>
          </div>
          {result.mxHost && (
            <div className="text-xs text-gray-500">
              MX: <span className="font-mono text-gray-700">{result.mxHost}</span>
            </div>
          )}
          {result.smtpCode != null && (
            <div className="text-xs text-gray-500">
              SMTP: <span className="font-mono text-gray-700">{result.smtpCode}</span>
              {result.smtpMessage && (
                <span className="text-gray-400 ml-1">— {result.smtpMessage.split('\n')[0]}</span>
              )}
            </div>
          )}
          {result.responseTimeMs != null && (
            <div className="text-xs text-gray-400">{result.responseTimeMs}ms</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Flag label="MX Found"       value={result.mxFound}       positive />
        <Flag label="SMTP Reachable" value={result.smtpReachable} positive />
        <Flag label="Catch-All"      value={result.isCatchAll} />
        <Flag label="Disposable"     value={result.isDisposable} />
        <Flag label="Role-Based"     value={result.isRoleBased} />
        <Flag label="Honeypot"       value={result.isHoneypot} />
      </div>

      {/* Enrichment signals — shown only for catch-all domains */}
      {result.isCatchAll && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Enrichment signals</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Flag label="Gravatar Profile" value={result.gravatarFound ?? false} positive />
            <Flag
              label={`HIBP Breaches${(result.hibpBreachCount ?? 0) > 0 ? ` (${result.hibpBreachCount})` : ''}`}
              value={(result.hibpBreachCount ?? 0) > 0}
              positive
            />
          </div>
          {!result.gravatarFound && !(result.hibpBreachCount ?? 0) && (
            <p className="text-xs text-gray-400 mt-2 italic">
              No enrichment signals found — address existence unconfirmed
            </p>
          )}
          {((result.gravatarFound ?? false) || (result.hibpBreachCount ?? 0) > 0) && (
            <p className="text-xs text-amber-600 mt-2">
              Address likely real — enrichment signals confirm past activity
            </p>
          )}
        </div>
      )}

      {result.errorMessage && (
        <p className="mt-3 text-xs text-red-400 bg-red-50 px-3 py-2 rounded-lg font-mono">
          {result.errorMessage}
        </p>
      )}
    </div>
  );
}
