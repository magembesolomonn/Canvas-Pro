// Update release signing. The private key is kept out of the app and out of
// source control; scripts/sign-update.cjs uses it to sign the checksum file
// that ships with each GitHub release. The public key below is embedded in the
// app, so a checksum published without a matching signature is not trusted.
const crypto = require('node:crypto');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAEMQrU8esJ8K8rbIb6BqYYn2Gc1QdxXb1yLx8Sjcitqc=
-----END PUBLIC KEY-----
`;

// Set to the released app's Developer ID Team ID once the build is signed
// with a Developer ID certificate and notarized. Empty disables this extra
// check; the Ed25519 checksum signature is always required.
const EXPECTED_TEAM_ID = '';

function verifyUpdateSignature(data, signature) {
  return crypto.verify(null, Buffer.from(data), crypto.createPublicKey(PUBLIC_KEY), Buffer.from(signature));
}

module.exports = { PUBLIC_KEY, EXPECTED_TEAM_ID, verifyUpdateSignature };
