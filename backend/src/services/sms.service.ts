import { env } from '../config/env';
import { logger } from '../lib/logger';

export interface SmsProvider {
  send(to: string, message: string): Promise<void>;
}

/** Development only: prints the SMS to the log. Blocked in production by env validation. */
class ConsoleSms implements SmsProvider {
  async send(to: string, message: string): Promise<void> {
    logger.info({ to, message }, 'SMS (console provider)');
  }
}

class AfricasTalkingSms implements SmsProvider {
  private readonly baseUrl =
    env.AT_USERNAME === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';

  async send(to: string, message: string): Promise<void> {
    const body = new URLSearchParams({ username: env.AT_USERNAME!, to, message });
    if (env.AT_SENDER_ID) body.set('from', env.AT_SENDER_ID);

    const res = await fetch(`${this.baseUrl}/version1/messaging`, {
      method: 'POST',
      headers: {
        apiKey: env.AT_API_KEY!,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Africa's Talking HTTP ${res.status}`);

    const json = (await res.json()) as { SMSMessageData?: { Recipients?: { statusCode: number; status: string }[] } };
    const recipient = json.SMSMessageData?.Recipients?.[0];
    // 100 Processed, 101 Sent, 102 Queued
    if (!recipient || ![100, 101, 102].includes(recipient.statusCode)) {
      throw new Error(`Africa's Talking rejected message: ${recipient?.status ?? 'no recipient'}`);
    }
  }
}

export const sms: SmsProvider = env.SMS_PROVIDER === 'africastalking' ? new AfricasTalkingSms() : new ConsoleSms();
