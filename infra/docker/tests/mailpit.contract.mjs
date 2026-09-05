import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';

import { waitForHealth } from '../scripts/wait-for-health.mjs';

const apiUrl = (process.env.MAILPIT_API_URL ?? '').replace(/\/$/, '');
assert.ok(apiUrl, 'MAILPIT_API_URL is required');
await waitForHealth(`${apiUrl}/readyz`);

const transporter = nodemailer.createTransport({
  host: 'mailpit',
  port: 1025,
  secure: false,
  auth: { user: 'synthetic', pass: 'synthetic' },
});

await transporter.sendMail({
  from: 'moderation@wmatch.invalid',
  to: 'ops@wmatch.invalid',
  subject: '[WMatch] Synthetic moderation case ready',
  text: 'case_id=00000000-0000-4000-8000-000000000001 status=open; no profile or message snapshot attached',
});

const response = await fetch(`${apiUrl}/api/v1/messages`);
assert.equal(response.status, 200);
const body = await response.json();
const messages = Array.isArray(body.messages) ? body.messages : Array.isArray(body.Messages) ? body.Messages : [];
assert.ok(messages.length >= 1, 'Mailpit should capture the synthetic message');
const serialized = JSON.stringify(messages);
assert.doesNotMatch(serialized, /Bearer\s|ExponentPushToken|supabase_service_role/i);

transporter.close();
process.stdout.write('Mailpit moderation SMTP contract: PASS\n');

