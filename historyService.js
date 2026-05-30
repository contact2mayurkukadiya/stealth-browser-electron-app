const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const encryption = require('./encryption');
const C = require(path.join(__dirname, 'src', 'constants', 'conditionStrings.cjs'));

const SCHEMA_VERSION = 1;
const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_SUGGEST_LIMIT = 8;

function safeProfileId(profileId) {
    return String(profileId || 'default').replace(/[^a-zA-Z0-9-_]/g, '_');
}

function normalizeLimit(value, fallback, max) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(Math.floor(n), max);
}

function quotePragmaString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeTransition(value) {
    const upper = String(value || 'LINK').toUpperCase();
    if (upper === C.HISTORY_TRANSITION.TYPED || upper === C.HISTORY_TRANSITION.RELOAD
        || upper === C.HISTORY_TRANSITION.BOOKMARK || upper === C.HISTORY_TRANSITION.LINK) return upper;
    return C.HISTORY_TRANSITION.LINK;
}

function normalizeUrlForDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return '';
    }
}

class HistoryService {
    constructor({ app, userDataPath, encryptionModule = encryption } = {}) {
        this.app = app;
        this.userDataPath = userDataPath;
        this.encryption = encryptionModule;
        this._dbs = new Map();
        this._sqlite3 = null;
        this._lastVisitByTab = new Map();
        this._queues = new Map();
        this._activeOperations = new Set();
        this._closing = false;
        this._closePromise = null;
    }

    get userDataDir() {
        if (this.userDataPath) return this.userDataPath;
        if (!this.app || typeof this.app.getPath !== 'function') {
            throw new Error('HistoryService requires an Electron app or userDataPath');
        }
        return this.app.getPath('userData');
    }

    _loadSqlite() {
        if (!this._sqlite3) {
            this._sqlite3 = require('@journeyapps/sqlcipher').verbose();
        }
        return this._sqlite3;
    }

    getDbPath(profileId) {
        return path.join(this.userDataDir, `history-${safeProfileId(profileId)}.sqlite`);
    }

    getKeyPath(profileId) {
        return path.join(this.userDataDir, `history-key-${safeProfileId(profileId)}.json`);
    }

    getLegacyHistoryPath(profileId) {
        return path.join(this.userDataDir, `history-${safeProfileId(profileId)}.ndjson`);
    }

    async _getOrCreateKey(profileId) {
        const keyPath = this.getKeyPath(profileId);
        if (fs.existsSync(keyPath)) {
            const parsed = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
            const decrypted = this.encryption.decrypt(parsed);
            if (!decrypted) throw new Error(`Unable to decrypt history key for ${safeProfileId(profileId)}`);
            return decrypted;
        }

        const key = crypto.randomBytes(32).toString('base64url');
        const payload = this.encryption.encrypt(key);
        fs.writeFileSync(keyPath, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 });
        return key;
    }

    _run(db, sql, params = []) {
        return this._trackOperation(new Promise((resolve, reject) => {
            db.run(sql, params, function onRun(err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        }));
    }

    _get(db, sql, params = []) {
        return this._trackOperation(new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        }));
    }

    _all(db, sql, params = []) {
        return this._trackOperation(new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(Array.isArray(rows) ? rows : []);
            });
        }));
    }

    _exec(db, sql) {
        return this._trackOperation(new Promise((resolve, reject) => {
            db.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        }));
    }

    _openDatabase(dbPath) {
        if (this._closing) return Promise.reject(new Error('HistoryService is closing'));
        const sqlite3 = this._loadSqlite();
        return this._trackOperation(new Promise((resolve, reject) => {
            const db = new sqlite3.Database(dbPath, (err) => {
                if (err) reject(err);
                else resolve(db);
            });
        }));
    }

    _trackOperation(promise) {
        const tracked = Promise.resolve(promise);
        this._activeOperations.add(tracked);
        tracked.finally(() => {
            this._activeOperations.delete(tracked);
        }).catch(() => undefined);
        return tracked;
    }

    _enqueue(profileId, task) {
        if (this._closing) return Promise.reject(new Error('HistoryService is closing'));
        const sid = safeProfileId(profileId);
        const previous = this._queues.get(sid) || Promise.resolve();
        const next = previous.catch(() => undefined).then(task);
        const cleanup = next.finally(() => {
            if (this._queues.get(sid) === cleanup) this._queues.delete(sid);
        });
        this._queues.set(sid, cleanup);
        return next;
    }

    async getDb(profileId) {
        if (this._closing) throw new Error('HistoryService is closing');
        const sid = safeProfileId(profileId);
        if (this._dbs.has(sid)) return this._dbs.get(sid);

        const db = await this._openDatabase(this.getDbPath(sid));
        const key = await this._getOrCreateKey(sid);
        await this._run(db, `PRAGMA key = ${quotePragmaString(key)}`);
        await this._run(db, 'PRAGMA foreign_keys = ON');
        await this._run(db, 'PRAGMA busy_timeout = 3000');
        await this._run(db, 'PRAGMA journal_mode = WAL');
        await this._initSchema(db);
        this._dbs.set(sid, db);
        return db;
    }

    async _initSchema(db) {
        await this._exec(db, `
            CREATE TABLE IF NOT EXISTS urls (
                id INTEGER PRIMARY KEY,
                url TEXT UNIQUE NOT NULL,
                title TEXT,
                visit_count INTEGER NOT NULL DEFAULT 0,
                typed_count INTEGER NOT NULL DEFAULT 0,
                last_visit_time INTEGER NOT NULL,
                hidden INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS visits (
                id INTEGER PRIMARY KEY,
                url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
                visit_time INTEGER NOT NULL,
                transition TEXT NOT NULL,
                referrer_visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_urls_url ON urls(url);
            CREATE INDEX IF NOT EXISTS idx_urls_last_visit_time ON urls(last_visit_time);
            CREATE INDEX IF NOT EXISTS idx_visits_visit_time ON visits(visit_time);
            CREATE INDEX IF NOT EXISTS idx_visits_url_time ON visits(url_id, visit_time);
            PRAGMA user_version = ${SCHEMA_VERSION};
        `);
    }

    async recordVisit(profileId, { url, title, transition = 'LINK', tabId = null, timestamp = Date.now() } = {}) {
        if (!url) return null;
        const now = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
        const stableTransition = normalizeTransition(transition);

        if (tabId != null) {
            const last = this._lastVisitByTab.get(String(tabId));
            if (last && last.url === url && now - last.timestamp < 3000) return null;
            this._lastVisitByTab.set(String(tabId), { url, timestamp: now });
        }

        return this._enqueue(profileId, async () => {
            const db = await this.getDb(profileId);
            await this._run(db, 'BEGIN IMMEDIATE TRANSACTION');
            try {
                let row = await this._get(db, 'SELECT id, visit_count, typed_count FROM urls WHERE url = ?', [url]);
                if (!row) {
                    const inserted = await this._run(
                        db,
                        `INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden)
                     VALUES (?, ?, 1, ?, ?, 0)`,
                        [url, title || url, stableTransition === 'TYPED' ? 1 : 0, now],
                    );
                    row = { id: inserted.lastID };
                } else {
                    await this._run(
                        db,
                        `UPDATE urls
                     SET title = COALESCE(NULLIF(?, ''), title),
                         visit_count = visit_count + 1,
                         typed_count = typed_count + ?,
                         last_visit_time = MAX(last_visit_time, ?),
                         hidden = 0
                     WHERE id = ?`,
                        [title || '', stableTransition === 'TYPED' ? 1 : 0, now, row.id],
                    );
                }

                const visit = await this._run(
                    db,
                    'INSERT INTO visits (url_id, visit_time, transition, referrer_visit_id) VALUES (?, ?, ?, NULL)',
                    [row.id, now, stableTransition],
                );
                await this._run(db, 'COMMIT');
                return { visitId: visit.lastID, urlId: row.id };
            } catch (error) {
                try { await this._run(db, 'ROLLBACK'); } catch (_) { }
                throw error;
            }
        });
    }

    async updateTitle(profileId, url, title) {
        if (!url || !title) return false;
        const db = await this.getDb(profileId);
        const result = await this._run(
            db,
            'UPDATE urls SET title = ? WHERE url = ? AND hidden = 0',
            [String(title), String(url)],
        );
        return result.changes > 0;
    }

    _parseCursor(cursor) {
        if (!cursor || typeof cursor !== 'object') return null;
        const visitTime = Number(cursor.visitTime);
        const visitId = Number(cursor.visitId);
        if (!Number.isFinite(visitTime) || !Number.isFinite(visitId)) return null;
        return { visitTime, visitId };
    }

    async search(profileId, { query = '', limit = DEFAULT_SEARCH_LIMIT, cursor = null } = {}) {
        const db = await this.getDb(profileId);
        const pageSize = normalizeLimit(limit, DEFAULT_SEARCH_LIMIT, 100);
        const cur = this._parseCursor(cursor);
        const q = String(query || '').trim().toLowerCase();

        const where = ['u.hidden = 0'];
        const params = [];
        if (q) {
            where.push('(LOWER(u.url) LIKE ? OR LOWER(COALESCE(u.title, "")) LIKE ?)');
            params.push(`%${q}%`, `%${q}%`);
        }
        if (cur) {
            where.push('(v.visit_time < ? OR (v.visit_time = ? AND v.id < ?))');
            params.push(cur.visitTime, cur.visitTime, cur.visitId);
        }

        const rows = await this._all(
            db,
            `SELECT
                v.id AS visitId,
                u.id AS urlId,
                u.url AS url,
                COALESCE(u.title, u.url) AS title,
                v.visit_time AS visitTime,
                v.transition AS transition
             FROM visits v
             JOIN urls u ON u.id = v.url_id
             WHERE ${where.join(' AND ')}
             ORDER BY v.visit_time DESC, v.id DESC
             LIMIT ?`,
            [...params, pageSize + 1],
        );

        const items = rows.slice(0, pageSize).map((row) => ({
            visitId: row.visitId,
            urlId: row.urlId,
            url: row.url,
            title: row.title || row.url,
            visitTime: row.visitTime,
            timestamp: row.visitTime,
            transition: row.transition || 'LINK',
        }));
        const last = items[items.length - 1];
        return {
            items,
            hasMore: rows.length > pageSize,
            nextCursor: rows.length > pageSize && last
                ? { visitTime: last.visitTime, visitId: last.visitId }
                : null,
        };
    }

    async getSuggestions(profileId, { query = '', limit = DEFAULT_SUGGEST_LIMIT } = {}) {
        const db = await this.getDb(profileId);
        const q = String(query || '').trim().toLowerCase();
        if (!q) return [];

        const max = normalizeLimit(limit, DEFAULT_SUGGEST_LIMIT, 12);
        const now = Date.now();
        const day = 86_400_000;
        const rows = await this._all(
            db,
            `SELECT
                url,
                COALESCE(title, url) AS title,
                visit_count,
                typed_count,
                last_visit_time,
                (
                    ((typed_count * 2.0) + visit_count)
                    * CASE
                        WHEN last_visit_time >= ? THEN 2.0
                        WHEN last_visit_time >= ? THEN 1.0
                        ELSE 0.1
                      END
                    + CASE
                        WHEN LOWER(url) = ? OR LOWER(url) = ? OR LOWER(url) = ? THEN 900
                        WHEN LOWER(url) LIKE ? THEN 650
                        WHEN REPLACE(REPLACE(LOWER(url), 'https://', ''), 'http://', '') LIKE ? THEN 650
                        WHEN REPLACE(REPLACE(LOWER(url), 'https://www.', ''), 'http://www.', '') LIKE ? THEN 650
                        WHEN LOWER(url) LIKE ? THEN 350
                        WHEN LOWER(COALESCE(title, '')) LIKE ? THEN 250
                        ELSE 0
                      END
                ) AS score
             FROM urls
             WHERE hidden = 0
               AND (LOWER(url) LIKE ? OR LOWER(COALESCE(title, '')) LIKE ?)
             ORDER BY score DESC, last_visit_time DESC
             LIMIT ?`,
            [
                now - day,
                now - 7 * day,
                q,
                `https://${q}`,
                `http://${q}`,
                `${q}%`,
                `${q}%`,
                `${q}%`,
                `%${q}%`,
                `${q}%`,
                `%${q}%`,
                `%${q}%`,
                max,
            ],
        );

        return rows.map((row) => {
            const urlLower = String(row.url || '').toLowerCase();
            const titleLower = String(row.title || '').toLowerCase();
            const urlMatch = urlLower.includes(q);
            const titleOnly = !urlMatch && titleLower.includes(q);
            return {
                text: titleOnly ? (row.title || row.url) : row.url,
                url: row.url,
                type: 'history',
                score: Math.max(0, Math.min(1000, Math.round(Number(row.score) || 0))),
                description: titleOnly ? row.url : (row.title || row.url),
                favicon: null,
            };
        });
    }

    async getTopSites(profileId, limit = 8) {
        const db = await this.getDb(profileId);
        const rows = await this._all(
            db,
            `SELECT url, COALESCE(title, url) AS title, visit_count, last_visit_time
             FROM urls
             WHERE hidden = 0
             ORDER BY visit_count DESC, last_visit_time DESC
             LIMIT 200`,
        );
        const byDomain = new Map();
        for (const row of rows) {
            const domain = normalizeUrlForDomain(row.url);
            if (!domain || byDomain.has(domain)) continue;
            byDomain.set(domain, {
                url: row.url,
                title: row.title || domain,
                domain,
                visitCount: Number(row.visit_count) || 0,
                lastVisitTime: Number(row.last_visit_time) || 0,
            });
            if (byDomain.size >= limit) break;
        }
        return Array.from(byDomain.values()).map(({ url, title, domain }) => ({ url, title, domain }));
    }

    async deleteVisits(profileId, visitIds = []) {
        const ids = Array.from(new Set((Array.isArray(visitIds) ? visitIds : [])
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)));
        if (ids.length === 0) return true;

        return this._enqueue(profileId, async () => {
            const db = await this.getDb(profileId);
            const placeholders = ids.map(() => '?').join(',');
            await this._run(db, 'BEGIN IMMEDIATE TRANSACTION');
            try {
                await this._run(db, `DELETE FROM visits WHERE id IN (${placeholders})`, ids);
                await this._rebuildUrlStats(db);
                await this._run(db, 'COMMIT');
                return true;
            } catch (error) {
                try { await this._run(db, 'ROLLBACK'); } catch (_) { }
                throw error;
            }
        });
    }

    async deleteUrls(profileId, urls = []) {
        const values = Array.from(new Set((Array.isArray(urls) ? urls : [])
            .map((url) => String(url || '').trim())
            .filter(Boolean)));
        if (values.length === 0) return true;

        const db = await this.getDb(profileId);
        const placeholders = values.map(() => '?').join(',');
        await this._run(db, `DELETE FROM urls WHERE url IN (${placeholders})`, values);
        return true;
    }

    async clear(profileId, { since = null } = {}) {
        return this._enqueue(profileId, async () => {
            const db = await this.getDb(profileId);
            await this._run(db, 'BEGIN IMMEDIATE TRANSACTION');
            try {
                if (since == null) {
                    await this._run(db, 'DELETE FROM visits');
                    await this._run(db, 'DELETE FROM urls');
                } else {
                    const cutoff = Number(since);
                    if (!Number.isFinite(cutoff)) {
                        await this._run(db, 'COMMIT');
                        return true;
                    }
                    await this._run(db, 'DELETE FROM visits WHERE visit_time >= ?', [cutoff]);
                    await this._rebuildUrlStats(db);
                }
                await this._run(db, 'COMMIT');
                return true;
            } catch (error) {
                try { await this._run(db, 'ROLLBACK'); } catch (_) { }
                throw error;
            }
        });
    }

    async _rebuildUrlStats(db) {
        await this._run(db, `
            UPDATE urls
            SET visit_count = COALESCE((SELECT COUNT(*) FROM visits WHERE visits.url_id = urls.id), 0),
                typed_count = COALESCE((SELECT COUNT(*) FROM visits WHERE visits.url_id = urls.id AND transition = 'TYPED'), 0),
                last_visit_time = COALESCE((SELECT MAX(visit_time) FROM visits WHERE visits.url_id = urls.id), last_visit_time)
        `);
        await this._run(db, 'DELETE FROM urls WHERE id NOT IN (SELECT DISTINCT url_id FROM visits)');
    }

    async migrateOldHistory(profileId) {
        const legacyPath = this.getLegacyHistoryPath(profileId);
        const backupPath = `${legacyPath}.bak`;
        if (!fs.existsSync(legacyPath) || fs.existsSync(backupPath)) {
            return { migrated: 0, skipped: 0, didRun: false };
        }

        const content = fs.readFileSync(legacyPath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        if (lines.length === 0) {
            fs.renameSync(legacyPath, backupPath);
            return { migrated: 0, skipped: 0, didRun: true };
        }

        return this._enqueue(profileId, async () => {
            const db = await this.getDb(profileId);
            let migrated = 0;
            let skipped = 0;
            await this._run(db, 'BEGIN IMMEDIATE TRANSACTION');
            try {
                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        const decoded = parsed && parsed.encrypted !== undefined
                            ? this.encryption.decrypt(parsed)
                            : JSON.stringify(parsed);
                        if (!decoded) {
                            skipped += 1;
                            continue;
                        }
                        const item = JSON.parse(decoded);
                        if (!item || !item.url) {
                            skipped += 1;
                            continue;
                        }
                        const timestamp = Number(item.timestamp);
                        await this._recordVisitInOpenTransaction(db, {
                            url: String(item.url),
                            title: item.title || item.url,
                            transition: 'LINK',
                            timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
                        });
                        migrated += 1;
                    } catch (_) {
                        skipped += 1;
                    }
                }
                await this._run(db, 'COMMIT');
            } catch (error) {
                try { await this._run(db, 'ROLLBACK'); } catch (_) { }
                throw error;
            }

            fs.renameSync(legacyPath, backupPath);
            return { migrated, skipped, didRun: true };
        });
    }

    async _recordVisitInOpenTransaction(db, { url, title, transition, timestamp }) {
        const stableTransition = normalizeTransition(transition);
        let row = await this._get(db, 'SELECT id FROM urls WHERE url = ?', [url]);
        if (!row) {
            const inserted = await this._run(
                db,
                `INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden)
                 VALUES (?, ?, 1, ?, ?, 0)`,
                [url, title || url, stableTransition === 'TYPED' ? 1 : 0, timestamp],
            );
            row = { id: inserted.lastID };
        } else {
            await this._run(
                db,
                `UPDATE urls
                 SET title = COALESCE(NULLIF(?, ''), title),
                     visit_count = visit_count + 1,
                     typed_count = typed_count + ?,
                     last_visit_time = MAX(last_visit_time, ?)
                 WHERE id = ?`,
                [title || '', stableTransition === 'TYPED' ? 1 : 0, timestamp, row.id],
            );
        }
        await this._run(
            db,
            'INSERT INTO visits (url_id, visit_time, transition, referrer_visit_id) VALUES (?, ?, ?, NULL)',
            [row.id, timestamp, stableTransition],
        );
    }

    clearTab(tabId) {
        if (tabId != null) this._lastVisitByTab.delete(String(tabId));
    }

    async closeAll() {
        if (this._closePromise) return this._closePromise;
        this._closing = true;
        this._closePromise = (async () => {
            await Promise.allSettled(Array.from(this._queues.values()));
            while (this._activeOperations.size > 0) {
                const operations = Array.from(this._activeOperations);
                await Promise.allSettled(operations);
            }
            const entries = Array.from(this._dbs.entries());
            for (const [, db] of entries) {
                await new Promise((resolve) => {
                    db.close(() => resolve());
                });
            }
            this._dbs.clear();
            this._lastVisitByTab.clear();
        })();
        return this._closePromise;
    }
}

module.exports = {
    HistoryService,
    safeProfileId,
};
