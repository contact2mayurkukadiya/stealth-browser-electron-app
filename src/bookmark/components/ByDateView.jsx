import React from 'react';
import HistoryRow from './HistoryRow';

function buildDateLabel(timestamp) {
  const now = new Date();
  const target = new Date(timestamp);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (target.toDateString() === now.toDateString()) {
    return `Today – ${now.toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })}`;
  }
  if (target.toDateString() === yesterday.toDateString()) {
    return `Yesterday – ${yesterday.toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })}`;
  }
  return target.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function groupByDate(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const label = buildDateLabel(entry.timestamp);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(entry);
  }
  return groups;
}

export default function ByDateView({
  entries,
  selected,
  onToggleSelect,
  onOpenEntry,
  onOpenContextMenu,
}) {
  const groups = groupByDate(entries);

  return (
    <>
      {Array.from(groups.entries()).map(([label, items]) => (
        <section key={label} className="h-date-section">
          <h2 className="h-date-heading">{label}</h2>
          {items.map((entry) => (
            <HistoryRow
              key={entry.visitId || `${entry.timestamp}-${entry.url}`}
              entry={entry}
              isSelected={selected.has(entry.visitId)}
              onToggleSelect={onToggleSelect}
              onOpenEntry={onOpenEntry}
              onOpenContextMenu={onOpenContextMenu}
            />
          ))}
        </section>
      ))}
    </>
  );
}
