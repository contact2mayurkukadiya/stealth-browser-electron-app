import React from 'react';
import GroupCard from './GroupCard';

function extractSearchQuery(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('google.') && u.pathname === '/search') {
      return u.searchParams.get('q') || null;
    }
  } catch { /* ignore */ }
  return null;
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

/**
 * Groups entries into sessions:
 * - A new group starts whenever a Google search is encountered.
 * - The search entry and all entries following it (until the next search) form that group.
 * - Entries before the first search (or that never have a search) are grouped by domain.
 */
function buildGroups(entries) {
  const groups = [];
  let currentGroup = null;

  for (const entry of entries) {
    const query = extractSearchQuery(entry.url);

    if (query) {
      // This is a Google search — start a new group
      currentGroup = { title: query, entries: [entry] };
      groups.push(currentGroup);
    } else if (currentGroup) {
      // Append to current search session
      currentGroup.entries.push(entry);
    } else {
      // No current search session — group by domain
      const domain = extractDomain(entry.url);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.title === domain && !lastGroup.isSearch) {
        lastGroup.entries.push(entry);
      } else {
        currentGroup = { title: domain, entries: [entry], isSearch: false };
        groups.push(currentGroup);
      }
    }
  }

  return groups;
}

export default function ByGroupView({ entries, onOpenEntry, onOpenContextMenu }) {
  const groups = buildGroups(entries);

  if (groups.length === 0) {
    return <div className="h-empty">No browsing history yet.</div>;
  }

  return (
    <>
      {groups.map((group, idx) => (
        <GroupCard
          key={group.title + idx}
          groupTitle={group.title}
          entries={group.entries}
          onOpenEntry={onOpenEntry}
          onOpenContextMenu={onOpenContextMenu}
        />
      ))}
    </>
  );
}
