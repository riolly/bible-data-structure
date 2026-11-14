# Research

One file per topic, written from primary sources with links. A finding that changes the model becomes an ADR or a CONTEXT.md edit. A finding that a test can check becomes a fixture.

## Topics

| Topic | File | Status | Questions to answer |
|---|---|---|---|
| Canons and book identity | `canons.md` | done 2026-11-09 | Book lists and orders per tradition. Is the USFM code list complete for Ethiopian books? Books that differ between traditions (Esther, Daniel, Psalm 151). |
| Versification schemes | `versification.md` | done 2026-11-09 | Which schemes exist. How TVTMS and SWORD map between them, and their licenses. Splits, merges and absent verses. The address syntax. |
| Editions and revisions | `editions.md` | no file needed: ADR-0005 and its amendments decide it (edition stamp, words stamp, text stamp) | How publishers revise texts (BSB revision notes, ebible.org republishing). How to tell a text change from repackaging. |
| Textual variants | `variants.md` | closed by ADR-0008, out of scope. A verse an edition leaves out reads as absent (`source-markup.md`, CONTEXT.md) | The 2026-11-09 BSB ingest has no text for Matthew 17:21, 18:11, 23:14, Mark 7:16, 9:44, 9:46, 11:26, 15:28, Luke 17:36, 23:17, John 5:4, Acts 8:37, 15:34, 24:7, 28:29 and Romans 16:24 (see `bun run ingest` warnings). Also Mark 16:9-20, John 7:53-8:11, Romans 16:25-27. How critical texts and translations mark them. Present, absent, bracketed or moved. |
| Hebrew written and read forms | `hebrew-ketiv-qere.md` | decided 2026-11-10, ADR-0007 | ebible's WLC keeps only the ketiv. Move to upstream OSHB? How to store a qere without moving word indexes? |
| Lexicons and morphology | `lexicons.md` | Strong's numbers, glosses and morphology codes are in `word-tags.md` and plan step 11. The dictionaries wait for an app feature (ADR-0008 amendment) | Strong's, BDB, Thayer, Louw-Nida. Morphology code systems per source. Licenses. |
| Structure | `structure.md` | waits for the contract call that needs the outline (ADR-0008, in scope item 5) | Paragraphing and section headings across editions. Pericope systems. Literary units that cross chapters. |
| Markup in the pinned sources | `source-markup.md` | noted 2026-11-10 | Which USFM markers the sources use. Verse markers with no words, and verses with no marker. |
| Notes and cross-references | `apparatus.md` | footnotes are in the chapter document (ADR-0001). Cross-references wait for the contract call that needs them (ADR-0008, in scope item 5) | USFM footnotes (`\f`), cross-references (`\x`), the Treasury of Scripture Knowledge, OpenBible.info. |
| Tokenization beyond English | `tokenization.md` | closed by ADR-0008, other languages are out of scope | Rules for scripts without spaces between words. |
| API.Bible | `api-bible.md` | noted 2026-11-12 | Which Bibles the key reaches. The chapter JSON and how it maps to our chapter document. |
| Licensing | `licensing.md` | covers every source in use, updated 2026-11-13 | Per source, whether it can be redistributed in an app, its attribution, and whether raw files may be committed. |
| Psalm titles inside Hebrew verse 1 | `psalm-titles-in-hebrew-verse-1.md` | done 2026-11-13, issue #12 | Where TVTMS records the 53 Psalms whose English title is part of Hebrew verse 1. |
| Strong's numbers on English words | `word-tags.md` | noted 2026-11-13 for plan step 12 | Which source tags BSB and KJV words, how well each joins to our text, and what the KJV's own tags miss. |

## Trouble-spot fixtures

The model is done when these import and round-trip with no special cases:

- Psalm titles (Masoretic counts the title as verse 1)
- Joel 2/3 and Malachi 3/4 (chapter boundaries differ)
- Revelation 12:18 and 3 John 14-15 (verse boundaries differ)
- Romans 16:25-27 (placed at different points in different texts)
- Mark 16:9-20, John 7:53-8:11, Acts 8:37 (present, absent or bracketed)
- One deuterocanonical chapter under a second scheme (ADR-0002 migration check)
- The Greek additions to Daniel and Esther (out of scope, ADR-0008 amendment)

All but the last pass in `src/ingest/trouble-spots.test.ts` (2026-11-09), from excerpts in `src/ingest/fixtures/trouble-spots/`. The Greek Esther and Daniel of WEB and Brenton import as `ESG` and `DAG`, but nothing checks their additions yet.

Already covered by the carried fixtures: tokenizer edge cases (`src/ingest/fixtures/adversarial.usfm`) and real `.vrs` mapping lines for the ADR-0006 cases (`src/ingest/fixtures/real-cases.vrs`).
