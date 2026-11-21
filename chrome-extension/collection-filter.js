function matchesCollectionMode(item, mode) {
  if (mode === 'images') return item.kind === 'image';
  return item.kind !== 'image' || /\.gif(?:[?#]|$)/i.test(item.mediaUrl);
}
