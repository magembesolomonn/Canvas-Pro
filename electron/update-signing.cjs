// Update release signing. The private key is kept out of the app and out of
// source control; scripts/sign-update.cjs uses it to sign the checksum file
// that ships with each GitHub release. The public key below is embedded in the
// app, so a checksum published without a matching signature is not trusted.
const crypto = require('node:crypto');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAEMQrU8esJ8K8rbIb6BqYYn2Gc1QdxXb1yLx8Sjcitqc=
-----END PUBLIC KEY-----
`;

// A general release must be signed with a Developer ID certificate and
// notarized by Apple; whether to do so is a release decision. Set this to the
// released app's Developer ID Team ID to enable the extra check. Empty is the
// default and disables it; the Ed25519 checksum signature is always required.
const EXPECTED_TEAM_ID = process.env.EXPECTED_TEAM_ID || '';

function verifyUpdateSignature(data, signature) {
  return crypto.verify(null, Buffer.from(data), crypto.createPublicKey(PUBLIC_KEY), Buffer.from(signature));
}

module.exports = { PUBLIC_KEY, EXPECTED_TEAM_ID, verifyUpdateSignature };
