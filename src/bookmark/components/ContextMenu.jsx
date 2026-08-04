import React, { forwardRef } from 'react';

function getAllFolderUrls(node) {
    if (!node) return [];
    const urls = [];
    if (node.url) {
        urls.push(node.url);
    }
    if (Array.isArray(node.children)) {
        for (const child of node.children) {
            urls.push(...getAllFolderUrls(child));
        }
    }
    return urls;
}

function findNodeById(nodes, id) {
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
        if (!node) continue;
        if (String(node.id) === String(id)) return node;
        if (Array.isArray(node.children)) {
            const found = findNodeById(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

const ContextMenu = forwardRef(function ContextMenu(
    {
        x,
        y,
        entry,
        tree,
        hasClipboard,
        onEdit,
        onDelete,
        onCut,
        onCopy,
        onPaste,
        onOpenStealth,
        onOpenNewWindow,
        onOpenNewTab,
        onClose,
    },
    ref
) {
    const isFolder = !entry?.url;

    // Find full folder node in tree if it's a folder to get all children and URL count
    let folderUrls = [];
    if (isFolder && tree) {
        const allRoots = [...(tree.bar || []), ...(tree.other || []), ...(tree.mobile || [])];
        const fullNode = findNodeById(allRoots, entry.id);
        if (fullNode) {
            folderUrls = getAllFolderUrls(fullNode);
        }
    }
    const folderCount = folderUrls.length;

    return (
        <div
            ref={ref}
            className="b-context-menu"
            style={{ top: y, left: x }}
            role="menu"
            aria-label="Bookmark actions"
        >
            {/* A. Edit / Rename */}
            <button
                type="button"
                className="b-context-item"
                role="menuitem"
                onClick={() => { onClose(); onEdit(entry); }}
            >
                {isFolder ? 'Rename' : 'Edit'}
            </button>

            {/* B. Delete */}
            <button
                type="button"
                className="b-context-item danger"
                role="menuitem"
                onClick={() => { onClose(); onDelete(entry); }}
            >
                Delete
            </button>

            {/* C. Separator */}
            <div className="b-context-divider" role="separator" />

            {/* D. Cut */}
            <button
                type="button"
                className="b-context-item"
                role="menuitem"
                onClick={() => { onClose(); onCut(entry); }}
            >
                Cut
            </button>

            {/* E. Copy */}
            <button
                type="button"
                className="b-context-item"
                role="menuitem"
                onClick={() => { onClose(); onCopy(entry); }}
            >
                Copy
            </button>

            {/* F. Paste */}
            <button
                type="button"
                className="b-context-item"
                role="menuitem"
                disabled={!hasClipboard}
                style={!hasClipboard ? { opacity: 0.5, cursor: 'default' } : undefined}
                onClick={() => {
                    if (hasClipboard) {
                        onClose();
                        onPaste(entry);
                    }
                }}
            >
                Paste
            </button>

            {/* G. Separator */}
            <div className="b-context-divider" role="separator" />

            {/* H. Open in stealth window / Open All(count) in stealth window */}
            <button
                type="button"
                className="b-context-item"
                role="menuitem"
                onClick={() => { onClose(); onOpenStealth(entry, folderUrls); }}
            >
                {isFolder ? `Open All(${folderCount}) in stealth window` : 'Open in stealth window'}
            </button>

            {/* J. Open in new window / Open All(count) in new window */}
            <button
                type="button"
                className="b-context-item"
                role="menuitem"
                onClick={() => { onClose(); onOpenNewWindow(entry, folderUrls); }}
            >
                {isFolder ? `Open All(${folderCount}) in new window` : 'Open in new window'}
            </button>

            {/* K. Open in new tab / Open All(count) in new tab */}
            <button
                type="button"
                className="b-context-item"
                role="menuitem"
                onClick={() => { onClose(); onOpenNewTab(entry, folderUrls); }}
            >
                {isFolder ? `Open All(${folderCount}) in new tab` : 'Open in new tab'}
            </button>
        </div>
    );
});

export default ContextMenu;