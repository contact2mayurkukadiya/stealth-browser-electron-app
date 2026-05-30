/**
 * Browser Identity Verification diagnostics (read-only).
 *
 * Collects InviSurf runtime traits for local troubleshooting. Does not mutate
 * page-visible APIs, forge Client Hints, or automate third-party fingerprint sites.
 */
const { getBrowserIdentity } = require('./browserIdentity');
const { resolveInviSurfRootDir } = require('./appPaths');
const { getHeaderObservations, isSessionPolicyInstalled } = require('./sessionPolicy');
const { getProductionGuardStatus } = require('./windowSecurity');

const GPU_INFO_TIMEOUT_MS = 3000;
const RENDERER_PROBE_TIMEOUT_MS = 5000;

function withTimeout(promise, timeoutMs, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`${label} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        }),
    ]);
}

const RENDERER_PROBE_SCRIPT = `
(() => {
  const out = {
    userAgent: navigator.userAgent,
    webdriver: typeof navigator.webdriver === 'undefined' ? null : navigator.webdriver,
    platform: navigator.platform,
    language: navigator.language,
    languages: Array.isArray(navigator.languages) ? [...navigator.languages] : [],
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
    },
    userAgentData: null,
    webgl: null,
  };

  try {
    const uad = navigator.userAgentData;
    if (uad) {
      out.userAgentData = {
        brands: Array.isArray(uad.brands) ? uad.brands.map((b) => ({ brand: b.brand, version: b.version })) : [],
        mobile: !!uad.mobile,
        platform: uad.platform,
      };
    }
  } catch (_) {}

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      out.webgl = {
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    }
  } catch (_) {}

  return out;
})()
`;

/** @param {string | undefined | null} rawUrl */
function safeOrigin(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
        return new URL(rawUrl).origin;
    } catch {
        return null;
    }
}

/** @param {string | null | undefined} filePath @param {string | null | undefined} invisurfRoot */
function redactPath(filePath, invisurfRoot) {
    if (!filePath || typeof filePath !== 'string') return null;
    if (invisurfRoot && filePath.startsWith(invisurfRoot)) {
        return filePath.slice(invisurfRoot.length).replace(/^[/\\]/, '') || '.';
    }
    const parts = filePath.split(/[/\\]/);
    if (parts.length <= 2) return filePath;
    return `…/${parts.slice(-2).join('/')}`;
}

/**
 * @param {import('electron').App} app
 */
function collectMainProcessSnapshot(app) {
    const identity = getBrowserIdentity();
    let invisurfRoot = null;
    try {
        invisurfRoot = resolveInviSurfRootDir(app);
    } catch (_) {
        invisurfRoot = null;
    }

    const paths = {
        userData: typeof app?.getPath === 'function' ? app.getPath('userData') : null,
        sessionData: typeof app?.getPath === 'function' ? app.getPath('sessionData') : null,
        logs: typeof app?.getPath === 'function' ? app.getPath('logs') : null,
        crashDumps: typeof app?.getPath === 'function' ? app.getPath('crashDumps') : null,
        invisurfRoot,
    };

    return {
        appName: app?.name ?? null,
        isPackaged: !!app?.isPackaged,
        paths: {
            userData: redactPath(paths.userData, invisurfRoot),
            sessionData: redactPath(paths.sessionData, invisurfRoot),
            logs: redactPath(paths.logs, invisurfRoot),
            crashDumps: redactPath(paths.crashDumps, invisurfRoot),
            invisurfRoot: invisurfRoot ? redactPath(invisurfRoot, invisurfRoot) : null,
        },
        configuredIdentity: {
            userAgent: identity.userAgent,
            acceptLanguage: identity.acceptLanguage,
            chromeVersion: identity.chromeVersion,
            chromeMajor: identity.chromeMajor,
            electronVersion: process.versions.electron,
            nodeVersion: process.versions.node,
            platform: process.platform,
        },
        productionGuards: getProductionGuardStatus(app),
    };
}

/**
 * @param {import('electron').App} app
 * @returns {Promise<object>}
 */
function summarizeGpuInfo(info) {
    if (!info || typeof info !== 'object') return null;
    return {
        auxAttributes: info.auxAttributes || null,
        gpuDeviceCount: Array.isArray(info.gpuDevice) ? info.gpuDevice.length : 0,
        gpuDevices: Array.isArray(info.gpuDevice)
            ? info.gpuDevice.map((d) => ({
                vendorId: d.vendorId,
                deviceId: d.deviceId,
                active: !!d.active,
            }))
            : [],
    };
}

async function fetchGpuInfoBasic(app) {
    if (typeof app.getGPUInfo !== 'function') return null;

    const result = app.getGPUInfo('basic');
    if (result && typeof result.then === 'function') {
        return withTimeout(result, GPU_INFO_TIMEOUT_MS, 'getGPUInfo');
    }

    return withTimeout(
        new Promise((resolve, reject) => {
            app.getGPUInfo('basic', (error, info) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(info);
            });
        }),
        GPU_INFO_TIMEOUT_MS,
        'getGPUInfo',
    );
}

async function collectGpuSummary(app) {
    const summary = {
        featureStatus: null,
        basic: null,
    };

    try {
        if (typeof app.getGPUFeatureStatus === 'function') {
            summary.featureStatus = app.getGPUFeatureStatus();
        }
    } catch (_) {}

    try {
        const info = await fetchGpuInfoBasic(app);
        summary.basic = summarizeGpuInfo(info);
    } catch (err) {
        summary.basic = { error: String(err?.message || err) };
    }

    return summary;
}

/**
 * Probe active tab renderer without modifying page state.
 * @param {import('electron').WebContents} webContents
 */
async function probeRendererIdentity(webContents) {
    if (!webContents || webContents.isDestroyed?.()) {
        return { error: 'WebContents unavailable' };
    }
    try {
        const payload = await withTimeout(
            webContents.executeJavaScript(RENDERER_PROBE_SCRIPT, true),
            RENDERER_PROBE_TIMEOUT_MS,
            'rendererIdentityProbe',
        );
        return {
            urlOrigin: safeOrigin(webContents.getURL()),
            ...payload,
        };
    } catch (err) {
        return { error: String(err?.message || err) };
    }
}

/**
 * Build full identity verification report.
 * @param {{
 *   app: import('electron').App,
 *   context?: object | null,
 *   webContents?: import('electron').WebContents | null,
 *   tabId?: string | null,
 *   session?: import('electron').Session | null,
 * }} options
 */
async function buildIdentityReport({ app, context = null, webContents = null, tabId = null, session = null }) {
    const main = collectMainProcessSnapshot(app);
    const gpu = await collectGpuSummary(app);
    const targetSession = session || webContents?.session || null;

    let renderer = null;
    if (webContents) {
        renderer = await probeRendererIdentity(webContents);
    }

    const headerObservations = getHeaderObservations({
        session: targetSession,
        webContentsId: webContents?.id,
        limit: 20,
    });

    const uaMatch = renderer && !renderer.error
        ? renderer.userAgent === main.configuredIdentity.userAgent
        : null;

    return {
        generatedAt: Date.now(),
        tabId: tabId || context?.activeTabId || null,
        profileId: context?.profileId || null,
        partition: context?.partition || null,
        stealthWindow: !!context?.stealthWindow,
        sessionPolicyInstalled: targetSession ? isSessionPolicyInstalled(targetSession) : false,
        main,
        gpu,
        headerObservations,
        renderer,
        analysis: {
            userAgentMatchesConfigured: uaMatch,
            notes: [
                'Diagnostic-only report. Values are observed, not modified.',
                'InviSurf does not patch navigator.userAgentData or forge sec-ch-ua headers.',
            ],
        },
    };
}

/**
 * Compact summary suitable for merging into compat diagnostics output.
 * @param {object} fullReport
 */
function getCompactSummary(fullReport) {
    if (!fullReport || typeof fullReport !== 'object') return null;
    return {
        generatedAt: fullReport.generatedAt,
        tabId: fullReport.tabId,
        profileId: fullReport.profileId,
        sessionPolicyInstalled: fullReport.sessionPolicyInstalled,
        userAgentMatchesConfigured: fullReport.analysis?.userAgentMatchesConfigured ?? null,
        configuredUserAgent: fullReport.main?.configuredIdentity?.userAgent ?? null,
        rendererUserAgent: fullReport.renderer?.userAgent ?? null,
        userAgentDataBrands: fullReport.renderer?.userAgentData?.brands ?? null,
        webdriver: fullReport.renderer?.webdriver ?? null,
        productionGuards: fullReport.main?.productionGuards ?? null,
        recentHeaderObservationCount: Array.isArray(fullReport.headerObservations)
            ? fullReport.headerObservations.length
            : 0,
    };
}

module.exports = {
    RENDERER_PROBE_SCRIPT,
    buildIdentityReport,
    probeRendererIdentity,
    collectMainProcessSnapshot,
    collectGpuSummary,
    getCompactSummary,
};
