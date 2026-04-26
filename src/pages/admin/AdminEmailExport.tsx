import { useCallback, useMemo, useState } from 'react';
import { invokeFunction } from '../../lib/supabase';

const EXPORT_GROUPS = [
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending approval' },
  { key: 'expires60', label: 'Expires ≤60 days (pending renewal)' },
  { key: 'expired', label: 'Expired' },
  { key: 'lapsed90', label: 'Long-lapsed (365+ days past expiry)' },
  { key: 'rejected30', label: 'Rejected (last 30 days)' },
  { key: 'archived', label: 'Archived' },
  { key: 'matched', label: 'Matched' },
] as const;

type ExportKey = (typeof EXPORT_GROUPS)[number]['key'];

type Separator = ',' | ';' | '\n';

export default function AdminEmailExport() {
  const [selected, setSelected] = useState<Record<ExportKey, boolean>>(() => {
    const init = {} as Record<ExportKey, boolean>;
    for (const g of EXPORT_GROUPS) init[g.key] = false;
    return init;
  });
  const [separator, setSeparator] = useState<Separator>(';');
  const [emails, setEmails] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [profilesUnion, setProfilesUnion] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedKeys = useMemo(
    () => EXPORT_GROUPS.filter((g) => selected[g.key]).map((g) => g.key),
    [selected]
  );

  const formatted = useMemo(() => emails.join(separator === '\n' ? '\n' : separator), [emails, separator]);

  const fetchEmails = useCallback(async () => {
    if (selectedKeys.length === 0) {
      setError('Select at least one group.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = (await invokeFunction('admin-manage-users', {
        action: 'export_emails',
        statuses: selectedKeys,
      })) as {
        emails?: string[];
        counts?: Record<string, number>;
        total?: number;
        profiles_union?: number;
      };
      setEmails(res.emails ?? []);
      setCounts(res.counts ?? {});
      setProfilesUnion(typeof res.profiles_union === 'number' ? res.profiles_union : null);
    } catch (e) {
      setEmails([]);
      setCounts({});
      setProfilesUnion(null);
      setError(e instanceof Error ? e.message : 'Could not load emails');
    } finally {
      setLoading(false);
    }
  }, [selectedKeys]);

  async function copyToClipboard() {
    if (!formatted) return;
    try {
      await navigator.clipboard.writeText(formatted);
      alert('Copied to clipboard.');
    } catch {
      alert('Could not copy — select the text manually or try Download.');
    }
  }

  function downloadTxt() {
    if (!formatted) return;
    const blob = new Blob([formatted], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `member-emails-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const breakdownParts = EXPORT_GROUPS.filter((g) => selected[g.key] && counts[g.key] != null).map(
    (g) => `${g.label}: ${counts[g.key] ?? 0}`
  );

  return (
    <div>
      <h1>Export emails</h1>
      <p className="field-hint" style={{ marginTop: -8, marginBottom: 16 }}>
        Select member groups, then <strong>Get emails</strong>. Copy the list into Outlook (BCC recommended).
        Nothing is sent from this site.
      </p>

      {error && (
        <p className="card" style={{ color: 'var(--color-danger)', marginBottom: 12, padding: 12 }}>
          {error}
        </p>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 10 }}>Include</legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {EXPORT_GROUPS.map((g) => (
              <label key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!selected[g.key]}
                  onChange={(e) => setSelected((s) => ({ ...s, [g.key]: e.target.checked }))}
                />
                <span>{g.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void fetchEmails()}>
            {loading ? 'Loading…' : 'Get emails'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const next = { ...selected } as Record<ExportKey, boolean>;
              for (const g of EXPORT_GROUPS) next[g.key] = true;
              setSelected(next);
            }}
          >
            Select all groups
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const next = {} as Record<ExportKey, boolean>;
              for (const g of EXPORT_GROUPS) next[g.key] = false;
              setSelected(next);
            }}
          >
            Clear groups
          </button>
        </div>
      </div>

      {emails.length > 0 || Object.keys(counts).length > 0 ? (
        <div className="card" style={{ padding: 16 }}>
          <p style={{ marginTop: 0, marginBottom: 12 }}>
            <strong>{emails.length}</strong> unique address{emails.length === 1 ? '' : 'es'}
            {profilesUnion != null && (
              <>
                {' '}
                (from <strong>{profilesUnion}</strong> profile{profilesUnion === 1 ? '' : 's'} in union of selected
                groups)
              </>
            )}
          </p>
          {breakdownParts.length > 0 && (
            <p className="field-hint" style={{ marginBottom: 12 }}>
              Per group (profile rows): {breakdownParts.join(' · ')}
            </p>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Separator</span>
              <select
                className="btn btn-secondary"
                style={{ padding: '6px 10px' }}
                value={separator}
                onChange={(e) => setSeparator(e.target.value as Separator)}
              >
                <option value=";">Semicolon (;) — Outlook</option>
                <option value=",">Comma (,)</option>
                <option value={'\n'}>New line</option>
              </select>
            </label>
            <button type="button" className="btn btn-secondary" disabled={!formatted} onClick={() => void copyToClipboard()}>
              Copy to clipboard
            </button>
            <button type="button" className="btn btn-secondary" disabled={!formatted} onClick={downloadTxt}>
              Download as .txt
            </button>
          </div>

          <textarea
            readOnly
            value={formatted}
            rows={Math.min(20, Math.max(8, Math.ceil(emails.length / 4)))}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
            spellCheck={false}
          />
        </div>
      ) : null}
    </div>
  );
}
