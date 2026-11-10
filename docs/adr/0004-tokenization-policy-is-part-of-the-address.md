# The tokenization policy is part of what a word address means

Status: accepted. Carried from old bible-codex ADR-0014, commit `c2643a2`. The registered rules below are copied verbatim.

A word address is a verse plus a `word_index`: the 0-based ordinal of a word Token in the verse, punctuation excluded. The tokenizer decides what one word is (*LORD's*, *father-in-law*, elisions, numbers). Change a rule and every later index in affected verses shifts, which corrupts references the same way a text revision does (ADR-0005). So:

1. The word and punctuation rules are registered, versioned policy, recorded in this ADR and implemented in one place, `src/ingest/tokenize.ts`.
2. Any rule change is an address migration, with ADR-0005's reconciliation as the safety net.
3. The golden fixtures are adversarial (possessives, hyphenated compounds, elisions, numbers, mixed punctuation), so rule drift fails tests. **A failing tokenizer test is an address migration, not a test to update.**

## Considered options

- **Leave the rules implicit in the code.** Rejected. A well-meant "tokenizer bugfix" would ship a migration nobody noticed.
- **Count punctuation in `word_index`.** Rejected. Revisions touch punctuation (quote styles, commas) far more often than words, so excluding punctuation keeps indexes stable under the most common edition churn.

## Open for the research

- Rule 6 (a verse bridge collapses to its first number) loses information. Surfacing verse ranges needs re-ingest and is an address migration. Decide before any external reference exists.
- The rules were written for English. Amendment v1.2 registers what they do with Hebrew and Greek. A script without spaces between words still needs its own policy.
- The petuha and setuma marks (פ, ס) are punctuation since v1.3. Reading them as paragraph structure later needs no address change, since punctuation has no word index.

## The registered policy (v1 — fixed 2026-07-04, issue #6)

Implemented and guarded in `src/ingest/tokenize.ts` (the single tokenizer both KJV and
BSB ingest through); adversarial fixtures in `src/ingest/tokenize.test.ts` and the
golden fixture pin every rule. **A failing tokenizer test is an anchor migration, not a test to
update.**

1. A **word token** is a maximal run of letters/digits joined by *internal* apostrophes
   (`'`/`’`) or hyphens (`-`); it must **begin and end alphanumeric**. Possessives (*LORD's*)
   and hyphenated compounds (*father-in-law*) are ONE word — one tap target.
2. A **grouped number** — digits joined by `,` or `.` (*144,000*, *3.5*) — is ONE word token.
3. A **trailing bare apostrophe** (*disciples’*) and a **leading elision apostrophe** (*’Twas*)
   are punct, not part of the word — a quote-style revision (`'` → `’`) at a word edge touches
   only punct text, never a word (ADR-0005 immunity for the most common edition churn).
4. Everything else non-space is **punct**; a maximal run of punct characters (`,”`, `—`)
   collapses into a **single punct token**, addressed by the word it follows.
5. **Whitespace is never a token** (CONTEXT.md).
6. A **verse bridge** (`\v 17-18`) collapses to its FIRST number: every token in the bridged
   passage carries `verse = 17`, word indexes count from the bridge start, and the bridge end
   survives only as an ingest stat (`verseBridges`). The later number(s) never mint a
   coordinate, so no anchor can reference them — surfacing verse *ranges* later therefore
   requires re-ingest and is an **anchor migration** like any other rule change. Guarded by
   the golden fixture (`\v 5-6` in `adversarial.usfm`).

One clarification the real sources forced (BSB Zech 12): a heading never **inherits** the
preceding verse, but an **explicit `\v` inside a heading para** (a *versified* `\d` descriptive
title) keeps its verse and word indexes — otherwise that verse would vanish from the
translation and be unanchorable. Unversed headings (Psalm titles, `\s`, `\mt`, `\qa`) still
carry `verse = NULL`.

## Amendment v1.1 — Unicode combining marks bind to their base word (2026-07-05, old repo issue #25)

Reviewing the old app's draw layer surfaced two Unicode gaps that block the
Greek/Hebrew translation-corpus milestone. Both are fixed at ingest, **before** any non-Latin
anchor is minted, so — like the v1 departures above — no migration is incurred. The English
(KJV/BSB) corpus carries no combining marks, so every existing anchor is byte-for-byte
unchanged (the golden and adversarial fixtures pass untouched).

1. **NFC at ingest** (`src/ingest/normalize.ts`, applied to each text run before
   `tokenize`). Sources arrive canonically decomposed (Greek polytonic, and Hebrew is
   *frequently* decomposed). NFC makes stored token text canonical, and makes the draw layer's
   cmap-advance measure (`the old app draw layer`) agree with the shaped glyph run: e.g. `ὶ`
   (U+1F76) sums to 651 font units precomposed but 656 decomposed (base + zero-advance mark),
   a per-vowel drift that accumulates *within* a word and shifts line breaks on the fixed page.

2. **Combining marks are part of a word** (rule 1, above). A combining mark is Unicode category
   `M`, which the old punct branch (`[^\s\p{L}\p{N}]+`) captured — splitting a decomposed
   accent or a Hebrew vowel point off its base into a spurious punct token. Since Hebrew points
   have **no** canonical precomposed form, NFC alone cannot rescue them; the tokenizer must bind
   `\p{M}` to the preceding base. A word therefore now *begins* alphanumeric but may *end* on a
   combining mark. Guarded by the adversarial `tokenize.test.ts` and `normalize.test.ts` cases.

Still out of scope (unchanged): Phase-3 original-language segmentation, outsourced to external
per-occurrence ids (ADR-0003).
The measure-vs-shape parity assertion belongs to the Skia runtime (jest/device) suite, not the
Skia-free ingest tests.

## Amendment v1.2: Hebrew and Greek use the v1.1 rules unchanged (2026-11-09, step 3)

WLC (Hebrew) and SBLGNT (Greek) ingest through the same `tokenize.ts`. No rule changed, so no English address moved. These tests in `tokenize.test.ts` pin the results with text from the pinned sources:

1. Maqaf (`־`, U+05BE), sof pasuq (`׃`, U+05C3) and paseq (`׀`, U+05C0) are punctuation. A maqaf compound is two words, even inside one OSHB `\w` (`זַרְעוֹ־ב֖וֹ`, GEN 1:11). So a word index is not an OSHB word number. ADR-0003 links original words by external id, never by index.
2. ~~The petuha and setuma letters (`פ`, `ס`) after a WLC verse are words. They come last in their verse, so no other word's index depends on them.~~ Wrong, replaced by v1.3.
3. SBLGNT marks elision with `ʼ` (U+02BC), which Unicode classes as a letter, so `κατʼ` is one word. An elision written with `’` (U+2019) splits off as punctuation under rule 3. The same elision tokenizes differently by character, so a source that switches characters is an address migration.
4. Ano teleia (`·`), the Greek question mark (U+037E, NFC `;`) and SBLGNT's critical signs (`⸀ ⸁ ⸂ ⸃ ⟦ ⟧`) are punctuation.

## Amendment v1.3: the Hebrew paragraph marks are punctuation (2026-11-09)

פ (petuha, an open paragraph break) and ס (setuma, a closed one) are scribal layout marks, not words. v1.2 kept them as words on the claim that they always end their verse. They don't: in the pinned WLC, 90 of the 3,161 marks sit mid-verse, in 88 verses (GEN 35:22 breaks after "and Israel heard it"). In those verses every later word index counted the mark.

- **Rule 6.** In verse text, a standalone unpointed `פ` or `ס`, with no letter or combining mark touching it, is a punctuation token. In headings it stays a word, because KJV's Psalm 119 stanza labels (`ס SAMECH`) use the same letters beside the other 20 letter names. `normalize.ts` passes `paragraphMarks` outside headings, and `tokenize.test.ts` pins both cases.
- **Migration.** Word indexes after a mid-verse mark drop by one in those 88 WLC verses, and the 3,071 end-of-verse marks lose their word index. No English or Greek address moves. No outside reference existed yet.

## Amendment v1.4: a lettered verse is a segment (2026-11-09)

Brenton numbers Septuagint text with no Hebrew counterpart as letters on the previous verse (`\v 35a` to `\v 35o` after 1 Kings 2:35). The ingest kept only the digits and restarted the word count at each letter, so 1,748 word addresses in 91 Brenton verses each named two or more words.

- **Rule 7.** A verse marker with a letter (`\v 35a`) sets the token's `segment`, and word indexes count from 0 within each segment. `1KI 2:35a!1/brenton` is the first word of 35a. Verses without letters have segment `''`, so no other edition's address changes.
- The corpus holds a unique index on edition, book, chapter, verse, segment and word index, so a collision stops the ingest.
