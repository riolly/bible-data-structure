# bible-data-structure

A data model of the Bible (canons, versification schemes, editions, text units, original languages) and a pipeline that ingests real sources into it. It is the starting point for a range of Bible apps. Each app will get a compiled projection of this model instead of its own copy of the research.

Started 2026-11-09 from the research in [bible-codex](https://github.com/riolly/bible-codex) at commit `c2643a2`. Commands and rules are in [CLAUDE.md](CLAUDE.md), terms in [CONTEXT.md](CONTEXT.md).

## Plan

1. **Extract** the research from bible-codex. Done.
2. **Model the Bible itself.** Research each topic in [research/](research/README.md) from primary sources and fold the findings into CONTEXT.md, ADRs and the code. Versification and canons are researched and decided (ADR-0002, ADR-0006), and their code is built:
   1. Address module, `src/model/address.ts`: parses and formats `PSA 51:3/org`, `REV 13:1a/kjv`, `GEN 1:1-31/kjv` and `MAT 2:1!3/kjv`, with 1-based word numbers in strings and 0-based in storage. Done.
   2. Books keyed by USFM code and canons as rows (`book`, `canon`, `canon_section`, `canon_entry`, `canon_entry_book`, `book_name`), seeded with the USFM spec's 101 books, their English names and the protestant canon. `book.slug`, `testament`, `position` and `src/ingest/books.ts` are gone. Done.
   3. Scheme registry, `src/ingest/schemes.ts`: `kjv` plus the six Paratext schemes, with verse counts from libpalaso's `.vrs` files (MIT, copied from libpalaso commit `f1f70e9` and checked by sha256). KJV and BSB ingested under `kjv`, and ingest rejects verses a scheme lacks. Done. BSB later moved to `bsb` (step 3.3).
   4. Full `.vrs` parser and `scheme_mapping` rows to an extend-only `pivot` scheme, with a coverage check in place of the bijection check. `versification_map` and `divergent.vrs` are gone; `fixtures/real-cases.vrs` holds real lines for the ADR-0006 cases. Done.
   5. TVTMS compiled per scheme, pinned by URL and sha256 in `src/ingest/sources.ts`. TVTMS rows are stored where TVTMS decides from verse counts, `.vrs` rows elsewhere, and `build/mapping-diff.tsv` lists where they disagree. Done.

   Left open by this step, recorded in ADR-0006's amendments: the pivot home of the additions to Esther is undecided. TVTMS's text tests, also left open here, now run per edition (ADR-0006 amendment, text tests). Some libpalaso mapping lines name ESG verses missing from the same file's counts; `src/ingest/pivot.test.ts` reports them.
3. **Test against texts that disagree.** Import KJV, BSB, a Bible with deuterocanonical books, OSHB Hebrew, a Greek New Testament and, if licensable, the Septuagint. Make the trouble-spot fixtures in research/README.md pass.
   1. Licensing verdicts per source in [research/licensing.md](research/licensing.md). Every text below is public domain except SBLGNT (CC BY 4.0). Done.
   2. Each source lists the books it must have, and may carry counted text fixes. WLC (OSHB's Hebrew) and SBLGNT ingest under `org`. ADR-0004 v1.2 records that Hebrew and Greek tokenize under the v1.1 rules unchanged. Done.
   3. Derived schemes (ADR-0002 amendment): `rp` for Robinson-Pierpont 2018, `web` for the World English Bible with deuterocanon, and `brenton` for Brenton's Greek Septuagint, and `bsb` for the BSB's order of Philippians 1:16-17 (ADR-0006 amendment, text tests). Done.
   4. Trouble-spot fixtures and `src/ingest/trouble-spots.test.ts`. Every spot but the Greek additions to Daniel and Esther passes. Done.

   Left open by this step: 100 verses in chapters a derived scheme changes map nowhere, Brenton's 97 and WEB's 3. TVTMS's text tests run per edition and don't decide them (ADR-0006 amendment, text tests). There is no Catholic or Orthodox canon yet, so the deuterocanonical books have no canon order.
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
| Ingest pipeline, tokenizer, `.vrs` parser, fixtures | `src/ingest/` | Keep. The `.vrs` parser was rewritten for the full format (step 2.4), `divergent.vrs` replaced |
| Corpus schema and reader | `src/db/` | Keep. `listBooks` became `canonBooks`, which reads order and names from the canon tables |
| Interlinear sourcing (old issue #2) | research/interlinear-corpus-sourcing.md | Keep, open |
| Licensing notes (an old agent memory) | research/licensing.md | Lost, redone in step 3 |
| User data, storage and sync design (old ADR-0006, 0009, 0011) | docs/prior-art/ | Input for step 4 |
| Literary edition (old ADR-0017), hub sourcing (old ADR-0021) | docs/prior-art/ | Input for structure and sourcing research |
| Reading modes, presets, library ring, ink, typography (old ADR-0002 to 0005, 0008, 0012, 0015, 0016, 0018 to 0020) | not carried | Drop: app-specific |

## Editions

Every pin update in `src/ingest/sources.ts` is a new edition (ADR-0005). Record it here.

| Edition | Pinned zip sha256 | Edition stamp | Pinned on | Note |
|---|---|---|---|---|
| KJV | `c7ba60db…621aaf` | `sha256:7ead3d28b2b34c9b` | 2026-11-09 | July pin no longer matched. No July stamp exists, so a text change can't be confirmed |
| BSB | `75ca91d5…f7fbc4` | `sha256:3b0004861fcf2481` | 2026-11-09 | Same as KJV. Scheme `bsb` since the TVTMS text tests (ADR-0006 amendment) |
| WLC | `464225e1…bd1df7` | `sha256:a548fe69e09108f4` | 2026-11-09 | ebible `hboWLC`, scheme `org` |
| SBLGNT | `04c5c536…b10a73` | `sha256:89a22750abd8cdbe` | 2026-11-09 | ebible `grcsbl`, scheme `org`. Stamp is before the text fix |
| RP | `33b208ee…874048` | `sha256:1defb25636d232d6` | 2026-11-09 | ebible `grcmt`, scheme `rp` |
| WEB | `05b0440b…3589c8` | `sha256:5f722b4d8f3f4e8e` | 2026-11-09 | ebible `eng-web`, scheme `web` |
| Brenton | `9de434f4…86e9a4` | `sha256:3db40d92c53c8d1d` | 2026-11-09 | ebible `grcbrent`, scheme `brenton` |
