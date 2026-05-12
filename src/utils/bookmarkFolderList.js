/** Flatten folder tree for a folder `<select>` / overlay list (indented labels). */
export function collectFolderOptions(list, prefix = '') {
  const result = [];
  for (const item of list) {
    if (item.type === 'folder') {
      result.push({ id: item.id, label: prefix + item.title });
      if (item.children?.length) {
        result.push(...collectFolderOptions(item.children, `${prefix}  `));
      }
    }
  }
  return result;
}
