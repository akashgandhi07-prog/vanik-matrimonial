import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SessionProvider } from './components/SessionContext';
import { SiteHeader } from './components/SiteHeader';
import AdminAddMember from './pages/admin/AdminAddMember';
import AdminCoupons from './pages/admin/AdminCoupons';
import AdminEmailExport from './pages/admin/AdminEmailExport';
import AdminEmailLog from './pages/admin/AdminEmailLog';
import AdminFeedback from './pages/admin/AdminFeedback';
import AdminLayout from './pages/admin/AdminLayout';
import AdminMemberDetail from './pages/admin/AdminMemberDetail';
import AdminMembers from './pages/admin/AdminMembers';
import AdminOverview from './pages/admin/AdminOverview';
import AdminRequests from './pages/admin/AdminRequests';
import AdminScheduledJobs from './pages/admin/AdminScheduledJobs';
import AdminSettings from './pages/admin/AdminSettings';
import DemoBrowse from './pages/DemoBrowse';
import Feedback from './pages/Feedback';
import ForgotPassword from './pages/ForgotPassword';
import Landing from './pages/Landing';
import Login from './pages/Login';
import MemberBrowse from './pages/MemberBrowse';
import MemberMyProfile from './pages/MemberMyProfile';
import MemberRequests from './pages/MemberRequests';
import MemberSaved from './pages/MemberSaved';
import MemberShell from './pages/MemberShell';
import MembershipExpired from './pages/MembershipExpired';
import Privacy from './pages/Privacy';
import Register from './pages/Register';
import RegistrationPending from './pages/RegistrationPending';
import RegistrationRejected from './pages/RegistrationRejected';
import ResetPassword from './pages/ResetPassword';
import VerifyEmailSuccess from './pages/VerifyEmailSuccess';

/**
 * Supabase email links often redirect to Site URL root (`/#access_token=...`) instead of
 * `/verify-email-success`. Move the hash to the right route so the session is established
 * and the UI matches the flow.
 */
function AuthHashRedirect({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const h = window.location.hash;
    if (!h || !h.includes('access_token=')) return;
    const path = location.pathname;
    if (path === '/verify-email-success' || path === '/reset-password') return;

    const qs = new URLSearchParams(h.startsWith('#') ? h.slice(1) : h);
    const type = qs.get('type');
    const target = type === 'recovery' ? '/reset-password' : '/verify-email-success';
    navigate(`${target}${h}`, { replace: true });
  }, [location.pathname, navigate]);

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <AuthHashRedirect>
          <SiteHeader />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/demo" element={<DemoBrowse />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email-success" element={<VerifyEmailSuccess />} />
            <Route path="/registration-pending" element={<RegistrationPending />} />
            <Route path="/registration-rejected" element={<RegistrationRejected />} />
            <Route path="/membership-expired" element={<MembershipExpired />} />
            <Route path="/renew-membership" element={<MembershipExpired />} />
            <Route path="/dashboard" element={<MemberShell />}>
              <Route index element={<Navigate to="browse" replace />} />
              <Route path="browse" element={<MemberBrowse />} />
              <Route path="saved" element={<MemberSaved />} />
              <Route path="requests" element={<MemberRequests />} />
              <Route path="my-profile" element={<MemberMyProfile />} />
            </Route>
            <Route path="/feedback/:requestId/:candidateId" element={<Feedback />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminOverview />} />
              <Route path="members" element={<AdminMembers />} />
              <Route path="members/:id" element={<AdminMemberDetail />} />
              <Route path="requests" element={<AdminRequests />} />
              <Route path="feedback" element={<AdminFeedback />} />
              <Route path="add-member" element={<AdminAddMember />} />
              <Route path="scheduled-jobs" element={<AdminScheduledJobs />} />
              <Route path="coupons" element={<AdminCoupons />} />
              <Route path="email-log" element={<AdminEmailLog />} />
              <Route path="email-export" element={<AdminEmailExport />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthHashRedirect>
      </SessionProvider>
    </BrowserRouter>
  );
}
