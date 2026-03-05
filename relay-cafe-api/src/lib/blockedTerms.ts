// Custom blocked terms that @2toad/profanity doesn't cover.
// Add new entries here — one term per line, grouped by category.
// The content filter normalizes input (strips punctuation, zero-width chars)
// before matching, so "i'm" should be written as "im".

export const blockedTerms: string[] = [
  // Child exploitation phrases
  'child porn',
  'kiddie porn',
  'cp link',
  'looking for underage',
  'young girls pics',
  'young boys pics',
  'preteen sex',
  'loli',
  'shota',

  // Explicit violent threats
  'i will kill you',
  'im going to kill you',
  'ill kill you',
  'i will murder you',
  'im going to murder you',
  'kill yourself',
  'kys',

  // Extreme harassment
  'i hope you die',
  'go die',
  'drink bleach',
  'neck yourself',
]
