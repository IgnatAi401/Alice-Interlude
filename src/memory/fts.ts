/**
 * FTS5 trigram query building (dev/ROADMAP.md §4.5). The trigram tokenizer
 * only matches terms of at least three characters, so CJK text is cut into
 * overlapping three-character fragments and other scripts into whole words.
 */

const MAX_TERMS = 60
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu
const WORD = /[\p{L}\p{N}]{3,}/gu

/** Returns an FTS5 MATCH expression, or undefined when nothing is long enough to search. */
export function buildFtsQuery(text: string): string | undefined {
  const terms = new Set<string>()
  const add = (term: string) => { if (terms.size < MAX_TERMS) terms.add(term.toLowerCase()) }
  for (const [run] of text.matchAll(CJK_RUN)) {
    for (let index = 0; index + 3 <= run.length; index++) add(run.slice(index, index + 3))
  }
  for (const [word] of text.replace(CJK_RUN, ' ').matchAll(WORD)) add(word)
  if (!terms.size) return undefined
  // Quote every term so FTS operators in user text (AND, NEAR, *, ") are plain characters.
  return [...terms].map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ')
}
