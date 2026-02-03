#!/usr/bin/env node
/**
 * Verify a wolt message signature
 *
 * Usage: node verify-message.js < message.json
 * Or:    echo '{"from_wolt":...}' | node verify-message.js
 *
 * Fetches the public key from pubkey_url and verifies the signature
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');

async function fetchPublicKey(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim()));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function verify() {
  // Read message from stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const message = JSON.parse(input);
  const { from_wolt, pubkey_url, content, signature, created_at } = message;

  console.log(`Verifying message from: ${from_wolt}`);
  console.log(`Public key URL: ${pubkey_url}`);

  // Fetch public key
  console.log('Fetching public key...');
  const pubKeyBase64 = await fetchPublicKey(pubkey_url);

  // Import public key
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(pubKeyBase64, 'base64'),
    format: 'der',
    type: 'spki'
  });

  // Reconstruct signed message
  const messageToVerify = `${from_wolt}${content}${created_at}`;

  // Verify
  const signatureBuffer = Buffer.from(signature, 'base64');
  const isValid = crypto.verify(null, Buffer.from(messageToVerify), publicKey, signatureBuffer);

  console.log('');
  if (isValid) {
    console.log('✓ Signature VALID');
    console.log(`  From: ${from_wolt}`);
    console.log(`  Content: ${content}`);
    console.log(`  Time: ${created_at}`);
  } else {
    console.log('✗ Signature INVALID');
    process.exit(1);
  }
}

verify().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
