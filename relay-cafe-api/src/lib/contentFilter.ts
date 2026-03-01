// Content filter for send-time moderation.
// Rejects messages containing severe prohibited content.
// Does NOT log, store, or send rejected message text anywhere.

// Zero-width characters to strip before matching
const ZERO_WIDTH = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(ZERO_WIDTH, '')
    .replace(/[^\w\s]/g, '')  // strip punctuation to catch k.i.l.l, f*ck, etc.
    .replace(/\s+/g, ' ')
    .trim()
}

// Word-boundary patterns for each category.
// Each pattern uses \b for word boundaries to reduce false positives.
const PATTERNS: RegExp[] = buildPatterns()

function buildPatterns(): RegExp[] {
  // Categories per design doc:
  // 1. Severe slurs (racial, ethnic, homophobic)
  // 2. Explicit sexual terms
  // 3. Child exploitation phrases
  // 4. Explicit violent threats
  // 5. Extreme harassment

  const terms: string[] = [
    // Category 1: Severe slurs
    'nigger', 'nigga', 'faggot', 'fag', 'dyke', 'kike', 'spic', 'wetback',
    'chink', 'gook', 'raghead', 'towelhead', 'tranny',

    // Category 2: Explicit sexual (most severe only)
    'child porn', 'kiddie porn', 'cp link',

    // Category 3: Child exploitation phrases
    'looking for underage', 'young girls pics', 'young boys pics',
    'preteen sex', 'loli', 'shota',

    // Category 4: Explicit violent threats
    'i will kill you', 'im going to kill you', 'ill kill you',
    'i will murder you', 'im going to murder you',
    'kill yourself', 'kys',

    // Category 5: Extreme harassment
    'i hope you die', 'go die', 'drink bleach', 'neck yourself',
  ]

  return terms.map(term => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`, 'i')
  })
}

export function checkContent(text: string): { blocked: boolean } {
  const normalized = normalize(text)
  for (const pattern of PATTERNS) {
    if (pattern.test(normalized)) {
      return { blocked: true }
    }
  }
  return { blocked: false }
}
