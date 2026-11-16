// Mood colour helpers. Mood colours come from the moods table (color_hex).

const HEX = /^#?([0-9a-f]{6})$/i;

export function hexToRgb(hex) {
  const m = HEX.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (WCAG) of a hex colour. */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink colour that stays readable on a mood colour. */
export const inkOn = (hex) => (luminance(hex) > 0.38 ? '#1A1C2C' : '#FFFFFF');

/**
 * The "aura" behind the mood composer: one soft field per selected mood,
 * positioned around the page. Returns a CSS background value.
 */
export function aura(colors, strength = 0.42) {
  const list = (colors || []).map(hexToRgb).filter(Boolean).slice(0, 4);
  if (!list.length) return 'none';
  const spots = ['18% 22%', '82% 18%', '70% 78%', '24% 82%'];
  return list.map(([r, g, b], i) => `radial-gradient(48% 56% at ${spots[i]}, rgba(${r}, ${g}, ${b}, ${strength}), rgba(${r}, ${g}, ${b}, 0) 70%)`).join(', ');
}

/** Pleasant cover from the album's two stored colours. */
export const cover = (pair) => {
  const [a, b] = Array.isArray(pair) ? pair : [];
  return `linear-gradient(135deg, ${a || '#B9BFD3'}, ${b || '#2A2F48'})`;
};
