import React, { useState, useEffect, useCallback } from 'react';
import NtpSearchBox from './NtpSearchBox';
import './NewTabApp.css';

// ── Clock ──────────────────────────────────────────────────────────────────

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date) {
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="ntp-clock" aria-live="polite" aria-atomic="true">
      <div className="ntp-clock__time">{formatTime(now)}</div>
      <div className="ntp-clock__date">{formatDate(now)}</div>
    </div>
  );
}

// ── Top Sites ──────────────────────────────────────────────────────────────

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function SiteTile({ site }) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const domain = extractDomain(site.url);
  const letter = (site.title || domain || '?')[0].toUpperCase();

  const handleClick = useCallback(() => {
    window.electronAPI?.navigate('current', site.url);
  }, [site.url]);

  return (
    <button
      className="ntp-site-tile"
      onClick={handleClick}
      title={site.title || domain}
      aria-label={site.title || domain}
    >
      <div className="ntp-site-tile__icon-wrap">
        {faviconFailed ? (
          <div className="ntp-site-tile__letter" aria-hidden="true">{letter}</div>
        ) : (
          <img
            className="ntp-site-tile__favicon"
            src={faviconUrl(domain)}
            alt=""
            onError={() => setFaviconFailed(true)}
          />
        )}
      </div>
      <span className="ntp-site-tile__label">{site.title || domain}</span>
    </button>
  );
}

function TopSites() {
  const [sites, setSites] = useState([]);

  useEffect(() => {
    window.electronAPI?.ntpGetTopSites?.().then((data) => {
      if (Array.isArray(data)) setSites(data);
    }).catch(() => {});
  }, []);

  if (sites.length === 0) return null;

  return (
    <section className="ntp-top-sites" aria-label="Most visited sites">
      <div className="ntp-top-sites__grid">
        {sites.map((site) => (
          <SiteTile key={site.url} site={site} />
        ))}
      </div>
    </section>
  );
}

// ── NewTabApp ──────────────────────────────────────────────────────────────

export default function NewTabApp() {
  return (
    <div className="ntp-root">
      <main className="ntp-main">
        <Clock />
        <NtpSearchBox />
        <TopSites />
      </main>
    </div>
  );
}
