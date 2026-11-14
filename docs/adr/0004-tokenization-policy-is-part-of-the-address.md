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

- ~~Rule 6 (a verse bridge collapses to its first number) loses information. Surfacing verse ranges needs re-ingest and is an address migration. Decide before any external reference exists.~~ Decided by v1.5.
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

## Amendment v1.5: a verse bridge is one unit with a range (2026-11-10, plan step 8)

Rule 6 collapsed `\v 17-18` to 17, so 18 named nothing. NLT prints Numbers 1:20-21 as one unit, and an app asked for Numbers 1:21 must find it. This amendment replaces rule 6 of the v1 policy, the verse bridge rule. It is the address migration that rule said a range would need. The paragraph-mark rule that v1.3 also numbered 6 is unchanged, and so is `tokenize.ts`.

- **Rule 6, replaced.** A verse marker with a range makes one verse unit with a first and a last verse. Every number from the first to the last resolves to the unit: `NUM 1:21/nlt` finds the unit 20-21. The unit's tokens carry the first number in `token.verse`, and word indexes count from 0 across the whole unit, so `NUM 1:20!3/nlt` and `NUM 1:21!3/nlt` name the same word. `verse_text.last_verse` holds the last verse, equal to `verse` for a single verse, and `verseUnitOf` in `src/model/corpus.ts` resolves a number to its unit.
- **Rule 6a, the unit check.** A unit has one number or one unbroken range: the last verse is above the first, and neither end has a segment letter. Within a chapter the units rise in source order. A unit's first verse is above the previous unit's last verse, or the same single verse with a later segment letter (Brenton's `35`, `35a`). `normalize.ts` stops the ingest otherwise. All seven pinned editions pass.
- **Every number must be in the scheme.** The ingest checks each number of a range against the edition's scheme, not just the first.
- **Words stamp.** A word in a bridge hashes its address with the range (`4MA 8:28-29!3`), so the stamp changes when what a number resolves to changes. Other words hash as before. WEB is the only pinned edition with bridges. Five of its six bridges hold only a footnote (Sirach), and one holds words (4 Maccabees 8:28-29). So WEB's words stamp changed from `sha256:8fa638d577ba7d01` to `sha256:4e13d87b9f25701f`, and the other six stayed the same.
- **Migration.** No word moved: each word keeps its first-verse address and index. The later numbers of a bridge gain an address. No outside reference existed yet, so nothing needs migrating.

## Amendment: a unit's words are its verse text's words (2026-11-13, plan step 13)

A pack ships no token rows (`src/pack/pack.ts`), so it reads a word address from the verse text. `verseWords` in `tokenize.ts` tokenizes a unit's `verse_text.text` as verse text (rule 6 on) and keeps the words. The ingest stops unless that list equals the unit's word tokens, in order. All seven pinned editions passed on 2026-11-13. The `words` call reads a translation's words this way from the corpus DB too, so both read the same words. Verse text joins a unit's text runs with a space, and no token spans a space, so tokenizing the joined text gives the same words as tokenizing each run. Since 2026-11-14 verse text leaves out the paragraph marks of rule 6 and KJV's pilcrow (ADR-0001 amendment). They were never words, so the list is the same, and the ingest still stops unless it equals the unit's word tokens.

## Amendment v1.6: Hebrew text keeps the source's code point order (2026-11-14)

Rule 1 of v1.1 applied NFC to every text run. NFC reorders combining marks by their canonical combining class, which for Hebrew points is not the reading order. The pinned OSHB's README (section "Hebrew Normalization") says to avoid NFC, and the source has no U+034F (combining grapheme joiner) to protect the order: 0 occurrences.

- **The rule.** Text in the Hebrew script, U+0590 to U+05FF and the presentation forms U+FB1D to U+FB4F, is stored as the source wrote it, in every edition. All other text stays NFC, which Greek needs. `storedText` in `src/ingest/text-form.ts` applies it, and every place the ingest and the providers normalize text calls it.
- **The numbers.** The pinned OSHB has 306,785 `<w>` elements. With `/` removed, NFC changes the code point order of 143,471 of them. In 641 it swaps two vowel points on one consonant: 637 spellings of Jerusalem, where the lamed carries a patah or qamats and then a hiriq (`JOS 10:1!6`, U+05B7 U+05B4 became U+05B4 U+05B7), and 4 other words (`DEU 3:22`, `2KI 21:26`, `ISA 49:23`, `LAM 3:25`). So NFC stored a vowel order the source does not have.
- **What changed.** Only the text of WLC's words, verse text, readings and original words. 142,820 WLC word tokens changed text. No token's address, index or kind moved in any edition, and the chapter documents were already the source's text. WLC's words stamp changed from `sha256:027a6cea9c1feb67` to `sha256:417bc29c00456aea`, and its text stamp from `sha256:71b1b46617a0053a` to `sha256:3c1de7a7e03ca66a`. Its edition stamp and every other edition's stamps stayed the same.
- **Comparing.** Matching words across sources (MACULA, the KJV tags, Clear's alignments) compares letters under NFD, so it is unchanged. An app that compares Hebrew text with another source normalizes both sides the same way for that comparison only.
