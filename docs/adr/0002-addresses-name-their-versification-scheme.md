# Addresses name their versification scheme, books are USFM codes, and a canon is data

Status: accepted 2026-11-09, address syntax and canon shape added the same day from `research/versification.md` and `research/canons.md`. Replaces the single fixed KJV versification of old bible-codex ADR-0001.

The first editions are Protestant (66 books, KJV numbering). Catholic, Orthodox and Septuagint Bibles are out of scope for content now, but the model must take them later without rewriting stored addresses. Three rules make that possible:

1. **A book's id is its USFM book code** (`GEN`, `PSA`, `JHN`, `TOB`, `1MA`). The code describes the content as the USFM spec defines it, not what a file's `\id` line says. English names and slugs are display data, never ids.
2. **Every verse address names its versification scheme.** `PSA 51:1` means different text under KJV and Masoretic numbering, so an address without a scheme is ambiguous. Each edition declares its native scheme. Moving an address between schemes goes through mapping data (ADR-0006).
3. **A canon is rows, not schema.** A canon is a named list of entries with its own order and sections. The old `book.testament` and `book.position` columns go away.

## Address syntax

The string form is a USFM Scripture Referencing Standard 1.0 reference, then `/`, then a scheme id:

```
PSA 51:3/org       the Hebrew verse that KJV numbers 51:1
PSA 51:0/eng       a Psalm title as verse 0
REV 13:1a/kjv      part of a verse (one-letter segment)
GEN 1:1-31/kjv     a range; the scheme applies to both ends
MAT 2:1!3/kjv      the third word of the verse
```

- The scheme goes in a suffix because the standard reserves the prefix slot for language and translation ids, where `eng` already reads as English. Paratext's `GEN 3:11/4` is precedent for the suffix.
- One string uses one scheme. A range or list never mixes schemes.
- Scheme ids are lowercase names from our own registry, seeded with `kjv` and the six Paratext names `org`, `eng`, `lxx`, `vul`, `rso`, `rsc`. KJV and BSB both declare `kjv`. Paratext `eng` is not KJV numbering: it has Revelation 12:18 and 3 John 15, and KJV has neither.
- **Word numbers in strings count from 1**, as the standard does. Stored word indexes count from 0 (ADR-0004). The parser and formatter convert, and a test covers it.

The storage form is separate columns, never a packed string or integer:

| Column | Type | Note |
|---|---|---|
| `scheme` | text | registry id |
| `book` | text | USFM code |
| `chapter` | integer | |
| `verse` | integer | 0 allowed for titles |
| `segment` | text | `''` for the whole verse, else one letter |

A generated `BBBCCCVVV` integer (Paratext book numbers) is allowed as a sort and range-query key, never as an id, and never with the scheme folded in.

## Canon shape

```
book              code PK, usfm_number
canon             id PK ('protestant', ...), tradition, source_url, note
canon_section     canon_id, section_id, parent_section_id NULL, ordinal, label_key
canon_entry       canon_id, entry_id, section_id, ordinal, status, label_key
canon_entry_book  canon_id, entry_id, ordinal, book_code
book_name         book_code, lang (BCP 47), canon_id NULL, long, short, abbr, source
```

- **Sections are a tree.** That covers the Tanakh's three groups, the Vulgate appendix and the Greek Bible's 4 Maccabees appendix.
- **Order lives on the entry**, so each tradition and each official list (the Catholic Catechism and the Nova Vulgata differ) has its own order.
- **An entry holds one or more book codes.** Tanakh "Samuel" is `1SA` plus `2SA`, and "The Twelve" is twelve codes. Traditions count entries, not codes (24 in the Tanakh, 81 in the Ethiopian list).
- **Status per entry** is `canonical`, `readable` or `appendix`. That holds the Orthodox *anagignoskomena* without a separate canon.
- **Book names live per language.** A row with `canon_id` NULL is the default, and a canon-specific row overrides it (Vulgate `EZR` is "1 Esdras", Orthodox `1KI` is "3 Kingdoms"). Parsing a human reference like "Esd 3:1" needs a canon and a language as input.
- **Ingest fixes mislabeled books with a per-source override** next to the pin in `src/ingest/sources.ts` (for example `codeOverrides: { EST: 'ESG' }` for ebible.org's Douay-Rheims), checked by a chapter count test.
- Only the `protestant` canon is filled in now.

## Considered options

- **One fixed numbering for every address (the old model).** Rejected. Adding the Septuagint or the Vulgate would change what existing addresses mean, so every stored address, including user data in apps, would need rewriting.
- **OSIS references with a work prefix (`KJV:Ps.51.3`).** Rejected. The prefix names a text, not a numbering.
- **A custom syntax (`org:PSA.51.3`).** Rejected. No other tool reads it.
- **0-based word numbers in strings.** Rejected. Other tools would read our strings one word off.
- **One book code per canon entry.** Rejected. The Tanakh and Ethiopian lists would change the shape later.

## Consequences

- Adding a tradition later means adding canon rows, a scheme and its mapping data. No stored address changes.
- A small fixture (one deuterocanonical chapter under a second scheme) must import with no model changes.
- The carried code still uses the old shape. `src/ingest/books.ts` maps USFM codes to English slugs used as ids, `book` has `testament` and `position`, and `versification_map` maps to the non-existent "av11n" canonical scheme. Replacing these is the first code change.
- Open: whether an edition that mixes traditions gets its own scheme id, which Catholic order becomes the default when a Catholic canon is added, and the Ethiopian narrow and broad lists (two canons or one with statuses). See the "What to decide next" sections of both research files.
