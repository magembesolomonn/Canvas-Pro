const SYMBOLS = {
  loop: 'repeat',
  canvas: 'square.dashed',
  hand: 'hand.draw',
  cursor: 'cursorarrow',
  text: 'textformat',
  rectangle: 'rectangle',
  ellipse: 'circle',
  undo: 'arrow.uturn.backward',
  redo: 'arrow.uturn.forward',
  chevronLeft: 'chevron.left',
  chevronRight: 'chevron.right',
  settings: 'gearshape',
  health: 'checkmark.shield',
  grid: 'square.grid.2x2',
  layout: 'rectangle.3.group',
  folder: 'folder',
  image: 'photo',
  video: 'film',
  audio: 'waveform',
  star: 'star',
  starFill: 'star.fill',
  tag: 'tag',
  trash: 'trash',
  link: 'link',
  play: 'play.fill',
  pause: 'pause.fill',
  volume: 'speaker.wave.2',
  mute: 'speaker.slash',
  expand: 'arrow.up.left.and.arrow.down.right',
  file: 'doc',
  docText: 'doc.text',
  sidebar: 'sidebar.left',
  inspector: 'sidebar.right',
  plus: 'plus',
  search: 'magnifyingglass',
  camera: 'camera',
  book: 'book',
  sparkles: 'sparkles',
  archive: 'tray',
  download: 'arrow.down.to.line',
  export: 'square.and.arrow.up',
  keyboard: 'keyboard',
  close: 'xmark',
  reload: 'arrow.clockwise',
  pencil: 'pencil.tip',
  arrow: 'arrow.up.right',
  sticky: 'note.text',
  list: 'list.bullet',
  filter: 'line.3.horizontal.decrease.circle',
  sort: 'arrow.up.arrow.down',
  appearance: 'circle.lefthalf.filled',
  extensions: 'puzzlepiece.extension',
  about: 'info.circle',
  importing: 'arrow.down.doc',
  minus: 'minus',
  heading: 'textformat.size.larger',
  toggle: 'switch.2',
  table: 'tablecells',
  library: 'rectangle.stack',
  viewOptions: 'line.3.horizontal.decrease',
  findSimilar: 'sparkle.magnifyingglass',
  plusMagnifier: 'plus.magnifyingglass',
  minusMagnifier: 'minus.magnifyingglass',
  resetZoom: 'arrow.counterclockwise',
  pauseCircle: 'pause.circle',
  playCircle: 'play.circle',
  retry: 'arrow.triangle.2.circlepath',
  duplicates: 'doc.on.doc',
  folderAdd: 'folder.badge.plus',
  gobackward10: 'gobackward.10',
  goforward10: 'goforward.10'
};

function glyph(name, options = {}) {
  const key = SYMBOLS[name] ? name : 'file';
  const symbol = SYMBOLS[key];
  const size = options.size || 20;
  const weight = options.weight || 'regular';
  const scale = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 2)));
  const span = document.createElement('span');
  span.className = 'sf-symbol';
  span.style.setProperty(
    '--symbol',
    `url("symbol://render?key=${encodeURIComponent(key)}&name=${encodeURIComponent(symbol)}&size=${size}&weight=${weight}&scale=${scale}")`
  );
  span.setAttribute('aria-hidden', 'true');
  return span;
}
