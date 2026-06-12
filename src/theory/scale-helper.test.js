import { describe, it, expect } from 'vitest';
import { getScaleNotes, getPentatonicNotes, getNoteOctaves } from './scale-helper.js';

describe('getScaleNotes', () => {
  it('returns the D major scale', () => {
    expect(getScaleNotes('D', 'major')).toEqual(['D', 'E', 'F#', 'G', 'A', 'B', 'C#']);
  });

  it('returns the A minor scale', () => {
    expect(getScaleNotes('A', 'minor')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });
});

describe('getPentatonicNotes', () => {
  it('returns major pentatonic for major', () => {
    expect(getPentatonicNotes('G', 'major')).toEqual(['G', 'A', 'B', 'D', 'E']);
  });

  it('returns minor pentatonic for minor', () => {
    expect(getPentatonicNotes('E', 'minor')).toEqual(['E', 'G', 'A', 'B', 'D']);
  });
});

describe('getNoteOctaves', () => {
  it('returns octaves within first-position violin range (G3-A5)', () => {
    expect(getNoteOctaves('D')).toEqual(['D4', 'D5']);
    expect(getNoteOctaves('G')).toEqual(['G3', 'G4', 'G5']);
  });
});
