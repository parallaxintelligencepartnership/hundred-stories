// Every colour here is copied from the game, never invented.
// Chrome tokens: docs/VISUAL.md "Tokens".
export const steel = '#1c232e';
export const steel2 = '#28313f';
export const line = '#3a4556';
export const ink = '#e8ecf2';
export const inkDim = '#98a3b3';
export const amber = '#f4b942';
export const mint = '#8ff0c0';
export const alert = '#ff5c4d';

// Scene 1 opens on pure black (shot list).
export const black = '#000000';

// Room walls: docs/VISUAL.md "room walls".
export const room = {
  lobby: '#f8f8f6',
  lobbyColumn: '#3a3a3a',
  shop: '#e9f2e4',
  office: '#f7f5ee',
  condo: '#f2e8d8',
  cinema: '#2b2b3a',
} as const;

// Structure: docs/VISUAL.md slab, outline, shafts, windows.
export const outline = '#222222'; // every room cell and figure outline
export const slab = '#e6e6e6';
export const slabEdge = '#333333';
export const shaftCavity = '#3b3f47';
export const shaftRail = '#d8dbe0';
export const paneVacant = '#2a3550';
export const paneDay = '#7fb6e0'; // far zoom day pane, reused for sweat drops
// Elevator car interior: docs/VISUAL.md "elevator car".
export const carInterior = '#fff3c4';
export const carHandrail = '#f0bf62';

// Sky: docs/VISUAL.md "sky".
export const sky = {
  dayTop: '#9fd3f5',
  dayHorizon: '#dcefff',
  dawn: '#f6b98a',
  dusk: '#e08a7a',
  nightTop: '#0d1b3d',
  nightHorizon: '#1c2f5c',
} as const;

// People: src/render/figure.ts (LOOKS and outfitFor).
export const people = {
  skinA: '#f1c7a5',
  skinB: '#8d5a3b',
  skinC: '#c68a5e',
  skinD: '#e8b48f',
  hairA: '#3b2a1e',
  hairB: '#1d1512',
  topJacket: '#2f4f7f',
  topSweater: '#d9a441',
  topTee: '#e07a5f',
  topHoodie: '#3f8a4a',
  trousers: '#3a3f4a',
  staffTop: '#3f8f86',
  vipCoat: '#b8864b',
  guardTop: '#22365a',
  guardCap: '#1a2742',
  shoe: '#2a2a2e',
  sunglasses: '#111111',
  apron: '#f4f1ea',
} as const;
