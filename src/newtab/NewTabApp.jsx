import React, { useState, useEffect, useCallback, useMemo } from 'react';
import NtpSearchBox from './NtpSearchBox';
import { calenderDaysSvg, chatSvg, documentSvg, envelopeSvg, GraduationCapSvg, logoIcognitoDarkSvg, logoPurpleDarkSvg, logoPurpleLightSvg, menuNewWindowSvg, youtubeSvg } from '../constants/appAssetUrls';
import { useChromeTheme } from '../hooks/useChromeTheme';
import { useInvsurfDocumentFavicon } from '../hooks/useInvsurfLogoFavicon';
import './NewTabApp.css';
import { KEYBOARD, NTP_TILE } from '../constants/conditionStrings.js';
import AssetMaskIcon from '../components/AssetMaskIcon.jsx';

const PRESET_SHORTCUTS = [
  { title: 'Gmail', url: 'https://mail.google.com', Icon: envelopeSvg },
  { title: 'Calendar', url: 'https://calendar.google.com', Icon: calenderDaysSvg },
  { title: 'Docs', url: 'https://docs.google.com', Icon: documentSvg },
  { title: 'GitHub', url: 'https://github.com', Icon: menuNewWindowSvg },
  { title: 'Slack', url: 'https://slack.com', Icon: chatSvg },
  { title: 'YouTube', url: 'https://www.youtube.com', Icon: youtubeSvg },
  { title: 'Courses', url: 'https://www.coursera.org', Icon: GraduationCapSvg },
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
    window.electronAPI?.navigate('current', site.url, { source: 'top-site' });
  }, [site.url]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === KEYBOARD.ENTER || e.key === KEYBOARD.SPACE) {
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
    window.electronAPI?.navigate('current', url, { source: 'top-site' });
  }, [url]);

  return (
    <a className="ntp-shortcut" href={url} onClick={(e) => { e.preventDefault(); open(); }}>
      <div className="ntp-shortcut__icon-wrap">
        <AssetMaskIcon icon={Icon} size={16} className="ntp-shortcut__glyph" />
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
          tile.kind === NTP_TILE.SITE ? (
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
  useChromeTheme();
  const [isStealthNtp, setIsStealthNtp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.isStealthWindow?.()
      .then((v) => {
        if (!cancelled) setIsStealthNtp(!!v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useInvsurfDocumentFavicon(isStealthNtp);
  const topSites = useTopSites();

  return (
    <div className={`ntp-root${isStealthNtp ? ' ntp-root--stealth' : ''}`}>
      <div className="ntp-bg-gradient" aria-hidden="true" />

      <main className="ntp-main">
        <div className="ntp-main__center">
          <div className="ntp-hero">
            <div className="ntp-hero__mark">
              {isStealthNtp ? (
                <img
                  className="ntp-hero__logo ntp-hero__logo--stealth"
                  src={logoIcognitoDarkSvg}
                  alt=""
                  width={80}
                  height={80}
                  draggable={false}
                />
              ) : (
                <>
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
                </>
              )}
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
