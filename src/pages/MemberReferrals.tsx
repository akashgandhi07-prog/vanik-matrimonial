import { useEffect, useState } from 'react';
import { useMemberArea } from '../member/memberContext';
import { invokeFunction } from '../lib/supabase';

type ReferralInfo = {
  code: string | null;
  total_months: number;
  accepted: { first_name: string; months: number | null; rewarded_at: string | null }[];
  in_progress: { registered_at: string }[];
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function MemberReferrals() {
  const { profile } = useMemberArea();
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const boot = (await invokeFunction('member-bootstrap', {}, { idempotent: true })) as {
          referral_info?: ReferralInfo | null;
        };
        if (!cancelled) setInfo(boot.referral_info ?? null);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profile) return null;

  const code = info?.code ?? null;
  const shareLink = code ? `${window.location.origin}/register?ref=${encodeURIComponent(code)}` : '';

  async function copyLink() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(
        `Join me on the Vanik Matrimonial Register - use my code ${code} when you register and we both get free months: ${shareLink}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable; the code itself is still visible */
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Recommend a friend</h2>

      <div className="card" style={{ padding: '16px 18px', marginBottom: 18 }}>
        <p style={{ marginTop: 0 }}>
          For every friend who registers with your code and is <strong>accepted</strong>, we add{' '}
          <strong>2 months</strong> to your membership - and they get an extra month too. There is no limit
          to how many months you can earn.
        </p>
        {loadFailed && (
          <p style={{ color: 'var(--color-danger)' }}>
            Your referral details could not be loaded just now - please refresh the page to try again.
          </p>
        )}
        {code && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              border: '1px dashed rgba(146, 64, 14, 0.4)',
              borderRadius: 8,
              background: 'rgba(254, 243, 199, 0.35)',
            }}
          >
            <span style={{ fontSize: 15 }}>
              Your code: <strong style={{ letterSpacing: '0.05em' }}>{code}</strong>
            </span>
            <button type="button" className="btn btn-primary" style={{ padding: '6px 14px' }} onClick={() => void copyLink()}>
              {copied ? 'Copied!' : 'Copy invite link for WhatsApp'}
            </button>
          </div>
        )}
        {info && info.total_months > 0 && (
          <p style={{ marginBottom: 0, marginTop: 12 }}>
            You have earned <strong>{info.total_months} month{info.total_months === 1 ? '' : 's'}</strong> of free
            membership so far.
          </p>
        )}
      </div>

      <div className="card" style={{ padding: '16px 18px' }}>
        <h3 style={{ marginTop: 0 }}>Your referrals</h3>
        {!info || (info.accepted.length === 0 && info.in_progress.length === 0) ? (
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 0 }}>
            No one has used your code yet. Share your invite link with friends and family - WhatsApp works
            best in our community.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {info.in_progress.map((r, i) => (
              <li
                key={`p-${i}`}
                style={{ padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.08)', fontSize: 14 }}
              >
                <strong>Application in progress</strong> - someone registered with your code on{' '}
                {fmtDate(r.registered_at)}. Applications are reviewed within 2 working days; your reward is
                added automatically if they are accepted.
              </li>
            ))}
            {info.accepted.map((r, i) => (
              <li
                key={`a-${i}`}
                style={{ padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.08)', fontSize: 14 }}
              >
                {r.months != null && r.months > 0 ? (
                  <>
                    <strong>{r.first_name || 'A friend'}</strong> was accepted - <strong>{r.months} months</strong>{' '}
                    added to your membership on {fmtDate(r.rewarded_at)}.
                  </>
                ) : (
                  <>
                    <strong>{r.first_name || 'A friend'}</strong> was accepted. This referral was recorded but no
                    months were added (rewards apply while your own membership is active - contact us if this
                    looks wrong).
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
