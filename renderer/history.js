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
        container.innerHTML = `<div class="empty-state">${searchQuery ? 'No history entries found matching your search.' : 'Your browsing history is empty.'}</div>`;
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

    container.innerHTML = '';

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

            const itemEl = document.createElement('div');
            itemEl.className = 'history-item';
            
            const imgHtml = faviconUrl 
                ? `<img src="${faviconUrl}" class="favicon" onerror="this.style.display='none'">` 
                : `<div class="favicon"></div>`;

            itemEl.innerHTML = `
                <div class="time">${timeStr}</div>
                ${imgHtml}
                <div class="details">
                    <a href="${item.url}" class="title" onclick="event.preventDefault(); window.electronAPI.newTab(Date.now().toString()); setTimeout(() => window.electronAPI.navigate(Date.now().toString(), '${item.url}'), 100);">${escapeHtml(item.title)}</a>
                    <div class="url">${escapeHtml(item.url)}</div>
                </div>
            `;
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
