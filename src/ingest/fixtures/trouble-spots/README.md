# Trouble-spot fixtures

Whole chapters copied from the pinned sources in `src/ingest/sources.ts` on 2026-11-09 (WLC on 2026-11-10), for `src/ingest/trouble-spots.test.ts`. Each file keeps the book's `\id`, `\h`, `\toc` and `\mt` lines, where the source has them, and the listed chapters.

Two changes from the sources, so the fixtures stay small and carry no attribution-only data, and match what the ingest reads:

- In the ebible files, the `\w` attributes (`strong`, `x-morph`) are removed and the `\w` markers stay.
- The SBLGNT files are upstream's XML converted to USFM by `src/ingest/sblgnt-xml.ts`, and the WLC files upstream OSHB's XML converted by `src/ingest/oshb-xml.ts`, as the ingest reads them. The OSHB conversion keeps only the public-domain WLC text.

| Directory | Source | Chapters | License |
|---|---|---|---|
| `kjv` | ebible `eng-kjv` | PSA 51, JOL 2-3, MAL 3-4, REV 12-13, 3JN 1, ROM 14 and 16, MRK 16, JHN 7-8, ACT 8 | Public domain |
| `kjva` | ebible `eng-kjv`, Apocrypha | TOB 1 and 10, declared under `eng` | Public domain |
| `wlc` | openscriptures/morphhb at commit `3d15126` | PSA 51, JOL 2-4, MAL 3 | Public domain |
| `sblgnt` | LogosBible/SBLGNT at commit `d7f35ad` | REV 12-13, 3JN 1, ROM 14 and 16, MRK 16, JHN 7-8, ACT 8 | SBL Greek New Testament, © 2010 Society of Biblical Literature and Logos Bible Software, CC BY 4.0. Excerpted and converted as above |
| `rp` | ebible `grcmt` | ROM 14 and 16 | Public domain |
| `web` | ebible `eng-web` | ROM 14 and 16, TOB 1 | Public domain |
| `brenton` | ebible `grcbrent` | 1KI 2 (lettered verses 35a-35o), TOB 10 | Public domain |

Licensing verdicts: `research/licensing.md`.
