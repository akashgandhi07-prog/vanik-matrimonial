import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { invokeFunction, invokePublicFunction, supabase } from '../lib/supabase';
import {
  earlyRenewalBonusAvailable,
  hasMembershipAccess,
  isInMembershipGrace,
  membershipGraceEndsAt,
  profileNeedsMembershipExpiredRoute,
} from '../lib/memberStatus';

type ProfileLite = {
  reference_number: string | null;
  membership_expires_at: string | null;
  status: string;
};

export default function MembershipExpired() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  // Where this visit came from, captured before the Stripe return handler rewrites the URL.
  const [visitSource] = useState(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('checkout')) return null;
    const src = params.get('src');
    if (src === 'email' || src === 'banner') return src;
    return location.pathname === '/membership-expired' ? 'expired' : 'direct';
  });
  const visitLogged = useRef(false);
  const [profile, setProfile] = useState<ProfileLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [payBusy, setPayBusy] = useState(false);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let p =
      ((await supabase
        .from('profiles')
        .select('reference_number, membership_expires_at, status')
        .eq('auth_user_id', user.id)
        .maybeSingle()).data as ProfileLite | null) ?? null;
    if (!p) {
      try {
        const boot = (await invokeFunction('member-bootstrap', {}, { idempotent: true })) as { profile?: ProfileLite | null };
        if (boot.profile) p = boot.profile;
      } catch {
        /* ignore */
      }
    }
    setProfile(p);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!profile || !visitSource || visitLogged.current) return;
    visitLogged.current = true;
    // Best-effort analytics for the renewal funnel; never blocks the page.
    void supabase.rpc('log_renewal_page_visit', { p_source: visitSource }).then(({ error }) => {
      if (error) console.warn('log_renewal_page_visit', error.message);
    });
  }, [profile, visitSource]);

  useEffect(() => {
    void (async () => {
      try {
        const r = (await invokePublicFunction('billing-status', {})) as { stripe_renewal_enabled?: boolean };
        setBillingEnabled(!!r.stripe_renewal_enabled);
      } catch {
        setBillingEnabled(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (searchParams.get('checkout') === 'cancel') {
      setNotice('Payment was cancelled.');
      const next = new URLSearchParams(searchParams);
      next.delete('checkout');
      setSearchParams(next, { replace: true });
      return;
    }
    if (searchParams.get('checkout') !== 'success') return;

    setNotice('Payment received. Updating your membership…');
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    next.delete('session_id');
    setSearchParams(next, { replace: true });

    let cancelled = false;

    function subscriptionRenewed(
      before: { exp: string | null; st: string },
      after: { exp: string | null; st: string }
    ): boolean {
      if (
        after.st === 'active' &&
        before.st !== 'active' &&
        (before.st === 'expired' || before.st === 'closed')
      ) {
        return true;
      }
      const a = before.exp ? new Date(before.exp).getTime() : 0;
      const b = after.exp ? new Date(after.exp).getTime() : 0;
      return b > a;
    }

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const authUserId = user.id;

      async function snapshot() {
        const { data } = await supabase
          .from('profiles')
          .select('membership_expires_at, status')
          .eq('auth_user_id', authUserId)
          .maybeSingle();
        return {
          exp: (data?.membership_expires_at as string) ?? null,
          st: (data?.status as string) ?? '',
        };
      }

      const before = await snapshot();
      for (let i = 0; i < 12 && !cancelled; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1500));
        await load();
        const after = await snapshot();
        if (subscriptionRenewed(before, after)) {
          if (!cancelled) {
            setNotice('Renewal complete. Opening your member area…');
            navigate('/dashboard/browse', { replace: true });
          }
          return;
        }
      }
      if (!cancelled) {
        setNotice(
          'Payment received. If your expiry date still looks wrong, refresh the page or check your email (including junk or spam) for confirmation.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams, load, navigate]);

  const longDate = (d: Date) =>
    d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });
  const dateLabel = profile?.membership_expires_at ? longDate(new Date(profile.membership_expires_at)) : '-';
  const graceEndLabel = profile?.membership_expires_at
    ? longDate(membershipGraceEndsAt(profile.membership_expires_at))
    : '-';
  const inGrace = profile != null && profile.status === 'active' && isInMembershipGrace(profile.membership_expires_at);
  const bonus = profile != null && profile.status === 'active' && earlyRenewalBonusAvailable(profile.membership_expires_at);

  const isRenewable =
    profile != null &&
    (profile.status === 'expired' ||
      profile.status === 'closed' ||
      profileNeedsMembershipExpiredRoute(profile));

  const isArchivedRenewal = profile != null && profile.status === 'closed';

  // Still has access: either before the end date or inside the grace period.
  const isEarlyRenewal =
    profile != null && profile.status === 'active' && hasMembershipAccess(profile.membership_expires_at);

  async function startCheckout() {
    setPayBusy(true);
    setNotice(null);
    try {
      const origin = window.location.origin;
      const path = window.location.pathname;
      const res = (await invokeFunction('create-checkout-session', {
        purpose: 'renewal',
        client_origin: origin,
        renewal_success_path: '/renew-membership',
        renewal_cancel_path: path,
      })) as { url?: string };
      if (res.url) window.location.href = res.url;
      else throw new Error('No checkout URL returned');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not start checkout');
    } finally {
      setPayBusy(false);
    }
  }

  if (loading) {
    return (
      <PublicLayout>
        <div className="layout-max" style={{ maxWidth: 560, marginTop: 48 }}>
          <div className="card">
            <p style={{ margin: 0 }}>Loading…</p>
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (!profile) {
    return (
      <PublicLayout>
        <div className="layout-max" style={{ maxWidth: 560, marginTop: 48 }}>
          <div className="card">
            <h1>Sign in to renew</h1>
            <p style={{ color: 'var(--color-text-secondary)' }}>
              Sign in with the account you used to register, then you can renew your membership.
            </p>
            <Link
              to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
              className="btn btn-primary"
              style={{ marginTop: 16, display: 'inline-flex' }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (!isRenewable && !isEarlyRenewal) {
    return (
      <PublicLayout>
        <div className="layout-max" style={{ maxWidth: 560, marginTop: 48 }}>
          <div className="card">
            <h1>Renewal</h1>
            <p style={{ color: 'var(--color-text-secondary)' }}>
              Online renewal is available when your membership is active (due soon) or has expired. For help,
              contact{' '}
              <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a>.
            </p>
            <Link to="/" className="btn btn-secondary" style={{ marginTop: 16, display: 'inline-flex' }}>
              Home
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  const mail = `mailto:matrimonial@vanikcouncil.uk?subject=${encodeURIComponent(
    `Membership renewal - ${profile.reference_number || 'member'}`
  )}`;

  return (
    <PublicLayout>
      <div className="layout-max" style={{ maxWidth: 560, marginTop: 48 }}>
        <div className="card">
          <h1>
            {isEarlyRenewal ? 'Renew membership' : isArchivedRenewal ? 'Account archived' : 'Membership expired'}
          </h1>
          {inGrace ? (
            <p>
              Your membership ended on <strong>{dateLabel}</strong>. We have kept your profile visible until{' '}
              <strong>{graceEndLabel}</strong>. Renew now to stay on the register; your new year runs from{' '}
              {dateLabel}.
            </p>
          ) : isEarlyRenewal ? (
            <p>
              Your membership is valid until <strong>{dateLabel}</strong>. You can pay now to add another year
              from that date.
            </p>
          ) : isArchivedRenewal ? (
            <p>
              Your profile was archived after an extended period without renewal. Pay below to reactivate your
              membership (your last paid-through date was <strong>{dateLabel}</strong>).
            </p>
          ) : (
            <p>
              Your membership expired on <strong>{dateLabel}</strong>.
            </p>
          )}
          {bonus && (
            <p
              className="card"
              style={{
                padding: '10px 14px',
                background: 'rgba(4,120,87,0.08)',
                border: '1px solid rgba(4,120,87,0.25)',
              }}
            >
              <strong>Early renewal offer:</strong> pay by the end of {dateLabel} and we will add an extra month
              free, so you get 13 months for £10.
            </p>
          )}
          <p style={{ color: 'var(--color-text-secondary)' }}>
            The annual membership fee is £10. You can pay securely online when card payments are enabled, or
            email us to arrange renewal.
          </p>
          {notice && (
            <p style={{ marginTop: 12, color: 'var(--color-text-secondary)' }} role="status">
              {notice}
            </p>
          )}
          {billingEnabled ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              disabled={payBusy}
              onClick={() => void startCheckout()}
            >
              {payBusy ? 'Redirecting…' : 'Pay £10 with Stripe'}
            </button>
          ) : (
            <p style={{ marginTop: 16, fontSize: 14, color: 'var(--color-text-secondary)' }}>
              Card payments are not configured yet. Use email to renew.
            </p>
          )}
          <p style={{ marginTop: 16 }}>
            <a href={mail} className="btn btn-secondary" style={{ display: 'inline-flex' }}>
              Email us to renew
            </a>
          </p>
          {isEarlyRenewal && (
            <p style={{ marginTop: 24 }}>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/dashboard/browse')}>
                Back to member area
              </button>
            </p>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
