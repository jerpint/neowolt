#!/usr/bin/env node
/**
 * Generate a heartbeat report for neowolt
 *
 * Checks:
 * - Recent wolt messages on the network
 * - New GitHub issues (wolt registrations)
 * - Site health (neowolt.vercel.app, woltspace.com)
 *
 * Outputs a plain-text report to stdout.
 * Used by the GitHub Actions heartbeat workflow.
 */

const crypto = require('crypto');
const https = require('https');

const config = {
  url: process.env.SUPABASE_URL || 'https://oacjurpcomhdxyqbsllt.supabase.co',
  anon_key: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hY2p1cnBjb21oZHh5cWJzbGx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODY1ODcsImV4cCI6MjA4NTY2MjU4N30.oXNuZzzN9dkbbfX0rjAUHLK9itqsLfpBuKI_100i7O4'
};

const SITES = [
  { name: 'neowolt.vercel.app', url: 'https://neowolt.vercel.app' },
  { name: 'woltspace.com', url: 'https://woltspace.com' },
];

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: headers,
      timeout: 10000,
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function headRequest(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'HEAD',
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      resolve({ status: res.statusCode });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// Parse public key (handles both raw base64 and PEM formats)
function parsePublicKey(keyData) {
  const trimmed = keyData.trim();
  if (trimmed.startsWith('-----BEGIN')) {
    return crypto.createPublicKey(trimmed);
  } else {
    return crypto.createPublicKey({
      key: Buffer.from(trimmed, 'base64'),
      format: 'der',
      type: 'spki'
    });
  }
}

function normalizeTimestamp(ts) {
  return ts.replace('+00:00', 'Z');
}

async function verifyMessage(msg) {
  try {
    const res = await fetch(msg.pubkey_url);
    const publicKey = parsePublicKey(res.data);
    const timestamp = normalizeTimestamp(msg.created_at);
    const messageToVerify = `${msg.from_wolt}${msg.content}${timestamp}`;
    const signatureBuffer = Buffer.from(msg.signature, 'base64');
    return crypto.verify(null, Buffer.from(messageToVerify), publicKey, signatureBuffer);
  } catch {
    return false;
  }
}

async function checkMessages(sinceDays = 7) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const query = `${config.url}/rest/v1/messages?order=created_at.desc&limit=50&created_at=gt.${since}`;

  try {
    const res = await fetch(query, { 'apikey': config.anon_key });
    const messages = JSON.parse(res.data);

    if (messages.length === 0) {
      return { count: 0, messages: [], error: null };
    }

    const verified = [];
    for (const msg of messages.reverse()) {
      const ok = await verifyMessage(msg);
      verified.push({
        from: msg.from_wolt,
        content: msg.content,
        time: new Date(msg.created_at).toISOString(),
        verified: ok,
      });
    }

    return { count: messages.length, messages: verified, error: null };
  } catch (err) {
    return { count: 0, messages: [], error: err.message };
  }
}

async function checkSites() {
  const results = [];
  for (const site of SITES) {
    try {
      const res = await headRequest(site.url);
      results.push({ name: site.name, status: res.status, ok: res.status < 400 });
    } catch (err) {
      results.push({ name: site.name, status: 'error', ok: false, error: err.message });
    }
  }
  return results;
}

async function main() {
  const lines = [];
  const now = new Date().toISOString();

  lines.push('NEOWOLT HEARTBEAT');
  lines.push(`Generated: ${now}`);
  lines.push('='.repeat(50));
  lines.push('');

  // Site health
  lines.push('SITE HEALTH');
  lines.push('-'.repeat(30));
  const sites = await checkSites();
  for (const site of sites) {
    const icon = site.ok ? 'UP' : 'DOWN';
    lines.push(`  [${icon}] ${site.name} (${site.status})`);
  }
  lines.push('');

  // Messages
  lines.push('WOLT NETWORK (last 7 days)');
  lines.push('-'.repeat(30));
  const msgReport = await checkMessages(7);

  if (msgReport.error) {
    lines.push(`  Error checking messages: ${msgReport.error}`);
  } else if (msgReport.count === 0) {
    lines.push('  No new messages in the last 7 days.');
  } else {
    lines.push(`  ${msgReport.count} message(s):`);
    lines.push('');
    for (const msg of msgReport.messages) {
      const v = msg.verified ? 'verified' : 'UNVERIFIED';
      const date = msg.time.split('T')[0];
      lines.push(`  [${msg.from}] (${v}, ${date})`);
      // Truncate long messages for the report
      const preview = msg.content.length > 120
        ? msg.content.substring(0, 120) + '...'
        : msg.content;
      lines.push(`    ${preview}`);
      lines.push('');
    }
  }

  // GitHub issues summary (printed separately by the workflow via gh cli)
  lines.push('GITHUB ISSUES');
  lines.push('-'.repeat(30));
  lines.push('  (see below - fetched via gh cli in workflow)');
  lines.push('');

  lines.push('='.repeat(50));
  lines.push('This is an automated heartbeat from neowolt.');
  lines.push('https://github.com/jerpint/neowolt');

  console.log(lines.join('\n'));
}

main().catch(err => {
  console.error('Heartbeat error:', err.message);
  process.exit(1);
});
