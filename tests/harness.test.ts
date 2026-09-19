import { describe, expect, it } from 'vitest';

describe('harness', () => {
  it('harness proves it can fail', () => {
    expect(1 + 1).toBe(2);
  });
});
