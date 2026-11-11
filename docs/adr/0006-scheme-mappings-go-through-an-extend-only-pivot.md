# Scheme mappings compile from TVTMS through an extend-only pivot

Status: accepted 2026-11-09, from `research/versification.md`.

Moving an address from one versification scheme to another needs mapping data. Real mappings include partial verses, verses that move to another book, verses absent in one scheme, and many-to-one merges. The carried code's sparse one-to-one map to one canonical scheme can't express any of these. The decisions:

1. **Every mapping goes through a synthetic pivot scheme**, never through a real scheme like `kjv` or `org`. SWORD's 2026 draft found that mapping through KJV loses information, and Paratext's `org` already works as a pivot. The pivot is seeded from TVTMS's Standard numbering (KJV numbers plus subverses, titles as verse 0, and the extra books).
2. **The pivot only grows.** An id is never removed, a verse count never decreases, and a meaning is never reassigned (SWORD's invariants). A test enforces this against the previous build. Stored addresses never use the pivot. Only mapping rows do.
3. **STEPBible TVTMS is the primary mapping data** (CC BY 4.0), compiled at build time into one sparse table per scheme. Its `=Last` and `=Exist` tests run against a scheme's verse-count table. Its word-count tests need text, so they run per edition at ingest.
4. **Paratext `.vrs` files define the schemes and act as the second witness** (MIT). Their verse-count lines define each scheme. Their mapping lines are diffed against compiled TVTMS, and disagreements are reported, never resolved silently.
5. **SWORD and JSword are a third witness, used locally only.** They are GPL-2.0 and LGPL-2.1, so they never ship in output.
6. **Mapping rows** are `(scheme, book, chapter, verse, segment) → (pivot book, chapter, verse, segment)`. Many-to-many, cross-book and explicit `absent` rows are allowed, with a `kind` taken from the TVTMS action. The old bijection check goes. Its replacement checks that every verse in the scheme's count table maps somewhere or is marked absent.

## Considered options

- **Map through `kjv` (the old model) or `org`.** Rejected. A real scheme can't hold verses it doesn't have, so mapping loses them.
- **Paratext `.vrs` only.** Rejected as the primary source. It has six schemes, fewer traditions than TVTMS, and some lossy lines. It is still the cheapest way to define a scheme.
- **SWORD data.** Rejected for output because of GPL-2.0.

## Consequences

- TVTMS needs attribution and a note of changes in compiled outputs. STEPBible asks that the raw file not be re-posted, so the repo pins it by URL and checksum like the text sources, and doesn't commit it. Built in step 2: the corpus DB's `data_source` table holds the attribution and note of changes for each mapping source.
- `src/ingest/vrs.ts` must learn the full `.vrs` format: segments, cross-book lines and `#!` lines. Done in step 2 (2026-11-09).
- `src/ingest/fixtures/divergent.vrs` shifts Revelation 13:1-17 by one verse, which no real source does. The real difference is a partial verse (NRSV 12:18 = KJV 13:1a). Replace it with real cases: 3 John 14-15, the two-verse title of Psalm 51 (many-to-one), Romans 14:24-26 (cross-chapter), and Daniel 3 to `S3Y` (cross-book). Done in step 2: `src/ingest/fixtures/real-cases.vrs`.
- Verse mapping can't see a clause that moves between verses with the same numbers (the "stood on the sand" clause, which KJV and BSB place differently in Revelation 12:17 / 13:1). Only word alignment (ADR-0003) or the quote witness (ADR-0005) catches that.
- Open: whether OSHB's numbering matches `org` (unverified).

## Amendments from building it (2026-11-09)

- **The pivot's id is `pivot`.**
- **Pivot segments may be TVTMS subverse ids** (`2ES 7:35!aa`). They appear only in mapping rows, never in stored addresses, which keep one-letter segments (ADR-0002). TVTMS subverse `!0` is the verse's ordinary text and is stored as the whole verse.
- **The pivot holds only ids with a USFM home.** For the 66 protestant books it is KJV numbering exactly, so Standard references past KJV's extent are skipped: Esther 10:4-16:24 (the Greek additions in KJV-Apocrypha layout) and one stray `1Ki.5:32`. Where the additions to Esther go, and whether Baruch 6 or `LJE`, and Daniel 3:24-90 or `S3Y`, is the pivot home for shared text, stays open with research/canons.md ("What to decide next", item 5).
- **`.vrs` rows fill in where TVTMS can't decide.** TVTMS is primary wherever its `=Exist`, `=NotExist` and `=Last` tests settle a verse against the scheme's verse counts. Most TVTMS rows also test word counts, so for the other verses the `.vrs` row is stored, tagged `source = 'vrs'`. Since the amendment below, the word-count and `TextBeforeV1` tests run per edition, and `.vrs` rows fill in only where those can't decide either.
- **The `.vrs` witness reaches the pivot through TVTMS's `eng` rows.** `.vrs` lines map to `org`; they reach the pivot through `eng.vrs` read backwards and then TVTMS's `eng` rows, so a pivot id means the same thing in both witnesses. The diff therefore can't catch an error in TVTMS's `eng` rows themselves.

## Amendment: text tests per edition (2026-11-09)

Findings in [research/tvtms-text-tests.md](../../research/tvtms-text-tests.md).

- **The text tests run against each edition at ingest.** A verse's word count is its number of `word` tokens. `TextBeforeV1` holds when a `\d` block (a Psalm title) comes before verse 1. A test on a book the edition lacks leaves the row undecided.
- **A word test decides only when its two sides differ by at least 20% of the larger.** A closer result leaves the row undecided. TVTMS gives no tolerance, and its Philippians 1:16-17 test reads KJV (15 against 16 words) and WEB (16 against 18) as following the Greek verse order, which they don't.
- **A scheme takes a text-dependent row only when every edition under it that has the row's books gives the same result.** Mapping rows stay per scheme, so a scheme address names one text slot.
- **The ingest stops when an edition's own results would map a verse differently from its scheme's rows.** Such an edition needs a derived scheme (ADR-0002). BSB follows the critical order of Philippians 1:16-17, which KJV doesn't, so BSB moved from `kjv` to `bsb`. That changed the scheme of every BSB address; nothing outside this repo stored one yet.
- **The tested verses' word counts and titled Psalms are committed as `src/ingest/fixtures/edition-text.json`**, so tests compile the same mappings without a built corpus. The ingest writes `build/edition-text.json` and warns when it differs from the fixture. They are counts, not text.

Rejected: mapping rows per edition, which would let one scheme address map two ways. Rejected: rejecting an edition whose results conflict, which would have dropped BSB.

### Same-number swaps stay versification; the margin is registered policy (2026-11-09)

A review asked whether Philippians 1:16-17 belongs in schemes at all, since KJV and BSB both number the verses 16 and 17 and only the content differs, like the "stood on the sand" clause. Decided: it stays.

- **A whole-verse swap is versification.** A scheme maps numbers to text, and `PHP 1:16` names different text in KJV ("contention") and BSB ("love"). The Revelation clause differs: it moves part of a verse, which verse mapping can't express at any grain. TVTMS rows 27455-27456 map the swap, and mark it `Opt.`, a note "not needed if Versification is used because each verse retains its own number code and aligns using Mappings" (TVTMS line 4161). That is this model: `PHP 1:16/bsb` keeps its number, and the mapping pairs it with `PHP 1:17/kjv`. A parallel view shows each edition's own number beside the same content. Mapping by number alone would put "love" beside "contention", and SBLGNT under `org` has the same order as BSB.
- **The 20% margin (`WORD_TEST_MARGIN`) is registered policy, like the tokenizer rules (ADR-0004).** Changing it can change which rows a scheme takes and which editions conflict. A change needs an amendment here, and `build/mapping-diff.tsv` and the conflicts compared before and after. `tvtms.test.ts` pins the value.
- **An ingested edition keeps its scheme.** When a new edition's text conflicts with its scheme's rows, the ingest stops (`stops BSB from sharing the kjv scheme`), and the new edition gets a derived scheme. Adding an edition never moves an existing edition's addresses. The ingest can't tell which edition is new, so `schemes.test.ts` pins each source's scheme: moving an ingested edition fails that test, and a new edition needs a new entry.

## Proposed amendment: a Psalm title inside verse 1 (2026-11-11, issue #12)

Status: proposed, not built. Findings in [research/psalm-titles-in-hebrew-verse-1.md](../../research/psalm-titles-in-hebrew-verse-1.md).

For 53 Psalms, English numbers a short title as verse 0 and Hebrew prints the same words at the start of verse 1. TVTMS's expanded rows give no relation, so the pivot title has no `org` counterpart and `map` reports it absent.

- **The compiler reads one pattern from TVTMS's short tables.** Where a scheme's column says `Absent [=Psa.N:1]` for `Psa.N:Title`, and the scheme keeps verse 1 as the Standard's verse 1, it adds `PSA N:1a → pivot PSA N:0` and `PSA N:1b → pivot PSA N:1`. These are TVTMS rows with their own `kind`, so `build/mapping-diff.tsv` lists them.
- The notes column (`Hebrew=23:1a`) says the same for 52 Psalms and is wrong for Psalm 37, so it is not read.
- The pivot doesn't change. `org` gains about 106 rows. `map` gives `part` for the title and for English verse 1, and `several` for Hebrew verse 1.
