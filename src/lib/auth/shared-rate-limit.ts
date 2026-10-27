import { createHmac } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const consumeSharedLoginLimit = async (username: string, ip: string) => {
  const secret = process.env.APP_SESSION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('RATE_LIMIT_UNAVAILABLE');
  // IP first: random usernames cannot grow storage beyond the IP budget.
  for (const [scope, value, limit] of [['ip', ip, 60], ['account', username.trim().toLowerCase(), 12]] as const) {
    const bucket = createHmac('sha256', secret).update(`login:${scope}:${value}`).digest('hex');
    const { data, error } = await supabaseAdmin.rpc('consume_security_rate_limit', {
      p_bucket: bucket, p_limit: limit, p_window_seconds: 900
    });
    if (error || !Number.isInteger(data) || data < 0) throw new Error('RATE_LIMIT_UNAVAILABLE');
    if (data > 0) return data as number;
  }
  return 0;
};
