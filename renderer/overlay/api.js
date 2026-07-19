export function notifyHost(data) {
    if (window.electronAPI && window.electronAPI.chromeOverlayNotifyHost) {
        window.electronAPI.chromeOverlayNotifyHost(data);
    }
}

export function applyChromeThemeTokens(patch) {
    const root = document.documentElement;
    const tokens = patch.tokens && typeof patch.tokens === 'object' ? patch.tokens : {};
    Object.keys(tokens).forEach(function (k) {
        const v = tokens[k];
        if (v === undefined || v === null || v === '') return;
        root.style.setProperty(k, String(v));
    });
    root.style.colorScheme = patch.effectiveDark ? 'dark' : 'light';
    const fa = patch.forcedAppearance;
    if (fa === 'light' || fa === 'dark') {
        root.setAttribute('data-forced-appearance', fa);
    } else {
        root.removeAttribute('data-forced-appearance');
    }
}