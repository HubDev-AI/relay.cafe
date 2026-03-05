import { describe, test, expect } from 'bun:test'
import { checkContent } from '../../src/lib/contentFilter'

describe('checkContent', () => {
  // Category 1: Severe slurs (covered by @2toad/profanity built-in list)
  test('blocks severe racial slurs', () => {
    expect(checkContent('you are a nigger').blocked).toBe(true)
    expect(checkContent('hey nigga').blocked).toBe(true)
  })

  test('blocks homophobic slurs', () => {
    expect(checkContent('you faggot').blocked).toBe(true)
  })

  test('blocks common profanity', () => {
    expect(checkContent('fuck you').blocked).toBe(true)
    expect(checkContent('you are an asshole').blocked).toBe(true)
    expect(checkContent('what a bitch').blocked).toBe(true)
  })

  // Category 2+3: Sexual / CSAM (custom addWords)
  test('blocks child exploitation terms', () => {
    expect(checkContent('looking for child porn').blocked).toBe(true)
    expect(checkContent('preteen sex content').blocked).toBe(true)
    expect(checkContent('looking for underage').blocked).toBe(true)
  })

  // Category 4: Violent threats (custom addWords)
  test('blocks explicit violent threats', () => {
    expect(checkContent('i will kill you').blocked).toBe(true)
    expect(checkContent('im going to murder you').blocked).toBe(true)
    expect(checkContent('kill yourself').blocked).toBe(true)
    expect(checkContent('kys').blocked).toBe(true)
  })

  // Category 5: Extreme harassment (custom addWords)
  test('blocks extreme harassment', () => {
    expect(checkContent('i hope you die').blocked).toBe(true)
    expect(checkContent('drink bleach').blocked).toBe(true)
  })

  // Word boundary — no false positives
  test('does not block words containing blocked substrings', () => {
    expect(checkContent('I flagged the issue').blocked).toBe(false)
    expect(checkContent('She has a classic style').blocked).toBe(false)
    expect(checkContent('cocktail party tonight').blocked).toBe(false)
    expect(checkContent('class assignment due').blocked).toBe(false)
  })

  // Normalization: punctuation stripping
  test('catches evasion with dots between letters', () => {
    expect(checkContent('k.i.l.l yourself').blocked).toBe(true)
    expect(checkContent('i will k-i-l-l you').blocked).toBe(true)
  })

  // Normalization: case insensitive
  test('catches mixed case', () => {
    expect(checkContent('KILL YOURSELF').blocked).toBe(true)
    expect(checkContent('Kill Yourself').blocked).toBe(true)
  })

  // Normalization: zero-width chars
  test('catches zero-width character evasion', () => {
    expect(checkContent('kill\u200Byourself').blocked).toBe(true)
    expect(checkContent('k\u200Dys').blocked).toBe(true)
  })

  // Clean messages pass
  test('allows normal messages', () => {
    expect(checkContent('Hello, how are you?').blocked).toBe(false)
    expect(checkContent('Have a wonderful day!').blocked).toBe(false)
    expect(checkContent('The weather is nice today').blocked).toBe(false)
    expect(checkContent('I love coding in TypeScript').blocked).toBe(false)
  })

  // Edge cases
  test('handles empty string', () => {
    expect(checkContent('').blocked).toBe(false)
  })

  test('handles whitespace-only', () => {
    expect(checkContent('   ').blocked).toBe(false)
  })

  test('handles single character', () => {
    expect(checkContent('a').blocked).toBe(false)
  })

  test('handles max length clean message', () => {
    expect(checkContent('x'.repeat(1000)).blocked).toBe(false)
  })
})
