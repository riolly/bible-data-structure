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
   2. Each source lists the books it must have, and may carry counted text fixes. WLC (OSHB's Hebrew, from upstream since ADR-0007) and SBLGNT ingest under `org`. ADR-0004 v1.2 records that Hebrew and Greek tokenize under the v1.1 rules unchanged. Done.
   3. Derived schemes (ADR-0002 amendment): `rp` for Robinson-Pierpont 2018, `web` for the World English Bible with deuterocanon, and `brenton` for Brenton's Greek Septuagint, and `bsb` for the BSB's order of Philippians 1:16-17 (ADR-0006 amendment, text tests). Done.
   4. Trouble-spot fixtures and `src/ingest/trouble-spots.test.ts`. Every spot but the Greek additions to Daniel and Esther passes. Done.

   Left open by this step: 100 verses in chapters a derived scheme changes map nowhere, Brenton's 97 and WEB's 3. TVTMS's text tests run per edition and don't decide them (ADR-0006 amendment, text tests). There is no Catholic or Orthodox canon yet, so the deuterocanonical books have no canon order.
4. **Design app projections.** Replaced on 2026-11-10 by steps 5 to 15, after a review of the model against licensed translations. The scope they assume is in [ADR-0008](docs/adr/0008-scope-and-support-levels.md).
5. **Record the scope and the support levels.** The scope and the Full and Reading levels are in [ADR-0008](docs/adr/0008-scope-and-support-levels.md). CONTEXT.md has the terms Full edition, Reading edition, rights record and provider, and CLAUDE.md the new product principle. Done.
6. **Make a clean checkout build.** Each text source is pinned by its edition stamp, not its zip hash (ADR-0005, step 6 amendment, CLAUDE.md and CONTEXT.md). A zip whose text gives the pinned stamp passes, and a changed stamp stops the download and is a new edition. The download falls back to our copy in the `sources` release on this repo. ebible's 2026-11-10 KJV zip gives the pinned stamp, so no edition is new. A clean checkout ran `ingest:download` and `ingest` to the end. Done.
7. **Store each chapter as a document, and derive tokens from it.** The stored truth is one USJ document per chapter (`chapter_doc`), with its whitespace, character styles, footnotes, cross-references, stanza breaks and published verse numbers (`\cp`, `\va`, `\vp`). A block keeps its USFM marker and level (`pi2`, `li2`, `s2`) in `block.marker`, in place of the role vocabulary. Tokens, blocks and verse text (`verse_text`) are derived from the documents by the same tokenizer. ADR-0001's step 7 amendment lists the supported markers, and the ingest stops on any other. Every edition's words stamp and edition stamp stayed the same. Done.
8. **Give a verse bridge its range.** ADR-0004 v1.5 replaces rule 6. A verse unit holds a first and a last verse (`verse_text.verse` and `last_verse`), every number in the range resolves to the unit (`readVerseUnit`), and word indexes count within the unit. The ingest stops unless each unit has one number or one unbroken range, rising within its chapter. The `\v 5-6` fixture resolves from both 5 and 6. WEB's 4 Maccabees 8:28-29 is the only pinned bridge with words, so only WEB's words stamp changed. No stored reference existed. Done.
9. **Write the app contract.** The interface, its result types and the display rule for each mapping result (`MapKind`) are in `src/contract/contract.ts`. `corpus-contract.ts` implements it over `build/corpus.db`, `rights.ts` holds the rights records, and `contract.test.ts` has the cases. The calls are `chapter`, `passage`, `verseText`, `map` and `rights`, then `resolve` (#11), `words` (step 11) and `credits` (step 13). Every address a result carries names its scheme (`JHN 3:16/kjv`), and apps store that form, because an edition's scheme can change. Human references go through `bible-passage-reference-parser`, English only. Done.
10. **Add the rights record and two providers.** The providers are a local pack and API.Bible. `src/provider/provider.ts` is one `BibleContract` over the local editions and the licensed ones, which it fetches a chapter at a time through `api-bible-cache.ts` and converts in `api-bible.ts`. The licensed editions are NASB 1995, NLT and NIV, the three a Starter key allows. Each has a scheme derived from `kjv` and checked against the counts in `src/provider/facts/` (ADR-0006, licensed editions amendment), a chapter stamp per fetched chapter (ADR-0005 amendment, 2026-11-11) and a rights record in `rights.ts` (research/licensing.md, research/api-bible.md). Licensed text is never committed. On 2026-11-13 `bun run api-bible:check` rendered NASB 1995 John 3 and Psalm 119, NLT Numbers 1 with its twelve bridges, and NIV John 3 through the contract. Done.
11. **Put Strong's numbers and glosses on the original words.** The contract's `words` call reads them from `original_word` (ADR-0003 amendment, word grain). Hebrew words come from the pinned OSHB with MACULA Hebrew's glosses, and Greek words from MACULA Greek's SBLGNT edition (license verdicts in research/licensing.md). The ingest stops when a verse's words differ between the sources, with one counted Greek exception (`JHN 8:5`). Of 306,785 Hebrew and 137,741 Greek words, two Greek words have no Strong's number because Strong's dictionary lacks them, and 150 Hebrew and 69 Greek read words have no gloss in MACULA. No stamp changed. Done.
12. **Put Strong's numbers on the English words of BSB and KJV.** The numbers are in `word_alignment` by word address (ADR-0003, step 12 and KJV amendments). The BSB's come from Clear Bible's manual alignments, on 721,761 of 726,744 words. The KJV's come from its own `strong=` tags that pass a test against the step 11 words: 343,055 of 349,308 tags, on 354,801 of its 790,676 words. Neither edition is Full yet. research/word-tags.md has the sources, the counts and what is missing. Done.
13. **Compile packs and measure.** The pack is what ships, and `corpus.db` never does (CONTEXT.md, `src/pack/pack.ts`). `bun run pack` builds the four packs below, measures them, and stops unless they read the same as `corpus.db`. Baseline from 2026-11-10 for KJV: token rows with the current indexes are 71.3 MB (22.0 MB gzipped), and one compressed document per chapter plus one text row per verse is 9.7 MB (3.6 MB gzipped). Measured on 2026-11-13 with Node 24 and better-sqlite3 on a laptop (Intel i7-9750H) whose cores were held at 800 MHz, about a fifth of their top speed, and not on a phone. Read times on a full-speed laptop would be lower:

    | Pack | Editions | Size | Gzipped | Chapter read, median and p95 |
    |---|---|---|---|---|
    | `WLC+SBLGNT.db` | WLC, SBLGNT | 65.7 MB | 21.2 MB | 3.1 ms, 4.3 ms |
    | `KJV.db` | KJV, WLC, SBLGNT | 74.5 MB | 25.7 MB | 3.7 ms, 5.1 ms |
    | `BSB.db` | BSB, WLC, SBLGNT | 114.6 MB | 33.0 MB | 4.4 ms, 6.7 ms |
    | `KJV+BSB.db` | KJV, BSB, WLC, SBLGNT | 123.4 MB | 37.6 MB | 3.7 ms, 5.4 ms |

    So the KJV adds about 9 MB to the hub and the BSB about 49 MB, 40 MB of it the `word_alignment` rows. The hub's 52.9 MB is `original_word`. Making `verse_text`, `original_word` and `word_alignment` WITHOUT ROWID took the BSB pack from 145.1 MB to 117.6 MB, and leaving out the schemes outside ADR-0008 (LXX, Vulgate, Brenton, RSO, RSC, WEB, RP) saved 3.1 MB more. A chapter read makes three queries (four for chapter 1), and each costs about 1 ms through drizzle, which builds the SQL on every call: the same verse query takes 0.05 ms as a prepared statement. Done.
14. **Anchor user marks to a verse.** The rules are in ADR-0005's step 14 amendment (2026-11-13), and apps build the storage. No edition is Full yet, so no app can make a word mark. Done.
15. **Decide what stays in the build.** The Brenton, WEB and Robinson-Pierpont tests stay while they pass. When a step above breaks one, delete it instead of fixing it.

Steps only a person can do:

- Upload the zip of every new edition to our copy of the pinned sources (step 6) with `gh release upload sources`. The download keeps each zip in `src/ingest/sources/mirror/`. The `sources` release holds the seven current editions.
- Ask API.Bible in writing whether converting its JSON content to our own chapter document for display counts as a change under section 4.1 of its terms. Until it answers, converted licensed chapters stay on this machine (step 10).
- Ask API.Bible in writing whether NASB and NLT may be stored whole on a device, and whether our server may cache chapters for our app.
- Ask the Lockman Foundation for terms on NASB files with Strong's numbers. That license moves NASB from Reading to Full.

## Carried over from bible-codex

| Old item | Here | Verdict |
|---|---|---|
| Token stream with Block overlays (old ADR-0001, 0010) | ADR-0001 | Keep |
| Single fixed KJV versification as the hub (old ADR-0001) | ADR-0002 | Replaced: addresses name their scheme |
| `book` with English slug id, `testament`, fixed `position` | `src/db/corpus-schema.ts`, `src/model/books.ts`, `src/model/canon.ts` | Replaced: USFM codes, canon as data (ADR-0002) |
| Original Word hub, morpheme grain, external ids (old ADR-0007) | ADR-0003 | Keep, built in step 11 |
| Registered tokenizer policy (old ADR-0014) | ADR-0004 | Keep. Verse bridges decided in v1.5. Scripts without spaces still open |
| Edition stamp and quote witness (old ADR-0013) | ADR-0005 | Keep |
| Headings not addressable | ADR-0001 | Revisit in structure research |
| Textual variants (not modeled) | research/README.md | New topic |
| Ingest pipeline, tokenizer, `.vrs` parser, fixtures | `src/ingest/` | Keep. The `.vrs` parser was rewritten for the full format (step 2.4), `divergent.vrs` replaced |
| Corpus schema and reader | `src/db/` | Keep. `listBooks` became `canonBooks`, which reads order and names from the canon tables |
| Interlinear sourcing (old issue #2) | research/licensing.md, research/word-tags.md | Answered in steps 11 and 12 |
| Licensing notes (an old agent memory) | research/licensing.md | Lost, redone in step 3 |
| User data, storage and sync design (old ADR-0006, 0009, 0011) | bible-codex at `c2643a2` | Was input for step 14 |
| Literary edition (old ADR-0017), hub sourcing (old ADR-0021) | bible-codex at `c2643a2` | Input for structure research |
| Reading modes, presets, library ring, ink, typography (old ADR-0002 to 0005, 0008, 0012, 0015, 0016, 0018 to 0020) | not carried | Drop: app-specific |

## Editions

Each text source is pinned by its edition stamp in `src/ingest/sources.ts` (ADR-0005, step 6 amendment). A changed stamp is a new edition. Record it here. The words stamp (ADR-0005 amendment) changes whenever stored words change, and the text stamp whenever a stored chapter document or verse text does, so record both after any ingest that changes one. Text stamps start on 2026-11-11, when the documents lost their word attributes. The zip sha256 is only the last one seen, since a rebuilt zip with the same text passes.

| Edition stamp | Edition | Words stamp | Text stamp | Pinned on | Last zip sha256 | Note |
|---|---|---|---|---|---|---|
| `sha256:7ead3d28b2b34c9b` | KJV | `sha256:13f8787f02884340` | `sha256:4ff63bca4edaaf12` | 2026-11-09 | `941ef56e…0b8133` (2026-11-10) | July pin no longer matched. No July stamp exists, so a text change can't be confirmed. ebible rebuilt the zip on 2026-11-10 (was `c7ba60db…621aaf`) with the same text |
| `sha256:3b0004861fcf2481` | BSB | `sha256:f5dbe0632c8c21ad` | `sha256:29fefc98e5fe0fd4` | 2026-11-09 | `75ca91d5…f7fbc4` | Same as KJV. Scheme `bsb` since the TVTMS text tests (ADR-0006 amendment) |
| `sha256:b15b041bc282f9b8` | WLC | `sha256:027a6cea9c1feb67` | `sha256:27e6552a84866eea` | 2026-11-10 | `f56c1507…177b4c7` | Upstream openscriptures/morphhb at `3d15126`, scheme `org`, with 1,260 qere readings (ADR-0007). Replaced ebible `hboWLC` (`464225e1…bd1df7`, stamps `sha256:a548fe69e09108f4` and `sha256:496bcbfec1bf8375`), which dropped the qere and leaked markup into 10 verses |
| `sha256:33876ae1d14e3756` | SBLGNT | `sha256:b029321cde54e6b7` | `sha256:7fc2c1e684076b27` | 2026-11-09 | `bcb9cfd8…3cbf56` | Upstream LogosBible/SBLGNT at `d7f35ad`, scheme `org`. Replaced ebible `grcsbl` (`04c5c536…b10a73`, stamp `sha256:89a22750abd8cdbe`), whose text was damaged (research/licensing.md) |
| `sha256:1defb25636d232d6` | RP | `sha256:f991602ae5d26c3f` | `sha256:f347b0eee40a72e4` | 2026-11-09 | `33b208ee…874048` | ebible `grcmt`, scheme `rp` |
| `sha256:5f722b4d8f3f4e8e` | WEB | `sha256:4e13d87b9f25701f` | `sha256:b447c8c3866316ea` | 2026-11-09 | `05b0440b…3589c8` | ebible `eng-web`, scheme `web`. Words stamp was `sha256:8fa638d577ba7d01` until ADR-0004 v1.5 gave the 4MA 8:28-29 bridge its range |
| `sha256:3db40d92c53c8d1d` | Brenton | `sha256:968ebb8e2132bf89` | `sha256:fecb8074dbce0768` | 2026-11-09 | `9de434f4…86e9a4` | ebible `grcbrent`, scheme `brenton` |
