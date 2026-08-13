const crypto = require('crypto');
const fs = require('fs');

// 1. Generate RSA key pair
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// 2. Base64 encode the public key for manifest.json
const manifestKey = publicKey.toString('base64');

// 3. Calculate Extension ID
// ID is the first 16 bytes (32 hex chars) of SHA256 of the public key, mapped to 'a'-'p'
const hash = crypto.createHash('sha256').update(publicKey).digest('hex');
const idChars = hash.slice(0, 32).split('').map(c => {
  const v = parseInt(c, 16);
  return String.fromCharCode(97 + v); // 97 is 'a'
}).join('');

console.log('Manifest Key:');
console.log(manifestKey);
console.log('\nExtension ID:');
console.log(idChars);
