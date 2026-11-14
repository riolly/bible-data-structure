# Text is a per-edition token stream with structure overlays, built from USFM

Status: accepted. Carried from old bible-codex ADR-0001 (text model) and ADR-0010 (ingest), commit `c2643a2`.

Each edition's text is stored as an ordered stream of **Tokens** (word and punctuation occurrences). Verse numbers and literary **Blocks** (prose paragraphs, poetry lines, headings) are overlays on that stream. A verse is an address that tokens carry, not a storage unit.

The stream is produced by a build-time pipeline. usfm-grammar parses USFM/USX into USJ (Unified Standard JSON), `src/ingest/normalize.ts` flattens USJ into Tokens and Blocks, and the result is written to SQLite. Consumers read the normalized output and never need a USFM parser.

## Considered options

- **Verse as the storage unit.** Rejected. A verse crosses paragraph and poetry-line boundaries, so a verse list loses the structure that `\p`, `\q#`, titles and Psalm headers encode.
- **Direct token-to-token alignment between translations.** Rejected. Word counts and word order differ, and one word can render as several. There is no stable 1:1 edge. Translations relate only through a shared verse address or a shared original word (ADR-0003).
- **A runtime scripture engine (Proskomma).** Rejected. It brings its own internal model, which would be a second source of truth beside ours.
- **Hand-rolled SFM parsing or usfm-js.** Rejected. usfm-grammar is a maintained tree-sitter grammar with USFM, USX and USJ conversion.

## Consequences

- Blocks partition the stream: every Token belongs to exactly one Block, and Blocks never overlap. Overlapping literary structure (chiasm, inclusio, parallelism) needs a separate layer.
- Whitespace is never a Token. Spacing belongs to whoever renders the text.
- Heading Tokens carry no verse (`verse = NULL`, not 0) and no word index. A heading never inherits the preceding verse. An explicit `\v` inside a heading paragraph (a versified `\d` Psalm title) keeps its verse. A Psalm title the scheme numbers as verse 0 is the exception below.
- The pipeline is plain TypeScript and is tested with golden fixtures (`src/ingest/fixtures/`). The fixtures assert the invariants above and the tokenizer rules in ADR-0004.
- Adding an edition means running the pipeline on its USFM. The parser and normalizer don't depend on the translation.
- Anything the normalizer doesn't model yet (footnotes, cross-references, `\w` attributes, words of Jesus) lands in an ingest stats bag instead of being silently dropped. Unknown structure throws.

## Amendment: a Psalm title is verse 0 where the scheme says so (2026-11-09)

ADR-0002 and the `kjv`, `bsb` and `web` schemes make `PSA 51:0/kjv` a valid address for the title, and mapping `PSA 51:1/org` lands there. Under the rule above the title's words had no verse, so the address found no text and no title word could be addressed.

- An unnumbered `\d` title before a chapter's first verse gets verse 0 and word indexes when the edition's scheme lists that chapter in `scheme_title`. `normalize.ts` takes the chapters as `titleChapters`, and `book-check.ts` reads them from the scheme.
- Other headings keep `verse = NULL`. So does a `\d` the scheme doesn't number, such as WEB's title of Psalm 151 (`PS2`), which no scheme gives a verse 0.
- Verse 0 prints no verse number, so its first word has no `verseStart`.

## Amendment: the stored truth is one USJ document per chapter (2026-11-10, plan step 7)

The token stream drops what a reader sees: footnotes, cross-references, character styles (`\add`, `\nd`, `\wj`), stanza breaks, published verse numbers and the spacing between words. A licensed provider returns chapter documents (plan step 10), and an app renders a chapter at a time. So the document becomes the truth, and the token stream is derived from it.

- An edition's stored truth is one USJ document per chapter, in `chapter_doc`: the nodes usfm-grammar gives from one `\c` up to the next, unchanged. Chapter 0 holds the front matter before `\c 1`. The document keeps the whitespace, character styles, notes with their parts, `\b`, and the published numbers `\cp`, `\va` and `\vp` (usfm-grammar writes these as `pubnumber` and `altnumber` on the chapter and verse nodes).
- `normalize.ts` derives tokens, blocks and verse text (`verse_text`) from the chapter documents, with the tokenizer of ADR-0004 unchanged. It reads nothing else, so a document read back from the corpus gives the same rows (`roundtrip.test.ts`). Note text was never tokens, so no word address moved, and every edition's words stamp stayed the same (README, Editions).
- A block keeps its USFM marker (`p`, `q2`, `pi2`, `li2`, `s2`, `d`) in `block.marker`, in place of the role vocabulary and `indent`. `genre` (prose, poetry or heading) is still derived from the marker.
- Verse text has one row per verse marker, keyed by verse and segment. It is the verse's surface text without notes, with each run of whitespace made one space and a space where the verse crosses a block. A verse whose marker is printed with no words has a row with empty text. A verse the edition skips has no row. Neither does an empty marker for a verse the edition's scheme lacks: its address would name a verse the scheme lacks, so the ingest warns and the marker stays only in the document. The same derivation drops it, so a document read back still gives the same rows. Real cases are in [research/source-markup.md](../../research/source-markup.md).
- WLC and SBLGNT arrive as XML. `oshb-xml.ts` and `sblgnt-xml.ts` convert them to USFM, and from there they take the same parse, so they are stored in the same form.
- `parse.ts` still rewrites a versified `\d` to `\qd` for the grammar, and now writes `d` back into the USJ, so the stored document has the source's marker. A source with the rewrite on that also has a real `\qd` stops the parse.

### Supported markers

The ingest stops on any marker or node type not listed here, at any depth. The list is what the seven pinned sources use, plus `\sc` ([research/source-markup.md](../../research/source-markup.md)). A marker joins the list when a source or a contract call needs it (ADR-0008). Numbered markers accept the bare form and levels 1 to 4 (`\s`, `\s1` to `\s4`).

| Kind | Markers | Derived rows |
|---|---|---|
| Book and numbers | `\id`, `\c`, `\cp`, `\v`, `\va`, `\vp` | `\v` sets the verse of later tokens |
| Heading blocks | `\mt#`, `\ms#`, `\s#`, `\is#`, `\d`, `\qa`, `\sp` | Blocks with genre `heading` |
| Prose blocks | `\p`, `\m`, `\nb`, `\mi`, `\pc`, `\pmo`, `\pi#`, `\li#`, `\ip` | Blocks with genre `prose` |
| Poetry blocks | `\q#`, `\qr` | Blocks with genre `poetry` |
| Paragraphs with no block | `\b` (stanza break), `\r`, `\mr` (reference lines), `\h`, `\toc1` to `\toc3`, `\ide`, `\cl` | None. The text stays in the document |
| Character styles | `\w`, `\add`, `\nd`, `\sc`, `\wj`, `\qs`, `\tl`, `\it`, `\bk` | Their text becomes tokens |
| Notes | `\f`, `\x` | None |
| Inside a note | `\fr`, `\ft`, `\fq`, `\fqa`, `\fl`, `\xo`, `\xt`, `\wh`, and the character styles | None |

usfm-grammar writes a nested style (`\+w`) with the plain marker, so it needs no row of its own. Milestones, figures, tables and sidebars are not supported.

The list has one home in code, `src/model/corpus.ts`: `UsjElement` is a union over these markers, and normalize.ts checks against the same lists. Only `normalizeChapters` makes a `ChapterDoc`, after its checks pass, so a renderer or a step 10 adapter that writes a marker outside the list fails to compile.

### Word attributes are dropped (2026-11-11, steps 5 to 9 review)

The sources' `\w` attributes (`strong=` in KJV, BSB and WEB, `x-morph=` in RP) are not stored. Nothing checks them, ADR-0003 found WEB's Strong's numbers shifted, and plan step 12 adds checked tags as their own data. `splitChapters` drops every character style's attributes and keeps its marker and text, so no word, words stamp or edition stamp changed.

### Verse text leaves out the pilcrow (2026-11-14, SDK review)

KJV prints a pilcrow (`¶`) where a paragraph starts: `\v 9 ¶ Now when Jesus was risen`. 2,970 of its 31,218 verse units began with one, always as the first character, and no other pinned edition has any ([research/source-markup.md](../../research/source-markup.md)). The contract tells a caller to store the verse text as its quote (ADR-0005), so the mark landed in every stored quote of those verses.

- Verse text leaves out every pilcrow. `normalizeChapters` removes it from each unit's finished text, before it collapses whitespace. A unit whose only text is a pilcrow is then a unit with no words. No pinned edition has one.
- The chapter document keeps the pilcrow, and so does the token stream, where it is a punctuation token with no word index. No word address moved, and every words stamp stayed the same.
- A chapter stamp covers the verse text (ADR-0005 amendment, 2026-11-11), so the stamps of the 790 KJV chapters that hold a pilcrow changed, and KJV's text stamp with them. No other edition's did (README, Editions).
- A fetched chapter goes through the same derivation, so a licensed edition that prints a pilcrow gets the same verse text.
- WLC's standalone `פ` and `ס` (ADR-0004 rule 6) are paragraph marks too, and stay in its verse text for now: 3,072 verse units end with one and 88 hold one inside. Leaving them out is an open question.
