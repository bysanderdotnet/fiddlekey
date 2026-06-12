import { describe, it, expect } from 'vitest';
import { KeySmoother } from './smoothing.js';

describe('KeySmoother', () => {
  it('returns null when nothing was added', () => {
    const smoother = new KeySmoother(3);
    expect(smoother.add(null)).toBeNull();
  });

  it('returns the majority estimate in the window', () => {
    const smoother = new KeySmoother(5);
    const dMajor = { tonic: 'D', mode: 'major' };
    const gMajor = { tonic: 'G', mode: 'major' };

    smoother.add(dMajor);
    smoother.add(dMajor);
    smoother.add(gMajor);
    expect(smoother.add(dMajor)).toEqual(dMajor);
  });

  it('forgets estimates that fall out of the window', () => {
    const smoother = new KeySmoother(2);
    const aMinor = { tonic: 'A', mode: 'minor' };
    const eMinor = { tonic: 'E', mode: 'minor' };

    smoother.add(aMinor);
    smoother.add(eMinor);
    expect(smoother.add(eMinor)).toEqual(eMinor);
  });

  it('clear resets the history', () => {
    const smoother = new KeySmoother(3);
    smoother.add({ tonic: 'D', mode: 'major' });
    smoother.clear();
    expect(smoother.getMajority()).toBeNull();
  });
});
