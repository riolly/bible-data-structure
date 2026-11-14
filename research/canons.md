# Canons and book identity

Researched 2026-11-09 for ADR-0002 (book id is a USFM code, a canon is data). Findings first, recommendation last. Every claim links to its source. Claims marked **unverified** come from secondary sources or memory and need a primary check before they become data.

Versification overlaps with this topic in three places, all noted inline: Greek Esther, Greek Daniel and Baruch change chapter numbers as well as book identity, and SWORD ties a book list to each versification scheme. The scheme side is in `research/versification.md`.

## 1. The USFM book code list

Source: [USFM-USX-USJ documentation, Book Identifiers](https://docs.usfm.bible/usfm/latest/doc/books.html) (latest is 3.2; the [3.1 page](https://docs.usfm.bible/usfm/3.1/doc/books.html) has the same 100 codes). The spec is CC BY 4.0 ([LICENSE.md](https://github.com/usfm-bible/tcdocs/blob/main/LICENSE.md)).

The list has a fixed number per code. The number is a sort key for files and Paratext flags, not a canon order (40 is unused; numbers past 99 use a letter, A0 to C3).

| Range | Codes | Notes from the spec |
|---|---|---|
| 01-39 | GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL | EST is "Hebrew Esther", DAN is "Hebrew Daniel". EZR also covers "Ezra-Nehemiah when one book". PSA: "151 Psalms in Orthodox Bibles, 155 Psalms in West Syriac Bibles". PRO: "24 Proverbs in the Ethiopian Bible". |
| 41-67 | MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV | |
| 68-87 | TOB JDT ESG WIS SIR BAR LJE S3Y SUS BEL 1MA 2MA 3MA 4MA 1ES 2ES MAN PS2 ODA PSS | Deuterocanon, Orthodox books, Odes, Psalms of Solomon |
| A4-A6 | EZA 5EZ 6EZ | Ezra Apocalypse (4 Ezra, ch 3-14 of Latin 2 Esdras), 5 Ezra, 6 Ezra. Formerly 4ES, 5ES, 6ES |
| B2-C3 | DAG PS3 2BA LBA JUB ENO 1MQ 2MQ 3MQ REP 4BA LAO | Greek Daniel, Psalms 152-155, Syriac Baruch books, Ethiopian books, Laodiceans |
| A0-B1 | FRT BAK OTH INT CNC GLO TDX NDX | Peripherals, not books |
| 94-100 | XXA to XXG | Extra material, project-defined |

### Coverage of Orthodox and Ethiopian books

- **Covered**: 1-3 Meqabyan (`1MQ` `2MQ` `3MQ`), Enoch (`ENO`), Jubilees (`JUB`), Ethiopian "Reproof" or Proverbs part 2 (`REP`), 4 Baruch / Paralipomena of Jeremiah (`4BA`), Psalms of Solomon (`PSS`), Odes (`ODA`), Psalm 151 (`PS2`), Psalms 152-155 (`PS3`), 2 Baruch and the Letter of Baruch (`2BA`, `LBA`), 3 and 4 Maccabees, Laodiceans (`LAO`).
- **Gaps in the spec**: the official EOTC list (section 2) names Sirate Tsion, Tizaz, Gitsew, Abtilis, 1 and 2 Dominos, the book of Clement, Didascalia and "Josephas the Son of Bengorion". None has a USFM code. Nor do 3 Corinthians (Armenian lists), 1 and 2 Clement, the Didache or the Shepherd of Hermas.
- **Codes outside the spec**: the CrossWire [OSIS Book Abbreviations](https://wiki.crosswire.org/OSIS_Book_Abbreviations) table gives "Paratext" codes the USFM spec does not list: `ADE` (Additions to Esther), `3CO`, `COP`, `WSI`, `EUT`, `DOJ` (Armenian additions), `1CL`, `2CL`, `DID`, `SHE` (Apostolic Fathers), `PSO`, `PJE`, `PSB`, and six codes for Rahlfs' variant texts (`JSA`, `JDB`, `TBS`, `SST`, `DNT`, `BLT`). The same table maps both `EpBar` and `Barn` to `LBA` and flags the collision. The Scripture Burrito schema's `bookId` enum ([common.schema.json](https://github.com/bible-technology/scripture-burrito/blob/master/schema/common.schema.json)) has 107 values: the 92 USFM book codes (no peripherals, no `XX*`) plus exactly those six Rahlfs codes. *Whether current Paratext accepts the other wiki codes is unverified.* So the "USFM code" set is not one closed list: the spec, Burrito and Paratext practice differ at the edges.
- **Odes**: the spec warns that "Odes has different contents in Greek, Russian, and Syriac traditions", so `ODA` names a slot, not a fixed text.

### OSIS and SWORD names

OSIS ids are title-case strings (`Gen`, `Tob`, `1Macc`). SWORD uses OSIS ids inside its versification files. The ids SWORD uses for the books that differ, read from the CrossWire source (GPL v2, [canon_kjva.h](https://raw.githubusercontent.com/bibletime/crosswire-sword-mirror/trunk/include/canon_kjva.h), [canon_nrsva.h](https://raw.githubusercontent.com/bibletime/crosswire-sword-mirror/trunk/include/canon_nrsva.h), [canon_lxx.h](https://raw.githubusercontent.com/bibletime/crosswire-sword-mirror/trunk/include/canon_lxx.h), [canon_vulg.h](https://raw.githubusercontent.com/bibletime/crosswire-sword-mirror/trunk/include/canon_vulg.h)):

| Content | USFM | OSIS / SWORD |
|---|---|---|
| Hebrew Esther | EST | Esth (10 ch) |
| Additions to Esther only | none in the spec; `ADE` in the CrossWire table (section 1) | AddEsth (KJVA, numbered as chapters 10-16) |
| Full Greek Esther | ESG | EsthGr (NRSVA, 16 ch), or Esth with 16 ch (Catholic, Vulg, LXX, Orthodox, Synodal) |
| Hebrew Daniel | DAN | Dan (12 ch) |
| Full Greek Daniel | DAG | Dan with 14 ch (Catholic, Vulg, LXX, Orthodox, Synodal) |
| Prayer of Azariah and Song of the Three | S3Y | PrAzar |
| Susanna, Bel | SUS, BEL | Sus, Bel |
| Baruch | BAR | Bar (5 or 6 ch) |
| Letter of Jeremiah | LJE | EpJer |
| Psalm 151 separate | PS2 | AddPs (NRSVA, Vulg) |
| Prayer of Manasseh | MAN | PrMan |
| 1 Esdras (Greek) | 1ES | 1Esd |
| 2 Esdras (Latin, 16 ch) | 2ES | 2Esd |
| Odes | ODA | Odes (LXX, 14 ch) |
| Psalms of Solomon | PSS | PssSol |
| Enoch | ENO | 1En (LXX scheme, 108 ch) |
| Laodiceans | LAO | EpLao |

The SWORD LXX scheme also lists `FVD` ("Fourteenth Vision of Daniel", 1 chapter), which has no USFM code.

The CrossWire OSIS table adds `DanGr` and `AddDan` (with Prayer of Azariah as an alternate name, not its own id; SWORD's KJVA scheme still uses `PrAzar`), `4Ezra`, `5Ezra`, `6Ezra`, and Ethiopian ids `1Meq` `2Meq` `3Meq` `Rep` `4Bar` `Jub` `1En`. It says `Ps151` "is not legal in Sword", so Psalm 151 as a book is `AddPs`. The list says its basis is "the SBL Handbook of Style". *The OSIS 2.1.1 manual's own appendix was not fetched; the `osisCore.2.1.1.xsd` schema does not enumerate book ids.*

## 2. Book lists and orders per tradition

### Protestant (66)

The order in `src/ingest/books.ts` at commit `cf03cc0`, now `src/model/canon.ts` (GEN to MAL, MAT to REV), is the order of the KJV and of SWORD's `KJV` scheme. KJV editions that include the Apocrypha print it as a block between the testaments. SWORD's KJVA scheme lists it as `1Esd 2Esd Tob Jdt AddEsth Wis Sir Bar PrAzar Sus Bel PrMan 1Macc 2Macc` after Malachi ([canon_kjva.h](https://raw.githubusercontent.com/bibletime/crosswire-sword-mirror/trunk/include/canon_kjva.h)). In this block Baruch has 6 chapters (the Letter of Jeremiah is chapter 6) and the additions to Esther stand alone.

### Roman Catholic (73)

- **Book list**: the Council of Trent, Session IV (1546), *Decretum de canonicis Scripturis*, printed in the appendix of the Nova Vulgata ([vatican.va](https://www.vatican.va/archive/bible/nova_vulgata/documents/nova-vulgata_appendix_decretum-can-script_lt.html)). It names "Esdrae primus et secundus, qui dicitur Nehemias" (Ezra and Nehemiah as 1 and 2 Esdras), "Psalterium Davidicum centum quinquaginta psalmorum" (150 psalms, so no Psalm 151) and "Ieremias cum Baruch". It anathematizes anyone who rejects the books "integros cum omnibus suis partibus" (entire with all their parts), which is what brings in the Greek parts of Esther and Daniel.
- **Count and an order**: Catechism of the Catholic Church 120 ([vatican.va](https://www.vatican.va/content/catechism/en/part_one/section_one/chapter_two/article_3/iv_the_canon_of_scripture.html)): "46 books for the Old Testament (45 if we count Jeremiah and Lamentations as one) and 27 for the New". Its OT order puts Tobit, Judith, Esther, 1 and 2 Maccabees after Nehemiah.
- **A second official order**: the Nova Vulgata, the Church's typical Latin edition ([OT index](https://www.vatican.va/archive/bible/nova_vulgata/documents/nova-vulgata_vetus-testamentum_lt.html)), puts Tobit, Judith, Esther after Nehemiah but 1 and 2 Maccabees at the end, after Malachi. So one tradition has two official orders. SWORD's `Catholic` scheme follows the CCC order ([canon_catholic.h](https://raw.githubusercontent.com/bibletime/crosswire-sword-mirror/trunk/include/canon_catholic.h)); its `Vulg` scheme follows the Nova Vulgata.
- **NT order**: the CCC and Nova Vulgata use the familiar order (Pauline letters, Hebrews, James, 1-2 Peter, 1-3 John, Jude). Trent lists Peter, John, James, Jude.
- **Structure inside books** (Nova Vulgata): Esther has 10 chapters with the Greek additions as lettered verses in place (1:1a, 1:1b and on) ([Esther](https://www.vatican.va/archive/bible/nova_vulgata/documents/nova-vulgata_vt_esther_lt.html)); Daniel has 14 chapters ([Daniel](https://www.vatican.va/archive/bible/nova_vulgata/documents/nova-vulgata_vt_danielis_lt.html)); Baruch has 6, with the Letter of Jeremiah as chapter 6 ([Baruch](https://www.vatican.va/archive/bible/nova_vulgata/documents/nova-vulgata_vt_baruch_lt.html)).
- **Vulgate appendix**: SWORD's `Vulg` scheme lists `PrMan 1Esd 2Esd AddPs EpLao` after Revelation, the appendix books of the Clementine Vulgate ([canon_vulg.h](https://raw.githubusercontent.com/bibletime/crosswire-sword-mirror/trunk/include/canon_vulg.h)). They are printed but not canonical.

### Eastern Orthodox (Greek and Slavonic)

There is no single conciliar list that all Orthodox churches print. Sources:

- The NRSV Apocrypha front matter, published by Cambridge ([PDF](https://www.cambridge.org/us/files/5314/5207/7560/New_Revised_Standard_Version_Apocrypha.pdf)), sorts the books by tradition:
  - A. In the Roman Catholic, Greek and Slavonic Bibles: Tobit, Judith, Additions to Esther, Wisdom, Sirach, Baruch, Letter of Jeremiah "(=Baruch ch 6)", Additions to Daniel, 1-2 Maccabees.
  - B. In the Greek and Slavonic Bibles, not the Roman Catholic canon: 1 Esdras "(=II Esdras in Slavonic = III Esdras in Vulgate Appendix)", Prayer of Manasseh, Psalm 151 "following Psalm 150 in the Greek Bible", 3 Maccabees.
  - C. In the Slavonic Bible and the Vulgate appendix: 2 Esdras "(= III Esdras in Slavonic = IV Esdras in Appendix to Vulgate)".
  - D. In an appendix to the Greek Bible: 4 Maccabees.
- The United Bible Societies' translator site agrees: Orthodox Bibles follow the Catholic canon "plus Prayer of Manasseh, 1 and 2 Esdras, 3 Maccabees, and Psalm 151" ([UBS TIPs](https://tips.translation.bible/old-testament-books-in-tips/)).
- The Orthodox Church in America lists "Tobit, Judith, more chapters of Esther and Daniel, the Books of Maccabees, ... Wisdom of Solomon, ... Sirach, ... Baruch, and the Prayer of Manasseh" as the "longer canon" ([OCA Q&A](https://www.oca.org/questions/scripture/canon-of-scripture)).

**Greek order**, as encoded in SWORD's `Orthodox` scheme ([canon_orthodox.h](https://raw.githubusercontent.com/bibletime/crosswire-sword-mirror/trunk/include/canon_orthodox.h)): Gen ... 2Chr, 1Esd, Ezra, Neh, Tob, Jdt, Esth (Greek), 1-3 Macc, Ps (151), PrMan, Job, Prov, Eccl, Song, Wis, Sir, then the Twelve in Septuagint order (Hos, Amos, Mic, Joel, Obad, Jonah ...), Isa, Jer, Bar (5 ch), Lam, EpJer, Ezek, Sus, Dan, Bel, 4Macc. The minor prophets come before the major prophets, and their order differs from the Hebrew.

**Slavonic and Russian order**, from SWORD's `Synodal` scheme ([canon_synodal.h](https://raw.githubusercontent.com/bibletime/crosswire-sword-mirror/trunk/include/canon_synodal.h)): Gen ... 2Chr, PrMan, Ezra, Neh, 1Esd ("2 Ezra"), Tob, Jdt, Esth, Job, Ps, Prov, Eccl, Song, Wis, Sir, Isa, Jer, Lam, EpJer, Bar, Ezek, Dan, the Twelve in Hebrew order, 1-3 Macc, 2Esd ("3 Ezra"). The NT puts the Catholic letters (James, 1-2 Peter, 1-3 John, Jude) right after Acts and before Romans. The Optina monastery's Synodal text shows the same placement of 2 Ezra, Letter of Jeremiah before Baruch, 3 Ezra last and James after Acts ([bible.optina.ru](https://bible.optina.ru/)).

Differences between Greek and Slavonic that matter for data:

| Point | Greek | Slavonic / Russian Synodal |
|---|---|---|
| Latin 2 Esdras (`2ES`) | not included | included, called 3 Ezra |
| Greek 1 Esdras (`1ES`) | 1 Esdras, before Ezra | 2 Ezra, after Nehemiah |
| 4 Maccabees | appendix | not included |
| Prophets | Twelve first, LXX order | Major first, Hebrew order |
| Catholic letters in NT | after Hebrews | after Acts |

Orthodox status is graded. The Russian Longer Catechism counts 22 OT books with the Hebrew canon and says Sirach and "certain others" are not in that count "because they do not exist in the Hebrew" (Q. 35). *Unverified against a primary edition; the only text found online is a transcription at [sermonindex.net](https://sermonindex.net/books/longer-catechism-of-the-orthodox/4).* Greek usage calls these books *anagignoskomena* ("readable"). A canon entry therefore needs a status, not only membership.

### Oriental Orthodox

Sources here are thin. Only the Ethiopian list comes from the church itself.

**Ethiopian Orthodox Tewahedo.** The church's site ([ethiopianorthodox.org](https://ethiopianorthodox.org/english/canonical/books.html)) says "46 books of the Old Testament and 35 books of the New Testament that will bring the total of canonized books of the Bible to 81". Its list, with my USFM mapping in brackets:

- OT, in order: Genesis to Ruth; "I and II Samuel" (one entry, `1SA` `2SA`); "I and II Kings" (`1KI` `2KI`); I Chronicles; II Chronicles; "Jublee" (`JUB`); Enoch (`ENO`); "Ezra and Nehemia" (one entry, `EZR` `NEH`); "Ezra (2nd) and Ezra Sutuel" (`1ES` and `EZA`, *mapping unverified*); Tobit; Judith; Esther; "I Maccabees"; "II and III Maccabees" (these are the Meqabyan books, `1MQ` `2MQ` `3MQ`, *mapping unverified*; UBS says Ethiopian Bibles have 1-3 Meqabyan "instead of 1-3 Maccabees" ([UBS TIPs](https://tips.translation.bible/old-testament-books-in-tips/))); Job; Psalms; Proverbs; "Tegsats (Reproof)" (`REP`); "Metsihafe Tibeb (the books of wisdom)" (`WIS`, *unverified*); Ecclesiastes; Song of Songs; Isaiah; Jeremiah; Ezekiel; Daniel; Hosea, Amos, Micah, Joel, Obadiah, Jonah, Nahum ... Malachi (Septuagint order for the first six); "Book of Joshua the son of Sirac" (`SIR`); "The Book of Josephas the Son of Bengorion" (no code).
- NT: the 27 books with James after 3 John (Pauline letters, Hebrews, 1-2 Peter, 1-3 John, James, Jude, Revelation), then Sirate Tsion, Tizaz, Gitsew, Abtilis, 1 and 2 Dominos, the book of Clement, Didascalia. None of these eight has a USFM code.
- The same page says the Ethiopic Bible "includes the book of Enoch, Baruch, and the third and fourth Esdras", which are not in the numbered list.

The scholarly account, R. W. Cowley, "The Biblical Canon of the Ethiopian Orthodox Church Today", *Ostkirchliche Studien* 23 (1974), 318-323, distinguishes a narrower and a broader canon, and notes that a list headed "81 books" does not itself total 81. *Seen only in a reproduction ([islamic-awareness.org](https://www.islamic-awareness.org/bible/text/canon/ethiopican)); unverified against the journal.* For the model: Ethiopian canon data needs at least two canons (narrower, broader), several books with no USFM code, and Proverbs split into `PRO` (24 ch) and `REP`.

**Coptic Orthodox.** No synod-level list found. A Coptic clergy article names Tobit, Judith, the additions to Esther and Daniel, Wisdom, Sirach, Baruch, 1-2 Maccabees and Psalm 151 as deuterocanonical ([LA Copts, Fr. Moses Samaan](https://www.lacopts.org/orthodoxy/our-faith/the-holy-bible/the-deuterocanonical-books/)). Status of 3-4 Maccabees and the Esdras books: *unverified*.

**Armenian Apostolic.** Michael Stone's edited canon lists (*Harvard Theological Review* 66, 1973, [abstract](https://www.cambridge.org/core/journals/harvard-theological-review/article/abs/armenian-canon-lists-i-the-council-of-partaw-768-c-e/471D50FE3CE3CACCA8FA39A91C6141FA), and HTR 72, 1979) show medieval lists that include the Testaments of the Twelve Patriarchs and 3 Corinthians. The lists themselves were not visible on a fetched primary page. *Unverified.* The 1805 Zohrab edition's contents: *unverified*.

**Syriac Orthodox and the Peshitta.** The USFM spec itself records Syriac features: `PSA` has "155 Psalms in West Syriac Bibles", `PS3` is Psalms 152-155 "found in West Syriac manuscripts", `2BA` is "the Apocalypse of Baruch in Syriac Bibles", `LBA` is the Letter of Baruch, and `BAR` is "called 1 Baruch in Syriac Bibles" ([USFM books](https://docs.usfm.bible/usfm/latest/doc/books.html)). The Leiden Peshitta edition's contents and the early 22-book Peshitta New Testament (without 2 Peter, 2-3 John, Jude, Revelation): *unverified, no primary page fetched*.

### Jewish Tanakh

Same 39 books as the Protestant OT, counted as 24, in three groups: Torah, Nevi'im (Prophets), Ketuvim (Writings).

- **Talmudic order**, Bava Batra 14b ([Sefaria](https://www.sefaria.org/Bava_Batra.14b), William Davidson edition, CC BY-NC): Prophets "Joshua and Judges, Samuel and Kings, Jeremiah and Ezekiel, and Isaiah and the Twelve Prophets"; Writings "Ruth and the book of Psalms, and Job and Proverbs; Ecclesiastes, Song of Songs, and Lamentations; Daniel and the Scroll of Esther; and Ezra and Chronicles".
- **Printed order** used by Sefaria's library index ([api/index](https://www.sefaria.org/api/index/)): Prophets Joshua, Judges, Samuel, Kings, Isaiah, Jeremiah, Ezekiel, the Twelve; Writings Psalms, Proverbs, Job, Song of Songs, Ruth, Lamentations, Ecclesiastes, Esther, Daniel, Ezra, Nehemiah, Chronicles.
- The Leningrad Codex puts Chronicles first in the Writings. *Unverified: no primary page fetched.*

The 24-count makes 1-2 Samuel, 1-2 Kings, 1-2 Chronicles and Ezra-Nehemiah one book each and the Twelve one book. A canon entry can therefore cover several USFM codes.

## 3. Books whose identity differs between traditions

| Case | What differs | USFM | OSIS / SWORD | Real editions |
|---|---|---|---|---|
| Esther | Hebrew Esther (10 ch) vs Greek Esther (Hebrew text plus 6 additions, about 107 verses more) | `EST` for Hebrew, `ESG` for "the longer Greek LXX Esther" | `Esth`, `AddEsth` (additions alone), `EsthGr` (whole) | ebible.org Douay-Rheims (`engDRA`) stores Greek Esther under `EST` with 16 chapters, additions in ch 11-16 (Vulgate layout). ebible.org World English Bible Catholic (`eng-web-c`) uses `ESG` with 10 chapters and merges the additions into 1:1, after 3:13, 4:17, 8:12 and 10:3 (its own intro says so). The Nova Vulgata uses lettered verses in place. The NRSV uses lettered chapters A-F. |
| Daniel | Hebrew Daniel (12 ch) vs Greek Daniel (14 ch, with the Prayer of Azariah in ch 3, Susanna as 13, Bel as 14) | `DAN` vs `DAG`; or `DAN` plus `S3Y` `SUS` `BEL` as separate books | `Dan` with 12 or 14 ch; `PrAzar` `Sus` `Bel` separate in KJVA, NRSVA, LXX | Douay-Rheims stores 14 chapters under `DAN`. WEB Catholic uses `DAG`. The LXX scheme places Susanna before Daniel and Bel after it. |
| Baruch and Letter of Jeremiah | Catholic Baruch has 6 ch (ch 6 is the Letter). Orthodox Bibles have Baruch 5 ch and a separate Letter | `BAR`: "5 chapters in Orthodox Bibles (LJE is separate); 6 chapters in Catholic Bibles (includes LJE)" | `Bar` 5 or 6 ch, `EpJer` | Both ebible.org Catholic editions have 6-chapter `BAR`. |
| Psalm 151 | Part of Psalms (Orthodox) or a separate book in an Apocrypha | `PSA` with 151 ch, or `PS2` | `Ps` with 151 ch (LXX, Orthodox, Synodal) or `AddPs` (NRSVA, Vulg) | |
| Prayer of Manasseh | Separate book, appended to 2 Chronicles, or an Ode | `MAN` | `PrMan` | Synodal places it after 2 Chronicles. In the LXX scheme it follows Psalms. It is also Ode 12 in Greek Odes. *(Ode numbering unverified.)* |
| 3 and 4 Maccabees | 3 Macc is in Greek and Slavonic canons. 4 Macc is a Greek appendix | `3MA`, `4MA` | `3Macc`, `4Macc` | The spec also notes Ethiopian-style numbering, where `1MA` is "called '3 Maccabees' in some traditions" |
| Odes | A book of biblical canticles (14 chapters in SWORD's LXX scheme). Content differs by tradition | `ODA` | `Odes` | |

**The Esdras names.** The same name means four different books depending on the Bible. From the NRSV Apocrypha table and the USFM notes on `EZR`, `NEH`, `1ES`, `2ES`, `EZA`:

| Content | USFM | English Protestant / NRSV | Vulgate | Septuagint | Russian Synodal |
|---|---|---|---|---|---|
| Hebrew Ezra | `EZR` | Ezra | 1 Esdras | part of Esdras B (with Nehemiah) | Ezra |
| Nehemiah | `NEH` | Nehemiah | 2 Esdras | part of Esdras B | Nehemiah |
| Greek Ezra (9 ch) | `1ES` | 1 Esdras | 3 Esdras (appendix) | Esdras A | 2 Ezra |
| Latin apocalypse (16 ch) | `2ES` | 2 Esdras | 4 Esdras (appendix) | absent | 3 Ezra |
| Ezra Apocalypse proper (2 Esdras 3-14) | `EZA` | | | | |
| 2 Esdras 1-2 / 15-16 | `5EZ` / `6EZ` | | | | |

The Septuagint names come from common usage (Esdras A and B), *unverified against a printed LXX edition*. The point for the model holds either way: never display or parse "1 Esdras" without knowing the canon.

**Book identity versus versification.** Greek Esther shows that "which USFM code" and "how the verses are numbered" are separate questions. The same Catholic book appears as `EST` with 16 chapters, `ESG` with 10 chapters, and lettered verses in the Nova Vulgata. The versification research has to give each of those layouts a scheme. This file only fixes which code the content belongs to.

**Codes found while building step 2 (2026-11-09).**

- TVTMS writes Latin 2 Esdras as both `4Es` and `2Es`. Its section headers read `$4Es./2Es.10:59-10:60`, and its `4Es.10:59-60` rows match `rso.vrs` lines 395-396 for `2ES` ([TVTMS][tvtms]). So TVTMS `4Es` is USFM `2ES`, not `EZA`, even though the USFM spec says `EZA` was "formerly called 4ES".
- libpalaso's `eng.vrs`, `org.vrs` and `lxx.vrs` list verse counts for `JSA`, `JDB`, `TBS`, `SST`, `DNT` and `BLT`. Its `Canon.cs` marks all six "*obsolete*" ("actual variant text for JOS, now in LXA text"), no mapping line uses them, and the USFM spec lacks them ([Canon.cs lines 321-327](https://github.com/sillsdev/libpalaso/blob/b4f7a6da7b868f9ae909e40fb0708f5fd4efd782/SIL.Scripture/Canon.cs#L321-L327)). The scheme registry drops them.

## 4. How data formats represent a canon or book set

None of the formats below has a canon object with order, grouping and status. Each has a book set and leaves order to a fixed list.

| Format | What it stores | Order | Grouping | Source |
|---|---|---|---|---|
| USFM spec | A fixed table of codes with a number each | The number (GEN=01 ... MAL=39, MAT=41 ... REV=67, TOB=68 ...) | None | [books](https://docs.usfm.bible/usfm/latest/doc/books.html) |
| Paratext project | `BooksPresent` in `Settings.xml`: a string of `0`/`1`, one flag per book in the fixed Paratext book list | Fixed list | None | SIL's open-source reader of Paratext projects, [ptsettings.py](https://raw.githubusercontent.com/sillsdev/ptx2pdf/0855e35d119bbcc24c47d75ce75057de54dbebf8/python/lib/ptxprint/ptsettings.py) lines 226-261, and its book list in [utils.py](https://raw.githubusercontent.com/sillsdev/ptx2pdf/0855e35d119bbcc24c47d75ce75057de54dbebf8/python/lib/ptxprint/utils.py) line 42. Paratext's own code is not public |
| Paratext names | `BookNames.xml`: per `code`, attributes `long`, `short`, `abbr` | | | same `ptsettings.py` (`read_bookNames`) |
| Scripture Burrito | `currentScope`: an object keyed by book code, each value a list of chapters or verse ranges (empty = whole book) | None (JSON object keys) | None | [scope.schema.json](https://github.com/bible-technology/scripture-burrito/blob/master/schema/scope.schema.json), [example](https://github.com/bible-technology/scripture-burrito/blob/master/docs/examples/artifacts/textTranslation.json) |
| Burrito names | `localizedNames` keyed `book-gen`, `book-exo`, each with `abbr`, `short`, `long`, each a map from language tag to string (`{"short": {"en": "Genesis"}}`) | | | same example |
| SWORD | One header per versification: `otbooks[]` and `ntbooks[]` of `{name, OSIS id, preferred abbreviation, chapter count}`, plus verse counts per chapter | Array order | Two arrays only | [canon_kjva.h](https://raw.githubusercontent.com/bibletime/crosswire-sword-mirror/trunk/include/canon_kjva.h) |
| OSIS | Book ids only; a document lists the books it contains | Document order | `<div type="bookGroup">` in a document *(element usage unverified)* | [OSIS Book Abbreviations](https://wiki.crosswire.org/OSIS_Book_Abbreviations) |

SWORD ships these versification systems, each with its own book list: KJV (in `canon.h`), KJVA, NRSV, NRSVA, MT, Leningrad, Synodal, SynodalProt, Vulg, LXX, Catholic, Catholic2, Calvin, DarbyFr, German, Luther, Orthodox, Segond ([SVN listing](https://crosswire.org/svn/sword/trunk/include/)).

In SWORD a canon and a versification scheme are one object. That is the coupling ADR-0002 avoids. The `Vulg` scheme puts its appendix books in `ntbooks` after Revelation, which shows that two testaments are not enough grouping for real Bibles.

The Burrito `localizedNames` shape (code, then name length, then language) is the closest existing shape to what this repo needs for names.

## 5. Licenses

| Data | License | Use in an app | Source |
|---|---|---|---|
| USFM book code table and its notes | CC BY 4.0 (specs, docs, data); MIT (code) | Yes, with attribution | [tcdocs LICENSE.md](https://github.com/usfm-bible/tcdocs/blob/main/LICENSE.md) |
| Scripture Burrito schema (book enum, names shape) | MIT | Yes, keep the notice | [LICENSE](https://github.com/bible-technology/scripture-burrito/blob/master/LICENSE) |
| SWORD canon headers (book lists, OSIS ids, chapter counts) | GPL v2 | Copying the files into a non-GPL app is not allowed. The facts in them (which books, what order) come from church documents and can be taken from those instead | [canon.h](https://crosswire.org/svn/sword/trunk/include/canon.h) |
| CrossWire OSIS book table | No license stated on the page *(unverified)* | Use the OSIS ids as identifiers. Don't copy the table's prose | [wiki](https://wiki.crosswire.org/OSIS_Book_Abbreviations) |
| ubsicap versification_json | MIT | Yes (versification topic) | [LICENSE](https://raw.githubusercontent.com/ubsicap/versification_json/master/LICENSE) |
| Church documents (CCC, Nova Vulgata, Trent) | Copyright Libreria Editrice Vaticana | A book list and its order are facts. Store them with a link, don't copy text | [CCC 120](https://www.vatican.va/content/catechism/en/part_one/section_one/chapter_two/article_3/iv_the_canon_of_scripture.html) |
| Sefaria Bava Batra English (William Davidson) | CC BY-NC | Quote only. The Tanakh order is a fact | [Sefaria](https://www.sefaria.org/Bava_Batra.14b) |
| Localized book names inside editions (`\toc1` long, `\toc2` short, `\toc3` abbreviation, `\h` header) | The edition's own license | Yes for public-domain editions (KJV, WEB Catholic). Per edition otherwise | the USFM files; [ebible.org policy](https://ebible.org/ippolicy.php) says each work keeps its own license |
| BibleOrgSys book-name data | Code is MPL-2.0. Data file license *unverified* | Unverified | [LICENSE](https://raw.githubusercontent.com/Freely-Given-org/BibleOrgSys/master/LICENSE) |
| unfoldingWord resources | CC BY-SA 4.0 *(from a search excerpt, unverified)* | Share-alike would apply to a derived name table | [unfoldingword.org](https://unfoldingword.org/for-translators/content/) |

Verdict: the code list (USFM, CC BY 4.0) and the canon facts are free to use. Book names per language should come from public-domain editions' `\toc` fields first. SWORD's files are a cross-check, not a source to copy.

## Recommendation

Adopted in ADR-0002 (Canon shape): the canon tables, order and status on the entry, sections as a tree, book names per language with a canon-specific override, and a per-source code override where a file's `\id` line names the wrong book. What that ADR leaves out:

- Two official Catholic orders exist, so a canon id must name a specific list, for example `catholic-ccc` and `catholic-nova-vulgata`.
- Where the spec uses one code with a variable extent (`BAR` with 5 or 6 chapters, `PSA` with 150, 151 or 155), keep one code. The extent belongs to the edition's versification scheme, which is the versification research's job.
- Where a tradition keeps a part as its own book (`LJE`, `PS2`, `S3Y`, `SUS`, `BEL`, `MAN`), the canon entry points at that code. Whether an edition can hold the same text under two layouts (Psalm 151 as `PSA` 151 and as `PS2`) needs a mapping, again in versification.
- Books with no USFM code (Ethiopian broader NT, Josippon, 3 Corinthians) get a code only when an edition needs one. Prefer a code already used in Paratext practice (`3CO`, `1CL` from the CrossWire table) over inventing one, and record the source.
- Seed English names from the USFM spec (CC BY 4.0) and other languages from public-domain editions' `\toc1`, `\toc2`, `\toc3`. Keep each edition's own `\toc` values as edition data, separate from `book_name`.

### Left for a wider scope

Decided in ADR-0002: only the `protestant` canon is filled in, the code override is per-source config, and `book` keeps no display column. The three questions below only matter for a Catholic or Orthodox canon or a deuterocanonical book. Both are out of scope (ADR-0008), and that ADR's amendment of 2026-11-14 names the event that reopens each one:

1. **Status values.** Is `canonical | readable | appendix` enough, or does the Ethiopian narrower and broader split need a fourth value instead of two canons?
2. **With the versification research:** schemes for the three Esther layouts (Vulgate chapters 11-16, Nova Vulgata lettered verses, WEB Catholic merged verses), Daniel 13-14 versus `SUS`/`BEL`, Baruch 6 versus `LJE`, and Psalm 151 inside `PSA` versus `PS2`.
3. **Primary checks still open:** Oriental Orthodox lists (Coptic, Armenian, Syriac), the OSIS 2.1.1 manual's book appendix, and the Russian Longer Catechism text.
[tvtms]: https://github.com/STEPBible/STEPBible-Data/tree/5de0a47f35f0fc13dfe1430d104e5db8a4285f9c/Versification
