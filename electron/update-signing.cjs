const crypto = require('node:crypto');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAJRjf09uwYrItAyDum+EbuDpINoBEnQUfu7/zi1TeZY4=
-----END PUBLIC KEY-----
`;

const EXPECTED_TEAM_ID = process.env.EXPECTED_TEAM_ID || '';

function verifyUpdateSignature(data, signature) {
  return crypto.verify(null, Buffer.from(data), crypto.createPublicKey(PUBLIC_KEY), Buffer.from(signature));
}

module.exports = { PUBLIC_KEY, EXPECTED_TEAM_ID, verifyUpdateSignature };
