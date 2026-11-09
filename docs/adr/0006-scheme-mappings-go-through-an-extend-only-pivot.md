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

- TVTMS needs attribution and a note of changes in compiled outputs. STEPBible asks that the raw file not be re-posted, so the repo pins it by URL and checksum like the text sources, and doesn't commit it. Where the attribution lives in each output is open.
- `src/ingest/vrs.ts` must learn the full `.vrs` format: segments, cross-book lines and `#!` lines. Today it throws on most of these or drops them.
- `src/ingest/fixtures/divergent.vrs` shifts Revelation 13:1-17 by one verse, which no real source does. The real difference is a partial verse (NRSV 12:18 = KJV 13:1a). Replace it with real cases: 3 John 14-15, the two-verse title of Psalm 51 (many-to-one), Romans 14:24-26 (cross-chapter), and Daniel 3 to `S3Y` (cross-book).
- Verse mapping can't see a clause that moves between verses with the same numbers (the "stood on the sand" clause, which KJV and BSB place differently in Revelation 12:17 / 13:1). Only word alignment (ADR-0003) or the quote witness (ADR-0005) catches that.
- The pivot's id is `pivot` (decided 2026-11-09 while building it). Open: whether OSHB's numbering matches `org` (unverified).
