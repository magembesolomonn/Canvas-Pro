const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const file = process.argv[2];
const keyFile = process.env.CANVAS_UPDATE_KEY || process.argv[3] || path.join(__dirname, '../audits/update-signing.key');
const signatureFile = process.argv[4] || path.join(path.dirname(file || '.'), 'update.sig');
if (!file) {
  console.error('Usage: node scripts/sign-update.cjs <SHA256SUMS.txt> [private-key.pem] [update.sig]');
  process.exit(1);
}
const signature = crypto.sign(null, fs.readFileSync(file), crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8')));
fs.writeFileSync(signatureFile, signature);
console.log('Signed ' + file + ' -> ' + signatureFile);
console.log('Upload both the checksum file and update.sig to the GitHub release.');
