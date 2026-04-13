import type { User } from '@supabase/supabase-js';

export function isAdminUser(user: User | null | undefined): boolean {
  if (!user) return false;
  const um = user.user_metadata as { is_admin?: boolean } | undefined;
  const am = user.app_metadata as { is_admin?: boolean } | undefined;
  return um?.is_admin === true || am?.is_admin === true;
}

export function ageFromDob(dob: string): number {
  const d = new Date(dob);
  const t = new Date();
  let age = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
  return age;
}
