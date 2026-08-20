import type { Session } from '@supabase/supabase-js';

import { supabase } from '../../../utils/supabase/client';
import { telemetry } from '../../services/telemetry';
import {
  clearAuthFlowState,
  getTrustedAuthDeepLinkKind,
  normalizeOtpType,
  parseDeepLinkParams,
  validateAuthFlowState,
} from './authSupport';

export async function processAuthDeepLink(options: {
  url: string | null;
  onSession: (session: Session | null) => Promise<void>;
  onRecovery: () => void;
}) {
  if (!options.url) {
    return;
  }

  const params = parseDeepLinkParams(options.url);
  const authLinkKind = getTrustedAuthDeepLinkKind(options.url);

  if (!authLinkKind) {
    telemetry.track('auth.deep_link_rejected', { reason: 'untrusted_route' });
    return;
  }

  if (params.error || params.errorDescription) {
    telemetry.track('auth.deep_link_rejected', { reason: 'provider_error', code: params.errorCode });
    return;
  }

  if (params.accessToken || params.refreshToken) {
    telemetry.track('auth.deep_link_rejected', { reason: 'raw_tokens' });
    return;
  }

  const otpType = normalizeOtpType(params.type);
  if (
    (authLinkKind === 'verify' && otpType === 'recovery')
    || (authLinkKind === 'recovery' && otpType != null && otpType !== 'recovery')
  ) {
    telemetry.track('auth.deep_link_rejected', { reason: 'route_type_mismatch' });
    return;
  }

  const authFlowKind = authLinkKind === 'recovery' ? 'recovery' : 'signup';
  if (
    (params.code || params.tokenHash)
    && !(await validateAuthFlowState(authFlowKind, params.state))
  ) {
    telemetry.track('auth.deep_link_rejected', { reason: 'invalid_state' });
    return;
  }

  let session: Session | null = null;
  if (params.code) {
    const result = await supabase.auth.exchangeCodeForSession(params.code);
    if (result.error) {
      telemetry.captureException(result.error, { operation: 'auth_pkce_exchange' });
      return;
    }
    session = result.data.session ?? null;
  } else if (params.tokenHash && otpType) {
    const result = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: otpType });
    if (result.error) {
      telemetry.captureException(result.error, { operation: 'auth_otp_verification' });
      return;
    }
    session = result.data.session ?? null;
  } else {
    return;
  }

  await options.onSession(session);
  await clearAuthFlowState(authFlowKind);

  if (authLinkKind === 'recovery') {
    options.onRecovery();
  }
}
