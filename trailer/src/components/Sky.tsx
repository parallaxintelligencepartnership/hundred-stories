import React from 'react';

// Full frame vertical gradient; two stops are enough for the flat game sky.
export const Sky: React.FC<{ top: string; horizon: string; horizonAt?: number }> = ({ top, horizon, horizonAt = 85 }) => (
  <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${top} 0%, ${horizon} ${horizonAt}%)` }} />
);
