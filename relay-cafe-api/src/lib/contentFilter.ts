// Content filter for send-time moderation.
// Rejects messages containing severe prohibited content.
// Does NOT log, store, or send rejected message text anywhere.

import { Profanity } from '@2toad/profanity'
import { blockedTerms } from './blockedTerms'

// Zero-width characters to strip before matching
const ZERO_WIDTH = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g

// Strip zero-width chars (catches k​ys → kys)
function stripZeroWidth(text: string): string {
  return text.replace(ZERO_WIDTH, '')
}

// Full normalize: zero-width → space, strip punctuation (catches k.i.l.l → kill)
function normalize(text: string): string {
  return text
    .replace(ZERO_WIDTH, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// @2toad/profanity handles slurs, profanity, and sexual terms out of the box.
// We add domain-specific phrases it doesn't cover: exploitation, threats, harassment.
// See blockedTerms.ts to add more.
const profanity = new Profanity({ wholeWord: true, grawlix: '****' })
profanity.addWords(blockedTerms)

export function checkContent(text: string): { blocked: boolean } {
  // Pass 1: raw text (package handles case-insensitive matching)
  if (profanity.exists(text)) return { blocked: true }
  // Pass 2: zero-width chars removed (catches k​ys → kys)
  const stripped = stripZeroWidth(text)
  if (stripped !== text && profanity.exists(stripped)) return { blocked: true }
  // Pass 3: full normalize — zero-width as space + punctuation stripped (catches k.i.l.l → kill)
  const normalized = normalize(text)
  if (normalized !== stripped && profanity.exists(normalized)) return { blocked: true }
  return { blocked: false }
}
