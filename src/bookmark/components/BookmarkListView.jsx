import React from 'react';
import BookmarkRow from './BookmarkRow';

export default function BookmarkListView({
    entries,
    selected,
    onToggleSelect,
    onOpenEntry,
    onOpenFolder,
    onOpenContextMenu,
}) {
    return (
        <div className="b-list">
            {entries.map((entry) => (
                <BookmarkRow
                    key={entry.id || entry.url || entry.title}
                    entry={entry}
                    isSelected={selected.has(entry.id)}
                    onToggleSelect={onToggleSelect}
                    onOpenEntry={onOpenEntry}
                    onOpenFolder={onOpenFolder}
                    onOpenContextMenu={onOpenContextMenu}
                />
            ))}
        </div>
    );
}