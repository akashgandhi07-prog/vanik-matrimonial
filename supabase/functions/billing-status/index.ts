import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const stripeOk = !!(Deno.env.get('STRIPE_SECRET_KEY')?.trim() && Deno.env.get('STRIPE_MEMBERSHIP_PRICE_ID')?.trim());

  return jsonResponse({
    stripe_registration_enabled: stripeOk,
    stripe_renewal_enabled: stripeOk,
  });
});
