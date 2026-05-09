import React, { useState, useEffect, useCallback, useMemo } from 'react';
import NtpSearchBox from './NtpSearchBox';
import { logoPurpleDarkSvg, logoPurpleLightSvg } from '../constants/appAssetUrls';
import './NewTabApp.css';

// ── Icons (Material-like, inlined for CSP / offline) ────────────────────────

function IconMail({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5L4 8V6l8 5 8-5v2z" />
    </svg>
  );
}

function IconCalendar({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z" />
    </svg>
  );
}

function IconDoc({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  );
}

function IconTerminal({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
    </svg>
  );
}

function IconForum({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z" />
    </svg>
  );
}

function IconPlay({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l7 4.5-7 4.5z" />
    </svg>
  );
}

function IconSchool({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3 1 9l11 6 9-4.91V17h2V9L12 3z" />
    </svg>
  );
}

const PRESET_SHORTCUTS = [
  { title: 'Gmail', url: 'https://mail.google.com', Icon: IconMail },
  { title: 'Calendar', url: 'https://calendar.google.com', Icon: IconCalendar },
  { title: 'Docs', url: 'https://docs.google.com', Icon: IconDoc },
  { title: 'GitHub', url: 'https://github.com', Icon: IconTerminal },
  { title: 'Slack', url: 'https://slack.com', Icon: IconForum },
  { title: 'YouTube', url: 'https://www.youtube.com', Icon: IconPlay },
  { title: 'Courses', url: 'https://www.coursera.org', Icon: IconSchool },
];

// ── Top Sites & shortcuts ────────────────────────────────────────────────────

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

function SiteShortcutCard({ site }) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const domain = extractDomain(site.url);
  const letter = (site.title || domain || '?')[0].toUpperCase();

  const handleClick = useCallback(() => {
    window.electronAPI?.navigate('current', site.url);
  }, [site.url]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  return (
    <div
      className="ntp-shortcut"
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={site.title || domain}
      aria-label={site.title || domain}
    >
      <div className="ntp-shortcut__icon-wrap">
        {faviconFailed ? (
          <div className="ntp-shortcut__letter" aria-hidden="true">{letter}</div>
        ) : (
          <img
            className="ntp-shortcut__favicon"
            src={faviconUrl(domain)}
            alt=""
            draggable={false}
            onError={() => setFaviconFailed(true)}
          />
        )}
      </div>
      <span className="ntp-shortcut__label">{site.title || domain}</span>
    </div>
  );
}

function PresetShortcutCard({ shortcut }) {
  const { title, url, Icon } = shortcut;

  const open = useCallback(() => {
    window.electronAPI?.navigate('current', url);
  }, [url]);

  return (
    <a className="ntp-shortcut" href={url} onClick={(e) => { e.preventDefault(); open(); }}>
      <div className="ntp-shortcut__icon-wrap">
        <Icon className="ntp-shortcut__glyph" />
      </div>
      <span className="ntp-shortcut__label">{title}</span>
    </a>
  );
}

function ShortcutGrid({ topSites }) {
  const tiles = useMemo(() => {
    if (topSites.length > 0) {
      return topSites.slice(0, 8).map((site) => ({ kind: 'site', key: site.url, site }));
    }
    return PRESET_SHORTCUTS.map((s) => ({ kind: 'preset', key: s.url, shortcut: s }));
  }, [topSites]);

  return (
    <section className="ntp-shortcuts" aria-label="Most frequent links">
      <div className="ntp-shortcuts__grid">
        {tiles.map((tile) =>
          tile.kind === 'site' ? (
            <SiteShortcutCard key={tile.key} site={tile.site} />
          ) : (
            <PresetShortcutCard key={tile.key} shortcut={tile.shortcut} />
          ),
        )}
      </div>
    </section>
  );
}

function useTopSites() {
  const [sites, setSites] = useState([]);

  useEffect(() => {
    window.electronAPI?.ntpGetTopSites?.()
      .then((data) => {
        if (Array.isArray(data)) setSites(data);
      })
      .catch(() => {});
  }, []);

  return sites;
}

// ── NewTabApp ──────────────────────────────────────────────────────────────

export default function NewTabApp() {
  const topSites = useTopSites();

  return (
    <div className="ntp-root">
      <div className="ntp-bg-gradient" aria-hidden="true" />

      <main className="ntp-main">
        <div className="ntp-main__center">
          <div className="ntp-hero">
            <div className="ntp-hero__mark">
              <img
                className="ntp-hero__logo ntp-hero__logo--scheme-light"
                src={logoPurpleLightSvg}
                alt=""
                width={80}
                height={80}
                draggable={false}
              />
              <img
                className="ntp-hero__logo ntp-hero__logo--scheme-dark"
                src={logoPurpleDarkSvg}
                alt=""
                width={80}
                height={80}
                draggable={false}
              />
            </div>
            <h1 className="ntp-hero__name">InviSurf</h1>
          </div>
          <NtpSearchBox />
          <ShortcutGrid topSites={topSites} />
        </div>
      </main>
    </div>
  );
}
