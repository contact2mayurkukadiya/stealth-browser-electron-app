let fullHistory = [];

document.addEventListener('DOMContentLoaded', () => {
    loadHistory();

    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
        renderHistory(e.target.value.toLowerCase());
    });

    document.getElementById('clear-btn').addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear your browsing history? This action cannot be undone.')) {
            const success = await window.electronAPI.historyClear();
            if (success) {
                fullHistory = [];
                renderHistory();
            }
        }
    });
});

async function loadHistory() {
    fullHistory = await window.electronAPI.historyGet();
    renderHistory();
}

function renderHistory(searchQuery = '') {
    const container = document.getElementById('history-container');
    
    let filteredHistory = fullHistory;
    if (searchQuery) {
        filteredHistory = fullHistory.filter(item => 
            (item.title && item.title.toLowerCase().includes(searchQuery)) ||
            (item.url && item.url.toLowerCase().includes(searchQuery))
        );
    }

    if (filteredHistory.length === 0) {
        container.textContent = '';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = searchQuery ? 'No history entries found matching your search.' : 'Your browsing history is empty.';
        container.appendChild(empty);
        return;
    }

    // Group by Date
    const grouped = {};
    filteredHistory.forEach(item => {
        const date = new Date(item.timestamp);
        const dayLabel = getDateLabel(date);
        if (!grouped[dayLabel]) grouped[dayLabel] = [];
        grouped[dayLabel].push(item);
    });

    container.textContent = '';

    for (const [dateLabel, items] of Object.entries(grouped)) {
        const titleEl = document.createElement('div');
        titleEl.className = 'date-header';
        titleEl.textContent = dateLabel;
        container.appendChild(titleEl);

        const listEl = document.createElement('div');
        listEl.className = 'history-list';

        items.forEach(item => {
            const date = new Date(item.timestamp);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            // Try to extract a clean domain for favicon fallback
            let domain = '';
            try { domain = new URL(item.url).hostname; } catch (e) {}
            const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';

            // Build item using DOM APIs — no innerHTML with user data (XSS fix)
            const itemEl = document.createElement('div');
            itemEl.className = 'history-item';

            const timeEl = document.createElement('div');
            timeEl.className = 'time';
            timeEl.textContent = timeStr;

            let faviconEl;
            if (faviconUrl) {
                faviconEl = document.createElement('img');
                faviconEl.src = faviconUrl;
                faviconEl.className = 'favicon';
                faviconEl.onerror = () => { faviconEl.style.display = 'none'; };
            } else {
                faviconEl = document.createElement('div');
                faviconEl.className = 'favicon';
            }

            const detailsEl = document.createElement('div');
            detailsEl.className = 'details';

            const titleLink = document.createElement('a');
            titleLink.href = '#';
            titleLink.className = 'title';
            titleLink.textContent = item.title || item.url;
            titleLink.addEventListener('click', (e) => {
                e.preventDefault();
                // Open history URL in a new tab via IPC
                const tabId = 'hist-' + Date.now();
                window.electronAPI.newTab(tabId, false, item.url);
            });

            const urlEl = document.createElement('div');
            urlEl.className = 'url';
            urlEl.textContent = item.url;

            detailsEl.appendChild(titleLink);
            detailsEl.appendChild(urlEl);

            itemEl.appendChild(timeEl);
            itemEl.appendChild(faviconEl);
            itemEl.appendChild(detailsEl);

            listEl.appendChild(itemEl);
        });

        container.appendChild(listEl);
    }
}

function getDateLabel(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    
    return date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
