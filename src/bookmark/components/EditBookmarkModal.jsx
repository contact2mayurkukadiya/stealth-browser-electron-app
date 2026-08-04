import React, { useState } from 'react';

export default function EditBookmarkModal({ entry, onSave, onClose }) {
  const isFolder = !entry?.url;
  const [title, setTitle] = useState(entry?.title || '');
  const [url, setUrl] = useState(entry?.url || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      id: entry.id,
      title: title.trim(),
      ...(isFolder ? {} : { url: url.trim() }),
    });
  };

  return (
    <div className="b-modal-overlay" onClick={onClose}>
      <div className="b-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <h3 className="b-modal-title">{isFolder ? 'Rename folder' : 'Edit bookmark'}</h3>

        <form onSubmit={handleSubmit}>
          <div className="b-modal-field">
            <label htmlFor="b-edit-name">Name</label>
            <input
              id="b-edit-name"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          {!isFolder && (
            <div className="b-modal-field">
              <label htmlFor="b-edit-url">URL</label>
              <input
                id="b-edit-url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
          )}

          <div className="b-modal-actions">
            <button type="button" className="b-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="b-btn-primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
