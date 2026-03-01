// Content filter for send-time moderation.
// Rejects messages containing severe prohibited content.
// Does NOT log, store, or send rejected message text anywhere.

import { Profanity } from '@2toad/profanity'

// Zero-width characters to strip before matching
const ZERO_WIDTH = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g

function normalize(text: string): string {
  return text
    .replace(ZERO_WIDTH, '')
    .replace(/[^\w\s]/g, '')  // strip punctuation to catch k.i.l.l, f*ck, etc.
    .replace(/\s+/g, ' ')
    .trim()
}

// @2toad/profanity handles slurs, profanity, and sexual terms out of the box.
// We add domain-specific phrases it doesn't cover: exploitation, threats, harassment.
const profanity = new Profanity({ wholeWord: true, grawlix: '****' })

profanity.addWords([
  // Child exploitation phrases
  'child porn', 'kiddie porn', 'cp link',
  'looking for underage', 'young girls pics', 'young boys pics',
  'preteen sex', 'loli', 'shota',

  // Explicit violent threats
  'i will kill you', 'im going to kill you', 'ill kill you',
  'i will murder you', 'im going to murder you',
  'kill yourself', 'kys',

  // Extreme harassment
  'i hope you die', 'go die', 'drink bleach', 'neck yourself',
])

export function checkContent(text: string): { blocked: boolean } {
  const normalized = normalize(text)
  if (profanity.exists(normalized)) {
    return { blocked: true }
  }
  return { blocked: false }
}
