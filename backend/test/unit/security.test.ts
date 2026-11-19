import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { isPrivateDatabaseHost, validateInitData } from '../../src/security.js';

function signedInitData(botToken: string, values: Record<string, string>): string {
  const encoded = Object.entries(values).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  const dataCheck = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  return `${encoded.join('&')}&hash=${hash}`;
}

test('validates Telegram initData and extracts a numeric user id', () => {
  const now = 1_700_000_000_000;
  const input = signedInitData('test-bot-token', { auth_date: '1700000000', user: JSON.stringify({ id: 12345, first_name: 'Nova', username: 'nova' }) });
  const parsed = validateInitData(input, 'test-bot-token', 300, now);
  assert.equal(parsed.telegramId, '12345');
  assert.equal(parsed.username, 'nova');
});

test('rejects malformed encoding, duplicates and future dates', () => {
  assert.throws(() => validateInitData('user=%E0%A4%A&auth_date=1&hash=bad', 'token', 300));
  const now = 1_700_000_000_000;
  const input = signedInitData('token', { auth_date: '1700000000', user: JSON.stringify({ id: 1 }) });
  assert.throws(() => validateInitData(`${input}&user=x`, 'token', 300, now));
  const future = signedInitData('token', { auth_date: '1700000100', user: JSON.stringify({ id: 1 }) });
  assert.throws(() => validateInitData(future, 'token', 300, now));
});

test('accepts only private database hosts', () => {
  assert.equal(isPrivateDatabaseHost('localhost'), true);
  assert.equal(isPrivateDatabaseHost('postgres'), true);
  assert.equal(isPrivateDatabaseHost('10.0.0.10'), true);
  assert.equal(isPrivateDatabaseHost('8.8.8.8'), false);
});
