const fs = require('fs');
const path = require('path');

const MAX_STRING_LENGTH = 1600;
const MAX_LOG_FILES = 14;
const SECRET_KEY_PATTERN = /(password|passwd|secret|token|cookie|authorization|credential|api[-_]?key|session)/i;

function dayStamp(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function serializeError(error) {
    if (!error) return null;
    if (typeof error === 'string') return { message: redactString(error) };
    return {
        name: redactString(error.name || 'Error'),
        message: redactString(error.message || String(error)),
        stack: redactString(error.stack || ''),
        code: error.code || undefined,
    };
}

function redactString(value) {
    let text = String(value || '');
    text = text.replace(/([?&](?:token|key|password|secret|code|auth|session)[^=]*=)[^&#\s]+/gi, '$1[redacted]');
    text = text.replace(/(authorization:\s*)(bearer\s+)?[^\s,;]+/gi, '$1[redacted]');
    return text.length > MAX_STRING_LENGTH ? `${text.slice(0, MAX_STRING_LENGTH)}…` : text;
}

function sanitizeUrl(value) {
    try {
        const url = new URL(String(value || ''));
        url.search = '';
        url.hash = '';
        return redactString(url.toString());
    } catch {
        return redactString(value);
    }
}

function sanitizeValue(value, depth = 0, key = '') {
    if (value == null) return value;
    if (SECRET_KEY_PATTERN.test(key)) return '[redacted]';
    if (depth > 4) return '[max-depth]';
    if (value instanceof Error) return serializeError(value);
    if (typeof value === 'string') {
        return /url$/i.test(key) || key === 'url' || key.endsWith('Url') ? sanitizeUrl(value) : redactString(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            out[childKey] = sanitizeValue(childValue, depth + 1, childKey);
        }
        return out;
    }
    return redactString(String(value));
}

function safeWriteFile(filePath, text) {
    fs.writeFileSync(filePath, text, { encoding: 'utf-8', mode: 0o600 });
}

function createAppLogger({ app, encryptionModule, maxFiles = MAX_LOG_FILES } = {}) {
    if (!app || !encryptionModule) {
        throw new Error('createAppLogger requires app and encryptionModule');
    }

    let logDir = null;

    function getLogDir() {
        if (!logDir) {
            logDir = path.join(app.getPath('userData'), 'secure-logs');
            fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
            const readmePath = path.join(logDir, 'README.txt');
            if (!fs.existsSync(readmePath)) {
                safeWriteFile(readmePath, [
                    'InviSurf secure logs',
                    '',
                    'Files ending in .elog are encrypted line-delimited JSON records.',
                    'They are intended for local crash/debug investigation and may require InviSurf on this machine to decrypt.',
                    'Do not share logs unless you intentionally export/decrypt and review them first.',
                    '',
                ].join('\n'));
            }
        }
        return logDir;
    }

    function getCurrentLogFile() {
        return path.join(getLogDir(), `invisurf-${dayStamp()}.elog`);
    }

    function isLogFilePath(filePath) {
        try {
            const resolvedDir = path.resolve(getLogDir());
            const resolvedFile = path.resolve(String(filePath || ''));
            return resolvedFile.startsWith(`${resolvedDir}${path.sep}`) &&
                /^invisurf-\d{4}-\d{2}-\d{2}\.elog$/.test(path.basename(resolvedFile));
        } catch {
            return false;
        }
    }

    function listLogFiles() {
        try {
            return fs.readdirSync(getLogDir())
                .filter((name) => /^invisurf-\d{4}-\d{2}-\d{2}\.elog$/.test(name))
                .map((name) => {
                    const filePath = path.join(getLogDir(), name);
                    const stat = fs.statSync(filePath);
                    return {
                        name,
                        path: filePath,
                        size: stat.size,
                        mtimeMs: stat.mtimeMs,
                        modifiedAt: stat.mtime.toISOString(),
                    };
                })
                .sort((a, b) => b.mtimeMs - a.mtimeMs);
        } catch {
            return [];
        }
    }

    function deleteLogFile(filePath) {
        if (!isLogFilePath(filePath)) {
            return false;
        }
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                return true;
            }
        } catch (_) {
            return false;
        }
        return false;
    }

    function clearLogFiles({ since = null } = {}) {
        const cutoff = since == null ? null : Number(since);
        let deleted = 0;
        for (const file of listLogFiles()) {
            const createdAt = (() => {
                try {
                    const stat = fs.statSync(file.path);
                    return Number.isFinite(stat.birthtimeMs) ? stat.birthtimeMs : stat.mtimeMs;
                } catch {
                    return file.mtimeMs;
                }
            })();
            if (cutoff != null && (!Number.isFinite(cutoff) || createdAt < cutoff)) continue;
            if (deleteLogFile(file.path)) deleted += 1;
        }
        return { deleted };
    }

    function pruneOldLogs() {
        try {
            const files = fs.readdirSync(getLogDir())
                .filter((name) => /^invisurf-\d{4}-\d{2}-\d{2}\.elog$/.test(name))
                .sort();
            const toDelete = files.slice(0, Math.max(0, files.length - maxFiles));
            for (const name of toDelete) {
                fs.unlinkSync(path.join(getLogDir(), name));
            }
        } catch (_) {
            // Logging must never break the app.
        }
    }

    function buildRecord(level, event, data = {}) {
        return {
            schemaVersion: 1,
            ts: new Date().toISOString(),
            pid: process.pid,
            appVersion: typeof app.getVersion === 'function' ? app.getVersion() : null,
            platform: process.platform,
            level,
            event,
            data: sanitizeValue(data),
        };
    }

    function write(level, event, data = {}) {
        try {
            const record = buildRecord(level, event, data);
            const payload = encryptionModule.encrypt(JSON.stringify(record));
            fs.appendFileSync(getCurrentLogFile(), `${JSON.stringify(payload)}\n`, { encoding: 'utf-8', mode: 0o600 });
            pruneOldLogs();
        } catch (err) {
            try {
                console.error('[appLogger] write failed:', err?.message || err);
            } catch (_) {
                // ignore
            }
        }
    }

    function readEncryptedLogFile(filePath) {
        if (!isLogFilePath(filePath)) {
            throw new Error('Invalid log file path');
        }
        const text = fs.readFileSync(filePath, 'utf-8');
        return text
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                try {
                    const decrypted = encryptionModule.decrypt(JSON.parse(line));
                    return decrypted ? JSON.parse(decrypted) : null;
                } catch (error) {
                    return {
                        schemaVersion: 1,
                        ts: new Date().toISOString(),
                        level: 'warn',
                        event: 'log:decode-failed',
                        data: { error: serializeError(error) },
                    };
                }
            })
            .filter(Boolean);
    }

    return {
        info: (event, data) => write('info', event, data),
        warn: (event, data) => write('warn', event, data),
        error: (event, data) => write('error', event, data),
        fatal: (event, data) => write('fatal', event, data),
        getLogDir,
        getCurrentLogFile,
        isLogFilePath,
        listLogFiles,
        deleteLogFile,
        clearLogFiles,
        readEncryptedLogFile,
        serializeError,
        sanitizeValue,
    };
}

module.exports = {
    createAppLogger,
};
