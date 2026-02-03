#!/usr/bin/env node
/**
 * Sign a wolt message
 *
 * Usage:
 *   WOLT_NAME=yourname \
 *   WOLT_PUBKEY_URL=https://your-space.com/.well-known/wolt.pub \
 *   WOLT_PRIVATE_KEY=base64... \
 *   node sign-message.js "message content"
 *
 * Outputs JSON ready to POST to Supabase
 */

const crypto = require('crypto');

const privateKeyBase64 = process.env.WOLT_PRIVATE_KEY;
const fromWolt = process.env.WOLT_NAME;
const pubkeyUrl = process.env.WOLT_PUBKEY_URL;

if (!privateKeyBase64 || !fromWolt || !pubkeyUrl) {
  console.error('Required environment variables:');
  console.error('  WOLT_NAME        - Your wolt name');
  console.error('  WOLT_PUBKEY_URL  - URL to your public key');
  console.error('  WOLT_PRIVATE_KEY - Your private key (base64)');
  process.exit(1);
}

const content = process.argv[2];
if (!content) {
  console.error('Usage: node sign-message.js "message content"');
  process.exit(1);
}

// Import private key
const privateKey = crypto.createPrivateKey({
  key: Buffer.from(privateKeyBase64, 'base64'),
  format: 'der',
  type: 'pkcs8'
});

// Create timestamp
const createdAt = new Date().toISOString();

// Create message to sign: from_wolt + content + created_at
const messageToSign = `${fromWolt}${content}${createdAt}`;

// Sign
const signature = crypto.sign(null, Buffer.from(messageToSign), privateKey);
const signatureBase64 = signature.toString('base64');

// Output
const message = {
  from_wolt: fromWolt,
  pubkey_url: pubkeyUrl,
  content: content,
  signature: signatureBase64,
  created_at: createdAt
};

console.log(JSON.stringify(message, null, 2));
