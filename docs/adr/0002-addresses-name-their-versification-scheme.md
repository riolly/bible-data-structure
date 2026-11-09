# Addresses name their versification scheme, books are USFM codes, and a canon is data

Status: accepted 2026-11-09. Replaces the single fixed KJV versification of old bible-codex ADR-0001.

The first editions are Protestant (66 books, KJV-style numbering). Catholic, Orthodox and Septuagint Bibles are out of scope for content now, but the model must take them later without rewriting stored addresses. Three rules make that possible:

1. **A book's id is its USFM book code** (`GEN`, `PSA`, `JHN`, `TOB`, `1MA`). The USFM list already includes the deuterocanonical and Orthodox books, so new books are new data. English names and slugs are display data, never ids.
2. **Every verse address names its versification scheme.** `PSA 51:1` means different text under KJV and Masoretic numbering, so an address without a scheme is ambiguous. Each edition declares its native scheme. Moving an address between schemes goes through mapping data between schemes, never through an assumed shared numbering. The exact address syntax is decided in the versification research (`research/`).
3. **A canon is a row, not schema.** A canon is a named, ordered list of book codes (Protestant 66 now; Catholic 73, Orthodox and Ethiopian lists later). The old `book.testament` enum and fixed `book.position` column go away. Testament, grouping and order become properties of a canon's list.

## Considered options

- **One fixed numbering for every address (the old model).** Rejected. Adding the Septuagint or the Vulgate would change what existing addresses mean, so every stored address, including user data in apps, would need rewriting.
- **Leave canon and scheme implicit until a second tradition arrives.** Rejected. That is the same migration, just later and with more data.
- **Ingest a deuterocanonical edition now.** Rejected for scope. A single test fixture (below) proves the model would take one.

## Consequences

- Adding a tradition later means adding a canon list, a versification scheme and its mapping data. No stored address changes.
- A small fixture (one deuterocanonical chapter under a second scheme) must import with no model changes. If it needs changes, the model is wrong while the fix is still cheap.
- The carried code still uses the old shape: `src/ingest/books.ts` maps USFM codes to English slugs used as anchor ids, `book` has `testament` and `position`, and `versification_map` maps to one canonical av11n scheme. Switching these is the first model change.
- Candidate mapping sources for the research: STEPBible TVTMS and the SWORD versification systems (KJV, KJVA, NRSVA, Vulg, LXX, Synodal and others). Both need a license check.
