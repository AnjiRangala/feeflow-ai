import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const integerList = z.string()
  .regex(/^-?\d+(,-?\d+)*$/, 'must be a comma-separated list of integers')
  .transform((value) => value.split(',').map(Number));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('2h'),
  OTP_HMAC_SECRET: z.string().min(32, 'OTP_HMAC_SECRET must be at least 32 characters'),
  OTP_EXPIRES_MINUTES: z.coerce.number().int().positive().max(15).default(5),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  AI_SERVICE_URL: z.string().url().default('http://127.0.0.1:8000').refine((value) => {
    const url = new URL(value);
    const privateServiceName = /^[a-z][a-z0-9-]*$/i.test(url.hostname);
    return ['http:', 'https:'].includes(url.protocol) &&
      (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || privateServiceName);
  }, 'must point to localhost or a private single-label service; public AI providers are not supported'),
  AI_SERVICE_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(5_000),
  AI_SERVICE_TOKEN: z.string().min(32).optional(),
  PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  REFUND_POLICY_VERSION: z.string().trim().min(1).max(80).default('demo-pro-rata-v1'),
  MOCK_PAYMENTS_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  REMINDER_SCHEDULE_OFFSETS_DAYS: integerList
    .prefault('3,0,-3,-7,-15')
    .refine((offsets) => offsets.length <= 20 &&
      offsets.every((offset) => Number.isSafeInteger(offset) && Math.abs(offset) <= 365) &&
      new Set(offsets).size === offsets.length,
    'must contain up to 20 unique integer day offsets between -365 and 365'),
  REMINDER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  REMINDER_CATCH_UP_WINDOW_MS: z.coerce.number().int().min(0).max(7 * 24 * 60 * 60 * 1000)
    .default(24 * 60 * 60 * 1000),
  REMINDER_STALE_SENDING_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(3_600_000).default(300_000),
  REMINDER_RETRY_DELAYS_MS: integerList
    .prefault('60000,300000,900000')
    .refine((delays) => delays.length <= 10 && delays.every((delay) =>
      Number.isSafeInteger(delay) && delay >= 1_000 && delay <= 24 * 60 * 60 * 1000),
    'must contain up to 10 retry delays between 1000 and 86400000 milliseconds'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z.string().default('false').transform((value) => value === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default(''),
  RECEIPT_GST_NOTE: z.string().trim().min(1).max(500).default(
    'Not configured. No GST has been calculated or collected. Project assumption only; not a statement of tax applicability.'
  )
});

export function loadConfig(source = process.env) {
  const normalized = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== '')
  );
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production') {
    if (config.MOCK_PAYMENTS_ENABLED || config.PAYMENT_PROVIDER !== 'razorpay') {
      throw new Error('Production requires PAYMENT_PROVIDER=razorpay and MOCK_PAYMENTS_ENABLED=false');
    }
    if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET || !config.RAZORPAY_WEBHOOK_SECRET) {
      throw new Error('Production requires Razorpay credentials and webhook secret');
    }
    if (!config.AI_SERVICE_TOKEN) throw new Error('Production requires AI_SERVICE_TOKEN');
    if (!config.SMTP_HOST || !config.SMTP_PORT || !config.SMTP_USER || !config.SMTP_PASSWORD || !config.SMTP_FROM) {
      throw new Error('Production requires authenticated SMTP configuration');
    }
    if (new URL(config.FRONTEND_URL).protocol !== 'https:') {
      throw new Error('Production FRONTEND_URL must use HTTPS');
    }
    if (new URL(config.MONGO_URI).protocol !== 'mongodb+srv:' &&
        !/[?&]tls=true(?:&|$)/i.test(config.MONGO_URI)) {
      throw new Error('Production MONGO_URI must enable TLS');
    }
  }
  return config;
}

export const config = loadConfig();
