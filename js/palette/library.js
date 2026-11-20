// Built-in palettes. Each is built from 4 key colours:
//   [base, secondary, accent, atmosphere/fog]
// fromKeys() expands each key into a 4-shade ramp. Add your own here, or make
// them in the app (Palette → New / From image / Import) and export the JSON.
import { fromKeys } from './palette.js';

export const STYLE_PALETTES = {
  test: fromKeys('test', 'Test Card', ['#a04a32', '#38e8c8', '#d0b070', '#20283a']),
  fogway: fromKeys('fogway', 'Fogway', ['#7a46c0', '#4fe6f0', '#ff4fd8', '#1a0c30']),
  monoliths: fromKeys('monoliths', 'Monoliths', ['#8b8f9a', '#9a6cff', '#ffcf6e', '#0f2a3c']),
  relic: fromKeys('relic', 'Relic', ['#ff5a7a', '#56d6ff', '#ffd36b', '#0d0618']),
};

// Album palettes for the Radiohead set (docs/superpowers/specs/2026-11-20-radiohead-setlist-environments-design.md).
// Colour moods only; environments for those songs use these as their own palette.
export const ALBUM_PALETTES = {
  bends: fromKeys('bends', 'The Bends', ['#c8b49a', '#6aa8c8', '#f0f4f8', '#1c3448']),
  okc: fromKeys('okc', 'OK Computer', ['#b8bcc0', '#58a8c0', '#d8e070', '#1a2430']),
  kida: fromKeys('kida', 'Kid A', ['#dce8f0', '#4a6a8a', '#f05a1e', '#141a22']),
  amnesiac: fromKeys('amnesiac', 'Amnesiac', ['#7a2a2a', '#d8c8a0', '#e04040', '#24140e']),
  inrainbows: fromKeys('inrainbows', 'In Rainbows', ['#a83a2a', '#3a8a4a', '#f0b020', '#08080a']),
  amsp: fromKeys('amsp', 'A Moon Shaped Pool', ['#9a9a98', '#d8a0a8', '#e8eef4', '#16181c']),
  tkol: fromKeys('tkol', 'The King of Limbs', ['#8aa86a', '#e8d88a', '#f4f4ea', '#2a3640']),
};

export const BUILTIN_PALETTES = [
  ...Object.values(STYLE_PALETTES),
  ...Object.values(ALBUM_PALETTES),
  fromKeys('vapor', 'Vaporwave', ['#ff71ce', '#01cdfe', '#fffb96', '#1a0f3a']),
  fromKeys('bloodmoon', 'Blood Moon', ['#a8202a', '#5a1a40', '#ff8a3d', '#160508']),
  fromKeys('toxic', 'Toxic Swamp', ['#5c8a2a', '#2a6a5a', '#d4ff3a', '#0c140a']),
  fromKeys('ashfall', 'Ashfall', ['#8a8478', '#6a4a3a', '#d23a2a', '#4a4a46']),
  fromKeys('deepsea', 'Deep Sea', ['#1f6f8b', '#3a3a8a', '#7affd4', '#04101c']),
  fromKeys('sunset', 'Arcade Sunset', ['#ff6a3d', '#9a3aa8', '#ffd23a', '#1a0a2a']),
  fromKeys('handheld', 'Handheld Green', ['#8bac0f', '#306230', '#9bbc0f', '#0f380f']),
  fromKeys('amber', 'Amber Terminal', ['#ffb000', '#a86a00', '#ffe08a', '#120900']),
  fromKeys('glacier', 'Glacier', ['#a8d8ff', '#6a8ac8', '#ffffff', '#0e1a2c']),
  fromKeys('jungle', 'Jungle Ruins', ['#4a7a2a', '#8a6a3a', '#ffd25a', '#0c1a0c']),
  fromKeys('mono', 'Monochrome', ['#b0b0b0', '#707070', '#ffffff', '#141414']),
];
BUILTIN_PALETTES.forEach((p) => { p.builtin = true; });
