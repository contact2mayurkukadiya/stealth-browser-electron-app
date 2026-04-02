import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setBookmarks } from '../store/bookmarksSlice';
import BookmarkItem from './BookmarkItem';

const ADD_FOLDER_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 640 640">
    <path fill="white" d="M576 448C576 512 547.3 512 512 512L128 512C92.7 512 64 483.3 64 448L64 160C64 124.7 92.7 96 128 96L266.7 96C280.5 96 294 100.5 305.1 108.8L343.5 137.6C349 141.8 355.8 144 362.7 144L512 144C547.3 144 576 172.7 576 208L576 448zM320 224C306.7 224 296 234.7 296 248L296 296L248 296C234.7 296 224 306.7 224 320C224 333.3 234.7 344 248 344L296 344L296 392C296 405.3 306.7 416 320 416C333.3 416 344 405.3 344 392L344 344L392 344C405.3 344 416 333.3 416 320C416 306.7 405.3 296 392 296L344 296L344 248C344 234.7 333.3 224 320 224z" />
  </svg>
);

export default function BookmarkBar({ currentTabId }) {
  const dispatch = useDispatch();
  const bookmarksData = useSelector(s => s.bookmarks.data);

  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  const [folderName, setFolderName] = useState('');
  const folderInputRef = useRef(null);
  const dragSrcIdRef = useRef(null);

  // Focus folder name input when prompt appears
  useEffect(() => {
    if (showFolderPrompt && folderInputRef.current) {
      folderInputRef.current.focus();
    }
  }, [showFolderPrompt]);

  const handleNavigate = useCallback((url) => {
    if (currentTabId) window.electronAPI.navigate(currentTabId, url);
  }, [currentTabId]);

  const createFolder = async () => {
    const name = folderName.trim();
    if (name) {
      const data = await window.electronAPI.bookmarksAddFolder(name);
      dispatch(setBookmarks(data));
    }
    setShowFolderPrompt(false);
    setFolderName('');
  };

  const cancelFolder = () => {
    setShowFolderPrompt(false);
    setFolderName('');
  };

  const handleFolderKeyDown = (e) => {
    if (e.key === 'Enter') createFolder();
    if (e.key === 'Escape') cancelFolder();
  };

  return (
    <div className="bookmark-bar">
      {bookmarksData.bar.map(item => (
        <BookmarkItem
          key={item.id}
          item={item}
          dragSrcIdRef={dragSrcIdRef}
          bookmarksData={bookmarksData}
          onNavigate={handleNavigate}
        />
      ))}

      {showFolderPrompt && (
        <div className="bk-folder-prompt" id="bk-folder-prompt">
          <input
            ref={folderInputRef}
            id="bk-folder-name"
            type="text"
            placeholder="Folder name"
            maxLength={40}
            value={folderName}
            onChange={e => setFolderName(e.target.value)}
            onKeyDown={handleFolderKeyDown}
          />
          <button id="bk-folder-ok" onClick={createFolder}>OK</button>
          <button id="bk-folder-cancel" onClick={cancelFolder}>Cancel</button>
        </div>
      )}

      <button
        className="bk-add-folder btn"
        title="Add folder"
        onClick={() => setShowFolderPrompt(v => !v)}
      >
        {ADD_FOLDER_ICON}
      </button>
    </div>
  );
}
