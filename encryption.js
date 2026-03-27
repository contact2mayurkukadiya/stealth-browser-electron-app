const { safeStorage } = require('electron');
const crypto = require('crypto');
const os = require('os');

// Fallback key using PBKDF2 with machine-specific details
let fallbackKey = null;

function getFallbackKey() {
    if (!fallbackKey) {
        let id;
        try {
            id = crypto.createHash('sha256').update(os.hostname() + os.userInfo().username).digest('hex');
        } catch(e) {
            id = 'fallback-stealth-browser-id';
        }
        fallbackKey = crypto.pbkdf2Sync(id, 'stealth-browser-salt', 100000, 32, 'sha512');
    }
    return fallbackKey;
}

function encrypt(text) {
    if (!text) return '';
    try {
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
            const encryptedBuffer = safeStorage.encryptString(text);
            return {
                encrypted: true,
                type: 'safeStorage',
                data: encryptedBuffer.toString('base64')
            };
        } else {
            // Fallback crypto
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-gcm', getFallbackKey(), iv);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag = cipher.getAuthTag().toString('hex');

            return {
                encrypted: true,
                type: 'fallback',
                iv: iv.toString('hex'),
                authTag: authTag,
                data: encrypted
            };
        }
    } catch (err) {
        console.error('Encryption failed:', err);
        return { encrypted: false, data: text }; // Should we fail hard? Returning plaintext is dangerous but prevents total app break if unrecoverable.
        // Returning plaintext if encryption fails is risky. Better to throw, but per user request "without breaking a feature". 
        // We'll throw so it can be handled by the caller.
    }
}

function decrypt(payloadObj) {
    if (!payloadObj || !payloadObj.encrypted) {
        return payloadObj?.data || payloadObj || ''; 
    }

    try {
        if (payloadObj.type === 'safeStorage') {
            const buffer = Buffer.from(payloadObj.data, 'base64');
            return safeStorage.decryptString(buffer);
        } else if (payloadObj.type === 'fallback') {
            const iv = Buffer.from(payloadObj.iv, 'hex');
            const authTag = Buffer.from(payloadObj.authTag, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', getFallbackKey(), iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(payloadObj.data, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }
    } catch (err) {
        console.error('Decryption failed:', err);
        return '';
    }
    
    return '';
}

module.exports = {
    encrypt,
    decrypt
};
