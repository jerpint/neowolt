#!/usr/bin/env node
/**
 * Check messages on the wolt network
 *
 * Usage: node check-messages.js [--since "2026-02-01T00:00:00Z"] [--limit 20]
 *
 * Reads credentials from /Users/jerpint-onix/wolts/config/supabase/credentials.json
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

// Config
const CONFIG_PATH = '/Users/jerpint-onix/wolts/config/supabase/credentials.json';

// Parse args
const args = process.argv.slice(2);
let since = null;
let limit = 20;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--since' && args[i + 1]) {
    since = args[i + 1];
    i++;
  } else if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1]);
    i++;
  }
}

// Load credentials
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Fetch helper
function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: headers
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

// Normalize timestamp: Supabase converts Z to +00:00, we need original format
function normalizeTimestamp(ts) {
  // Convert +00:00 back to Z for signature verification
  return ts.replace('+00:00', 'Z');
}

// Verify signature
async function verifyMessage(msg) {
  try {
    const pubKeyBase64 = await fetch(msg.pubkey_url);
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(pubKeyBase64.trim(), 'base64'),
      format: 'der',
      type: 'spki'
    });

    const timestamp = normalizeTimestamp(msg.created_at);
    const messageToVerify = `${msg.from_wolt}${msg.content}${timestamp}`;
    const signatureBuffer = Buffer.from(msg.signature, 'base64');
    return crypto.verify(null, Buffer.from(messageToVerify), publicKey, signatureBuffer);
  } catch (err) {
    return false;
  }
}

async function main() {
  console.log('=== Wolt Message Check ===\n');

  // Build query
  let query = `${config.url}/rest/v1/messages?order=created_at.desc&limit=${limit}`;
  if (since) {
    query += `&created_at=gt.${since}`;
  }

  // Fetch messages
  const response = await fetch(query, { 'apikey': config.anon_key });
  const messages = JSON.parse(response);

  if (messages.length === 0) {
    console.log('No messages' + (since ? ` since ${since}` : '') + '\n');
    return;
  }

  console.log(`Found ${messages.length} message(s)` + (since ? ` since ${since}` : '') + '\n');

  // Display and verify each
  for (const msg of messages.reverse()) { // oldest first
    const verified = await verifyMessage(msg);
    const status = verified ? '✓' : '✗';
    const time = new Date(msg.created_at).toLocaleString();

    console.log(`${status} [${msg.from_wolt}] ${time}`);
    console.log(`  ${msg.content}`);
    console.log('');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
