// Garage paints, picked to fit the game's dusty palette; the custom picker
// covers anything else. One colour applies to every car and is held for the
// visit, never stored.
export const PAINTS = [
  { name: 'Sunset Coral', color: '#d96143' },
  { name: 'Signal Red', color: '#b8232f' },
  { name: 'Clementine', color: '#e08a33' },
  { name: 'Desert Mustard', color: '#e0b44a' },
  { name: 'Sage Green', color: '#78977b' },
  { name: 'Forest Green', color: '#3f6b4a' },
  { name: 'Sea Glass', color: '#6fa9c2' },
  { name: 'Midnight Blue', color: '#2f4a6d' },
  { name: 'Alpine Ice', color: '#9fc4d5' },
  { name: 'Deep Plum', color: '#6b4a6b' },
  { name: 'Bone White', color: '#e7e3d5' },
  { name: 'Graphite', color: '#4a5257' },
];

// Swatch that restores each car's own finish.
export const DEFAULT_PAINT = 'default';
export const DEFAULT_PAINT_NAME = 'Each car’s own colour';

const HEX = /^#[0-9a-f]{6}$/i;
export const isPaint = value => typeof value === 'string' && HEX.test(value);
// null means each car's own finish.
export const readPaint = value => (isPaint(value) ? value.toLowerCase() : null);
export const paintName = color => PAINTS.find(paint => paint.color === color)?.name ?? null;
