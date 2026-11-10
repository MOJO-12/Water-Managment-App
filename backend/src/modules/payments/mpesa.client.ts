import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { nairobiTimestamp, stkPassword } from './mpesa.utils';

const BASE_URL = env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
const providerError = () => new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Could not reach M-Pesa. Please try again.');

function config() {
  const { MPESA_CONSUMER_KEY: key, MPESA_CONSUMER_SECRET: secret, MPESA_SHORTCODE: shortcode } = env;
  const { MPESA_PASSKEY: passkey, MPESA_CALLBACK_BASE_URL: base, MPESA_CALLBACK_SECRET: cbSecret } = env;
  if (!key || !secret || !shortcode || !passkey || !base || !cbSecret) {
    throw new AppError(503, 'PAYMENTS_UNAVAILABLE', 'M-Pesa payments are not available right now');
  }
  // The word "mpesa" is deliberately absent from this path: Daraja can reject callback URLs containing it.
  return { key, secret, shortcode, passkey, callbackUrl: `${base}/api/v1/payments/hooks/stk/${cbSecret}` };
}
export const isMpesaConfigured = (): boolean => {
  try {
    config();
    return true;
  } catch {
    return false;
  }
};

let cached: { token: string; expiresAt: number } | undefined;

async function getToken(cfg: ReturnType<typeof config>): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${Buffer.from(`${cfg.key}:${cfg.secret}`).toString('base64')}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.error({ err }, 'Daraja auth request failed');
    throw providerError();
  }
  if (!res.ok) {
    logger.error({ status: res.status }, 'Daraja rejected the consumer key/secret');
    throw providerError();
  }
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: string | number };
  if (!json.access_token) throw providerError();
  cached = { token: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3599) * 1000 - 60_000 };
  return json.access_token;
}

async function post<T>(path: string, body: object, cfg: ReturnType<typeof config>): Promise<{ ok: boolean; json: T }> {
  const token = await getToken(cfg);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    logger.error({ err, path }, 'Daraja request failed');
    throw providerError();
  }
  if (res.status === 401) cached = undefined;
  return { ok: res.ok, json: (await res.json().catch(() => ({}))) as T };
}

interface StkResponse {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
  errorCode?: string;
  errorMessage?: string;
}

export async function initiateStkPush(input: { amountKes: number; phone: string; reference: string; description: string }) {
  const cfg = config();
  const timestamp = nairobiTimestamp();
  const { ok, json } = await post<StkResponse>(
    '/mpesa/stkpush/v1/processrequest',
    {
      BusinessShortCode: cfg.shortcode,
      Password: stkPassword(cfg.shortcode, cfg.passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: env.MPESA_TRANSACTION_TYPE,
      Amount: input.amountKes,
      PartyA: input.phone,
      PartyB: cfg.shortcode,
      PhoneNumber: input.phone,
      CallBackURL: cfg.callbackUrl,
      AccountReference: input.reference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    },
    cfg,
  );
  if (!ok || json.ResponseCode !== '0' || !json.CheckoutRequestID) {
    logger.error(
      { code: json.ResponseCode, desc: json.ResponseDescription, errorCode: json.errorCode, errorMessage: json.errorMessage },
      'STK push rejected by Daraja',
    );
    throw providerError();
  }
  return {
    checkoutRequestId: json.CheckoutRequestID,
    merchantRequestId: json.MerchantRequestID ?? null,
    customerMessage: json.CustomerMessage ?? 'Check your phone and enter your M-Pesa PIN.',
  };
}

/** Asks Daraja how a prompt ended. resultCode is undefined while it is still being processed. */
export async function queryStkPush(checkoutRequestId: string): Promise<{ resultCode?: number; resultDesc?: string }> {
  const cfg = config();
  const timestamp = nairobiTimestamp();
  const { json } = await post<{ ResultCode?: string | number; ResultDesc?: string }>(
    '/mpesa/stkpushquery/v1/query',
    {
      BusinessShortCode: cfg.shortcode,
      Password: stkPassword(cfg.shortcode, cfg.passkey, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    cfg,
  );
  if (json.ResultCode === undefined || json.ResultCode === '') return {};
  const code = Number(json.ResultCode);
  return Number.isNaN(code) ? {} : { resultCode: code, ...(json.ResultDesc && { resultDesc: json.ResultDesc }) };
}
