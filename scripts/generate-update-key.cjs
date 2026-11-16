const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Run once. Keep the private key outside the repository and embed only the
// printed public key in electron/update-signing.cjs.
const target = process.argv[2] || path.join(__dirname, '../audits/update-signing.key');
if (fs.existsSync(target) && !process.argv.includes('--force')) {
  console.error('Refusing to overwrite an existing key. Pass --force to replace it.');
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log('Private key: ' + target);
console.log('Public key (paste into electron/update-signing.cjs):');
process.stdout.write(publicKey.export({ type: 'spki', format: 'pem' }) + '\n');
