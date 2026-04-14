import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PublicLayout } from '../components/Layout';
import { invokeFunction, invokePublicFunction, supabase } from '../lib/supabase';
import { profileNeedsMembershipExpiredRoute } from '../lib/memberStatus';

type ProfileLite = {
  reference_number: string | null;
  membership_expires_at: string | null;
  status: string;
};

export default function MembershipExpired() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
        const boot = (await invokeFunction('member-bootstrap', {})) as { profile?: ProfileLite | null };
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
    if (searchParams.get('checkout') === 'success') {
      setNotice('Payment received. Your membership will update in a few moments. Refresh if needed.');
      setSearchParams({}, { replace: true });
      const t = window.setTimeout(() => void load(), 2000);
      return () => window.clearTimeout(t);
    }
    if (searchParams.get('checkout') === 'cancel') {
      setNotice('Payment was cancelled.');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, load]);

  const dateLabel = profile?.membership_expires_at
    ? new Date(profile.membership_expires_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '-';

  const isRenewable =
    profile != null &&
    (profile.status === 'expired' || profileNeedsMembershipExpiredRoute(profile));

  const isEarlyRenewal =
    profile != null &&
    (profile.status === 'active' || profile.status === 'matched') &&
    profile.membership_expires_at != null &&
    new Date(profile.membership_expires_at) > new Date();

  async function startCheckout() {
    setPayBusy(true);
    setNotice(null);
    try {
      const origin = window.location.origin;
      const path = window.location.pathname;
      const res = (await invokeFunction('create-checkout-session', {
        purpose: 'renewal',
        client_origin: origin,
        renewal_success_path: '/dashboard/browse',
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
            <Link to="/login" className="btn btn-primary" style={{ marginTop: 16, display: 'inline-flex' }}>
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
              <a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a>.
            </p>
            <Link to="/" className="btn btn-secondary" style={{ marginTop: 16, display: 'inline-flex' }}>
              Home
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  const mail = `mailto:register@vanikmatrimonial.co.uk?subject=${encodeURIComponent(
    `Membership renewal - ${profile.reference_number || 'member'}`
  )}`;

  return (
    <PublicLayout>
      <div className="layout-max" style={{ maxWidth: 560, marginTop: 48 }}>
        <div className="card">
          <h1>{isEarlyRenewal ? 'Renew membership' : 'Membership expired'}</h1>
          {isEarlyRenewal ? (
            <p>
              Your membership is valid until <strong>{dateLabel}</strong>. You can pay now to add another year
              from that date.
            </p>
          ) : (
            <p>
              Your membership expired on <strong>{dateLabel}</strong>.
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
