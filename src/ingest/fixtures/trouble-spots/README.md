# Trouble-spot fixtures

Whole chapters copied from the pinned sources in `src/ingest/sources.ts` on 2026-11-09, for `src/ingest/trouble-spots.test.ts`. Each file keeps the book's `\id`, `\h`, `\toc` and `\mt` lines and the listed chapters.

Two changes from the sources, so the fixtures stay small and carry no attribution-only data:

- The `\w` attributes (`strong`, `x-morph`) are removed. The `\w` markers stay. This drops OSHB's CC BY 4.0 morphology from the WLC files, leaving the public-domain WLC text.
- The SBLGNT files lose the ` ‘p /’ ‘/book’` or ` ‘/book’` that ebible.org leaves after a book's last verse (`textFixes` in sources.ts; `schemes.test.ts` checks the fixes against the full source).

| Directory | Source | Chapters | License |
|---|---|---|---|
| `kjv` | ebible `eng-kjv` | PSA 51, JOL 2-3, MAL 3-4, REV 12-13, 3JN 1, ROM 14 and 16, MRK 16, JHN 7-8, ACT 8 | Public domain |
| `kjva` | ebible `eng-kjv`, Apocrypha | TOB 1, declared under `eng` | Public domain |
| `wlc` | ebible `hboWLC` | PSA 51, JOL 2-4, MAL 3 | Public domain |
| `sblgnt` | ebible `grcsbl` | REV 12-13, 3JN 1, ROM 14 and 16, MRK 16, JHN 7-8, ACT 8 | SBL Greek New Testament, © 2010 Society of Biblical Literature and Logos Bible Software, CC BY 4.0. Excerpted and changed as above |
| `rp` | ebible `grcmt` | ROM 14 and 16 | Public domain |
| `web` | ebible `eng-web` | ROM 14 and 16, TOB 1 | Public domain |

Licensing verdicts: `research/licensing.md`.
