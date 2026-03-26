const fs = require('fs');
const encryption = require('./encryption');

console.log('Testing encryption...');
const rawData = { test: 'data', secret: '12345' };

// 1. Encrypt
const payload = encryption.encrypt(JSON.stringify(rawData));
console.log('Is Encrypted?', payload.encrypted);

// 2. Decrypt
const decStr = encryption.decrypt(payload);
const decObj = JSON.parse(decStr);
console.log('Decrypted Match?', JSON.stringify(decObj) === JSON.stringify(rawData));

// 3. Plaintext fallback test
const plainFallback = encryption.decrypt(rawData);
console.log('Plaintext Fallback Match?', JSON.stringify(plainFallback) === JSON.stringify(rawData));
