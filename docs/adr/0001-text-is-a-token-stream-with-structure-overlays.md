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

- An unnumbered `\d` title before a chapter's first verse gets verse 0 and word indexes when the edition's scheme lists that chapter in `scheme_title`. `normalize.ts` takes the chapters as `titleChapters`, and `run.ts` reads them from the scheme.
- Other headings keep `verse = NULL`. So does a `\d` the scheme doesn't number, such as WEB's title of Psalm 151 (`PS2`), which no scheme gives a verse 0.
- Verse 0 prints no verse number, so its first word has no `verseStart`.
