# bible-data-structure

A data model of the Bible (canons, versification schemes, editions, text units, original languages) and a pipeline that ingests real sources into it. It is the starting point for a range of Bible apps. Each app will get a compiled projection of this model instead of its own copy of the research.

Started 2026-11-09 from the research in [bible-codex](https://github.com/riolly/bible-codex) at commit `c2643a2`. Commands and rules are in [CLAUDE.md](CLAUDE.md), terms in [CONTEXT.md](CONTEXT.md).

## Plan

1. **Extract** the research from bible-codex. Done.
2. **Model the Bible itself.** Research each topic in [research/](research/README.md) from primary sources and fold the findings into CONTEXT.md, ADRs and the code. Versification and canons are decided in ADR-0002 and ADR-0006, and their code is built:
   1. The address module, `src/model/address.ts`. Done.
   2. Books keyed by USFM code and canons as rows, seeded with the USFM spec's 101 books, their English names and the protestant canon (`src/model/books.ts`, `src/model/canon.ts`). Done.
   3. The scheme registry, `src/ingest/schemes.ts`. Done.
   4. The full `.vrs` parser (`src/ingest/vrs.ts`) and mapping rows to an extend-only `pivot` scheme (`src/ingest/pivot.ts`). Done.
   5. TVTMS compiled per scheme (`src/ingest/tvtms.ts`). `build/mapping-diff.tsv` lists where it and the `.vrs` files disagree. Done.

   Left open by this step, recorded in ADR-0006's amendments: the pivot home of the additions to Esther is undecided. Some libpalaso mapping lines name ESG verses missing from the same file's counts; `src/ingest/pivot.test.ts` reports them.
3. **Test against texts that disagree.** Import KJV, BSB, a Bible with deuterocanonical books, OSHB Hebrew, a Greek New Testament and, if licensable, the Septuagint. Make the trouble-spot fixtures in research/README.md pass.
   1. Licensing verdicts per source in [research/licensing.md](research/licensing.md). Every text below is public domain except SBLGNT (CC BY 4.0). Done.
   2. Each source lists the books it must have, and may carry counted text fixes. WLC (OSHB's Hebrew, from upstream since ADR-0007) and SBLGNT ingest under `org`. ADR-0004 v1.2 records that Hebrew and Greek tokenize under the v1.1 rules unchanged. Done.
   3. Derived schemes (ADR-0002 amendment): `rp` for Robinson-Pierpont 2018, `web` for the World English Bible with deuterocanon, and `brenton` for Brenton's Greek Septuagint, and `bsb` for the BSB's order of Philippians 1:16-17 (ADR-0006 amendment, text tests). Done.
   4. Trouble-spot fixtures and `src/ingest/trouble-spots.test.ts`. Every spot but the Greek additions to Daniel and Esther passes. Done.

   Left open by this step: 100 verses in chapters a derived scheme changes map nowhere, Brenton's 97 and WEB's 3. TVTMS's text tests run per edition and don't decide them (ADR-0006 amendment, text tests). There is no Catholic or Orthodox canon yet, so the deuterocanonical books have no canon order.
4. **Design app projections.** Replaced on 2026-11-10 by steps 5 to 15, after a review of the model against licensed translations. The scope they assume is in [ADR-0008](docs/adr/0008-scope-and-support-levels.md).
5. **Record the scope and the support levels.** The scope and the Full and Reading levels are in [ADR-0008](docs/adr/0008-scope-and-support-levels.md). CONTEXT.md has the terms Full edition, Reading edition, rights record and provider, and CLAUDE.md the new product principle. Done.
6. **Make a clean checkout build.** Each text source is pinned by its edition stamp, not its zip hash, and the download falls back to our copy in the `sources` release on this repo (ADR-0005, step 6 amendment). A clean checkout ran `ingest:download` and `ingest` to the end. Done.
7. **Store each chapter as a document, and derive tokens from it.** The stored truth is one USJ document per chapter (`chapter_doc`). Tokens, blocks and verse text are derived from it, and the ingest stops on a marker outside the supported list (ADR-0001, step 7 amendment). Every edition's words stamp and edition stamp stayed the same. Done.
8. **Give a verse bridge its range.** A verse unit holds a first and a last verse, every number in the range resolves to the unit, and word indexes count within the unit (ADR-0004 v1.5). WEB's 4 Maccabees 8:28-29 is the only pinned bridge with words, so only WEB's words stamp changed. Done.
9. **Write the app contract.** The interface, its result types and the display rule for each mapping result (`MapKind`) are in `src/contract/contract.ts`, and CONTEXT.md lists the calls. `corpus-contract.ts` implements it over `build/corpus.db`, `rights.ts` holds the rights records, and `contract.test.ts` has the cases. Human references go through `bible-passage-reference-parser`, English only. Done.
10. **Add the rights record and two providers.** The providers are a local pack and API.Bible. `src/provider/provider.ts` is one `BibleContract` over the local editions and the licensed ones, which it fetches a chapter at a time through `api-bible-cache.ts` and converts in `api-bible.ts`. The licensed editions are NASB 1995, NLT and NIV, the three a Starter key allows. Each has a scheme derived from `kjv` and checked against the counts in `src/provider/facts/` (ADR-0006, licensed editions amendment), a chapter stamp per fetched chapter (ADR-0005 amendment, 2026-11-11) and a rights record in `rights.ts` (research/licensing.md, research/api-bible.md). Licensed text is never committed. On 2026-11-13 `bun run api-bible:check` rendered NASB 1995 John 3 and Psalm 119, NLT Numbers 1 with its twelve bridges, and NIV John 3 through the contract. Done.
11. **Put Strong's numbers and glosses on the original words.** The contract's `words` call reads them from `original_word` (ADR-0003 amendment, word grain). Hebrew words come from the pinned OSHB with MACULA Hebrew's glosses, and Greek words from MACULA Greek's SBLGNT edition (license verdicts in research/licensing.md). `contract.test.ts` asserts the word counts and how many words lack a number or a gloss. No stamp changed. Done.
12. **Put Strong's numbers on the English words of BSB and KJV.** The numbers are in `word_alignment` by word address (ADR-0003, step 12 and KJV amendments). The BSB's come from Clear Bible's manual alignments, and the KJV's from its own `strong=` tags that pass a test against the step 11 words. Neither edition is Full yet. research/word-tags.md has the sources, the counts and what is missing. Done.
13. **Compile packs and measure.** The pack is what ships, and `corpus.db` never does (CONTEXT.md, `src/pack/pack.ts`). `bun run pack` builds the four packs below, measures them, and stops unless they read the same as `corpus.db`. Baseline from 2026-11-10 for KJV: token rows with the current indexes are 71.3 MB (22.0 MB gzipped), and one compressed document per chapter plus one text row per verse is 9.7 MB (3.6 MB gzipped). Measured on 2026-11-14 with Node 24 and better-sqlite3 on a laptop (Intel i7-9750H) whose cores were held at 800 MHz, about a fifth of their top speed, and not on a phone. Read times on a full-speed laptop would be lower:

    | Pack | Editions | Size | Gzipped | Chapter read, median and p95 |
    |---|---|---|---|---|
    | `WLC+SBLGNT.db` | WLC, SBLGNT | 65.7 MB | 21.2 MB | 1.5 ms, 2.4 ms |
    | `KJV.db` | KJV, WLC, SBLGNT | 92.8 MB | 29.3 MB | 1.8 ms, 3.4 ms |
    | `BSB.db` | BSB, WLC, SBLGNT | 114.6 MB | 33.0 MB | 2.0 ms, 4.1 ms |
    | `KJV+BSB.db` | KJV, BSB, WLC, SBLGNT | 141.7 MB | 41.2 MB | 2.0 ms, 4.0 ms |

    So the KJV adds about 27 MB to the hub, 18 MB of it the `word_alignment` rows, and the BSB about 49 MB, 40 MB of it those rows. The hub's 52.9 MB is `original_word`. Making `verse_text`, `original_word` and `word_alignment` WITHOUT ROWID took the BSB pack from 145.1 MB to 117.6 MB, and leaving out the schemes outside ADR-0008 (LXX, Vulgate, Brenton, RSO, RSC, WEB, RP) saved 3.1 MB more. A chapter read makes three queries (four for chapter 1), each a drizzle prepared statement built once per DB (`prepared` in `src/db/corpus-read.ts`). When drizzle built the SQL on every call, the same reads took 3.2 to 3.6 ms at the median. Building the contract over the KJV+BSB pack takes about 77 ms and the first `map` about 47 ms, down from 165 ms and 128 ms when drizzle mapped every scheme and mapping row to an object. Done.
14. **Anchor user marks to a verse.** The rules are in ADR-0005's step 14 amendment (2026-11-13), and apps build the storage. No edition is Full yet, so no app can make a word mark. Done.
15. **Decide what stays in the build.** The Brenton, WEB and Robinson-Pierpont tests stay while they pass. When a step above breaks one, delete it instead of fixing it.

Steps only a person can do:

- Upload the zip of every new edition to our copy of the pinned sources (step 6) with `gh release upload sources`. The download keeps each zip in `src/ingest/sources/mirror/`. The `sources` release holds the seven current editions.
- Ask API.Bible in writing whether converting its JSON content to our own chapter document for display counts as a change under section 4.1 of its terms. Until it answers, converted licensed chapters stay on this machine (step 10).
- Ask API.Bible in writing whether NASB and NLT may be stored whole on a device, and whether our server may cache chapters for our app.
- Ask the Lockman Foundation for terms on NASB files with Strong's numbers. That license moves NASB from Reading to Full.

## Use from an app

`bun pm pack` builds the package and writes `bible-data-structure-0.0.1.tgz` (77 KB). It holds `dist/` only: the app entry (`src/index.ts`), the Node entry (`src/node.ts`) and their type declarations. An app keeps the file in its own repo and installs it with `bun add ./vendor/bible-data-structure-0.0.1.tgz`. That installs drizzle-orm, fflate and the reference parser, with no native build. The app brings a sync drizzle SQLite driver. The contract ran unchanged on better-sqlite3, `node:sqlite`, `bun:sqlite` and sql.js on 2026-11-14.

```ts
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { ContractError, packContract, schema } from 'bible-data-structure';

const db = drizzle({ client: new DatabaseSync('KJV+BSB.db', { readOnly: true }), schema });
const bible = packContract(db);

const editions = await bible.editions();            // KJV, BSB, WLC, SBLGNT
const books = await bible.books('KJV');             // 66 books in canon order, each with its chapter count
const chapter = await bible.chapter('KJV', 'JHN', 3);
const hebrew = await bible.map('KJV', 'PSA 51:1', 'WLC');
```

For licensed editions, wrap the pack in a provider with the app's own fetch: `provider({ local: packReader(db), fetchChapter })`. On a Node server, `chapterFetcher` from `bible-data-structure/node` is that fetch, through the kept responses. A call that can't answer rejects with a `ContractError`, and its `code` says whether the address was bad, the edition unknown or a fetch failed (`src/contract/contract.ts`).

What the app's `tsconfig.json` needs, checked from a scratch app on 2026-11-14:

- `moduleResolution: "Bundler"`. Under `NodeNext` the declarations and the app resolve two copies of drizzle's types, and `packContract(db)` fails to compile.
- `skipLibCheck: true`. drizzle-orm `1.0.0-rc.4` fails its own declaration check without it.
- `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` all pass.

A git dependency doesn't work: bun installs none of a git dependency's dev dependencies, so the build can't run on install.

## Carried over from bible-codex

Each ADR's status line names the old ADR it carries or replaces. What is left:

| Old item | Here | Verdict |
|---|---|---|
| Headings not addressable | ADR-0001 | Revisit in structure research |
| User data, storage and sync design (old ADR-0006, 0009, 0011) | bible-codex at `c2643a2` | Was input for step 14 |
| Literary edition (old ADR-0017), hub sourcing (old ADR-0021) | bible-codex at `c2643a2` | Input for structure research |
| Reading modes, presets, library ring, ink, typography (old ADR-0002 to 0005, 0008, 0012, 0015, 0016, 0018 to 0020) | not carried | Drop: app-specific |

## Editions

Each text source is pinned by its edition stamp in `src/ingest/sources.ts`. A changed stamp is a new edition. Record it here, and record the words stamp and text stamp after any ingest that changes one (ADR-0005 and its amendments define all three). Text stamps start on 2026-11-11, when the documents lost their word attributes. The zip sha256 is only the last one seen, since a rebuilt zip with the same text passes.

| Edition stamp | Edition | Words stamp | Text stamp | Pinned on | Last zip sha256 | Note |
|---|---|---|---|---|---|---|
| `sha256:7ead3d28b2b34c9b` | KJV | `sha256:13f8787f02884340` | `sha256:08d16804136e6f45` | 2026-11-09 | `941ef56e…0b8133` (2026-11-10) | July pin no longer matched. No July stamp exists, so a text change can't be confirmed. ebible rebuilt the zip on 2026-11-10 (was `c7ba60db…621aaf`) with the same text. Text stamp was `sha256:4ff63bca4edaaf12` until verse text left out the pilcrow on 2026-11-14 (ADR-0001 amendment) |
| `sha256:3b0004861fcf2481` | BSB | `sha256:f5dbe0632c8c21ad` | `sha256:29fefc98e5fe0fd4` | 2026-11-09 | `75ca91d5…f7fbc4` | Same as KJV. Scheme `bsb` since the TVTMS text tests (ADR-0006 amendment) |
| `sha256:b15b041bc282f9b8` | WLC | `sha256:027a6cea9c1feb67` | `sha256:27e6552a84866eea` | 2026-11-10 | `f56c1507…177b4c7` | Upstream openscriptures/morphhb at `3d15126`, scheme `org`, with 1,260 qere readings (ADR-0007). Replaced ebible `hboWLC` (`464225e1…bd1df7`, stamps `sha256:a548fe69e09108f4` and `sha256:496bcbfec1bf8375`), which dropped the qere and leaked markup into 10 verses |
| `sha256:33876ae1d14e3756` | SBLGNT | `sha256:b029321cde54e6b7` | `sha256:7fc2c1e684076b27` | 2026-11-09 | `bcb9cfd8…3cbf56` | Upstream LogosBible/SBLGNT at `d7f35ad`, scheme `org`. Replaced ebible `grcsbl` (`04c5c536…b10a73`, stamp `sha256:89a22750abd8cdbe`), whose text was damaged (research/licensing.md) |
| `sha256:1defb25636d232d6` | RP | `sha256:f991602ae5d26c3f` | `sha256:f347b0eee40a72e4` | 2026-11-09 | `33b208ee…874048` | ebible `grcmt`, scheme `rp` |
| `sha256:5f722b4d8f3f4e8e` | WEB | `sha256:4e13d87b9f25701f` | `sha256:b447c8c3866316ea` | 2026-11-09 | `05b0440b…3589c8` | ebible `eng-web`, scheme `web`. Words stamp was `sha256:8fa638d577ba7d01` until ADR-0004 v1.5 gave the 4MA 8:28-29 bridge its range |
| `sha256:3db40d92c53c8d1d` | Brenton | `sha256:968ebb8e2132bf89` | `sha256:fecb8074dbce0768` | 2026-11-09 | `9de434f4…86e9a4` | ebible `grcbrent`, scheme `brenton` |
