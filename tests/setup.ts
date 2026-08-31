import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

const TEST_DB = process.env.TEST_DB_NAME ?? 'madesaite_test';
const base = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/madesaite');
base.pathname = `/${TEST_DB}`;

// Every test module resolves DATABASE_URL through this, never the dev database.
process.env.DATABASE_URL = base.toString();
process.env.AUTH_SECRET ??= 'test_only_secret_value_at_least_32_chars_long!!';
process.env.MOCK_GATEWAY_SECRET ??= 'test_only_gateway_secret_value_1234567890';
process.env.PAYMENT_PROVIDER ??= 'mock';
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
process.env.ORDER_PAYMENT_TTL_MINUTES ??= '30';
