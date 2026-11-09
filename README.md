# bible-data-structure

A data model of the Bible (canons, versification schemes, editions, text units, original languages) and a pipeline that ingests real sources into it. It is the starting point for a range of Bible apps. Each app will get a compiled projection of this model instead of its own copy of the research.

Started 2026-11-09 from the research in [bible-codex](https://github.com/riolly/bible-codex) at commit `c2643a2`. Commands and rules are in [CLAUDE.md](CLAUDE.md), terms in [CONTEXT.md](CONTEXT.md).

## Plan

1. **Extract** the research from bible-codex. Done.
2. **Model the Bible itself.** Research each topic in [research/](research/README.md) from primary sources and fold the findings into CONTEXT.md, ADRs and the code. Versification and canons are researched and decided (ADR-0002, ADR-0006). Next is the code that implements them, in this order, test first:
   1. An address module: parse and format `PSA 51:3/org`, `REV 13:1a/kjv`, `GEN 1:1-31/kjv` and `MAT 2:1!3/kjv` (1-based word numbers in strings, 0-based in storage). Round-trip tests.
   2. Book and canon tables keyed by USFM code (`book`, `canon`, `canon_section`, `canon_entry`, `canon_entry_book`, `book_name`), with the Protestant canon and English names seeded from the USFM spec. Remove `book.slug`, `testament` and `position`, and `src/ingest/books.ts` slugs.
   3. A scheme registry seeded with `kjv` and the six Paratext schemes, with verse-count tables from the libpalaso `.vrs` files (MIT, pinned by commit). A test that KJV and BSB ingest under `kjv`.
   4. A full `.vrs` parser (segments, cross-book lines, `#!` lines) and mapping rows to a pivot, replacing `versification_map` and the bijection check. Replace `divergent.vrs` with the real cases listed in ADR-0006.
   5. TVTMS compiled to per-scheme mapping tables, pinned by URL and checksum, diffed against the `.vrs` mappings.
3. **Test against texts that disagree.** Import KJV, BSB, a Bible with deuterocanonical books, OSHB Hebrew, a Greek New Testament and, if licensable, the Septuagint. Make the trouble-spot fixtures in research/README.md pass.
4. **Design app projections.** Write the contract any Bible app needs (render a chapter, resolve "Ps 23", map a verse to another edition, anchor a user's mark, search), then compile the model into per-app packs and measure size and speed. Content changes become rebuilds. Only app user data needs migrations.

## Carried over from bible-codex

| Old item | Here | Verdict |
|---|---|---|
| Token stream with Block overlays (old ADR-0001, 0010) | ADR-0001 | Keep |
| Single fixed KJV versification as the hub (old ADR-0001) | ADR-0002 | Replaced: addresses name their scheme |
| `book` with English slug id, `testament`, fixed `position` | `src/db/corpus-schema.ts`, `src/model/books.ts`, `src/model/canon.ts` | Replaced: USFM codes, canon as data (ADR-0002) |
| Original Word hub, morpheme grain, external ids (old ADR-0007) | ADR-0003 | Keep, not built |
| Registered tokenizer policy (old ADR-0014) | ADR-0004 | Keep. Revisit verse bridges and non-English scripts |
| Edition stamp and quote witness (old ADR-0013) | ADR-0005 | Keep |
| Headings not addressable | ADR-0001 | Revisit in structure research |
| Textual variants (not modeled) | research/README.md | New topic |
| Ingest pipeline, tokenizer, `.vrs` parser, fixtures | `src/ingest/` | Keep, 54 tests pass |
| Corpus schema and reader | `src/db/` | Keep. `listBooks` became `canonBooks`, which reads order and names from the canon tables |
| Interlinear sourcing (old issue #2) | research/interlinear-corpus-sourcing.md | Keep, open |
| Licensing notes (an old agent memory) | research/README.md | Lost, needs redoing |
| User data, storage and sync design (old ADR-0006, 0009, 0011) | docs/prior-art/ | Input for step 4 |
| Literary edition (old ADR-0017), hub sourcing (old ADR-0021) | docs/prior-art/ | Input for structure and sourcing research |
| Reading modes, presets, library ring, ink, typography (old ADR-0002 to 0005, 0008, 0012, 0015, 0016, 0018 to 0020) | not carried | Drop: app-specific |

## Editions

Every pin update in `src/ingest/sources.ts` is a new edition (ADR-0005). Record it here.

| Edition | Pinned zip sha256 | Edition stamp | Pinned on | Note |
|---|---|---|---|---|
| KJV | `c7ba60db…621aaf` | `sha256:7ead3d28b2b34c9b` | 2026-11-09 | July pin no longer matched. No July stamp exists, so a text change can't be confirmed |
| BSB | `75ca91d5…f7fbc4` | `sha256:3b0004861fcf2481` | 2026-11-09 | Same as KJV |
