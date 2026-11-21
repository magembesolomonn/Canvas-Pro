const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const signing = require('../electron/update-signing.cjs');

test('a node:crypto Ed25519 signature verifies and a tampered payload is rejected', () => {
  const payload = Buffer.from('sha256  Canvas-Pro-1.1.11.dmg\n');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const signature = crypto.sign(null, payload, privateKey);

  const createPublicKey = crypto.createPublicKey;
  try {
    crypto.createPublicKey = () => publicKey;
    assert.equal(signing.verifyUpdateSignature(payload, signature), true);
    assert.equal(signing.verifyUpdateSignature(Buffer.from('sha256  tampered.dmg\n'), signature), false);
  } finally {
    crypto.createPublicKey = createPublicKey;
  }
});

test('a signature from an unrelated temporary key is not trusted', () => {
  const payload = Buffer.from('checksums\n');
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const signature = crypto.sign(null, payload, privateKey);
  assert.equal(signing.verifyUpdateSignature(payload, signature), false);
  assert.equal(crypto.createPublicKey(signing.PUBLIC_KEY).asymmetricKeyType, 'ed25519');
});
