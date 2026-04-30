import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import imageCompression from 'browser-image-compression';
import { rejectReasonIfNotJpegOrPng } from '../lib/profilePhotoAccept';
import { PublicLayout } from '../components/Layout';
import { ageFromDob, isAdminUser, publicAuthUrl, userFacingAuthError } from '../lib/auth';
import { HEIGHT_OPTIONS } from '../lib/heights';
import { sanitizeText } from '../lib/sanitize';
import {
  isValidInternationalPhone,
  isValidLoosePostcode,
  isValidPersonName,
  isValidPlaceField,
  isValidUkMobile,
  isValidUkPostcode,
} from '../lib/registerValidation';
import { invokeFunction, invokePublicFunction, supabase } from '../lib/supabase';

const LS_KEY = 'vmr_registration_v1';

type Step = 1 | 2 | 3;
const DIET_OPTIONS = ['Veg', 'Non-veg', 'Vegan', 'Jain', 'Pescetarian'] as const;

type FormState = {
  step: Step;
  gender: 'Male' | 'Female' | '';
  date_of_birth: string;
  mobile_phone: string;
  home_address_line1: string;
  home_address_city: string;
  home_address_postcode: string;
  home_address_country: string;
  id_document_path: string;
  coupon_code: string;
  coupon_hint: '' | 'valid' | 'invalid';
  first_name: string;
  surname: string;
  nationality: string;
  place_of_birth: string;
  town_country_of_origin: string;
  religion: string;
  father_name: string;
  mother_name: string;
  future_settlement_plans: string;
  education: string;
  job_title: string;
  height_cm: number | '';
  diet: string;
  hobbies: string;
  photo_path: string;
  photo_paths: string[];
  consent_contact: boolean;
  consent_age: boolean;
  consent_privacy: boolean;
  id_file_name: string;
  photo_compress_note: string;
};

const defaultState: FormState = {
  step: 1,
  gender: '',
  date_of_birth: '',
  mobile_phone: '',
  home_address_line1: '',
  home_address_city: '',
  home_address_postcode: '',
  home_address_country: 'UK',
  id_document_path: '',
  coupon_code: '',
  coupon_hint: '',
  first_name: '',
  surname: '',
  nationality: '',
  place_of_birth: '',
  town_country_of_origin: '',
  religion: '',
  father_name: '',
  mother_name: '',
  future_settlement_plans: '',
  education: '',
  job_title: '',
  height_cm: '',
  diet: '',
  hobbies: '',
  photo_path: '',
  photo_paths: [],
  consent_contact: false,
  consent_age: false,
  consent_privacy: false,
  id_file_name: '',
  photo_compress_note: '',
};

function loadState(): FormState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...defaultState };
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return { ...defaultState };
  }
}

function validateStep1(form: FormState, age: number | null): Record<string, string> {
  const e: Record<string, string> = {};
  const countryRaw = form.home_address_country.trim();
  const isUk = /^uk$/i.test(countryRaw) || /^united kingdom$/i.test(countryRaw);

  if (!form.gender) e.gender = 'Please select your gender.';
  if (!form.date_of_birth) e.date_of_birth = 'Date of birth is required.';
  else if (age == null) e.date_of_birth = 'Enter a valid date of birth.';
  else if (age < 18) e.date_of_birth = 'You must be 18 or over to register.';
  if (!form.mobile_phone.trim()) e.mobile_phone = 'Mobile number is required.';
  else if (isUk && !isValidUkMobile(form.mobile_phone)) {
    e.mobile_phone = 'For UK addresses, enter a UK mobile (e.g. 07123 456789 or +44 7123 456789).';
  } else if (!isUk && !isValidInternationalPhone(form.mobile_phone)) {
    e.mobile_phone =
      'Enter a valid phone number (8-15 digits; include country code, e.g. +1 415 555 0100).';
  }
  if (!form.home_address_line1.trim()) e.home_address_line1 = 'Address line 1 is required.';
  else if (form.home_address_line1.trim().length < 3)
    e.home_address_line1 = 'Please enter a fuller address line.';
  if (!form.home_address_city.trim()) e.home_address_city = 'City or town is required.';
  if (!form.home_address_postcode.trim()) {
    e.home_address_postcode = 'Postcode or postal code is required.';
  } else if (isUk && !isValidUkPostcode(form.home_address_postcode)) {
    e.home_address_postcode = 'Enter a valid UK postcode (e.g. SW1A 1AA).';
  } else if (!isUk && !isValidLoosePostcode(form.home_address_postcode)) {
    e.home_address_postcode = 'Enter your postal code (2-20 characters).';
  }
  if (!form.home_address_country.trim()) e.home_address_country = 'Country is required.';
  if (!form.id_document_path) e.id_document_path = 'Please upload proof of identity.';
  return e;
}

function validateStep2(form: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!isValidPersonName(form.first_name)) e.first_name = 'Enter a valid first name (letters, spaces, hyphen or apostrophe).';
  if (!isValidPersonName(form.surname)) e.surname = 'Enter a valid surname.';
  if (!isValidPlaceField(form.nationality, 100)) e.nationality = 'Enter your nationality (at least 2 characters).';
  if (!isValidPlaceField(form.place_of_birth, 200)) e.place_of_birth = 'Enter where you live.';
  if (!isValidPlaceField(form.town_country_of_origin, 200))
    e.town_country_of_origin = 'Enter town and country of family origin.';
  if (!form.religion) e.religion = 'Please select a religion.';
  if (!isValidPersonName(form.father_name)) e.father_name = "Enter your father's name.";
  if (!isValidPersonName(form.mother_name)) e.mother_name = "Enter your mother's name.";
  if (form.future_settlement_plans.trim().length > 200)
    e.future_settlement_plans = 'Maximum 200 characters for this field.';
  return e;
}

function validateStep3(form: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!form.education.trim()) e.education = 'Education is required.';
  else if (form.education.trim().length < 3) e.education = 'Please add a bit more detail.';
  if (!form.job_title.trim()) e.job_title = 'Job title is required.';
  if (form.height_cm === '') e.height_cm = 'Please select your height.';
  if (!form.diet) e.diet = 'Please select a diet preference.';
  if (!form.hobbies.trim()) e.hobbies = 'Hobbies and interests are required.';
  else if (form.hobbies.trim().length < 3) e.hobbies = 'Please share a little more (at least a few words).';
  if (!form.photo_paths.length) e.photo_path = 'Please upload at least one profile photo.';
  if (!form.consent_contact) e.consent_contact = 'You must consent to share contact details for this service.';
  if (!form.consent_age) e.consent_age = 'You must confirm you are 18 or over.';
  if (!form.consent_privacy) e.consent_privacy = 'You must accept the privacy policy and terms of use.';
  return e;
}

/** First key in validation maps matches field order in validateStep*. */
const FIRST_INVALID_FIELD_IDS: Record<string, string> = {
  gender: 'reg-gender-male',
  date_of_birth: 'reg-dob',
  mobile_phone: 'reg-tel',
  home_address_line1: 'reg-addr1',
  home_address_city: 'reg-city',
  home_address_postcode: 'reg-postcode',
  home_address_country: 'reg-country',
  id_document_path: 'reg-id-file',
  first_name: 'reg-given',
  surname: 'reg-family',
  nationality: 'reg-nationality',
  place_of_birth: 'reg-pob',
  town_country_of_origin: 'reg-origin',
  religion: 'reg-religion',
  father_name: 'reg-father',
  mother_name: 'reg-mother',
  future_settlement_plans: 'reg-settlement',
  education: 'reg-education',
  job_title: 'reg-job',
  height_cm: 'reg-height',
  diet: 'reg-diet-veg',
  hobbies: 'reg-hobbies',
  photo_path: 'reg-photo',
  consent_contact: 'reg-consent-contact',
  consent_age: 'reg-consent-age',
  consent_privacy: 'reg-consent-privacy',
  payment: 'reg-payment-fee',
};

function focusFirstFieldError(errors: Record<string, string>) {
  const firstKey = Object.keys(errors)[0];
  if (!firstKey) return;
  const id = FIRST_INVALID_FIELD_IDS[firstKey];
  if (!id) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (el instanceof HTMLElement && typeof el.focus === 'function') {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }
  });
}

export default function Register() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessionReady, setSessionReady] = useState(false);
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => loadState());
  const [idProgress, setIdProgress] = useState(0);
  const [idUploading, setIdUploading] = useState(false);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [dragPhotoIndex, setDragPhotoIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [updateEmailBusy, setUpdateEmailBusy] = useState(false);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [stripeCheckoutSessionId, setStripeCheckoutSessionId] = useState<string | null>(null);
  const [stripeRedirectBusy, setStripeRedirectBusy] = useState(false);
  const [couponChecking, setCouponChecking] = useState(false);
  const [resubmitMode, setResubmitMode] = useState(false);
  const [resubmitReason, setResubmitReason] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const rejectHydrateDoneRef = useRef<string | null>(null);

  useEffect(() => {
    rejectHydrateDoneRef.current = null;
  }, [session?.user?.id]);

  useEffect(() => {
    if (location.pathname !== '/register') {
      rejectHydrateDoneRef.current = null;
    }
  }, [location.pathname]);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(form));
  }, [form]);

  useEffect(() => {
    if (searchParams.get('checkout') !== 'success') return;
    const sid = searchParams.get('session_id');
    if (sid?.startsWith('cs_')) {
      setStripeCheckoutSessionId(sid);
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setFieldErrors({});
  }, [form.step]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const verified = !!session?.user?.email_confirmed_at;
  const userId = session?.user?.id ?? null;
  const isAdmin = isAdminUser(session?.user);

  useEffect(() => {
    if (!sessionReady || !session?.user || !isAdmin) return;
    navigate('/admin', { replace: true });
  }, [sessionReady, session?.user, isAdmin, navigate]);

  useEffect(() => {
    if (!verified || !userId) return;
    void (async () => {
      try {
        const r = (await invokePublicFunction('billing-status', {})) as {
          stripe_registration_enabled?: boolean;
        };
        setBillingEnabled(!!r.stripe_registration_enabled);
      } catch {
        setBillingEnabled(false);
      }
    })();
  }, [verified, userId]);

  useEffect(() => {
    if (!session?.user?.id || !verified) return;
    void (async () => {
      const uid = session.user.id;
      let status: string | null = null;
      const { data: p } = await supabase
        .from('profiles')
        .select('status')
        .eq('auth_user_id', uid)
        .maybeSingle();
      if (p?.status) status = p.status as string;
      else {
        try {
          const boot = (await invokeFunction('member-bootstrap', {})) as {
            profile?: { status?: string } | null;
          };
          const st = boot.profile?.status;
          if (st) status = st;
        } catch {
          /* edge unavailable or not deployed */
        }
      }
      if (!status) return;
      if (status === 'pending_approval') navigate('/registration-pending', { replace: true });
      else if (status === 'active') navigate('/dashboard/browse', { replace: true });
      else if (status === 'matched') navigate('/dashboard/browse', { replace: true });
      else if (status === 'rejected' && location.pathname !== '/register') {
        navigate('/registration-rejected', { replace: true });
      }
    })();
  }, [session?.user?.id, verified, navigate, location.pathname]);

  /** Pre-fill the form when resubmitting after rejection (ID/photo must be uploaded again). */
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || !verified || location.pathname !== '/register') return;
    void (async () => {
      const { data: p } = await supabase.from('profiles').select('*').eq('auth_user_id', uid).maybeSingle();
      if (!p || p.status !== 'rejected') {
        setResubmitMode(false);
        setResubmitReason(null);
        return;
      }
      if (rejectHydrateDoneRef.current === uid) return;
      rejectHydrateDoneRef.current = uid;
      setResubmitMode(true);
      setResubmitReason((p.rejection_reason as string | null) ?? null);
      const { data: m } = await supabase.from('member_private').select('*').eq('profile_id', p.id).maybeSingle();
      if (!m) return;
      setForm((prev) => ({
        ...prev,
        gender: p.gender === 'Female' ? 'Female' : 'Male',
        date_of_birth: m.date_of_birth ?? '',
        mobile_phone: m.mobile_phone ?? '',
        home_address_line1: m.home_address_line1 ?? '',
        home_address_city: m.home_address_city ?? '',
        home_address_postcode: m.home_address_postcode ?? '',
        home_address_country: m.home_address_country ?? 'UK',
        first_name: p.first_name ?? '',
        surname: m.surname ?? '',
        nationality: p.nationality ?? '',
        place_of_birth: p.place_of_birth ?? '',
        town_country_of_origin: p.town_country_of_origin ?? '',
        religion: p.religion ?? '',
        father_name: m.father_name ?? '',
        mother_name: m.mother_name ?? '',
        future_settlement_plans: p.future_settlement_plans ?? '',
        education: p.education ?? '',
        job_title: p.job_title ?? '',
        height_cm: p.height_cm ?? '',
        diet: p.diet ?? 'Veg',
        hobbies: p.hobbies ?? '',
        coupon_code: (m.coupon_used as string) ?? '',
        coupon_hint: '',
        id_document_path: '',
        photo_path: '',
        photo_paths: [],
        id_file_name: '',
        photo_compress_note: '',
        consent_contact: false,
        consent_age: false,
        consent_privacy: false,
        step: 1,
      }));
      setPhotoPreviews((old) => {
        old.forEach((url) => URL.revokeObjectURL(url));
        return [];
      });
    })();
  }, [session?.user?.id, verified, location.pathname]);

  const update = useCallback((patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
  }, []);

  const clearFieldError = useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const age = useMemo(() => {
    if (!form.date_of_birth) return null;
    return ageFromDob(form.date_of_birth);
  }, [form.date_of_birth]);

  async function signUpAccount(e: React.FormEvent) {
    e.preventDefault();
    setAuthMsg(null);
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setAuthMsg('Email is required.');
      return;
    }
    if (password.length < 8) {
      setAuthMsg('Password must be at least 8 characters.');
      return;
    }
    setAuthSubmitting(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { emailRedirectTo: publicAuthUrl('/verify-email-success') },
      });
      if (error) setAuthMsg(userFacingAuthError(error));
      else setAuthMsg('Check your inbox to verify your email before continuing.');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      setAuthMsg(msg || 'Could not create account. Please try again.');
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function startRegistrationCheckout() {
    setStripeRedirectBusy(true);
    setActionNotice(null);
    try {
      const res = (await invokeFunction('create-checkout-session', {
        purpose: 'registration',
      })) as { url?: string };
      if (res.url) window.location.href = res.url;
      else throw new Error('No checkout URL returned');
    } catch (e) {
      setActionNotice({ type: 'err', text: e instanceof Error ? e.message : 'Could not start checkout' });
    } finally {
      setStripeRedirectBusy(false);
    }
  }

  async function applyCoupon() {
    const code = form.coupon_code.trim();
    if (!code) {
      update({ coupon_hint: '' });
      return;
    }
    setCouponChecking(true);
    try {
      const res = (await invokeFunction('validate-coupon', { code })) as { valid?: boolean };
      update({ coupon_hint: res.valid ? 'valid' : 'invalid' });
    } catch {
      update({ coupon_hint: 'invalid' });
    } finally {
      setCouponChecking(false);
    }
  }

  async function uploadId(file: File) {
    if (!session?.user) return;
    const reject = rejectReasonIfNotJpegOrPng(file);
    if (reject) {
      setFieldErrors((prev) => ({ ...prev, id_document_path: reject }));
      return;
    }
    clearFieldError('id_document_path');
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `${session.user.id}/id-${Date.now()}.${ext}`;
    setIdUploading(true);
    setIdProgress(0.2);
    const timer = window.setInterval(() => {
      setIdProgress((p) => Math.min(p + 0.15, 0.9));
    }, 200);
    const { error } = await supabase.storage.from('id-documents').upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    clearInterval(timer);
    setIdUploading(false);
    setIdProgress(error ? 0 : 1);
    if (error) {
      setFieldErrors((prev) => ({ ...prev, id_document_path: error.message }));
      setActionNotice({ type: 'err', text: `Could not upload proof of identity: ${error.message}` });
      return;
    }
    update({ id_document_path: path, id_file_name: file.name });
  }

  async function uploadPhoto(file: File) {
    if (!session?.user || !form.gender) return;
    if (form.photo_paths.length >= 3) {
      setFieldErrors((prev) => ({ ...prev, photo_path: 'Maximum 3 photos allowed.' }));
      return;
    }
    const reject = rejectReasonIfNotJpegOrPng(file);
    if (reject) {
      setFieldErrors((prev) => ({ ...prev, photo_path: reject }));
      return;
    }
    clearFieldError('photo_path');
    setPhotoUploading(true);
    setActionNotice(null);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.2,
        maxWidthOrHeight: 800,
        useWebWorker: true,
      });
      const note = `${(file.size / (1024 * 1024)).toFixed(1)}MB → ${(compressed.size / 1024).toFixed(0)}KB`;
      update({ photo_compress_note: note });
      const ext = compressed.type === 'image/png' ? 'png' : 'jpg';
      const path = `${form.gender}/${session.user.id}/photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error } = await supabase.storage.from('profile-photos').upload(path, compressed, {
        upsert: true,
        contentType: compressed.type || 'image/jpeg',
      });
      if (error) {
        setFieldErrors((prev) => ({ ...prev, photo_path: error.message }));
        setActionNotice({ type: 'err', text: `Could not upload profile photo: ${error.message}` });
        return;
      }
      setPhotoPreviews((prev) => [...prev, URL.createObjectURL(compressed)]);
      const nextPaths = [...form.photo_paths, path].slice(0, 3);
      update({ photo_paths: nextPaths, photo_path: nextPaths[0] ?? '' });
      setActionNotice({ type: 'ok', text: 'Photo uploaded. You can submit your registration now.' });
    } catch (err) {
      setActionNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not process this image. Please try a different file.',
      });
    } finally {
      setPhotoUploading(false);
    }
  }

  async function submitAll(e: React.FormEvent) {
    e.preventDefault();
    if (!session?.user?.email) return;
    const e3 = validateStep3(form);
    if (Object.keys(e3).length) {
      setFieldErrors(e3);
      focusFirstFieldError(e3);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const payload = {
        gender: form.gender,
        seeking_gender: form.gender === 'Female' ? 'Male' : 'Female',
        date_of_birth: form.date_of_birth,
        mobile_phone: sanitizeText(form.mobile_phone, 40),
        home_address_line1: sanitizeText(form.home_address_line1, 200),
        home_address_city: sanitizeText(form.home_address_city, 100),
        home_address_postcode: sanitizeText(form.home_address_postcode, 20),
        home_address_country: sanitizeText(form.home_address_country, 80),
        id_document_path: form.id_document_path,
        photo_paths: form.photo_paths,
        photo_path: form.photo_path,
        coupon_code: form.coupon_code.trim(),
        first_name: sanitizeText(form.first_name, 80),
        surname: sanitizeText(form.surname, 80),
        email: session.user.email,
        nationality: sanitizeText(form.nationality, 100),
        place_of_birth: sanitizeText(form.place_of_birth, 200),
        town_country_of_origin: sanitizeText(form.town_country_of_origin, 200),
        religion: form.religion,
        father_name: sanitizeText(form.father_name, 120),
        mother_name: sanitizeText(form.mother_name, 120),
        future_settlement_plans: sanitizeText(form.future_settlement_plans, 200),
        education: sanitizeText(form.education, 500),
        job_title: sanitizeText(form.job_title, 200),
        height_cm: form.height_cm === '' ? null : form.height_cm,
        diet: form.diet,
        hobbies: sanitizeText(form.hobbies, 400),
        stripe_checkout_session_id: stripeCheckoutSessionId ?? '',
      };
      const res = (await invokeFunction('submit-registration', payload)) as {
        reference_number?: string;
      };
      sessionStorage.setItem('vmr_pending_email', session.user.email);
      if (res.reference_number) sessionStorage.setItem('vmr_pending_ref', res.reference_number);
      localStorage.removeItem(LS_KEY);
      window.location.href = '/registration-pending';
    } catch (err) {
      if (err instanceof Error && err.message === 'PAYMENT_REQUIRED') {
        setFieldErrors({
          payment: 'Pay the £10 membership fee before submitting (or apply a valid coupon code).',
        });
        focusFirstFieldError({ payment: 'x' });
      } else {
        setActionNotice({ type: 'err', text: err instanceof Error ? err.message : 'Submission failed' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function removePhotoAt(index: number) {
    setPhotoPreviews((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target);
      return prev.filter((_, i) => i !== index);
    });
    const nextPaths = form.photo_paths.filter((_, i) => i !== index);
    update({ photo_paths: nextPaths, photo_path: nextPaths[0] ?? '' });
  }

  function movePhoto(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    if (from >= form.photo_paths.length || to >= form.photo_paths.length) return;
    const nextPaths = [...form.photo_paths];
    const [movedPath] = nextPaths.splice(from, 1);
    nextPaths.splice(to, 0, movedPath);
    setPhotoPreviews((prev) => {
      const next = [...prev];
      const [movedPreview] = next.splice(from, 1);
      next.splice(to, 0, movedPreview);
      return next;
    });
    update({ photo_paths: nextPaths, photo_path: nextPaths[0] ?? '' });
  }

  if (!sessionReady) {
    return (
      <PublicLayout>
        <div className="layout-max register-page register-page--narrow">
          <div className="register-card" aria-busy="true" aria-live="polite">
            <p className="register-lead" style={{ margin: 0 }}>
              Loading…
            </p>
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (!session) {
    const authErr = authMsg && !authMsg.toLowerCase().includes('check your inbox');
    return (
      <PublicLayout>
        <div className="layout-max register-page register-page--narrow">
          <div className="register-card">
            <h1>Create your account</h1>
            <p className="register-lead">
              We will email you a verification link. After you confirm your email, you can complete your
              profile in a few steps.
            </p>
            <form className="register-form-grid" onSubmit={signUpAccount}>
              <div>
                <label className="label" htmlFor="register-email">
                  Email <span aria-hidden="true">*</span>
                </label>
                <input
                  id="register-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={authErr ? true : undefined}
                  aria-describedby={authMsg ? 'register-auth-msg' : undefined}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="register-password">
                  Password <span aria-hidden="true">*</span>
                </label>
                <input
                  id="register-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={authErr ? true : undefined}
                  required
                />
                <p className="field-hint" style={{ marginBottom: 0 }}>
                  At least 8 characters. Use a mix of letters and numbers for a stronger password.
                </p>
              </div>
              {authMsg && (
                <p
                  id="register-auth-msg"
                  className={`register-msg ${authErr ? 'register-msg--error' : 'register-msg--success'}`}
                  role={authErr ? 'alert' : 'status'}
                >
                  {authMsg}
                </p>
              )}
              <button type="submit" className="btn btn-primary" disabled={authSubmitting}>
                {authSubmitting ? 'Creating account…' : 'Continue'}
              </button>
            </form>
            <p className="register-auth-footer">
              <Link to="/login">Already registered? Sign in</Link>
            </p>
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (isAdmin) {
    return (
      <PublicLayout>
        <div className="layout-max register-page register-page--narrow">
          <div className="register-card" aria-busy="true" aria-live="polite">
            <p className="register-lead" style={{ margin: 0 }}>
              Redirecting to admin…
            </p>
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (!verified) {
    return (
      <PublicLayout>
        <div className="layout-max register-page register-page--medium">
          <div className="register-card">
            <h1>Verify your email</h1>
            <p className="register-lead">
              We sent a link to <strong>{session.user.email}</strong>. Open the email and tap the link to
              continue registration. Check your spam or promotions folder if you do not see it within a few
              minutes.
            </p>
            {verifyNotice && (
              <p
                className={`register-msg ${verifyNotice.type === 'err' ? 'register-msg--error' : 'register-msg--success'}`}
                role="status"
              >
                {verifyNotice.text}
              </p>
            )}
            <div className="register-form-grid" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={resendBusy}
                onClick={async () => {
                  setVerifyNotice(null);
                  setResendBusy(true);
                  try {
                    const { error } = await supabase.auth.resend({
                      type: 'signup',
                      email: session.user.email!,
                    });
                    if (error) setVerifyNotice({ type: 'err', text: userFacingAuthError(error) });
                    else
                      setVerifyNotice({
                        type: 'ok',
                        text: 'Another verification email is on its way. Check your inbox and spam folder.',
                      });
                  } finally {
                    setResendBusy(false);
                  }
                }}
              >
                {resendBusy ? 'Sending…' : 'Resend verification email'}
              </button>
            </div>
            <p className="field-hint">Wrong address? Enter a new email and we will send a fresh link.</p>
            <div className="register-actions" style={{ alignItems: 'flex-start' }}>
              <input
                id="register-new-email"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={updateEmailBusy}
                onClick={async () => {
                  if (!newEmail.trim()) return;
                  setVerifyNotice(null);
                  setUpdateEmailBusy(true);
                  try {
                    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
                    if (error) setVerifyNotice({ type: 'err', text: userFacingAuthError(error) });
                    else {
                      setVerifyNotice({
                        type: 'ok',
                        text: 'If the update succeeded, check your new inbox for the verification link.',
                      });
                      setNewEmail('');
                    }
                  } finally {
                    setUpdateEmailBusy(false);
                  }
                }}
              >
                {updateEmailBusy ? 'Updating…' : 'Update email'}
              </button>
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  const step = form.step;
  const progress = ((step - 1) / 3) * 100;
  const stepLabels = ['Identity & address', 'Personal details', 'Profile & photo'] as const;
  const resubmitReasonLower = (resubmitReason ?? '').toLowerCase();
  const resubmitTips = [
    resubmitReasonLower.includes('photo') ? 'Use a clear, recent face photo with good lighting.' : null,
    resubmitReasonLower.includes('id') || resubmitReasonLower.includes('identity')
      ? 'Upload a sharp and fully visible ID image.'
      : null,
    resubmitReasonLower.includes('name') ? 'Check that personal names match official records.' : null,
    resubmitReasonLower.includes('address') ? 'Review address and postcode for accuracy.' : null,
  ].filter(Boolean) as string[];

  return (
    <PublicLayout>
      <div className="layout-max register-page">
        <div className="register-card">
          {actionNotice && (
            <p
              className={`register-msg ${actionNotice.type === 'err' ? 'register-msg--error' : 'register-msg--success'}`}
              role={actionNotice.type === 'err' ? 'alert' : 'status'}
            >
              {actionNotice.text}
            </p>
          )}
          {resubmitMode && (
            <div
              className="badge badge-warning"
              style={{
                display: 'block',
                marginBottom: 16,
                padding: 12,
                textAlign: 'left',
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              <strong>Resubmitting your application.</strong> Your previous details are pre-filled below. You
              must upload a <strong>new proof of identity</strong> and a <strong>new profile photo</strong>, then
              complete all three steps and submit again for review.
              {resubmitReason && (
                <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                  <strong>Review note:</strong> {resubmitReason}
                </p>
              )}
              {resubmitTips.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {resubmitTips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div style={{ marginBottom: 22 }}>
            <div className="register-steps">
              {([1, 2, 3] as const).map((s) => (
                <span
                  key={s}
                  className={
                    'register-step-pill' +
                    (s === step ? ' register-step-pill--active' : '') +
                    (s < step ? ' register-step-pill--done' : '')
                  }
                >
                  {s}. {stepLabels[s - 1]}
                </span>
              ))}
            </div>
            <div className="register-progress-track">
              <div className="register-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="register-step-meta">
              Step {step} of 3: {stepLabels[step - 1]}
            </p>
          </div>

          {step === 1 && (
            <form
              className="register-form-grid"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                const e1 = validateStep1(form, age);
                if (Object.keys(e1).length) {
                  setFieldErrors(e1);
                  focusFirstFieldError(e1);
                  return;
                }
                setFieldErrors({});
                update({ step: 2 });
              }}
            >
              <h2 className="register-section-title">Account &amp; identity</h2>
              <p className="field-hint" style={{ marginTop: -8 }}>
                These details are used for verification and your member record.
              </p>
              <div>
                <label className="label" htmlFor="reg-email-readonly">
                  Email
                </label>
                <input
                  id="reg-email-readonly"
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={session.user.email ?? ''}
                  disabled
                  readOnly
                />
              </div>
              <div>
                <label className="label" htmlFor="reg-password-mask">
                  Password
                </label>
                <input
                  id="reg-password-mask"
                  type="password"
                  name="password"
                  autoComplete="off"
                  value="••••••••"
                  disabled
                  readOnly
                />
              </div>
              <div>
                <span className="label" id="reg-gender-label">
                  Gender <span aria-hidden="true">*</span>
                </span>
                <div className="register-radio-row" role="group" aria-labelledby="reg-gender-label">
                  {(['Male', 'Female'] as const).map((g) => (
                    <label key={g}>
                      <input
                        id={g === 'Male' ? 'reg-gender-male' : 'reg-gender-female'}
                        type="radio"
                        name="gender"
                        checked={form.gender === g}
                        onChange={() => {
                          update({ gender: g });
                          clearFieldError('gender');
                        }}
                      />
                      {g}
                    </label>
                  ))}
                </div>
                {fieldErrors.gender && <p className="field-error">{fieldErrors.gender}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-dob">
                  Date of birth <span aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-dob"
                  type="date"
                  name="bday"
                  autoComplete="bday"
                  value={form.date_of_birth}
                  onChange={(e) => {
                    update({ date_of_birth: e.target.value });
                    clearFieldError('date_of_birth');
                  }}
                  aria-invalid={fieldErrors.date_of_birth ? true : undefined}
                />
                {age != null && (
                  <p className="field-hint" style={{ marginBottom: 0 }}>
                    Age: {age}
                    {age < 18 && (
                      <span style={{ color: 'var(--color-danger)', fontWeight: 500 }}> (must be 18+)</span>
                    )}
                  </p>
                )}
                {fieldErrors.date_of_birth && (
                  <p className="field-error">{fieldErrors.date_of_birth}</p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="reg-tel">
                  Mobile phone <span aria-hidden="true">*</span>
                </label>
                <p className="field-hint" style={{ marginTop: 0 }}>
                  If your country is <strong>UK</strong> or <strong>United Kingdom</strong>, use a UK mobile.
                  Otherwise include your country code (8-15 digits total).
                </p>
                <input
                  id="reg-tel"
                  type="tel"
                  name="tel-national"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="e.g. 07123 456789 or +1 415 555 0100"
                  value={form.mobile_phone}
                  onChange={(e) => {
                    update({ mobile_phone: e.target.value });
                    clearFieldError('mobile_phone');
                  }}
                  aria-invalid={fieldErrors.mobile_phone ? true : undefined}
                />
                {fieldErrors.mobile_phone && (
                  <p className="field-error">{fieldErrors.mobile_phone}</p>
                )}
              </div>

              <fieldset className="register-fieldset">
                <legend>Home address</legend>
                <div className="register-form-grid" style={{ gap: 16 }}>
                  <div>
                    <label className="label" htmlFor="reg-addr1">
                      Address line 1 <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="reg-addr1"
                      name="address-line1"
                      type="text"
                      autoComplete="address-line1"
                      value={form.home_address_line1}
                      onChange={(e) => {
                        update({ home_address_line1: e.target.value });
                        clearFieldError('home_address_line1');
                      }}
                      aria-invalid={fieldErrors.home_address_line1 ? true : undefined}
                    />
                    {fieldErrors.home_address_line1 && (
                      <p className="field-error">{fieldErrors.home_address_line1}</p>
                    )}
                  </div>
                  <div>
                    <label className="label" htmlFor="reg-city">
                      City or town <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="reg-city"
                      name="address-level1"
                      type="text"
                      autoComplete="address-level1"
                      value={form.home_address_city}
                      onChange={(e) => {
                        update({ home_address_city: e.target.value });
                        clearFieldError('home_address_city');
                      }}
                      aria-invalid={fieldErrors.home_address_city ? true : undefined}
                    />
                    {fieldErrors.home_address_city && (
                      <p className="field-error">{fieldErrors.home_address_city}</p>
                    )}
                  </div>
                  <div>
                    <label className="label" htmlFor="reg-postcode">
                      Postcode / postal code <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="reg-postcode"
                      name="postal-code"
                      type="text"
                      autoComplete="postal-code"
                      placeholder="e.g. SW1A 1AA or 10115"
                      value={form.home_address_postcode}
                      onChange={(e) => {
                        update({ home_address_postcode: e.target.value });
                        clearFieldError('home_address_postcode');
                      }}
                      aria-invalid={fieldErrors.home_address_postcode ? true : undefined}
                    />
                    {fieldErrors.home_address_postcode && (
                      <p className="field-error">{fieldErrors.home_address_postcode}</p>
                    )}
                  </div>
                  <div>
                    <label className="label" htmlFor="reg-country">
                      Country <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="reg-country"
                      name="country-name"
                      type="text"
                      autoComplete="country-name"
                      placeholder="e.g. UK, India, USA"
                      value={form.home_address_country}
                      onChange={(e) => {
                        update({ home_address_country: e.target.value });
                        clearFieldError('home_address_country');
                      }}
                      aria-invalid={fieldErrors.home_address_country ? true : undefined}
                    />
                    <p className="field-hint" style={{ marginBottom: 0 }}>
                      Enter <strong>UK</strong> or <strong>United Kingdom</strong> for UK addresses (stricter phone
                      and postcode checks).
                    </p>
                    {fieldErrors.home_address_country && (
                      <p className="field-error">{fieldErrors.home_address_country}</p>
                    )}
                  </div>
                </div>
              </fieldset>

              <div>
                <label className="label" htmlFor="reg-id-file">
                  Proof of identity <span aria-hidden="true">*</span>
                </label>
                <p className="field-hint">
                  Passport photo page or driving licence. Used only to verify your identity; deleted after
                  approval. <strong>JPG or PNG only,</strong> up to 10MB.
                </p>
                <input
                  id="reg-id-file"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && f.size <= 10 * 1024 * 1024) {
                      void uploadId(f);
                    } else if (f) {
                  setFieldErrors((prev) => ({ ...prev, id_document_path: 'File too large. Maximum size is 10MB.' }));
                    }
                  }}
                />
                {idUploading && (
                  <div style={{ marginTop: 8 }}>
                    <div className="register-progress-track" style={{ height: 8 }}>
                      <div
                        className="register-progress-fill"
                        style={{ width: `${idProgress * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {form.id_document_path && !idUploading && (
                  <p style={{ color: 'var(--color-success)', marginBottom: 0, fontSize: 14 }}>
                    Uploaded: {form.id_file_name}
                  </p>
                )}
                {fieldErrors.id_document_path && (
                  <p className="field-error">{fieldErrors.id_document_path}</p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="reg-coupon">
                  Coupon code <span className="badge badge-muted">optional</span>
                </label>
                <p className="field-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                  If you have a code, enter it and click Apply. Leaving the field also checks the code.
                </p>
                <div className="flex-input-with-btn">
                  <input
                    id="reg-coupon"
                    name="coupon"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="e.g. VIP2026"
                    value={form.coupon_code}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase();
                      update({ coupon_code: v, coupon_hint: '' });
                    }}
                    onBlur={() => void applyCoupon()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void applyCoupon();
                      }
                    }}
                    disabled={couponChecking}
                    aria-busy={couponChecking}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!form.coupon_code.trim() || couponChecking}
                    onClick={() => void applyCoupon()}
                  >
                    {couponChecking ? 'Checking…' : 'Apply'}
                  </button>
                </div>
                {form.coupon_hint === 'valid' && (
                  <p style={{ color: 'var(--color-success)', fontSize: 14, margin: '6px 0 0' }}>
                    Valid: membership free
                  </p>
                )}
                {form.coupon_hint === 'invalid' && form.coupon_code.trim() && (
                  <p style={{ color: 'var(--color-danger)', fontSize: 14, margin: '6px 0 0' }}>
                    Invalid or expired code
                  </p>
                )}
                {form.coupon_hint !== 'valid' && (
                  <p className="field-hint" style={{ marginBottom: 0 }}>
                    {billingEnabled
                      ? 'Membership fee: £10/year. You will pay securely online before submitting your application (final step).'
                      : 'Membership fee: £10/year. Our team will contact you to arrange payment after approval.'}
                  </p>
                )}
              </div>
              <div className="register-actions">
                <button type="submit" className="btn btn-primary">
                  Continue
                </button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form
              className="register-form-grid"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                const e2 = validateStep2(form);
                if (Object.keys(e2).length) {
                  setFieldErrors(e2);
                  focusFirstFieldError(e2);
                  return;
                }
                setFieldErrors({});
                update({ step: 3 });
              }}
            >
              <h2 className="register-section-title">Personal details</h2>
              <p className="field-hint" style={{ marginTop: -8 }}>
                Use your legal names as they appear on official documents where possible.
              </p>
              <div>
                <label className="label" htmlFor="reg-given">
                  First name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-given"
                  name="given-name"
                  type="text"
                  autoComplete="given-name"
                  value={form.first_name}
                  onChange={(e) => {
                    update({ first_name: e.target.value });
                    clearFieldError('first_name');
                  }}
                  aria-invalid={fieldErrors.first_name ? true : undefined}
                />
                {fieldErrors.first_name && <p className="field-error">{fieldErrors.first_name}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-family">
                  Surname <span aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-family"
                  name="family-name"
                  type="text"
                  autoComplete="family-name"
                  value={form.surname}
                  onChange={(e) => {
                    update({ surname: e.target.value });
                    clearFieldError('surname');
                  }}
                  aria-invalid={fieldErrors.surname ? true : undefined}
                />
                {fieldErrors.surname && <p className="field-error">{fieldErrors.surname}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-nationality">
                  Nationality <span aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-nationality"
                  name="nationality"
                  type="text"
                  autoComplete="off"
                  value={form.nationality}
                  onChange={(e) => {
                    update({ nationality: e.target.value });
                    clearFieldError('nationality');
                  }}
                  aria-invalid={fieldErrors.nationality ? true : undefined}
                />
                {fieldErrors.nationality && <p className="field-error">{fieldErrors.nationality}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-pob">
                  Where do you live? <span aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-pob"
                  name="birth-place"
                  type="text"
                  autoComplete="off"
                  value={form.place_of_birth}
                  onChange={(e) => {
                    update({ place_of_birth: e.target.value });
                    clearFieldError('place_of_birth');
                  }}
                  aria-invalid={fieldErrors.place_of_birth ? true : undefined}
                />
                {fieldErrors.place_of_birth && (
                  <p className="field-error">{fieldErrors.place_of_birth}</p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="reg-origin">
                  Town and country of family origin <span aria-hidden="true">*</span>
                </label>
                <p className="field-hint">e.g. Nairobi, Kenya or Surat, Gujarat</p>
                <input
                  id="reg-origin"
                  name="origin-place"
                  type="text"
                  autoComplete="off"
                  value={form.town_country_of_origin}
                  onChange={(e) => {
                    update({ town_country_of_origin: e.target.value });
                    clearFieldError('town_country_of_origin');
                  }}
                  aria-invalid={fieldErrors.town_country_of_origin ? true : undefined}
                />
                {fieldErrors.town_country_of_origin && (
                  <p className="field-error">{fieldErrors.town_country_of_origin}</p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="reg-religion">
                  Religion <span aria-hidden="true">*</span>
                </label>
                <select
                  id="reg-religion"
                  name="religion"
                  autoComplete="off"
                  value={form.religion}
                  onChange={(e) => {
                    update({ religion: e.target.value });
                    clearFieldError('religion');
                  }}
                  aria-invalid={fieldErrors.religion ? true : undefined}
                >
                  <option value="">Select…</option>
                  {['Jain', 'Hindu', 'Other'].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {fieldErrors.religion && <p className="field-error">{fieldErrors.religion}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-father">
                  Father&apos;s name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-father"
                  type="text"
                  name="father-name"
                  autoComplete="additional-name"
                  value={form.father_name}
                  onChange={(e) => {
                    update({ father_name: e.target.value });
                    clearFieldError('father_name');
                  }}
                  aria-invalid={fieldErrors.father_name ? true : undefined}
                />
                {fieldErrors.father_name && <p className="field-error">{fieldErrors.father_name}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-mother">
                  Mother&apos;s name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-mother"
                  type="text"
                  name="mother-name"
                  autoComplete="off"
                  value={form.mother_name}
                  onChange={(e) => {
                    update({ mother_name: e.target.value });
                    clearFieldError('mother_name');
                  }}
                  aria-invalid={fieldErrors.mother_name ? true : undefined}
                />
                {fieldErrors.mother_name && <p className="field-error">{fieldErrors.mother_name}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-settlement">
                  Future settlement plans <span className="badge badge-muted">optional</span>
                </label>
                <p className="field-hint">e.g. Happy to stay in UK, open to relocating (max 200 characters)</p>
                <textarea
                  id="reg-settlement"
                  name="settlement-plans"
                  maxLength={200}
                  value={form.future_settlement_plans}
                  onChange={(e) => {
                    update({ future_settlement_plans: e.target.value });
                    clearFieldError('future_settlement_plans');
                  }}
                  aria-invalid={fieldErrors.future_settlement_plans ? true : undefined}
                  aria-describedby="reg-settlement-count"
                />
                <p id="reg-settlement-count" className="char-count">
                  {form.future_settlement_plans.length} / 200
                </p>
                {fieldErrors.future_settlement_plans && (
                  <p className="field-error">{fieldErrors.future_settlement_plans}</p>
                )}
              </div>
              <div className="register-actions">
                <button type="button" className="btn btn-secondary" onClick={() => update({ step: 1 })}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary">
                  Continue
                </button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form className="register-form-grid" noValidate onSubmit={submitAll}>
              <h2 className="register-section-title">Profile &amp; photo</h2>
              <p className="field-hint" style={{ marginTop: -8 }}>
                This information helps other members get to know you once your profile is approved.
              </p>
              <div>
                <label className="label" htmlFor="reg-education">
                  Education <span aria-hidden="true">*</span>
                </label>
                <p className="field-hint">e.g. BSc Mathematics, University of Manchester</p>
                <textarea
                  id="reg-education"
                  name="education"
                  autoComplete="education-level"
                  value={form.education}
                  onChange={(e) => {
                    update({ education: e.target.value });
                    clearFieldError('education');
                  }}
                  aria-invalid={fieldErrors.education ? true : undefined}
                />
                {fieldErrors.education && <p className="field-error">{fieldErrors.education}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-job">
                  Job title <span aria-hidden="true">*</span>
                </label>
                <p className="field-hint">e.g. Solicitor, Software Engineer</p>
                <input
                  id="reg-job"
                  name="job-title"
                  type="text"
                  autoComplete="organization-title"
                  value={form.job_title}
                  onChange={(e) => {
                    update({ job_title: e.target.value });
                    clearFieldError('job_title');
                  }}
                  aria-invalid={fieldErrors.job_title ? true : undefined}
                />
                {fieldErrors.job_title && <p className="field-error">{fieldErrors.job_title}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-height">
                  Height <span aria-hidden="true">*</span>
                </label>
                <select
                  id="reg-height"
                  name="height"
                  autoComplete="off"
                  value={form.height_cm === '' ? '' : String(form.height_cm)}
                  onChange={(e) => {
                    update({ height_cm: e.target.value ? Number(e.target.value) : '' });
                    clearFieldError('height_cm');
                  }}
                  aria-invalid={fieldErrors.height_cm ? true : undefined}
                >
                  <option value="">Select…</option>
                  {HEIGHT_OPTIONS.map((h) => (
                    <option key={h.cm} value={h.cm}>
                      {h.label}
                    </option>
                  ))}
                </select>
                {fieldErrors.height_cm && <p className="field-error">{fieldErrors.height_cm}</p>}
              </div>
              <div>
                <span className="label" id="reg-diet-label">
                  Diet <span aria-hidden="true">*</span>
                </span>
                <div className="register-radio-row" role="group" aria-labelledby="reg-diet-label">
                  {DIET_OPTIONS.map((d) => (
                    <label key={d}>
                      <input
                        id={`reg-diet-${d.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                        type="radio"
                        name="diet"
                        checked={form.diet === d}
                        onChange={() => {
                          update({ diet: d });
                          clearFieldError('diet');
                        }}
                      />
                      {d}
                    </label>
                  ))}
                </div>
                {fieldErrors.diet && <p className="field-error">{fieldErrors.diet}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-hobbies">
                  Hobbies and interests <span aria-hidden="true">*</span>
                </label>
                <p className="field-hint">
                  Tell us what you enjoy, for example: travelling, cooking, cricket, reading (max 400 characters)
                </p>
                <textarea
                  id="reg-hobbies"
                  name="hobbies"
                  maxLength={400}
                  autoComplete="off"
                  value={form.hobbies}
                  onChange={(e) => {
                    update({ hobbies: e.target.value });
                    clearFieldError('hobbies');
                  }}
                  aria-invalid={fieldErrors.hobbies ? true : undefined}
                  aria-describedby="reg-hobbies-count"
                />
                <p id="reg-hobbies-count" className="char-count">
                  {form.hobbies.length} / 400
                </p>
                {fieldErrors.hobbies && <p className="field-error">{fieldErrors.hobbies}</p>}
              </div>
              <div>
                <label className="label" htmlFor="reg-photo">
                  Profile photos (up to 3) <span aria-hidden="true">*</span>
                </label>
                <p className="field-hint">
                  A clear, recent photo of <strong>your face only</strong>. <strong>No group photos.</strong>{' '}
                  <strong>JPG or PNG only.</strong> Visible to other members after approval. Images are compressed
                  before upload. Drag and drop to reorder.
                </p>
                <input
                  id="reg-photo"
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  disabled={photoUploading}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    files.slice(0, 3).forEach((f) => void uploadPhoto(f));
                    clearFieldError('photo_path');
                    e.currentTarget.value = '';
                  }}
                />
                {photoUploading && (
                  <p className="field-hint" style={{ marginBottom: 0 }}>
                    Compressing and uploading your photo…
                  </p>
                )}
                {form.photo_compress_note && (
                  <p className="field-hint" style={{ marginBottom: 0 }}>
                    {form.photo_compress_note}
                  </p>
                )}
                {photoPreviews.length > 0 && (
                  <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                    {photoPreviews.map((src, idx) => (
                      <div
                        key={form.photo_paths[idx] ?? src}
                        draggable
                        onDragStart={() => setDragPhotoIndex(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragPhotoIndex != null) movePhoto(dragPhotoIndex, idx);
                          setDragPhotoIndex(null);
                        }}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'center',
                          padding: 8,
                          border: idx === 0 ? '2px solid var(--color-success)' : '1px solid var(--color-border)',
                          borderRadius: 8,
                        }}
                      >
                        <img src={src} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6 }} />
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 13 }}>{idx === 0 ? 'Primary profile photo' : `Photo ${idx + 1}`}</p>
                          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                            Drag to reorder
                          </p>
                        </div>
                        <button type="button" className="btn btn-secondary" onClick={() => removePhotoAt(idx)}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {fieldErrors.photo_path && <p className="field-error">{fieldErrors.photo_path}</p>}
              </div>
              {billingEnabled && form.coupon_hint !== 'valid' && (
                <div
                  id="reg-payment-fee"
                  className="register-fieldset"
                  style={{ background: 'var(--color-surface)', borderRadius: 8 }}
                  tabIndex={-1}
                >
                  <h3 className="register-section-title" style={{ fontSize: '1.05rem', marginTop: 0 }}>
                    Membership fee
                  </h3>
                  {stripeCheckoutSessionId ? (
                    <p style={{ color: 'var(--color-success)', marginBottom: 0 }}>
                      Payment received. You can submit your registration below.
                    </p>
                  ) : (
                    <>
                      <p className="field-hint" style={{ marginTop: -4 }}>
                        Pay the £10 registration fee by card. You will return here to submit your application.
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={stripeRedirectBusy}
                        onClick={() => void startRegistrationCheckout()}
                      >
                        {stripeRedirectBusy ? 'Redirecting…' : 'Pay £10 with Stripe'}
                      </button>
                    </>
                  )}
                  {fieldErrors.payment && <p className="field-error">{fieldErrors.payment}</p>}
                </div>
              )}

              <fieldset
                className="register-fieldset register-consent"
                style={{ background: 'var(--color-surface)' }}
              >
                <legend>Consent (all required)</legend>
                <label htmlFor="reg-consent-contact">
                  <input
                    id="reg-consent-contact"
                    type="checkbox"
                    checked={form.consent_contact}
                    onChange={(e) => {
                      update({ consent_contact: e.target.checked });
                      clearFieldError('consent_contact');
                    }}
                  />
                  <span>
                    I consent to my contact details being shared with prospective candidates as part of this
                    service.
                  </span>
                </label>
                {fieldErrors.consent_contact && (
                  <p className="field-error" style={{ marginTop: -4 }}>
                    {fieldErrors.consent_contact}
                  </p>
                )}
                <label htmlFor="reg-consent-age">
                  <input
                    id="reg-consent-age"
                    type="checkbox"
                    checked={form.consent_age}
                    onChange={(e) => {
                      update({ consent_age: e.target.checked });
                      clearFieldError('consent_age');
                    }}
                  />
                  <span>I confirm I am aged 18 or over.</span>
                </label>
                {fieldErrors.consent_age && (
                  <p className="field-error" style={{ marginTop: -4 }}>
                    {fieldErrors.consent_age}
                  </p>
                )}
                <label htmlFor="reg-consent-privacy">
                  <input
                    id="reg-consent-privacy"
                    type="checkbox"
                    checked={form.consent_privacy}
                    onChange={(e) => {
                      update({ consent_privacy: e.target.checked });
                      clearFieldError('consent_privacy');
                    }}
                  />
                  <span>
                    I have read and agree to the{' '}
                    <a href="/privacy" target="_blank" rel="noreferrer">
                      Privacy Policy
                    </a>{' '}
                    and{' '}
                    <a href="/privacy#terms" target="_blank" rel="noreferrer">
                      Terms of use
                    </a>
                    .
                  </span>
                </label>
                {fieldErrors.consent_privacy && (
                  <p className="field-error" style={{ marginTop: -4 }}>
                    {fieldErrors.consent_privacy}
                  </p>
                )}
              </fieldset>
              <div className="register-actions">
                <button type="button" className="btn btn-secondary" onClick={() => update({ step: 2 })}>
                  Back
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    submitting ||
                    !form.consent_contact ||
                    !form.consent_age ||
                    !form.consent_privacy ||
                    (billingEnabled && form.coupon_hint !== 'valid' && !stripeCheckoutSessionId)
                  }
                >
                  {submitting ? 'Submitting…' : 'Submit registration'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
