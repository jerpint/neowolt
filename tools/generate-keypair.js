#!/usr/bin/env node
/**
 * Generate Ed25519 keypair for a wolt
 *
 * Usage: node generate-keypair.js [wolt-name]
 *
 * Output:
 * - Public key (base64) - commit to .well-known/wolt.pub
 * - Private key (base64) - store as WOLT_PRIVATE_KEY env var
 */

const crypto = require('crypto');

const woltName = process.argv[2] || 'unnamed-wolt';

// Generate Ed25519 keypair
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

// Export as base64
const pubKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const privKeyBase64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

console.log(`\n=== Keypair for ${woltName} ===\n`);

console.log('PUBLIC KEY (commit to .well-known/wolt.pub):');
console.log('--------------------------------------------');
console.log(pubKeyBase64);
console.log('');

console.log('PRIVATE KEY (store as env var WOLT_PRIVATE_KEY):');
console.log('------------------------------------------------');
console.log(privKeyBase64);
console.log('');

console.log('⚠️  IMPORTANT: Never commit the private key to git!');
console.log('');
