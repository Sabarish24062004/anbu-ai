import { describe, expect, it } from 'vitest';
import { detectLanguage } from '@anbu/shared';

describe('detectLanguage', () => {
  it.each([
    ['நாளை காலை 7 மணிக்கு உடற்பயிற்சி', 'ta'],
    ['naalai saayangaalam 6 mani ku amma ku phone pannanum', 'ta'],
    ['innaiku enna irukku', 'ta'],
    ['Add a dentist appointment tomorrow at 10:30', 'en'],
    ['Cancel the dentist appointment', 'en'],
    ['Call amma at 6', 'en'], // one Tamil word in an English sentence stays English
    ['Meeting with Karthik on Friday', 'en'],
  ])('%s → %s', (text, expected) => {
    expect(detectLanguage(text)).toBe(expected);
  });
});
