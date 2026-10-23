# Plan 4: Statements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user uploads a bank statement (a PDF from HDFC, ICICI, SBI, Axis or Kotak, or a CSV from any bank), sees a preview, sorts the lines Gullak could not sort with swipes, and commits it: statement lines become transactions, logged spends are confirmed by the bank, fixed costs and savings transfers stay out of the daily budget, and the raw statement text is stored only encrypted.

**Architecture:** Server work lives in the `ingestion` feature, split into four sub-packages: `ingestion.statements` (pure readers: PDF text extraction with PDFBox on a bounded executor with a timeout, one layout class per bank, CSV with a column mapping), `ingestion.categorise` (merchant dictionary, user rules, suggestions, line kinds), `ingestion.matching` (pure scoring and assignment of statement lines to pending spends, fixed-cost and cash rules) and `ingestion.imports` (tables, the imports API, sort, commit, unlink). Raw statement text is encrypted with AES-256-GCM in the application (`common.crypto.FieldCipher`, key `GULLAK_ENC_KEY`); anything matched against later (fingerprints, user rule patterns, payee patterns, learned pairs) is a keyed HMAC, never plain text. The app adds an `imports` feature: a multipart method on the one API client, an upload flow that keeps the picked file in memory for a password retry, the error screens, a CSV column-mapping screen and swipe-to-sort with gesture-handler and Reanimated on the UI thread.

**Tech Stack:** Server: Spring Boot 4.1.1, Java 21, Spring Data JPA, `JdbcClient` for concurrency-sensitive writes and matching reads, Flyway, PostgreSQL 17, Apache PDFBox 3.0.x (`org.apache.pdfbox:pdfbox:3.0.5`, or the newest 3.0.x patch at execution time), JUnit 5, AssertJ, MockMvc, Testcontainers. App: Expo SDK 56+ (Plan 2), Expo Router, TypeScript strict, TanStack Query v5, `expo-document-picker`, `expo-file-system` (`File`), `expo/fetch`, `react-native-gesture-handler`, `react-native-reanimated` 4 + `react-native-worklets`, `expo-haptics`, Jest + React Native Testing Library, Maestro.

**Spec:** `docs/superpowers/specs/2026-10-23-gullak-v1-design.md` sections 2.3–2.5, 4.1, 4.5–4.8 and 4.11, with test cases in `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md` (sections 3, 4, 7.5, 8, 9, 10, 12), visual rules in `.claude/design.md`, prototype findings in `docs/ux-test-findings.md` and engineering rules in `docs/engineering-standards.md`. Read all of them before starting any task. Mockup copy quoted here comes from the design canvas boards `UploadStart`, `UploadPassword`, `UploadWrongPassword`, `UploadReading`, `Upload`, `UploadBankError`, `UploadScanned`, `SwipeSort`, `Insights` and `HomeEmpty`, verbatim except where a single sentence lost its full stop to follow `.claude/design.md`.

**Builds on:** Plan 1 (implemented; its code is authoritative), Plan 2 (written; its code blocks are the contract for the app), Plan 3 (written in parallel). From Plan 3 this plan assumes, and names in each task's **Interfaces** block: the `categories` table with the twelve codes `food_delivery`, `eating_out`, `quick_commerce`, `groceries`, `shopping`, `subscriptions`, `travel`, `bills_recharges`, `entertainment`, `health`, `upi_to_people`, `other`; the `transactions` columns from Plan 1's `V003` with `status` in `pending`, `confirmed`, `statement_only`, `source` in `manual`, `statement`, `payment_method` in `upi`, `card`, `cash`, `unknown`, `tag` in `need`, `want`, `regret`, and `client_id` nullable; the `xp_events` table (`user_id`, `kind`, `xp`, `ref_type`, `ref_id`, `reversed_at`); `in.gullak.gamification.XpService#award(UUID userId, XpKind kind, String refType, UUID refId): int` (the XP earned; 0 when already awarded, idempotent on `(user, kind, ref_type, ref_id)`), with this plan appending `XpKind.IMPORT_SORTED(10, null)` and `XpKind.LOGGING_ACCURACY(50, null)`; `in.gullak.ingestion.TransactionService` with `get`, `update` and `delete`; the `POST /transactions/{id}/unlink` endpoint and the `NOT_LINKED` error code; `ConflictException`. Where Plan 3 shipped a different name, the executor adapts the call site and records it in the task report.

**Migrations:** this plan's block is V010–V019 (Plan 3's is V006–V009); its one migration is `V010__statement_imports.sql`.

## Global Constraints

- Migrations for this plan use V010–V019; if an earlier plan was executed with more migrations than planned, renumber to the next free number in this block. This plan uses V010.
- Money is `long` paise on the server and whole-paise `number` in the app. No floating point near money. "₹5 or 2%" is `max(500, amount × 2 / 100)` paise; "within 10%" is `|line − cost| × 10 ≤ cost`.
- Day boundaries use `Asia/Kolkata` (`Ist`). A statement line's date is an IST date; it is stored as `occurred_at` = 12:00 IST that day. A logged spend's date for matching is `LocalDate.ofInstant(occurred_at, Ist.ZONE)`.
- Every query on user data filters by the user id from the JWT. Another user's import, line or transaction returns 404.
- The uploaded file is read into memory only (`spring.servlet.multipart.file-size-threshold` above the size cap), parsed, and dropped. No file is ever written to disk or logged; the file name is never read on the server; the password is used in memory only and never stored or logged.
- Raw statement text (descriptions, UPI handles) is stored only in `bytea` columns encrypted by `FieldCipher` with the owner's user id as associated data. Anything stored to be matched later is `FieldCipher.hash(userId, text)`, an HMAC-SHA256 hex string.
- Never logged at any level: amounts, merchant text, raw lines, file names, UPI handles, passwords, emails, tokens. Business events use `Events` constants with ids and counts only.
- `ErrorCode` is append-only: new codes go at the end, before `INTERNAL`. Every new code gets a message in `app/src/lib/errors.ts`, and `npm run gen:errors` regenerates `app/src/lib/error-codes.ts`.
- No empty catch blocks; no `catch (Exception`, `catch (RuntimeException` or `catch (Throwable` outside `common/error` (Plan 1's `SourceRulesTest`). The parser's async boundary handles `ExecutionException` and inspects the cause instead.
- JPA entities and repositories are package-private to `in.gullak.ingestion.imports`; ArchUnit requires a repository to be used only from its own package, so every class that touches a repository lives in that package. Controllers use services only.
- Uploads: 10 MB cap (413 `TOO_LARGE`), magic-byte check (400 `INVALID_FILE`), parsing on a bounded executor with a 10-second timeout that interrupts and frees the thread (422 `UNREADABLE`), 10 uploads per user per hour (429), at most 4 uploads read at once server-wide.
- App: features never call `fetch`; only `api` from `@/lib/client`. Money through `lib/money.ts`, dates through `lib/dates.ts`. Every screen renders loading, empty and error states. 44px targets and labels on every control. Animations on the UI thread with `.get()`/`.set()` and `scheduleOnRN`, Reduce Motion honoured. Import queries are never persisted to the phone's query cache (they carry statement text).
- Copy follows `.claude/design.md`: sentence case; a single sentence has no full stop; two or more sentences take a full stop after each; ₹ with Indian grouping; dates as `Fri, 23 Oct`.
- Each task's owner is named; after the owner hands back, `qa-engineer` runs, then `red-team` where the task says so, then `manager` reviews (`docs/team.md`). Every upload-facing task has a red-team pass.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A chai stall charges ₹20 twice on the same day and both lines are in the statement: both import the first time, and uploading the same statement again imports neither. Pinned in Task 9 (`identicalLinesOnOneDayBothImportOnceAndReuploadSkipsBoth`).
- A spend logged by UPI at 23:50 IST matches a bank line dated that IST day, and one logged at 00:10 IST the next day does not, even though both are the same UTC date. Pinned in Task 7 (`lateNightSpendMatchesOnlyItsOwnIstDay`).
- The phone loses its connection while the statement is uploading: the reading screen shows the problem with Try again, and the retry sends the same file without asking for it again. Pinned in Task 12 (`networkDropOnReadingKeepsTheFileAndRetries`).
- A Yes Bank statement whose narration says "NEFT to HDFC BANK" is detected as Yes Bank, not read as HDFC. Pinned in Task 3 (`narrationMentioningHdfcStillDetectsYesBank`).
- A user double-taps Need on a card: one tag is sent for that card, and the next card is not tagged by the second tap. Pinned in Task 14 (`doubleTapTagsOnlyOnce`).

## Decisions made in this plan

Where the spec is silent, these are the choices, each with its cost if wrong.

1. **Who sees statement text.** The owner sees the raw description on sort cards and the first rows of a CSV on the mapping screen, over TLS. It is stored only encrypted and is never logged. Spec 4.1's "never leaves the server unencrypted" is read as "never in clear at rest, in logs or to anyone but its owner". Cost if wrong: cards would show only the cleaned name.
2. **Display name of a statement line** (`transactions.merchant_name`, plain text): the dictionary's name ("Swiggy") when known, otherwise the cleaned merchant key in title case ("Kaka Dhaba"), and for a personal UPI handle only the part before `@` ("priya.s"). Cost: a fragment of statement text is stored in clear, like a typed merchant name.
3. **Keyed hashes, not patterns.** User rule patterns, fixed-cost payee patterns, learned merchant pairs and line fingerprints are `HMAC-SHA256(key derived from GULLAK_ENC_KEY, userId + text)`. Matching is exact equality on a normalised merchant key. The global dictionary lives in code (`MerchantDictionary`), so `merchant_rules` holds user rows only (`scope` keeps `global` reserved). Cost: rotating the key means re-deriving hashes from `merchant_raw_enc` in the same job that re-encrypts.
4. **Associated data.** AES-GCM binds each ciphertext to its owner's user id, so a row copied to another user does not decrypt. Cost: none.
5. **Draft lines** live in `import_lines` (description encrypted) and are deleted on commit or discard. `statement_imports` has no blob column (API-IMP-31). A CSV waiting for its column map keeps its rows as encrypted cells in `import_lines` (row 0 is the header).
6. **CSV mappings** are typed columns (`date_col`, `debit_col`, …), not jsonb, keyed by a header signature `csv:<16 hex of SHA-256 of the normalised headers>` used as the bank. Cost: a bank that renames a column asks again once.
7. **Partial reads** return 201 with `unreadableCount` (RD-15, API-IMP-13). The spec's `UNREADABLE_LINES` outcome is not an error code; `UNREADABLE` is the code for a file that cannot be read at all. Report recommends the spec edit.
8. **Buckets**, in order: credits, ATM withdrawals and savings transfers are automatic (`auto`); then fixed costs (`fixed`); then lines matched to a logged spend (`matched`); then lines categorised by a user rule or the dictionary (`auto`); everything else, including personal UPI payments, goes to swipe-to-sort (`sort`) with suggested chips. That makes the HDFC sample read 84 = 9 matched + 58 auto + 3 fixed + 14 to sort.
9. **Match scores**: amount exact 40, within ₹5 or 2% 25 (else no match); date same IST day 30, 1–3 days later 20 (UPI spends: same day only; card and unknown: up to 3 days later; a line before the spend never matches); same payment kind 10; merchant name contained in the line's key 20, similar (bigram Dice ≥ 0.5) 10; category agrees 5; a learned pair scores at least 100. High ≥ 90 links silently, medium ≥ 60 links with Undo, below 60 keeps both. Pairs are assigned greedily by score, then the earliest spend, then the earliest line. Cost: thresholds are tuning, kept in `MatchScorer`.
10. **Learned pairs** are recorded for every link a commit makes and removed by unlink. Cost: a wrong medium link left alone teaches a wrong pair.
11. **Fixed costs.** First sight: only lines with no dictionary category, within 10% of a fixed cost that has no payee yet; each cost takes the nearest amount (then the earliest date); each line serves one cost. The question is answered on the preview; "yes" stores the payee hash and the day of the month at once. Recognition after that: the same payee hash, within 10%, within 5 days of that day. An unanswered question at commit keeps the line out of the budget this time and asks again next import. Cost: a rent paid from two accounts asks twice.
12. **Statement credits** (salary, refunds) are stored with `counts_in_budget = false` in V1; they never change the pool. Cost: a refund on a statement does not give money back to the day.
13. **"Finish later"** commits: untagged lines are saved as Other with `needs_review = true`. +10 XP and the Sorted trigger fire only when no line is left untagged (or there was nothing to sort).
14. **Commit re-matches** only the lines matched at preview, against the pending spends as they are at commit. The sort deck never changes under the user.
15. **Unmatched pending spends become cash** (MAT-13) when the import covers their date: up to the statement's last date for UPI and unknown, up to 3 days before it for card (a card spend in the last 3 days may post later).
16. **Misc cash** is offered once per import, after commit, when ATM withdrawals in the import exceed cash spends logged in the import's period. Accepting creates one cash spend "Misc cash" (category Other) on the period's last day.
17. **Upload limits.** 10 uploads per user per hour (counts every attempt, so 50 wrong passwords stop at 10); a server-wide gate of 4 uploads in flight (a fifth waits up to 5 s, then 429); 2 parser threads with a queue of 4. Multipart parsing is lazy so the limits run before the bytes are read.
18. **PDF safety.** No `%%EOF` in the last 2 KB means a truncated download (UNREADABLE). At most 100 pages; content streams may use no filter or FlateDecode only, and their decoded size is counted with our own inflater and capped at 32 MB (a decompression bomb is UNREADABLE); at most 50,000 glyphs per page; text is extracted page by page; the stripper checks for interruption on every operator. JavaScript, embedded files, forms and annotations are never read. Residual risk: an object-stream bomb inflates inside PDFBox while loading; the container's memory limit is the backstop.
19. **The server ignores the multipart file name.** The app still sends the picked name (the cache copy has it); nothing on the server reads it.
20. **Dates outside the window.** A line dated after tomorrow (IST) or more than 2 years ago counts as unreadable.
21. **Ambiguous CSV dates are never guessed.** When a CSV has known headers but its dates fit both DD/MM and MM/DD (every day ≤ 12), the server asks for the column map with that format unset.
22. **Extra endpoints** beyond spec 4.6, all under `/api/v1`: `GET /imports/latest` (the "Last added" row), `GET /imports/{id}`, `POST /imports/{id}/column-map/preview` (the 3 parsed lines), `POST /imports/{id}/fixed-answer`, `POST /imports/{id}/misc-cash`.
23. **Discarded imports** answer 404 everywhere; a committed import answers 409 `ALREADY_COMMITTED` to tag, undo, commit, discard and column-map.
24. **Undo on the last card.** After the last tag the finished state shows at once with Undo for 5 seconds; the commit runs when that window ends or when "See where it went" is tapped.
25. **Button taps do not fly the card**; the swipe does. A tap tags at once, the next card appears and the Undo bar shows. A 300 ms lockout after each tag stops a double tap from tagging the next card.
26. **The "Need" button is ink**, as drawn; Plan 2's `Button` gains an `ink` variant. Terracotta stays the one primary per screen elsewhere.
27. **Column "dropdowns"** on the CSV mapping screen are rows of chips, one chip per header, so they work the same on Android, iOS and web without a native menu.
28. **Hooks into Plan 3.** Deleting a linked spend releases its statement line (API-SP-33), editing the category of a statement spend teaches a user rule (API-SP-27), and Plan 3's unlink endpoint calls `MatchService.unlink`. Spend responses gain `linkConfidence`.
29. **Statement samples are synthetic.** One PDFBox builder per bank writes a PDF and its expected JSON into `server/src/test/resources/statements/`; the files are committed. Each bank's layout rules sit in its own reader class, so a real anonymised sample and its JSON replace the synthetic pair without touching the pipeline.
30. **Bank requests** are one row per (user, bank, source), where source is `detected` (an upload of that bank) or `asked` (the button); demand is the count of distinct users.

## File structure

```
server/
  build.gradle.kts                                   Task 2 (pdfbox, writeStatementSamples task)
  src/main/resources/application.yml                 Tasks 1, 2, 7
  src/test/resources/application-test.yml            Task 1
  src/main/resources/db/migration/V010__statement_imports.sql   Task 7
  src/main/java/in/gullak/
    common/crypto/FieldCipher.java, EncryptionKeyCheck.java      Task 1
    common/error/ErrorCode.java, ErrorBody.java, GullakException.java, UnprocessableException.java,
      BadRequestException.java, TooLargeException.java, ConflictException.java (if Plan 3 has none),
      GlobalExceptionHandler.java                                Task 1
    common/log/Events.java                                       Task 1
    common/web/BodyLimitFilter.java                              Task 7
    gamification/BadgeTrigger.java                               Task 9
    profile/FixedCostPayee.java, FixedCostEntity.java, FixedCostService.java   Task 7
    ingestion/statements/
      Bank.java, Direction.java, FileKind.java, RawLine.java, ParsedStatement.java,
      ImportProperties.java, ReadFailures.java, AmountParser.java, PdfText.java, BankDetector.java,
      PdfStatementReader.java, ReaderOutput.java, BankLayout.java, BankLayoutReader.java,
      HdfcReader.java, DateWindow.java, FileSniffer.java, StatementParser.java   Task 2
      IciciReader.java, SbiReader.java, AxisReader.java, KotakReader.java        Task 3
      StatementDateFormat.java, CsvTable.java, CsvParser.java, CsvColumns.java,
      CsvMapping.java, CsvMapper.java, CsvOutcome.java (+ StatementParser edits)  Task 4
    ingestion/categorise/
      CategoryCodes.java, MerchantText.java, MerchantDictionary.java, GuessSource.java, Guess.java,
      Categoriser.java, Hint.java, Suggestion.java, Suggester.java, LineKind.java, LineClassifier.java   Task 5
    ingestion/matching/
      PendingSpend.java, LineCandidate.java, Confidence.java, Link.java, MatchScorer.java, Matcher.java,
      FixedCostInfo.java, FixedLine.java, FixedHit.java, FixedCostDetector.java, CashCover.java,
      LoggingAccuracy.java                                                        Task 6
    ingestion/imports/
      Bucket.java, ImportStatus.java, Tag.java, StatementImportEntity.java, StatementImportRepository.java,
      ImportLineEntity.java, ImportLineRepository.java, CsvMappingEntity.java, CsvMappingRepository.java,
      StatementTxnRepository.java,
      MerchantRuleRepository.java, MerchantRuleService.java, BankRequestRepository.java,
      BankRequestService.java, Cells.java, LinePlanner.java, ImportViews.java, ImportDrafts.java,
      UploadGate.java, UploadSource.java, ImportService.java, ImportController.java,
      BankRequestController.java, ImportPreview.java, FixedQuestion.java, LatestImport.java,
      BankRequestBody.java                                                        Task 7
      SortLine.java, SortList.java,
      TagRequest.java, TagResult.java, UndoResult.java, FixedAnswerRequest.java, ColumnMapRequest.java,
      MappedLine.java, ColumnMapPreview.java, SortService.java, DiscardResult.java
      (+ ImportService, ImportDrafts, ImportController, MerchantRuleService edits) Task 8
      CommitResult.java, MiscCashRequest.java, MiscCashResult.java, SavingsTransfer.java,
      SavingsTransferListener.java, CommitService.java, MatchService.java
      (+ StatementTxnRepository, MerchantRuleService, ImportController edits)          Task 9
    ingestion/TransactionService.java and Plan 3's controller, entity, response (hooks)  Task 9
  src/test/java/in/gullak/
    common/crypto/FieldCipherTest.java, EncryptionKeyCheckTest.java              Task 1
    common/error/ErrorDetailsTest.java                                           Task 1
    ingestion/statements/samples/SamplePdf.java, SampleMoney.java, Expected.java, HdfcSample.java,
      SpecialSamples.java, WriteSamples.java                                     Task 2 (WriteSamples extended in Task 3)
    ingestion/statements/samples/CommonRows.java, IciciSample.java, SbiSample.java, AxisSample.java,
      KotakSample.java, YesBankSample.java                                       Task 3
    ingestion/statements/Samples.java, TestParsers.java, Failures.java,
      AmountParserTest.java, BankLayoutReaderTest.java, PdfSafetyTest.java, StatementParserTest.java   Task 2
    ingestion/statements/BankReadersTest.java                                    Task 3
    ingestion/statements/StatementDateFormatTest.java, CsvTest.java             Task 4
    ingestion/categorise/MerchantTextTest.java, CategoriserTest.java, SuggesterTest.java,
      LineClassifierTest.java                                                    Task 5
    ingestion/matching/MatcherTest.java, FixedCostDetectorTest.java, CashCoverTest.java,
      LoggingAccuracyTest.java                                                   Task 6
    ingestion/imports/ImportTest.java, UploadApiTest.java, UploadOverHttpApiTest.java,
      UploadGateTest.java; common/web/BodyLimitExemptionTest.java                Task 7
    ingestion/imports/SortApiTest.java, ColumnMapApiTest.java                    Task 8
    support/RecordingBadgeTrigger.java, RecordingSavingsListener.java,
      ingestion/imports/CommitApiTest.java, UnlinkApiTest.java                   Task 9
    security/ImportSecurityApiTest.java                                          Task 10
  src/test/resources/statements/
    hdfc.pdf, hdfc.expected.json, hdfc-locked.pdf, hdfc-empty.pdf               Task 2 (generated)
    icici.*, sbi.*, axis.*, kotak.*, hdfc-malformed.*, yes-bank.pdf              Task 3 (generated)
    csv/standard-comma.csv, semicolon.csv, unknown-headers.csv, ambiguous-dates.csv,
      signed-amount.csv, formulas.csv                                            Task 4
app/
  src/lib/api-errors.ts, api.ts, api.test.ts, client.ts, query.ts, query.test.ts   Task 11
  src/components/ui/error-state.tsx (retryLabel)                                 Task 12
  src/lib/errors.ts, error-codes.ts (generated)                                  Task 1
  src/components/ui/button.tsx (ink variant)                                     Task 14
  jest.setup.ts (picker and file-system mocks; gesture-handler setup)            Tasks 11, 14
  src/features/imports/
    api.ts, hooks.ts, categories.ts, copy.ts, copy.test.ts, picker.ts, file-part.ts, file-part.web.ts,
    release.ts, release.web.ts, upload-store.tsx, upload-store.test.tsx, error-routes.ts,
    error-routes.test.ts                                                         Task 11
    components/upload-header.tsx, info-note.tsx, file-row.tsx, password-field.tsx, reading-steps.tsx,
    fixed-question.tsx;
    screens/upload-start-screen.tsx, password-screen.tsx, reading-screen.tsx, preview-screen.tsx;
    upload-flow.test.tsx                                                         Task 12
    screens/bank-error-screen.tsx, scanned-screen.tsx, problem-screen.tsx, column-map-screen.tsx;
    error-screens.test.tsx, column-map.test.tsx                                  Task 13
    components/swipe-card.tsx, swipe.ts, swipe.test.ts; screens/sort-screen.tsx; sort.test.tsx   Task 14
    components/link-badge.tsx, link-badge.test.tsx, entry-points.test.tsx       Task 15
  app/upload/_layout.tsx, index.tsx, password.tsx, reading.tsx, preview.tsx     Task 12
  app/upload/bank.tsx, scanned.tsx, problem.tsx, columns.tsx                    Task 13
  app/upload/sort.tsx                                                           Task 14
  app/_layout.tsx (upload stack), app/(tabs)/insights.tsx, src/features/home/today-section.tsx,
    Plan 3's spend detail screen (LinkBadge)                                     Task 15
  e2e/statement.yaml, e2e/wrong-password.yaml, e2e/assets/hdfc-locked.pdf, e2e/README.md   Task 15
docs/engineering-standards.md, README.md, docs/superpowers/specs/...-test-cases.md   Task 10
```

## Task overview

| # | Task | Owner | Test IDs | Red team |
|---|---|---|---|---|
| 1 | Error vocabulary, error details, field encryption | backend-engineer | SEC-03, SEC-02 (cipher half) | yes |
| 2 | PDF reading core, HDFC reader, parser executor, samples | backend-engineer | RD-01, RD-06 (HDFC), RD-07–14, RD-17, RD-22 (amounts), RD-24, RD-25, RD-26 (new), SEC-11, ERR-10 | yes |
| 3 | ICICI, SBI, Axis and Kotak readers, Yes Bank, malformed rows | backend-engineer | RD-02–06, RD-15, RD-16 | no |
| 4 | CSV reading and column mapping | backend-engineer | RD-18–23 | yes |
| 5 | Categorising, suggestions and line kinds | backend-engineer | CAT-01–08, CAT-09 (new) | no |
| 6 | Matching engine | backend-engineer | MAT-01–11, MAT-13–18 (rules), MAT-20 (maths) | no |
| 7 | Schema and the upload API | backend-engineer | API-IMP-01–07, 09, 12, 13, 15, 29–31; RD-13, RD-24 over HTTP; SEC-10 | yes |
| 8 | Column map, to-sort, tag and undo, fixed-cost answers, discard | backend-engineer | API-IMP-07 (map half), 08, 10, 11, 16–22, 26; CAT-07; API-IMP-32, 34 (new) | yes |
| 9 | Commit, links, unlink, misc cash, Plan 3 hooks | backend-engineer | API-IMP-14, 23–25, 27, 28; MAT-12, 13, 15, 17, 19, 20, 21; SEC-02; XP-07; API-IMP-33 (new) | yes |
| 10 | Security sweep, docs and test-case edits | qa-engineer | SEC-10, SEC-11 (HTTP), API-X-01 (imports), LOG-05 (imports), API-IMP-35, 36 (new) | yes |
| 11 | App: multipart client, imports API and hooks, upload store | app-engineer | APP-19 (file kept), ERR-12 (multipart) | yes |
| 12 | App: start, password, wrong password, reading, preview | app-engineer | APP-19 | yes |
| 13 | App: bank not supported, scanned, problem, CSV column mapping | app-engineer | APP-19, APP-32 (new) | yes |
| 14 | App: swipe-to-sort | app-engineer | APP-18 | no |
| 15 | App: entry points, link badge, E2E-04 and E2E-05 | app-engineer | APP-33 (new), E2E-04, E2E-05 | no |

---

### Task 1: Error vocabulary, error details, field encryption

**Owner:** backend-engineer (the two app files at the end are a mechanical regeneration). **Test IDs:** SEC-03, SEC-02 (cipher half; the database half is in Task 9). **Red team:** yes: key handling, nonce reuse, tampered ciphertext, a row moved to another user, what a missing or weak key does at startup.

**Files:**
- Create: `server/src/main/java/in/gullak/common/crypto/FieldCipher.java`, `server/src/main/java/in/gullak/common/crypto/EncryptionKeyCheck.java`, `server/src/main/java/in/gullak/common/error/BadRequestException.java`, `server/src/main/java/in/gullak/common/error/TooLargeException.java`, `server/src/main/java/in/gullak/common/error/ConflictException.java` (only if Plan 3 did not create it)
- Modify: `server/src/main/java/in/gullak/common/error/ErrorCode.java`, `ErrorBody.java`, `GullakException.java`, `UnprocessableException.java`, `GlobalExceptionHandler.java`, `server/src/main/java/in/gullak/common/log/Events.java`, `server/src/main/resources/application.yml`, `server/src/test/resources/application-test.yml`, `app/src/lib/errors.ts`, `app/src/lib/error-codes.ts` (generated)
- Test: `server/src/test/java/in/gullak/common/crypto/FieldCipherTest.java`, `server/src/test/java/in/gullak/common/crypto/EncryptionKeyCheckTest.java`, `server/src/test/java/in/gullak/common/error/ErrorDetailsTest.java`

**Interfaces:**
- Consumes: Plan 1's `ErrorCode`, `ErrorBody`, `GlobalExceptionHandler`; Plan 3's `ConflictException(ErrorCode, String)` and `NOT_LINKED` if present.
- Produces: `FieldCipher#encrypt(UUID owner, String plaintext): byte[]`, `#decrypt(UUID owner, byte[] blob): String`, `#hash(UUID owner, String text): String` (64 lowercase hex); `GullakException#details(): Map<String,Object>` and the 4-argument constructor; `UnprocessableException(ErrorCode, String, Map<String,?>)`; `BadRequestException(ErrorCode, String)` (400); `TooLargeException(String)` (413 `TOO_LARGE`); `ConflictException(ErrorCode, String)` (409); `ErrorBody.details` (omitted when null); error codes `PASSWORD_REQUIRED`, `WRONG_PASSWORD`, `UNSUPPORTED_BANK`, `SCANNED_PDF`, `NEEDS_COLUMN_MAP`, `UNREADABLE`, `INVALID_FILE`, `ALREADY_COMMITTED`, `NOTHING_TO_UNDO`; events `Events.IMPORT_FAILED` (`import.failed`) and `Events.BANK_REQUESTED` (`bank.requested`); the `gullak.crypto.key` property from `GULLAK_ENC_KEY`.

- [ ] **Step 1: Write the failing tests**

`server/src/test/java/in/gullak/common/crypto/FieldCipherTest.java`:

```java
package in.gullak.common.crypto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class FieldCipherTest {
    static final String KEY = Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.UTF_8));
    final FieldCipher cipher = new FieldCipher(KEY);
    final UUID owner = UUID.fromString("11111111-1111-4111-8111-111111111111");
    final UUID other = UUID.fromString("22222222-2222-4222-8222-222222222222");

    @Test
    void roundTripsUtf8Text() {
        byte[] blob = cipher.encrypt(owner, "UPI to priya.s@oksbi · ₹1,200");
        assertThat(cipher.decrypt(owner, blob)).isEqualTo("UPI to priya.s@oksbi · ₹1,200");
    }

    @Test
    void ciphertextNeverContainsThePlaintext() { // SEC-02, cipher half
        String text = "UPI/MURUGAN TEA STALL";
        byte[] blob = cipher.encrypt(owner, text);
        assertThat(new String(blob, StandardCharsets.ISO_8859_1)).doesNotContain("MURUGAN");
        assertThat(blob.length).isEqualTo(1 + 12 + text.getBytes(StandardCharsets.UTF_8).length + 16);
    }

    @Test
    void sameTextEncryptsDifferentlyEachTime() {
        assertThat(Arrays.equals(cipher.encrypt(owner, "ZEPTO"), cipher.encrypt(owner, "ZEPTO"))).isFalse();
    }

    @Test
    void anotherUsersIdCannotDecrypt() {
        byte[] blob = cipher.encrypt(owner, "SWIGGY");
        assertThatThrownBy(() -> cipher.decrypt(other, blob)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aFlippedByteIsDetected() {
        byte[] blob = cipher.encrypt(owner, "SWIGGY");
        blob[blob.length - 1] ^= 1;
        assertThatThrownBy(() -> cipher.decrypt(owner, blob)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aWrongKeyCannotDecrypt() {
        FieldCipher otherKey = new FieldCipher(Base64.getEncoder().encodeToString(new byte[32]));
        byte[] blob = cipher.encrypt(owner, "SWIGGY");
        assertThatThrownBy(() -> otherKey.decrypt(owner, blob)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void hashIsStablePerOwnerAndDiffersBetweenOwners() {
        String a = cipher.hash(owner, "key:KAKA DHABA");
        assertThat(a).matches("[0-9a-f]{64}").isEqualTo(cipher.hash(owner, "key:KAKA DHABA"));
        assertThat(cipher.hash(other, "key:KAKA DHABA")).isNotEqualTo(a);
        assertThat(cipher.hash(owner, "key:KAKA DHABA ")).isNotEqualTo(a);
    }
}
```

`server/src/test/java/in/gullak/common/crypto/EncryptionKeyCheckTest.java`:

```java
package in.gullak.common.crypto;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** SEC-03: without a usable GULLAK_ENC_KEY the server does not start, in any profile. */
class EncryptionKeyCheckTest {
    private static final String PROPERTY = "gullak.crypto.key";

    private static ApplicationContextRunner runner(String... profiles) {
        return new ApplicationContextRunner()
            .withInitializer(context -> context.getEnvironment().setActiveProfiles(profiles))
            .withUserConfiguration(FieldCipher.class, EncryptionKeyCheck.class);
    }

    @Test
    void missingKeyFailsToStart() {
        runner("prod").run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).rootCause().hasMessageContaining("GULLAK_ENC_KEY");
        });
        runner("local").withPropertyValues(PROPERTY + "=").run(context -> assertThat(context).hasFailed());
    }

    @Test
    void aKeyThatIsNotBase64OrNot32BytesFailsToStart() {
        runner("local").withPropertyValues(PROPERTY + "=not base64!").run(context -> assertThat(context).hasFailed());
        runner("local").withPropertyValues(PROPERTY + "=" + Base64.getEncoder().encodeToString(new byte[16]))
            .run(context -> assertThat(context.getStartupFailure()).rootCause().hasMessageContaining("32 bytes"));
    }

    @Test
    void prodRefusesTheTestKeyAndAnAllZeroKey() {
        runner("prod").withPropertyValues(PROPERTY + "=" + EncryptionKeyCheck.TEST_KEY)
            .run(context -> assertThat(context.getStartupFailure()).rootCause().hasMessageContaining("test key"));
        runner("prod").withPropertyValues(PROPERTY + "=" + Base64.getEncoder().encodeToString(new byte[32]))
            .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void prodStartsWithARealKey() {
        byte[] key = new byte[32];
        new java.security.SecureRandom().nextBytes(key);
        runner("prod").withPropertyValues(PROPERTY + "=" + Base64.getEncoder().encodeToString(key))
            .run(context -> assertThat(context).hasNotFailed().hasSingleBean(FieldCipher.class));
    }

    @Test
    void localMayUseTheTestKey() {
        runner("local").withPropertyValues(PROPERTY + "=" + EncryptionKeyCheck.TEST_KEY)
            .run(context -> assertThat(context).hasNotFailed().doesNotHaveBean(EncryptionKeyCheck.class));
    }
}
```

`server/src/test/java/in/gullak/common/error/ErrorDetailsTest.java`:

```java
package in.gullak.common.error;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.util.unit.DataSize;

class ErrorDetailsTest {
    final GlobalExceptionHandler handler = new GlobalExceptionHandler(DataSize.ofMegabytes(10));

    @Test
    void detailsTravelInTheBody() {
        Map<String, Object> details = new HashMap<>();
        details.put("bank", "Yes Bank");
        var response = handler.gullak(new UnprocessableException(ErrorCode.UNSUPPORTED_BANK, "We can't read this bank yet", details));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
        assertThat(response.getBody().code()).isEqualTo("UNSUPPORTED_BANK");
        assertThat(response.getBody().details()).containsEntry("bank", "Yes Bank");
    }

    @Test
    void aNullDetailValueIsKept() {
        Map<String, Object> details = new HashMap<>();
        details.put("bank", null);
        var response = handler.gullak(new UnprocessableException(ErrorCode.UNSUPPORTED_BANK, "x", details));
        assertThat(response.getBody().details()).containsKey("bank");
    }

    @Test
    void noDetailsMeansNoDetailsField() {
        var response = handler.gullak(new ConflictException(ErrorCode.ALREADY_COMMITTED, "Already added"));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody().details()).isNull();
    }

    @Test
    void tooLargeMessageComesFromTheConfiguredLimit() {
        assertThat(handler.tooLarge().getBody().message()).isEqualTo("That file is over 10 MB");
        assertThat(new GlobalExceptionHandler(DataSize.ofMegabytes(25)).tooLarge().getBody().message())
            .isEqualTo("That file is over 25 MB");
    }

    @Test
    void typedExceptionsCarryTheirStatus() {
        assertThat(handler.gullak(new BadRequestException(ErrorCode.INVALID_FILE, "Choose a PDF or CSV file")).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(handler.gullak(new TooLargeException("That file is over 10 MB")).getStatusCode())
            .isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.common.crypto.*' --tests 'in.gullak.common.error.ErrorDetailsTest'`
Expected: compilation fails (`FieldCipher`, `EncryptionKeyCheck`, `ConflictException`, the codes and the handler constructor do not exist).

- [ ] **Step 3: Error codes, exceptions and the handler**

In `ErrorCode.java`, add these lines immediately before `INTERNAL(false);` (after any codes Plans 2 and 3 appended):

```java
    PASSWORD_REQUIRED(false),
    WRONG_PASSWORD(true),
    UNSUPPORTED_BANK(false),
    SCANNED_PDF(false),
    NEEDS_COLUMN_MAP(false),
    UNREADABLE(false),
    INVALID_FILE(false),
    ALREADY_COMMITTED(false),
    NOTHING_TO_UNDO(false),
```

`WRONG_PASSWORD` is `true` because the standard lists a wrong statement password as a WARN. If Plan 3 did not add `NOT_LINKED`, add `NOT_LINKED(false),` in the same place (Task 9 needs it).

`GullakException.java` (whole file):

```java
package in.gullak.common.error;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;

public class GullakException extends RuntimeException {
    private final ErrorCode code;
    private final HttpStatus status;
    private final Map<String, Object> details;

    public GullakException(ErrorCode code, HttpStatus status, String message) {
        this(code, status, message, Map.of());
    }

    /**
     * {@code details} goes to the client as it is: ids, counts and the caller's own data only, never secrets.
     * Null values are allowed (an unknown bank name is sent as null).
     */
    public GullakException(ErrorCode code, HttpStatus status, String message, Map<String, ?> details) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = Collections.unmodifiableMap(new LinkedHashMap<>(details));
    }

    public ErrorCode code() { return code; }
    public HttpStatus status() { return status; }
    public Map<String, Object> details() { return details; }
}
```

`UnprocessableException.java` (whole file):

```java
package in.gullak.common.error;

import java.util.Map;
import org.springframework.http.HttpStatus;

public class UnprocessableException extends GullakException {
    public UnprocessableException(ErrorCode code, String message) {
        super(code, HttpStatus.UNPROCESSABLE_ENTITY, message);
    }

    public UnprocessableException(ErrorCode code, String message, Map<String, ?> details) {
        super(code, HttpStatus.UNPROCESSABLE_ENTITY, message, details);
    }
}
```

`BadRequestException.java`:

```java
package in.gullak.common.error;

import org.springframework.http.HttpStatus;

/** A 400 with a specific code that is not about one request field (INVALID_FILE). Field problems use ValidationException. */
public class BadRequestException extends GullakException {
    public BadRequestException(ErrorCode code, String message) {
        super(code, HttpStatus.BAD_REQUEST, message);
    }
}
```

`TooLargeException.java`:

```java
package in.gullak.common.error;

import org.springframework.http.HttpStatus;

public class TooLargeException extends GullakException {
    public TooLargeException(String message) {
        super(ErrorCode.TOO_LARGE, HttpStatus.PAYLOAD_TOO_LARGE, message);
    }
}
```

`ConflictException.java` (skip this file if Plan 3 already created one with this constructor):

```java
package in.gullak.common.error;

import org.springframework.http.HttpStatus;

public class ConflictException extends GullakException {
    public ConflictException(ErrorCode code, String message) {
        super(code, HttpStatus.CONFLICT, message);
    }
}
```

`ErrorBody.java` (whole file):

```java
package in.gullak.common.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorBody(String code, String message, List<FieldProblem> fields, String errorId, Map<String, Object> details) {
    public record FieldProblem(String field, String message) {}

    public ErrorBody(String code, String message, List<FieldProblem> fields, String errorId) {
        this(code, message, fields, errorId, null);
    }

    public static ErrorBody of(ErrorCode code, String message) {
        return new ErrorBody(code.name(), message, null, null, null);
    }
}
```

In `GlobalExceptionHandler.java`, add the imports `org.springframework.beans.factory.annotation.Value` and `org.springframework.util.unit.DataSize`, then add the field and constructor at the top of the class and replace the `gullak` and `tooLarge` methods (Plan 1 cleanup: the "10 MB" literal now comes from configuration):

```java
    private final String tooLargeMessage;

    public GlobalExceptionHandler(@Value("${spring.servlet.multipart.max-file-size:10MB}") DataSize maxFileSize) {
        this.tooLargeMessage = "That file is over " + maxFileSize.toMegabytes() + " MB";
    }

    @ExceptionHandler(GullakException.class)
    ResponseEntity<ErrorBody> gullak(GullakException e) {
        if (e.code().warn()) {
            log.warn("error.expected code={}", e.code());
        }
        Map<String, Object> details = e.details().isEmpty() ? null : e.details();
        return ResponseEntity.status(e.status()).body(new ErrorBody(e.code().name(), e.getMessage(), null, null, details));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ErrorBody> tooLarge() {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(ErrorBody.of(ErrorCode.TOO_LARGE, tooLargeMessage));
    }
```

Also add `import java.util.Map;`. The `validation` handler still calls `gullak(e)` and is unchanged.

In `Events.java`, add before the private constructor:

```java
    public static final String IMPORT_FAILED = "import.failed";
    public static final String BANK_REQUESTED = "bank.requested";
```

- [ ] **Step 4: The cipher and the startup check**

`server/src/main/java/in/gullak/common/crypto/FieldCipher.java`:

```java
package in.gullak.common.crypto;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * AES-256-GCM for statement text at rest (spec 4.5: merchant_raw_enc), bound to the owner's user id as associated
 * data, plus a keyed HMAC for values that are matched later (rule patterns, payee patterns, fingerprints).
 * Blob layout: version (1 byte) | nonce (12 bytes) | ciphertext with the 16-byte tag.
 */
@Component
public class FieldCipher {
    private static final byte VERSION = 1;
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final byte[] HASH_LABEL = "gullak-field-hash-v1".getBytes(StandardCharsets.UTF_8);

    private final SecretKey key;
    private final SecretKey hashKey;
    private final SecureRandom random = new SecureRandom();

    public FieldCipher(@Value("${gullak.crypto.key:}") String base64Key) {
        if (base64Key == null || base64Key.isBlank()) {
            throw new IllegalStateException("GULLAK_ENC_KEY must be set to 32 random bytes in base64 "
                + "(openssl rand -base64 32). Statement text cannot be stored without it.");
        }
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(base64Key.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("GULLAK_ENC_KEY is not valid base64", e);
        }
        if (raw.length != 32) {
            throw new IllegalStateException("GULLAK_ENC_KEY must decode to 32 bytes for AES-256, not " + raw.length);
        }
        this.key = new SecretKeySpec(raw, "AES");
        this.hashKey = new SecretKeySpec(hmac(new SecretKeySpec(raw, "HmacSHA256"), HASH_LABEL), "HmacSHA256");
    }

    public byte[] encrypt(UUID owner, String plaintext) {
        byte[] nonce = new byte[NONCE_BYTES];
        random.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(ownerBytes(owner));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return ByteBuffer.allocate(1 + NONCE_BYTES + sealed.length).put(VERSION).put(nonce).put(sealed).array();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("AES-GCM is not available", e);
        }
    }

    public String decrypt(UUID owner, byte[] blob) {
        if (blob == null || blob.length < 1 + NONCE_BYTES + TAG_BITS / 8 || blob[0] != VERSION) {
            throw new IllegalStateException("A stored field is not in the expected format");
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, blob, 1, NONCE_BYTES));
            cipher.updateAAD(ownerBytes(owner));
            byte[] plain = cipher.doFinal(blob, 1 + NONCE_BYTES, blob.length - 1 - NONCE_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("A stored field could not be decrypted", e);
        }
    }

    /** HMAC-SHA256 of owner and text, lowercase hex. Equal inputs give equal hashes; nothing can be read back. */
    public String hash(UUID owner, String text) {
        byte[] input = (owner + "\n" + text).getBytes(StandardCharsets.UTF_8);
        return HexFormat.of().formatHex(hmac(hashKey, input));
    }

    private static byte[] hmac(SecretKey k, byte[] input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(k);
            return mac.doFinal(input);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 is not available", e);
        }
    }

    private static byte[] ownerBytes(UUID owner) {
        return ByteBuffer.allocate(16).putLong(owner.getMostSignificantBits()).putLong(owner.getLeastSignificantBits()).array();
    }
}
```

`server/src/main/java/in/gullak/common/crypto/EncryptionKeyCheck.java`:

```java
package in.gullak.common.crypto;

import java.util.Base64;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * FieldCipher already refuses a missing or malformed key in every profile. Production also refuses the key that is
 * published in application-test.yml and an all-zero key, the two values most likely to be copied by mistake.
 */
@Component
@Profile("prod")
class EncryptionKeyCheck {
    /** Base64 of "test-only-generated-key-01234567"; the value in src/test/resources/application-test.yml. */
    static final String TEST_KEY = "dGVzdC1vbmx5LWdlbmVyYXRlZC1rZXktMDEyMzQ1Njc=";

    EncryptionKeyCheck(@Value("${gullak.crypto.key:}") String key) {
        String k = key == null ? "" : key.trim();
        if (k.equals(TEST_KEY)) {
            throw new IllegalStateException("GULLAK_ENC_KEY is the test key; generate a real one for prod");
        }
        if (k.equals(Base64.getEncoder().encodeToString(new byte[32]))) {
            throw new IllegalStateException("GULLAK_ENC_KEY is all zeros; generate a real one for prod");
        }
    }
}
```

In `server/src/main/resources/application.yml`, under the existing `gullak:` key add:

```yaml
  crypto:
    # 32 random bytes, base64: openssl rand -base64 32. Required in every profile; prod refuses the test key.
    key: ${GULLAK_ENC_KEY:}
```

In `server/src/test/resources/application-test.yml`, under `gullak:` add:

```yaml
  crypto:
    key: dGVzdC1vbmx5LWdlbmVyYXRlZC1rZXktMDEyMzQ1Njc=
```

- [ ] **Step 5: Run the server suite**

Run: `cd server && ./gradlew test`
Expected: PASS, including the three new classes and every Plan 1–3 test (the whole context now needs the key, which the test profile provides).

- [ ] **Step 6: App error messages**

Run `cd app && npm run gen:errors`. Then add these entries to the `messages` object in `app/src/lib/errors.ts` (it is typed `Record<ErrorCode, string>`, so `npm run typecheck` fails until every new code has one):

```ts
  PASSWORD_REQUIRED: "This PDF has a password",
  WRONG_PASSWORD: "That password didn't open the file. Check capital letters, then try your customer ID or date of birth.",
  UNSUPPORTED_BANK: "We can't read PDFs from this bank yet. Upload a CSV instead.",
  SCANNED_PDF: "This PDF is a scan with no text to read",
  NEEDS_COLUMN_MAP: "Tell us which column is which",
  UNREADABLE: "We couldn't read this file. Download it again from your bank and try once more.",
  INVALID_FILE: "Choose a PDF or CSV file",
  ALREADY_COMMITTED: "This statement is already added",
  NOTHING_TO_UNDO: "Nothing to undo",
```

If Step 3 added `NOT_LINKED`, also add `NOT_LINKED: "This spend isn't linked to a bank line",`.

Run: `cd app && npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Red team**

Dispatch `red-team` with task id `plan-04-task-1`: start the server with no key, a 16-byte key, the test key under `prod`; try to decrypt a blob with another user's id; check that `FieldCipher` never logs and that the key never appears in startup logs or the actuator. Findings go to `docs/reports/red-team/plan-04-task-1.md`; a High or Critical finding is fixed in this task.

- [ ] **Step 8: Commit**

```bash
git add server/src/main/java/in/gullak/common server/src/main/resources/application.yml \
  server/src/test/resources/application-test.yml server/src/test/java/in/gullak/common/crypto \
  server/src/test/java/in/gullak/common/error/ErrorDetailsTest.java app/src/lib/errors.ts app/src/lib/error-codes.ts
git commit -m "feat(server): import error codes, error details and AES-GCM field encryption

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: PDF reading core, HDFC reader, parser executor, samples

**Owner:** backend-engineer. **Test IDs:** RD-01, RD-06 (HDFC), RD-07, RD-08, RD-09, RD-10, RD-11, RD-12, RD-13, RD-14, RD-17, RD-22 (amount half), RD-24, RD-25, RD-26 (new: decompression bomb), SEC-11, ERR-10. **Red team:** yes: hostile PDFs (JavaScript, embedded files, a decompression bomb, a truncated file, a slow file, a PNG renamed), whether a timed-out parse keeps a thread, whether any temp file appears.

**Files:**
- Modify: `server/build.gradle.kts`, `server/src/main/resources/application.yml`
- Create (main, `server/src/main/java/in/gullak/ingestion/statements/`): `Bank.java`, `Direction.java`, `FileKind.java`, `RawLine.java`, `ParsedStatement.java`, `ImportProperties.java`, `ReadFailures.java`, `AmountParser.java`, `FileSniffer.java`, `DateWindow.java`, `PdfText.java`, `BankDetector.java`, `PdfStatementReader.java`, `ReaderOutput.java`, `BankLayout.java`, `BankLayoutReader.java`, `HdfcReader.java`, `StatementParser.java`
- Create (test, `server/src/test/java/in/gullak/ingestion/statements/`): `samples/SampleRow.java`, `samples/SampleMoney.java`, `samples/SamplePdf.java`, `samples/Expected.java`, `samples/HdfcSample.java`, `samples/SpecialSamples.java`, `samples/WriteSamples.java`, `Samples.java`, `TestParsers.java`, `Failures.java`, `AmountParserTest.java`, `BankLayoutReaderTest.java`, `HdfcReaderTest.java`, `PdfSafetyTest.java`, `StatementParserTest.java`
- Create (generated, committed): `server/src/test/resources/statements/hdfc.pdf`, `hdfc.expected.json`, `hdfc-locked.pdf`, `hdfc-empty.pdf`

**Interfaces:**
- Consumes: `ReadFailures` builds on Task 1's `UnprocessableException(code, message, details)`, `BadRequestException`, `TooLargeException`; `Ist`, `Events.IMPORT_FAILED`.
- Produces: `StatementParser` (Spring bean) with `FileKind sniff(byte[])`, `ParsedStatement readPdf(byte[] bytes, String password)`, `int busyThreads()`; `ParsedStatement(FileKind kind, String bank, String bankName, String bankLabel, boolean unlocked, List<RawLine> lines, int unreadable)`; `RawLine(int rowNo, LocalDate date, long amountPaise, Direction direction, String description)`; `Direction { DEBIT, CREDIT }`; `FileKind { PDF, CSV }`; `Bank` with `displayName()`, `label()`, `marker()`; `ImportProperties` (`gullak.imports.*`); `AmountParser.paise(String): OptionalLong`, `AmountParser.marker(String): Optional<Direction>`; `DateWindow.filter(List<RawLine>, LocalDate today)`; `PdfStatementReader` (`bank()`, `read(List<String>)`) and the abstract `BankLayoutReader(Bank, BankLayout)` that Task 3's readers extend; `ReadFailures.*`. Test side: `HdfcSample.rows()`, `HdfcSample.PASSWORD` (`GULLAK2026`), `SamplePdf`, `TestParsers.parser(...)`, `TestParsers.readers()`, `Samples.bytes(name)`, `Samples.assertMatches(statement, name)`, `Failures.codeOf(call)`, `./gradlew writeStatementSamples`.

- [ ] **Step 1: Dependency, settings and the sample task**

In `server/build.gradle.kts`, add to `dependencies`:

```kotlin
	implementation("org.apache.pdfbox:pdfbox:3.0.5")
```

and at the end of the file:

```kotlin
tasks.register<JavaExec>("writeStatementSamples") {
	group = "verification"
	description = "Regenerates the synthetic statement samples in src/test/resources/statements"
	classpath = sourceSets["test"].runtimeClasspath
	mainClass = "in.gullak.ingestion.statements.samples.WriteSamples"
	args("src/test/resources/statements")
}
```

Use the newest `3.0.x` patch of PDFBox if one is newer than `3.0.5`; never a `2.x` (different API) or a `4.0` pre-release.

In `server/src/main/resources/application.yml`, replace the `spring.servlet.multipart` block and add the imports settings under `gullak:`:

```yaml
  servlet:
    multipart:
      max-file-size: 10MB
      max-request-size: 11MB
      # Above max-file-size, so an upload is never written to a temp file (spec 4.6: no file on disk).
      file-size-threshold: 11MB
      # Parse the multipart body only when the controller asks, after the rate limit and the upload gate.
      resolve-lazily: true
```

```yaml
  imports:
    max-file-size: 10MB
    parse-timeout: 10s
    parser-threads: 2
    max-concurrent-uploads: 4
    uploads-per-hour: 10
    max-lines: 5000
    max-pages: 100
    max-decoded-bytes: 32MB
    max-glyphs-per-page: 50000
```

- [ ] **Step 2: The statement model**

`Bank.java`:

```java
package in.gullak.ingestion.statements;

/** Banks whose PDF statements V1 reads. {@code marker} is the upper-case text their statement header carries. */
public enum Bank {
    HDFC("HDFC Bank", "HDFC", "HDFC BANK"),
    ICICI("ICICI Bank", "ICICI", "ICICI BANK"),
    SBI("State Bank of India", "SBI", "STATE BANK OF INDIA"),
    AXIS("Axis Bank", "Axis", "AXIS BANK"),
    KOTAK("Kotak Mahindra Bank", "Kotak", "KOTAK MAHINDRA BANK");

    private final String displayName;
    private final String label;
    private final String marker;

    Bank(String displayName, String label, String marker) {
        this.displayName = displayName;
        this.label = label;
        this.marker = marker;
    }

    public String displayName() { return displayName; }
    public String label() { return label; }
    public String marker() { return marker; }
}
```

`Direction.java`:

```java
package in.gullak.ingestion.statements;

public enum Direction { DEBIT, CREDIT }
```

`FileKind.java`:

```java
package in.gullak.ingestion.statements;

public enum FileKind { PDF, CSV }
```

`RawLine.java`:

```java
package in.gullak.ingestion.statements;

import java.time.LocalDate;
import java.util.Objects;

/** One transaction as a reader found it. {@code description} is statement text: never log it. */
public record RawLine(int rowNo, LocalDate date, long amountPaise, Direction direction, String description) {
    public RawLine {
        Objects.requireNonNull(date, "date");
        Objects.requireNonNull(direction, "direction");
        Objects.requireNonNull(description, "description");
        if (amountPaise <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
    }
}
```

`ParsedStatement.java`:

```java
package in.gullak.ingestion.statements;

import java.util.List;

/**
 * A statement read into memory. {@code bank} is a {@link Bank} name for a PDF or "csv:<signature>" for a CSV;
 * {@code unreadable} counts rows that looked like transactions but could not be read (RD-15).
 */
public record ParsedStatement(FileKind kind, String bank, String bankName, String bankLabel, boolean unlocked,
                              List<RawLine> lines, int unreadable) {
    public ParsedStatement {
        lines = List.copyOf(lines);
    }
}
```

`ImportProperties.java`:

```java
package in.gullak.ingestion.statements;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("gullak.imports")
public record ImportProperties(
    @NotNull DataSize maxFileSize,
    @NotNull Duration parseTimeout,
    @Positive int parserThreads,
    @Positive int maxConcurrentUploads,
    @Positive int uploadsPerHour,
    @Positive int maxLines,
    @Positive int maxPages,
    @NotNull DataSize maxDecodedBytes,
    @Positive int maxGlyphsPerPage) {}
```

`ReadFailures.java`:

```java
package in.gullak.ingestion.statements;

import in.gullak.common.error.BadRequestException;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.TooLargeException;
import in.gullak.common.error.UnprocessableException;
import java.util.HashMap;
import java.util.Map;
import org.springframework.util.unit.DataSize;

/** The outcomes of spec 2.3 that are not a preview, each with the message the API returns. */
public final class ReadFailures {
    private ReadFailures() {}

    public static UnprocessableException passwordRequired() {
        return new UnprocessableException(ErrorCode.PASSWORD_REQUIRED, "This PDF needs its password");
    }

    public static UnprocessableException wrongPassword() {
        return new UnprocessableException(ErrorCode.WRONG_PASSWORD, "That password didn't open the file");
    }

    public static UnprocessableException scanned() {
        return new UnprocessableException(ErrorCode.SCANNED_PDF, "This PDF is a scan with no text to read");
    }

    public static UnprocessableException unreadable(String message) {
        return new UnprocessableException(ErrorCode.UNREADABLE, message);
    }

    public static UnprocessableException tooLong() {
        return unreadable("That statement is too long. Upload one month at a time.");
    }

    /** {@code name} is the bank's display name, or null when the header names no bank we know. */
    public static UnprocessableException unsupportedBank(String name) {
        Map<String, Object> details = new HashMap<>();
        details.put("bank", name);
        String message = name == null ? "We can't read PDFs from this bank yet" : "We can't read " + name + " PDFs yet";
        return new UnprocessableException(ErrorCode.UNSUPPORTED_BANK, message, details);
    }

    public static BadRequestException invalidFile() {
        return new BadRequestException(ErrorCode.INVALID_FILE, "Choose a PDF or CSV file");
    }

    public static TooLargeException tooLarge(DataSize max) {
        return new TooLargeException("That file is over " + max.toMegabytes() + " MB");
    }
}
```

- [ ] **Step 3: Write the failing tests for amounts and the layout reader**

`server/src/test/java/in/gullak/ingestion/statements/AmountParserTest.java` (RD-22, amount half):

```java
package in.gullak.ingestion.statements;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Optional;
import java.util.OptionalLong;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class AmountParserTest {
    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "1,234.00|123400", "1,23,456.50|12345650", "-500|-50000", "500-|-50000", "(500.00)|-50000",
        "+45|4500", "₹ 1,200|120000", "INR 99.5|9950", "Rs.60|6000", "0.07|7", "45|4500"})
    void parsesBankAmountsToPaise(String text, long paise) {
        assertThat(AmountParser.paise(text)).isEqualTo(OptionalLong.of(paise));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "  ", "abc", "1.234,00", "12.345", "1e5", "--5", "4S.00"})
    void rejectsWhatIsNotAnAmount(String text) {
        assertThat(AmountParser.paise(text)).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"DR,DEBIT", "Dr,DEBIT", "d,DEBIT", "Debit,DEBIT", "CR,CREDIT", "cr,CREDIT", "C,CREDIT", "Credit,CREDIT"})
    void readsDrCrMarkers(String marker, Direction direction) {
        assertThat(AmountParser.marker(marker)).contains(direction);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "X", "DRCR", "-"})
    void rejectsUnknownMarkers(String marker) {
        assertThat(AmountParser.marker(marker)).isEqualTo(Optional.empty());
    }
}
```

`server/src/test/java/in/gullak/ingestion/statements/BankLayoutReaderTest.java`:

```java
package in.gullak.ingestion.statements;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The shared row logic, on text lines as PdfText produces them (whitespace already collapsed). */
class BankLayoutReaderTest {
    static final String HEADER = "Date Narration Chq./Ref.No. Value Dt Withdrawal Amt. Deposit Amt. Closing Balance";
    final HdfcReader reader = new HdfcReader();

    @Test
    void directionComesFromTheBalance() {
        ReaderOutput out = reader.read(List.of(
            "HDFC BANK Ltd.", "Opening Balance : 1,000.00", HEADER,
            "01/10/26 NEFT CR-ACME TECH PVT LTD-SALARY 0000429812340000 01/10/26 500.00 1,500.00",
            "02/10/26 UPI/MURUGAN TEA STALL 0000429812340001 02/10/26 45.00 1,455.00",
            "STATEMENT SUMMARY"));
        assertThat(out.unreadable()).isZero();
        assertThat(out.lines()).extracting(RawLine::direction).containsExactly(Direction.CREDIT, Direction.DEBIT);
        assertThat(out.lines().get(1)).isEqualTo(
            new RawLine(2, LocalDate.of(2026, 10, 2), 4500, Direction.DEBIT, "UPI/MURUGAN TEA STALL"));
    }

    @Test
    void aWrappedNarrationIsJoinedToItsRow() {
        ReaderOutput out = reader.read(List.of(
            "Opening Balance : 1,000.00", HEADER,
            "02/10/26 UPI/MURUGAN TEA 0000429812340001 02/10/26 45.00 955.00",
            "STALL CHENNAI",
            "STATEMENT SUMMARY"));
        assertThat(out.lines()).singleElement().extracting(RawLine::description).isEqualTo("UPI/MURUGAN TEA STALL CHENNAI");
    }

    @Test
    void aRowWhoseBalanceDoesNotAddUpIsUnreadable() {
        ReaderOutput out = reader.read(List.of(
            "Opening Balance : 1,000.00", HEADER,
            "02/10/26 UPI/MURUGAN TEA STALL 0000429812340001 02/10/26 45.00 900.00",
            "03/10/26 UPI/KAKA DHABA 0000429812340002 03/10/26 150.00 750.00",
            "STATEMENT SUMMARY"));
        assertThat(out.unreadable()).isEqualTo(1);
        assertThat(out.lines()).singleElement().extracting(RawLine::amountPaise).isEqualTo(15000L);
    }

    @Test
    void aDatedRowMissingAColumnIsUnreadableAndItsBalanceCarriesOn() {
        ReaderOutput out = reader.read(List.of(
            "Opening Balance : 1,000.00", HEADER,
            "02/10/26 UPI/MURUGAN TEA STALL 0000429812340001 02/10/26 955.00",
            "03/10/26 UPI/KAKA DHABA 0000429812340002 03/10/26 150.00 805.00",
            "STATEMENT SUMMARY"));
        assertThat(out.unreadable()).isEqualTo(1);
        assertThat(out.lines()).singleElement().extracting(RawLine::direction).isEqualTo(Direction.DEBIT);
    }

    @Test
    void repeatedPageHeadersAndFootersAreSkipped() {
        ReaderOutput out = reader.read(List.of(
            "HDFC BANK Ltd.", "Opening Balance : 1,000.00", HEADER,
            "02/10/26 UPI/MURUGAN TEA STALL 0000429812340001 02/10/26 45.00 955.00",
            "Page 1 of 2", "HDFC BANK Ltd.", "Statement of account", HEADER,
            "03/10/26 UPI/KAKA DHABA 0000429812340002 03/10/26 150.00 805.00",
            "STATEMENT SUMMARY", "Page 2 of 2"));
        assertThat(out.lines()).hasSize(2);
        assertThat(out.lines().get(0).description()).isEqualTo("UPI/MURUGAN TEA STALL");
    }

    @Test
    void noOpeningBalanceMeansTheFirstRowCannotBeRead() {
        ReaderOutput out = reader.read(List.of(HEADER,
            "02/10/26 UPI/MURUGAN TEA STALL 0000429812340001 02/10/26 45.00 955.00",
            "03/10/26 UPI/KAKA DHABA 0000429812340002 03/10/26 150.00 805.00"));
        assertThat(out.unreadable()).isEqualTo(1);
        assertThat(out.lines()).hasSize(1);
    }
}
```

- [ ] **Step 4: Run to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.statements.*'`
Expected: compilation fails (`AmountParser`, `HdfcReader`, `ReaderOutput` do not exist).

- [ ] **Step 5: Amounts, the reader contract and the HDFC layout**

`AmountParser.java`:

```java
package in.gullak.ingestion.statements;

import java.util.Locale;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.regex.Pattern;

/** Bank amount text to signed paise. Commas are thousands separators (Indian or western grouping). */
public final class AmountParser {
    private static final Pattern NUMBER = Pattern.compile("\\d+(\\.\\d{1,2})?");

    private AmountParser() {}

    public static OptionalLong paise(String text) {
        if (text == null) {
            return OptionalLong.empty();
        }
        String s = text.strip()
            .replace("₹", "").replace("INR", "").replace("Rs.", "").replace("Rs", "")
            .replace(",", "").replace(" ", "").replace(" ", "");
        boolean negative = false;
        if (s.length() > 2 && s.startsWith("(") && s.endsWith(")")) {
            negative = true;
            s = s.substring(1, s.length() - 1);
        }
        if (s.startsWith("-")) {
            negative = !negative;
            s = s.substring(1);
        } else if (s.endsWith("-")) {
            negative = !negative;
            s = s.substring(0, s.length() - 1);
        } else if (s.startsWith("+")) {
            s = s.substring(1);
        }
        if (!NUMBER.matcher(s).matches()) {
            return OptionalLong.empty();
        }
        int dot = s.indexOf('.');
        String whole = dot < 0 ? s : s.substring(0, dot);
        String fraction = dot < 0 ? "" : s.substring(dot + 1);
        if (whole.length() > 13) {
            return OptionalLong.empty();
        }
        long paise = Long.parseLong(whole) * 100 + (fraction.isEmpty() ? 0 : Long.parseLong((fraction + "0").substring(0, 2)));
        return OptionalLong.of(negative ? -paise : paise);
    }

    public static Optional<Direction> marker(String text) {
        if (text == null) {
            return Optional.empty();
        }
        return switch (text.strip().toUpperCase(Locale.ROOT)) {
            case "DR", "D", "DEBIT", "WITHDRAWAL" -> Optional.of(Direction.DEBIT);
            case "CR", "C", "CREDIT", "DEPOSIT" -> Optional.of(Direction.CREDIT);
            default -> Optional.empty();
        };
    }
}
```

`PdfStatementReader.java`:

```java
package in.gullak.ingestion.statements;

import java.util.List;

/** One bank's layout rules. Swapping a synthetic sample for a real one touches only the bank's reader. */
public interface PdfStatementReader {
    Bank bank();

    /** {@code lines} are the PDF's text lines in reading order, whitespace collapsed, blanks removed. */
    ReaderOutput read(List<String> lines);
}
```

`ReaderOutput.java`:

```java
package in.gullak.ingestion.statements;

import java.util.List;

public record ReaderOutput(List<RawLine> lines, int unreadable) {
    public ReaderOutput {
        lines = List.copyOf(lines);
    }
}
```

`BankLayout.java`:

```java
package in.gullak.ingestion.statements;

import java.time.format.DateTimeFormatter;
import java.util.regex.Pattern;

/**
 * A bank's table, described as regular expressions over collapsed text lines.
 * {@code row} must define the named groups {@code date}, {@code desc}, {@code amount} and {@code balance}, plus
 * {@code marker} (Dr or Cr) when {@code markerDirection} is true; otherwise the direction comes from the balance.
 * {@code opening} defines {@code bal}. {@code rowStart} matches any line that begins like a row, readable or not.
 */
public record BankLayout(
    Pattern tableHeader,
    Pattern row,
    Pattern rowStart,
    DateTimeFormatter dateFormat,
    Pattern opening,
    Pattern tableEnd,
    Pattern ignore,
    boolean markerDirection) {}
```

`BankLayoutReader.java`:

```java
package in.gullak.ingestion.statements;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.OptionalLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Reads a bank table line by line: rows, wrapped narrations, unreadable rows, repeated page headers. */
public abstract class BankLayoutReader implements PdfStatementReader {
    private static final Pattern TRAILING_MONEY = Pattern.compile("([\\d,]+\\.\\d{2})(?:\\s*\\((?:Cr|Dr)\\))?$");
    private static final int MAX_DESCRIPTION = 200;

    private final Bank bank;
    private final BankLayout layout;

    protected BankLayoutReader(Bank bank, BankLayout layout) {
        this.bank = bank;
        this.layout = layout;
    }

    @Override
    public Bank bank() {
        return bank;
    }

    @Override
    public ReaderOutput read(List<String> lines) {
        List<RawLine> out = new ArrayList<>();
        int unreadable = 0;
        Long balance = null;
        boolean inTable = false;
        Row current = null;
        for (String line : lines) {
            if (!inTable) {
                Matcher opening = layout.opening().matcher(line);
                if (opening.find()) {
                    balance = money(opening.group("bal"));
                }
                if (layout.tableHeader().matcher(line).find()) {
                    inTable = true;
                }
                continue;
            }
            if (layout.tableEnd().matcher(line).find()) {
                flush(current, out);
                current = null;
                inTable = false;
                continue;
            }
            if (layout.ignore().matcher(line).find() || layout.tableHeader().matcher(line).find()) {
                continue;
            }
            Matcher row = layout.row().matcher(line);
            if (row.matches()) {
                flush(current, out);
                current = null;
                Long rowBalance = money(row.group("balance"));
                Row parsed = parse(row, balance, rowBalance);
                balance = rowBalance;
                if (parsed == null) {
                    unreadable++;
                } else {
                    current = parsed;
                }
                continue;
            }
            if (layout.rowStart().matcher(line).find()) {
                flush(current, out);
                current = null;
                unreadable++;
                Matcher tail = TRAILING_MONEY.matcher(line);
                if (tail.find()) {
                    balance = money(tail.group(1));
                }
                continue;
            }
            if (current != null) {
                current.append(line);
            }
        }
        flush(current, out);
        return new ReaderOutput(out, unreadable);
    }

    private Row parse(Matcher row, Long previousBalance, Long rowBalance) {
        LocalDate date;
        try {
            date = LocalDate.parse(row.group("date"), layout.dateFormat());
        } catch (DateTimeParseException e) {
            return null;
        }
        Long amount = money(row.group("amount"));
        if (amount == null || amount <= 0) {
            return null;
        }
        Direction direction;
        if (layout.markerDirection()) {
            direction = AmountParser.marker(row.group("marker")).orElse(null);
        } else if (previousBalance == null || rowBalance == null) {
            direction = null;
        } else if (rowBalance - previousBalance == -amount) {
            direction = Direction.DEBIT;
        } else if (rowBalance - previousBalance == amount) {
            direction = Direction.CREDIT;
        } else {
            direction = null;
        }
        if (direction == null) {
            return null;
        }
        return new Row(date, amount, direction, row.group("desc").strip());
    }

    private static void flush(Row row, List<RawLine> out) {
        if (row != null) {
            out.add(new RawLine(out.size() + 1, row.date, row.amount, row.direction, row.description.toString()));
        }
    }

    private static Long money(String text) {
        OptionalLong p = AmountParser.paise(text);
        return p.isPresent() ? p.getAsLong() : null;
    }

    private static final class Row {
        final LocalDate date;
        final long amount;
        final Direction direction;
        final StringBuilder description;

        Row(LocalDate date, long amount, Direction direction, String description) {
            this.date = date;
            this.amount = amount;
            this.direction = direction;
            this.description = new StringBuilder(description);
        }

        void append(String more) {
            if (description.length() + 1 + more.length() <= MAX_DESCRIPTION) {
                description.append(' ').append(more);
            }
        }
    }
}
```

`HdfcReader.java`:

```java
package in.gullak.ingestion.statements;

import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * HDFC savings statement: Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance.
 * Dates are dd/MM/yy; only one of the two amount columns is filled, so the direction comes from the balance.
 */
@Component
class HdfcReader extends BankLayoutReader {
    HdfcReader() {
        super(Bank.HDFC, new BankLayout(
            Pattern.compile("^Date Narration .*Closing Balance$"),
            Pattern.compile("^(?<date>\\d{2}/\\d{2}/\\d{2}) (?<desc>.+?) (?<ref>\\d{8,20}) (?<vdate>\\d{2}/\\d{2}/\\d{2}) "
                + "(?<amount>[\\d,]+\\.\\d{2}) (?<balance>[\\d,]+\\.\\d{2})$"),
            Pattern.compile("^\\d{2}/\\d{2}/\\d{2} "),
            DateTimeFormatter.ofPattern("dd/MM/uu", Locale.ENGLISH).withResolverStyle(ResolverStyle.STRICT),
            Pattern.compile("Opening Balance\\s*:?\\s*(?<bal>[\\d,]+\\.\\d{2})"),
            Pattern.compile("^(STATEMENT SUMMARY|\\*+ ?End of Statement)"),
            Pattern.compile("^(Page \\d+ of \\d+|HDFC BANK Ltd\\.|Statement of account)$"),
            false));
    }
}
```

- [ ] **Step 6: Run the two unit tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.statements.AmountParserTest' --tests 'in.gullak.ingestion.statements.BankLayoutReaderTest'`
Expected: PASS.

- [ ] **Step 7: The sample builders**

`samples/SampleRow.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.time.LocalDate;

/** One synthetic statement row. Names and handles are invented; no real account is involved. */
public record SampleRow(LocalDate date, String narration, long paise, boolean credit) {}
```

`samples/SampleMoney.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.util.Locale;

final class SampleMoney {
    private SampleMoney() {}

    /** 12345600 → "123,456.00" */
    static String western(long paise) {
        return String.format(Locale.ROOT, "%,d.%02d", paise / 100, paise % 100);
    }

    /** 12345600 → "1,23,456.00" */
    static String indian(long paise) {
        String digits = Long.toString(paise / 100);
        StringBuilder out = new StringBuilder();
        int len = digits.length();
        if (len <= 3) {
            out.append(digits);
        } else {
            String head = digits.substring(0, len - 3);
            for (int i = 0; i < head.length(); i++) {
                if (i > 0 && (head.length() - i) % 2 == 0) {
                    out.append(',');
                }
                out.append(head.charAt(i));
            }
            out.append(',').append(digits.substring(len - 3));
        }
        return out + String.format(Locale.ROOT, ".%02d", paise % 100);
    }
}
```

`samples/Expected.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

/** What a reader must find in a sample (RD-01 to RD-05). Written next to the PDF as <name>.expected.json. */
public record Expected(String bank, int lineCount, LocalDate firstDate, LocalDate lastDate,
                       long debitTotalPaise, long creditTotalPaise, int unreadableCount) {

    /** {@code broken} holds zero-based indexes of rows drawn so that they cannot be read. */
    public static Expected of(String bank, List<SampleRow> rows, Set<Integer> broken) {
        int count = 0;
        long debit = 0;
        long credit = 0;
        LocalDate first = null;
        LocalDate last = null;
        for (int i = 0; i < rows.size(); i++) {
            if (broken.contains(i)) {
                continue;
            }
            SampleRow r = rows.get(i);
            count++;
            if (r.credit()) {
                credit += r.paise();
            } else {
                debit += r.paise();
            }
            first = first == null || r.date().isBefore(first) ? r.date() : first;
            last = last == null || r.date().isAfter(last) ? r.date() : last;
        }
        return new Expected(bank, count, first, last, debit, credit, broken.size());
    }

    public String json() {
        return "{\"bank\":\"" + bank + "\",\"lineCount\":" + lineCount
            + ",\"firstDate\":" + quoted(firstDate) + ",\"lastDate\":" + quoted(lastDate)
            + ",\"debitTotalPaise\":" + debitTotalPaise + ",\"creditTotalPaise\":" + creditTotalPaise
            + ",\"unreadableCount\":" + unreadableCount + "}\n";
    }

    private static String quoted(LocalDate d) {
        return d == null ? "null" : "\"" + d + "\"";
    }
}
```

`samples/SamplePdf.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentInformation;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;

/** Draws a bank-like statement: a preamble, a column header, rows of cells at fixed x positions, 40 rows a page. */
public final class SamplePdf {
    public record Cell(float x, String text) {}

    public record Page(List<String> preamble, List<Cell> header, List<List<Cell>> rows, List<String> after) {}

    private static final float TOP = 800;
    private static final float LEFT = 30;
    private static final float STEP = 13;
    private static final float SIZE = 8;
    private static final int ROWS_PER_PAGE = 40;

    private SamplePdf() {}

    public static List<Page> paged(List<String> firstPreamble, List<String> repeatPreamble, List<Cell> header,
                                   List<List<Cell>> rows, List<String> after) {
        List<Page> pages = new ArrayList<>();
        int count = Math.max(1, (rows.size() + ROWS_PER_PAGE - 1) / ROWS_PER_PAGE);
        for (int p = 0; p < count; p++) {
            List<List<Cell>> slice = rows.subList(Math.min(rows.size(), p * ROWS_PER_PAGE),
                Math.min(rows.size(), (p + 1) * ROWS_PER_PAGE));
            pages.add(new Page(p == 0 ? firstPreamble : repeatPreamble, header, slice, p == count - 1 ? after : List.of()));
        }
        return pages;
    }

    public static PDDocument document(List<Page> pages) throws IOException {
        PDDocument doc = new PDDocument();
        PDFont font = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
        int number = 1;
        for (Page p : pages) {
            PDPage page = new PDPage(PDRectangle.A4);
            doc.addPage(page);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                float y = TOP;
                for (String line : p.preamble()) {
                    text(cs, font, LEFT, y, line);
                    y -= STEP;
                }
                y -= STEP / 2;
                for (Cell c : p.header()) {
                    text(cs, font, c.x(), y, c.text());
                }
                y -= STEP;
                for (List<Cell> row : p.rows()) {
                    for (Cell c : row) {
                        text(cs, font, c.x(), y, c.text());
                    }
                    y -= STEP;
                }
                y -= STEP / 2;
                for (String line : p.after()) {
                    text(cs, font, LEFT, y, line);
                    y -= STEP;
                }
                text(cs, font, LEFT, 30, "Page " + number + " of " + pages.size());
            }
            number++;
        }
        PDDocumentInformation info = new PDDocumentInformation();
        info.setProducer("Gullak sample builder");
        doc.setDocumentInformation(info);
        return doc;
    }

    /** AES-256 user password, as banks send statements. */
    public static void protect(PDDocument doc, String password) throws IOException {
        StandardProtectionPolicy policy = new StandardProtectionPolicy("owner-" + password, password, new AccessPermission());
        policy.setEncryptionKeyLength(256);
        doc.protect(policy);
    }

    public static byte[] bytes(PDDocument doc) throws IOException {
        try (doc; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            doc.save(out);
            return out.toByteArray();
        }
    }

    private static void text(PDPageContentStream cs, PDFont font, float x, float y, String s) throws IOException {
        if (s == null || s.isEmpty()) {
            return;
        }
        cs.beginText();
        cs.setFont(font, SIZE);
        cs.newLineAtOffset(x, y);
        cs.showText(s);
        cs.endText();
    }
}
```

`samples/HdfcSample.java` (84 lines, 1 to 22 Oct 2026, built so that the spec's example user with nine logged spends sees 9 matched, 58 auto, 3 fixed and 14 to sort):

```java
package in.gullak.ingestion.statements.samples;

import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import org.apache.pdfbox.pdmodel.PDDocument;

public final class HdfcSample {
    public static final String PASSWORD = "GULLAK2026";
    static final long OPENING = 125_000_00L;
    private static final float[] X = {30, 72, 262, 340, 392, 462, 522};
    private static final DateTimeFormatter DDMMYY = DateTimeFormatter.ofPattern("dd/MM/yy");
    /** Zero-based rows of malformedRows() drawn without their amount (RD-15). */
    public static final Set<Integer> BROKEN = Set.of(4, 9, 14);

    /** Dictionary merchants for the 55 automatically sorted lines. */
    private static final String[] AUTO = {
        "UPI/SWIGGY/swiggy@icici", "UPI/ZOMATO/zomato@hdfcbank", "UPI/ZEPTO/zepto@ybl", "PYU*BLINKIT8841",
        "UPI/SWIGGY INSTAMART/instamart@icici", "AMAZONPAY*Q3LK72", "UPI/FLIPKART/flipkart@axisbank",
        "UPI/UBER INDIA/uber@icici", "UPI/OLA/olacabs@icici", "UPI/BIGBASKET/bigbasket@hdfcbank",
        "UPI/AIRTEL PREPAID/airtel@icici"};

    private HdfcSample() {}

    public static List<SampleRow> rows() {
        List<SampleRow> rows = new ArrayList<>();
        rows.add(credit(1, "NEFT CR-ACME TECH PVT LTD-SALARY", 50_000));
        // fixed costs of the example user: cook, maid, rent
        rows.add(debit(1, "UPI to sunita.cook@ybl", 2_000));
        rows.add(debit(1, "UPI to kamla.bai@okicici", 1_500));
        rows.add(debit(5, "UPI to ramesh@okaxis", 10_000));
        // transfers: cash and savings
        rows.add(debit(2, "ATM WDL-ATM CASH MG ROAD", 2_000));
        rows.add(debit(7, "NEFT to SBI SIP-SIP MUTUAL FUND", 6_700));
        // fourteen lines Gullak cannot sort: small shops and UPI to people
        rows.add(debit(2, "UPI/MURUGAN TEA STALL", 45));
        rows.add(debit(3, "BHARATPE*MOMO POINT", 220));
        rows.add(debit(8, "UPI/BOMBAY SANDWICH CO", 180));
        rows.add(debit(9, "UPI/RAJU FRUIT CART", 120));
        rows.add(debit(11, "UPI to priya.s@oksbi", 1_200));
        rows.add(debit(12, "UPI/LAKSHMI TAILORS", 400));
        rows.add(debit(13, "UPI/SHARMA GENERAL STORE", 90));
        rows.add(debit(14, "PAYTM*CHAIPOINT", 60));
        rows.add(debit(15, "PG*ZMT8812", 260));
        rows.add(debit(16, "UPI/KAKA DHABA", 150));
        rows.add(debit(17, "BHARATPE*PAAN CORNER", 30));
        rows.add(debit(19, "UPI to 98xxxxxx10@ybl", 350));
        rows.add(debit(20, "UPI to amit.k@okicici", 60));
        rows.add(debit(21, "BHARATPE*JUICE CORNER", 85));
        // nine lines that the API test's logged spends match
        rows.add(debit(4, "UPI/SWIGGY/swiggy@icici", 389));
        rows.add(debit(6, "UPI/ZEPTO/zepto@ybl", 312));
        rows.add(debit(9, "UPI/THIRDWAVECOFFEE/okhdfc", 250));
        rows.add(debit(10, "UPI/UBER INDIA/uber@icici", 246));
        rows.add(debit(12, "UPI/STARBUCKS/starbucks@hdfcbank", 410));
        rows.add(debit(15, "UPI/BLINKIT/blinkit@icici", 520));
        rows.add(debit(17, "POS AMAZON RETAIL CARD 4012", 1_499));
        rows.add(debit(18, "UPI/RAPIDO/rapido@ybl", 85));
        rows.add(debit(20, "UPI/ZOMATO/zomato@hdfcbank", 455));
        for (int i = 0; i < 55; i++) {
            rows.add(debit(1 + i % 22, AUTO[i % AUTO.length], 100 + 13L * i));
        }
        rows.sort(Comparator.comparing(SampleRow::date));
        return List.copyOf(rows);
    }

    public static byte[] build() throws IOException {
        return SamplePdf.bytes(document(rows(), Set.of()));
    }

    public static byte[] locked() throws IOException {
        PDDocument doc = document(rows(), Set.of());
        SamplePdf.protect(doc, PASSWORD);
        return SamplePdf.bytes(doc);
    }

    public static byte[] empty() throws IOException {
        return SamplePdf.bytes(document(List.of(), Set.of()));
    }

    public static List<SampleRow> malformedRows() {
        return rows().subList(0, 20);
    }

    public static byte[] malformed() throws IOException {
        return SamplePdf.bytes(document(malformedRows(), BROKEN));
    }

    public static Expected expected() {
        return Expected.of("HDFC", rows(), Set.of());
    }

    public static Expected expectedMalformed() {
        return Expected.of("HDFC", malformedRows(), BROKEN);
    }

    static PDDocument document(List<SampleRow> rows, Set<Integer> broken) throws IOException {
        List<List<SamplePdf.Cell>> cells = new ArrayList<>();
        long balance = OPENING;
        for (int i = 0; i < rows.size(); i++) {
            SampleRow r = rows.get(i);
            balance += r.credit() ? r.paise() : -r.paise();
            String date = r.date().format(DDMMYY);
            List<SamplePdf.Cell> row = new ArrayList<>(List.of(
                cell(0, date), cell(1, r.narration()), cell(2, String.format("%016d", 429_812_340_000L + i)), cell(3, date)));
            if (!broken.contains(i)) {
                row.add(cell(r.credit() ? 5 : 4, SampleMoney.western(r.paise())));
            }
            row.add(cell(6, SampleMoney.western(balance)));
            cells.add(row);
        }
        List<String> first = List.of("HDFC BANK Ltd.", "Statement of account", "Account Holder : PRIYA SHARMA",
            "Account No : XXXXXXXX4821", "Statement From : 01/10/26 To : 22/10/26",
            "Opening Balance : " + SampleMoney.western(OPENING));
        List<String> repeat = List.of("HDFC BANK Ltd.", "Statement of account");
        List<SamplePdf.Cell> header = List.of(cell(0, "Date"), cell(1, "Narration"), cell(2, "Chq./Ref.No."),
            cell(3, "Value Dt"), cell(4, "Withdrawal Amt."), cell(5, "Deposit Amt."), cell(6, "Closing Balance"));
        List<String> after = rows.isEmpty()
            ? List.of("No transactions in the selected period", "STATEMENT SUMMARY")
            : List.of("STATEMENT SUMMARY", "Closing Balance : " + SampleMoney.western(balance));
        return SamplePdf.document(SamplePdf.paged(first, repeat, header, cells, after));
    }

    private static SamplePdf.Cell cell(int column, String text) {
        return new SamplePdf.Cell(X[column], text);
    }

    private static SampleRow debit(int day, String narration, long rupees) {
        return new SampleRow(LocalDate.of(2026, 10, day), narration, rupees * 100, false);
    }

    private static SampleRow credit(int day, String narration, long rupees) {
        return new SampleRow(LocalDate.of(2026, 10, day), narration, rupees * 100, true);
    }
}
```

`samples/SpecialSamples.java` (built in memory by the tests; never committed):

```java
package in.gullak.ingestion.statements.samples;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentNameDictionary;
import org.apache.pdfbox.pdmodel.PDEmbeddedFilesNameTreeNode;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.common.PDStream;
import org.apache.pdfbox.pdmodel.common.filespecification.PDComplexFileSpecification;
import org.apache.pdfbox.pdmodel.common.filespecification.PDEmbeddedFile;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.apache.pdfbox.pdmodel.interactive.action.PDActionJavaScript;

/** Hostile and broken files for RD-10 to RD-14, RD-26 and SEC-11. */
public final class SpecialSamples {
    private SpecialSamples() {}

    /** RD-12: a PNG signature in a file the user named .pdf. */
    public static byte[] png() {
        byte[] b = new byte[128];
        byte[] signature = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
        System.arraycopy(signature, 0, b, 0, signature.length);
        return b;
    }

    /** RD-11: a download cut short. */
    public static byte[] truncated() throws IOException {
        return Arrays.copyOf(HdfcSample.build(), 300);
    }

    /** RD-13: 11 MB that starts like a PDF. */
    public static byte[] oversized() {
        byte[] b = new byte[11 * 1024 * 1024];
        byte[] head = "%PDF-1.7\n".getBytes(StandardCharsets.US_ASCII);
        Arrays.fill(b, (byte) ' ');
        System.arraycopy(head, 0, b, 0, head.length);
        return b;
    }

    /** RD-10: one page that is only a picture. */
    public static byte[] scanned() throws IOException {
        System.setProperty("java.awt.headless", "true");
        PDDocument doc = new PDDocument();
        PDPage page = new PDPage(PDRectangle.A4);
        doc.addPage(page);
        BufferedImage img = new BufferedImage(400, 560, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, 400, 560);
        g.setColor(Color.BLACK);
        for (int y = 40; y < 540; y += 20) {
            g.drawLine(20, y, 380, y);
        }
        g.dispose();
        PDImageXObject image = LosslessFactory.createFromImage(doc, img);
        try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
            cs.drawImage(image, 0, 0, PDRectangle.A4.getWidth(), PDRectangle.A4.getHeight());
        }
        return SamplePdf.bytes(doc);
    }

    /** RD-14: ten pages of 40,000 single-glyph moves; under every size limit, slow to lay out. */
    public static byte[] slow() throws IOException {
        PDDocument doc = new PDDocument();
        PDType1Font font = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
        for (int p = 0; p < 10; p++) {
            PDPage page = new PDPage(PDRectangle.A4);
            doc.addPage(page);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.beginText();
                cs.setFont(font, 4);
                cs.newLineAtOffset(10, 830);
                cs.showText("HDFC BANK Ltd.");
                for (int i = 0; i < 40_000; i++) {
                    cs.newLineAtOffset(((i % 97) - 48) * 0.5f, i % 160 == 0 ? -5f : 0f);
                    cs.showText("a");
                }
                cs.endText();
            }
        }
        return SamplePdf.bytes(doc);
    }

    /** SEC-11: the HDFC sample with a JavaScript open action and an embedded file. */
    public static byte[] javascript() throws IOException {
        PDDocument doc = HdfcSample.document(HdfcSample.rows(), Set.of());
        doc.getDocumentCatalog().setOpenAction(new PDActionJavaScript(
            "app.alert('pwned'); this.exportDataObject({cName: 'evil.txt', nLaunch: 2});"));
        PDEmbeddedFile embedded = new PDEmbeddedFile(doc, new ByteArrayInputStream("not a statement".getBytes(StandardCharsets.UTF_8)));
        embedded.setSubtype("text/plain");
        PDComplexFileSpecification spec = new PDComplexFileSpecification();
        spec.setFile("evil.txt");
        spec.setEmbeddedFile(embedded);
        PDEmbeddedFilesNameTreeNode tree = new PDEmbeddedFilesNameTreeNode();
        tree.setNames(Map.of("evil.txt", spec));
        PDDocumentNameDictionary names = new PDDocumentNameDictionary(doc.getDocumentCatalog());
        names.setEmbeddedFiles(tree);
        doc.getDocumentCatalog().setNames(names);
        return SamplePdf.bytes(doc);
    }

    /** RD-26: a page whose content stream inflates from about 40 KB to 40 MB. */
    public static byte[] bomb() throws IOException {
        PDDocument doc = new PDDocument();
        PDPage page = new PDPage(PDRectangle.A4);
        doc.addPage(page);
        byte[] spaces = new byte[40 * 1024 * 1024];
        Arrays.fill(spaces, (byte) ' ');
        page.setContents(new PDStream(doc, new ByteArrayInputStream(spaces), COSName.FLATE_DECODE));
        try (ByteArrayOutputStream out = new ByteArrayOutputStream(); doc) {
            doc.save(out);
            return out.toByteArray();
        }
    }
}
```

`samples/WriteSamples.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Writes the committed samples: ./gradlew writeStatementSamples. To use a real anonymised statement instead, put
 * its PDF and a hand-checked <name>.expected.json in src/test/resources/statements and drop its line here.
 */
public final class WriteSamples {
    private WriteSamples() {}

    public static void main(String[] args) throws IOException {
        Path dir = Path.of(args.length > 0 ? args[0] : "src/test/resources/statements");
        Files.createDirectories(dir);
        Files.write(dir.resolve("hdfc.pdf"), HdfcSample.build());
        Files.writeString(dir.resolve("hdfc.expected.json"), HdfcSample.expected().json(), StandardCharsets.UTF_8);
        Files.write(dir.resolve("hdfc-locked.pdf"), HdfcSample.locked());
        Files.write(dir.resolve("hdfc-empty.pdf"), HdfcSample.empty());
    }
}
```

Run: `cd server && ./gradlew writeStatementSamples`
Expected: the four files appear under `server/src/test/resources/statements/`. Open `hdfc.pdf` in a PDF viewer once and check it looks like a statement (three pages, columns aligned).

- [ ] **Step 8: Write the failing reader, safety and parser tests**

`Samples.java`:

```java
package in.gullak.ingestion.statements;

import static org.assertj.core.api.Assertions.assertThat;

import com.jayway.jsonpath.DocumentContext;
import com.jayway.jsonpath.JsonPath;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.LocalDate;
import java.util.Objects;

/** Reads the committed sample files and checks a parse against <name>.expected.json. */
public final class Samples {
    private Samples() {}

    public static byte[] bytes(String name) {
        try (InputStream in = Samples.class.getResourceAsStream("/statements/" + name)) {
            return Objects.requireNonNull(in, "missing sample " + name + "; run ./gradlew writeStatementSamples").readAllBytes();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public static void assertMatches(ParsedStatement s, String name) {
        DocumentContext expected = JsonPath.parse(new String(bytes(name + ".expected.json")));
        long debit = s.lines().stream().filter(l -> l.direction() == Direction.DEBIT).mapToLong(RawLine::amountPaise).sum();
        long credit = s.lines().stream().filter(l -> l.direction() == Direction.CREDIT).mapToLong(RawLine::amountPaise).sum();
        assertThat(s.bank()).isEqualTo(expected.read("$.bank", String.class));
        assertThat(s.lines()).hasSize(expected.read("$.lineCount", Integer.class));
        assertThat(s.unreadable()).isEqualTo(expected.read("$.unreadableCount", Integer.class));
        if (!s.lines().isEmpty()) {
            assertThat(s.lines().getFirst().date()).isEqualTo(LocalDate.parse(expected.read("$.firstDate", String.class)));
            assertThat(s.lines().getLast().date()).isEqualTo(LocalDate.parse(expected.read("$.lastDate", String.class)));
        }
        assertThat(debit).isEqualTo(expected.read("$.debitTotalPaise", Long.class));
        assertThat(credit).isEqualTo(expected.read("$.creditTotalPaise", Long.class));
    }
}
```

`TestParsers.java`:

```java
package in.gullak.ingestion.statements;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.util.unit.DataSize;

/** A parser outside Spring, on the test clock (Fri 23 Oct 2026, 13:30 IST). */
public final class TestParsers {
    public static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-23T08:00:00Z"), ZoneOffset.UTC);

    private TestParsers() {}

    public static ImportProperties props(Duration timeout) {
        return new ImportProperties(DataSize.ofMegabytes(10), timeout, 2, 4, 10, 5000, 100, DataSize.ofMegabytes(32), 50_000);
    }

    public static List<PdfStatementReader> readers() {
        return List.of(new HdfcReader());
    }

    public static StatementParser parser() {
        return parser(Duration.ofSeconds(10));
    }

    public static StatementParser parser(Duration timeout) {
        return new StatementParser(props(timeout), readers(), CLOCK);
    }
}
```

`Failures.java`:

```java
package in.gullak.ingestion.statements;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.GullakException;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;

public final class Failures {
    private Failures() {}

    public static ErrorCode codeOf(ThrowingCallable call) {
        Throwable t = catchThrowable(call);
        assertThat(t).as("expected a GullakException").isInstanceOf(GullakException.class);
        return ((GullakException) t).code();
    }
}
```

`HdfcReaderTest.java`:

```java
package in.gullak.ingestion.statements;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class HdfcReaderTest {
    final StatementParser parser = TestParsers.parser();

    @Test
    void hdfcSampleMatchesItsExpectedFile() { // RD-01
        Samples.assertMatches(parser.readPdf(Samples.bytes("hdfc.pdf"), null), "hdfc");
    }

    @Test
    void hdfcIsDetectedFromTheText() { // RD-06 (HDFC)
        ParsedStatement s = parser.readPdf(Samples.bytes("hdfc.pdf"), null);
        assertThat(s.bank()).isEqualTo("HDFC");
        assertThat(s.bankName()).isEqualTo("HDFC Bank");
        assertThat(s.bankLabel()).isEqualTo("HDFC");
        assertThat(s.kind()).isEqualTo(FileKind.PDF);
        assertThat(s.unlocked()).isFalse();
    }

    @Test
    void salaryIsACreditAndRentADebit() {
        ParsedStatement s = parser.readPdf(Samples.bytes("hdfc.pdf"), null);
        assertThat(s.lines()).anySatisfy(l -> {
            assertThat(l.description()).isEqualTo("NEFT CR-ACME TECH PVT LTD-SALARY");
            assertThat(l.direction()).isEqualTo(Direction.CREDIT);
            assertThat(l.amountPaise()).isEqualTo(5_000_000);
        });
        assertThat(s.lines()).anySatisfy(l -> {
            assertThat(l.description()).isEqualTo("UPI to ramesh@okaxis");
            assertThat(l.date()).isEqualTo(LocalDate.of(2026, 10, 5));
            assertThat(l.direction()).isEqualTo(Direction.DEBIT);
        });
    }
}
```

`PdfSafetyTest.java`:

```java
package in.gullak.ingestion.statements;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.common.error.ErrorCode;
import in.gullak.ingestion.statements.samples.HdfcSample;
import in.gullak.ingestion.statements.samples.SpecialSamples;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class PdfSafetyTest {
    final StatementParser parser = TestParsers.parser();

    @Test
    void lockedWithoutAPasswordAsksForIt() { // RD-07
        assertThat(Failures.codeOf(() -> parser.readPdf(Samples.bytes("hdfc-locked.pdf"), null))).isEqualTo(ErrorCode.PASSWORD_REQUIRED);
        assertThat(Failures.codeOf(() -> parser.readPdf(Samples.bytes("hdfc-locked.pdf"), ""))).isEqualTo(ErrorCode.PASSWORD_REQUIRED);
    }

    @Test
    void aWrongPasswordGivesNoPartialResult() { // RD-08
        assertThat(Failures.codeOf(() -> parser.readPdf(Samples.bytes("hdfc-locked.pdf"), "WRONG"))).isEqualTo(ErrorCode.WRONG_PASSWORD);
    }

    @Test
    void theRightPasswordReadsEveryLine() { // RD-09
        ParsedStatement s = parser.readPdf(Samples.bytes("hdfc-locked.pdf"), HdfcSample.PASSWORD);
        assertThat(s.lines()).hasSize(84);
        assertThat(s.unlocked()).isTrue();
    }

    @Test
    void aPictureOfAStatementIsScanned() throws IOException { // RD-10
        byte[] scanned = SpecialSamples.scanned();
        assertThat(Failures.codeOf(() -> parser.readPdf(scanned, null))).isEqualTo(ErrorCode.SCANNED_PDF);
    }

    @Test
    void aTruncatedFileIsUnreadable() throws IOException { // RD-11
        byte[] truncated = SpecialSamples.truncated();
        assertThat(Failures.codeOf(() -> parser.readPdf(truncated, null))).isEqualTo(ErrorCode.UNREADABLE);
    }

    @Test
    void aPngNamedPdfIsInvalid() { // RD-12
        assertThat(Failures.codeOf(() -> parser.readPdf(SpecialSamples.png(), null))).isEqualTo(ErrorCode.INVALID_FILE);
    }

    @Test
    void aDecompressionBombIsRefusedBeforeExtraction() throws IOException { // RD-26
        byte[] bomb = SpecialSamples.bomb();
        assertThat(bomb.length).isLessThan(1024 * 1024);
        assertThat(Failures.codeOf(() -> parser.readPdf(bomb, null))).isEqualTo(ErrorCode.UNREADABLE);
    }

    @Test
    void javascriptAndAttachmentsAreIgnoredAndTheTextStillReads() throws IOException { // SEC-11
        ParsedStatement s = parser.readPdf(SpecialSamples.javascript(), null);
        assertThat(s.lines()).hasSize(84);
        assertThat(s.lines()).noneMatch(l -> l.description().contains("evil") || l.description().contains("pwned"));
    }

    @Test
    void theReaderCodeNeverTouchesActionsOrAttachments() throws IOException { // SEC-11
        Path main = Path.of("src/main/java/in/gullak/ingestion");
        List<String> forbidden = List.of("JavaScript", "EmbeddedFile", "getOpenAction", "PDAcroForm", "getAnnotations");
        try (Stream<Path> files = Files.walk(main)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String source = Files.readString(file);
                for (String word : forbidden) {
                    assertThat(source).as(file + " mentions " + word).doesNotContain(word);
                }
            }
        }
    }
}
```

`StatementParserTest.java`:

```java
package in.gullak.ingestion.statements;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.common.error.ErrorCode;
import in.gullak.ingestion.statements.samples.HdfcSample;
import in.gullak.ingestion.statements.samples.SpecialSamples;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
class StatementParserTest {

    @Test
    void elevenMegabytesIsTooLargeBeforeAnyParsing() { // RD-13
        StatementParser parser = TestParsers.parser();
        long started = System.nanoTime();
        assertThat(Failures.codeOf(() -> parser.readPdf(SpecialSamples.oversized(), null))).isEqualTo(ErrorCode.TOO_LARGE);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(500));
        assertThat(parser.busyThreads()).isZero();
    }

    @Test
    void aSlowFileTimesOutAndTheThreadIsReleased() throws Exception { // RD-14, ERR-10
        TestParsers.parser().readPdf(Samples.bytes("hdfc.pdf"), null); // warm PDFBox's font cache
        StatementParser parser = TestParsers.parser(Duration.ofMillis(300));
        byte[] slow = SpecialSamples.slow();
        long started = System.nanoTime();
        assertThat(Failures.codeOf(() -> parser.readPdf(slow, null))).isEqualTo(ErrorCode.UNREADABLE);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(3));
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (parser.busyThreads() > 0 && System.nanoTime() < deadline) {
            Thread.sleep(25);
        }
        assertThat(parser.busyThreads()).as("the timed-out parse still holds a thread").isZero();
        StatementParser normal = TestParsers.parser();
        assertThat(normal.readPdf(Samples.bytes("hdfc.pdf"), null).lines()).hasSize(84);
        assertThat(parser.readPdf(Samples.bytes("hdfc-empty.pdf"), null).lines()).isEmpty(); // the same executor works again
    }

    @Test
    void anEmptyStatementIsAPreviewWithNoLines() { // RD-17
        ParsedStatement s = TestParsers.parser().readPdf(Samples.bytes("hdfc-empty.pdf"), null);
        assertThat(s.lines()).isEmpty();
        assertThat(s.unreadable()).isZero();
        assertThat(s.bank()).isEqualTo("HDFC");
    }

    @Test
    void noReaderCallLeavesAFileBehind() throws Exception { // RD-24
        List<Path> before = tempFiles();
        StatementParser parser = TestParsers.parser();
        parser.readPdf(Samples.bytes("hdfc.pdf"), null);
        parser.readPdf(Samples.bytes("hdfc-locked.pdf"), HdfcSample.PASSWORD);
        Failures.codeOf(() -> parser.readPdf(Samples.bytes("hdfc-locked.pdf"), "WRONG"));
        Failures.codeOf(() -> parser.readPdf(SpecialSamples.scanned(), null));
        Failures.codeOf(() -> parser.readPdf(SpecialSamples.truncated(), null));
        assertThat(tempFiles()).isEqualTo(before);
    }

    @Test
    void passwordsNeverReachTheLogs(CapturedOutput out) { // RD-25
        StatementParser parser = TestParsers.parser();
        Failures.codeOf(() -> parser.readPdf(Samples.bytes("hdfc-locked.pdf"), "WRONG-Pa55word"));
        parser.readPdf(Samples.bytes("hdfc-locked.pdf"), HdfcSample.PASSWORD);
        assertThat(out.getAll()).doesNotContain("WRONG-Pa55word").doesNotContain(HdfcSample.PASSWORD);
    }

    private static List<Path> tempFiles() throws IOException {
        try (Stream<Path> files = Files.walk(Path.of(System.getProperty("java.io.tmpdir")), 3)) {
            return files.filter(Files::isRegularFile).sorted().toList();
        }
    }
}
```

- [ ] **Step 9: Run to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.statements.*'`
Expected: compilation fails (`StatementParser`, `PdfText` and the rest are missing).

- [ ] **Step 10: Text extraction, detection and the parser**

`FileSniffer.java`:

```java
package in.gullak.ingestion.statements;

/** The file's kind from its bytes, never from its name or the client's MIME type (spec 4.7: magic-byte check). */
public final class FileSniffer {
    private FileSniffer() {}

    public static FileKind sniff(byte[] b) {
        if (b == null || b.length == 0) {
            throw ReadFailures.invalidFile();
        }
        if (isPdf(b)) {
            return FileKind.PDF;
        }
        if (startsWith(b, 0x89, 'P', 'N', 'G') || startsWith(b, 0xFF, 0xD8, 0xFF) || startsWith(b, 'P', 'K', 3, 4)
            || startsWith(b, 'G', 'I', 'F', '8') || startsWith(b, 0xD0, 0xCF, 0x11, 0xE0) || startsWith(b, '%', '!')) {
            throw ReadFailures.invalidFile();
        }
        int n = Math.min(b.length, 8192);
        int control = 0;
        boolean delimiter = false;
        for (int i = 0; i < n; i++) {
            int c = b[i] & 0xFF;
            if (c == 0) {
                throw ReadFailures.invalidFile();
            }
            if (c < 0x20 && c != '\n' && c != '\r' && c != '\t') {
                control++;
            }
            if (c == ',' || c == ';' || c == '\t') {
                delimiter = true;
            }
        }
        if (!delimiter || control * 100 > n) {
            throw ReadFailures.invalidFile();
        }
        return FileKind.CSV;
    }

    private static boolean isPdf(byte[] b) {
        int i = 0;
        if (startsWith(b, 0xEF, 0xBB, 0xBF)) {
            i = 3;
        }
        while (i < b.length && i < 1024 && Character.isWhitespace((char) (b[i] & 0xFF))) {
            i++;
        }
        byte[] magic = {'%', 'P', 'D', 'F', '-'};
        if (b.length < i + magic.length) {
            return false;
        }
        for (int k = 0; k < magic.length; k++) {
            if (b[i + k] != magic[k]) {
                return false;
            }
        }
        return true;
    }

    private static boolean startsWith(byte[] b, int... prefix) {
        if (b.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if ((b[i] & 0xFF) != prefix[i]) {
                return false;
            }
        }
        return true;
    }
}
```

`DateWindow.java`:

```java
package in.gullak.ingestion.statements;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** Lines dated after tomorrow (IST) or more than two years ago are unreadable, not imported. */
public final class DateWindow {
    public record Filtered(List<RawLine> lines, int outside) {}

    private DateWindow() {}

    public static Filtered filter(List<RawLine> lines, LocalDate today) {
        LocalDate latest = today.plusDays(1);
        LocalDate earliest = today.minusYears(2);
        List<RawLine> kept = new ArrayList<>();
        int outside = 0;
        for (RawLine l : lines) {
            if (l.date().isAfter(latest) || l.date().isBefore(earliest)) {
                outside++;
            } else {
                kept.add(new RawLine(kept.size() + 1, l.date(), l.amountPaise(), l.direction(), l.description()));
            }
        }
        return new Filtered(List.copyOf(kept), outside);
    }
}
```

`PdfText.java`:

```java
package in.gullak.ingestion.statements;

import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.zip.InflaterInputStream;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.contentstream.operator.Operator;
import org.apache.pdfbox.cos.COSArray;
import org.apache.pdfbox.cos.COSBase;
import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.cos.COSStream;
import org.apache.pdfbox.io.IOUtils;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDResources;
import org.apache.pdfbox.pdmodel.common.PDStream;
import org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException;
import org.apache.pdfbox.pdmodel.graphics.PDXObject;
import org.apache.pdfbox.pdmodel.graphics.form.PDFormXObject;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;

/**
 * Text out of a PDF, in memory only, with the limits of spec 4.7: no temp files (memory-only stream cache), page,
 * decoded-size and glyph caps, and an interruptible stripper so a timed-out parse frees its thread. Only content
 * streams are read; actions, attachments, forms and annotations are never touched.
 */
final class PdfText {
    record Extracted(List<String> lines, boolean encrypted) {}

    private static final byte[] EOF = "%%EOF".getBytes(StandardCharsets.US_ASCII);

    private PdfText() {}

    static Extracted extract(byte[] bytes, String password, ImportProperties limits) throws IOException {
        if (!endsLikeAPdf(bytes)) {
            throw ReadFailures.unreadable("That file looks cut short. Download it again from your bank.");
        }
        PDDocument doc;
        try {
            doc = Loader.loadPDF(bytes, password == null ? "" : password, null, null, IOUtils.createMemoryOnlyStreamCache());
        } catch (InvalidPasswordException e) {
            throw password == null || password.isEmpty() ? ReadFailures.passwordRequired() : ReadFailures.wrongPassword();
        }
        try (doc) {
            int pages = doc.getNumberOfPages();
            if (pages == 0) {
                throw ReadFailures.unreadable("We couldn't read this file");
            }
            if (pages > limits.maxPages()) {
                throw ReadFailures.tooLong();
            }
            guard(doc, limits.maxDecodedBytes().toBytes());
            List<String> lines = new ArrayList<>();
            Stripper stripper = new Stripper(limits.maxGlyphsPerPage());
            stripper.setSortByPosition(true);
            for (int p = 1; p <= pages; p++) {
                if (Thread.currentThread().isInterrupted()) {
                    throw new InterruptedIOException("statement parse cancelled");
                }
                stripper.setStartPage(p);
                stripper.setEndPage(p);
                String text;
                try {
                    text = stripper.getText(doc);
                } catch (GlyphLimitException e) {
                    throw ReadFailures.unreadable("We couldn't read this file");
                }
                for (String raw : text.split("\\R")) {
                    String line = raw.replace(' ', ' ').replaceAll("\\s+", " ").strip();
                    if (!line.isEmpty()) {
                        lines.add(line);
                    }
                }
            }
            long letters = lines.stream().flatMapToInt(String::chars).filter(Character::isLetterOrDigit).count();
            if (letters < 20) {
                throw ReadFailures.scanned();
            }
            return new Extracted(List.copyOf(lines), doc.isEncrypted());
        }
    }

    private static boolean endsLikeAPdf(byte[] b) {
        int from = Math.max(0, b.length - 2048);
        outer:
        for (int i = b.length - EOF.length; i >= from; i--) {
            for (int k = 0; k < EOF.length; k++) {
                if (b[i + k] != EOF[k]) {
                    continue outer;
                }
            }
            return true;
        }
        return false;
    }

    /** Counts the decoded size of every content stream with our own inflater, so a bomb stops at the cap. */
    private static void guard(PDDocument doc, long limit) throws IOException {
        long used = 0;
        for (PDPage page : doc.getPages()) {
            Iterator<PDStream> streams = page.getContentStreams();
            while (streams.hasNext()) {
                used += decodedSize(streams.next().getCOSObject(), limit - used);
            }
            used += forms(page.getResources(), limit - used, 0);
        }
    }

    private static long forms(PDResources resources, long budget, int depth) throws IOException {
        if (resources == null || depth > 3) {
            return 0;
        }
        long total = 0;
        for (COSName name : resources.getXObjectNames()) {
            PDXObject x = resources.getXObject(name);
            if (x instanceof PDFormXObject form) {
                total += decodedSize(form.getCOSObject(), budget - total);
                total += forms(form.getResources(), budget - total, depth + 1);
            }
        }
        return total;
    }

    private static long decodedSize(COSStream stream, long budget) throws IOException {
        COSBase filters = stream.getFilters();
        boolean flate;
        if (filters == null) {
            flate = false;
        } else if (COSName.FLATE_DECODE.equals(filters)) {
            flate = true;
        } else if (filters instanceof COSArray array && array.size() == 1 && COSName.FLATE_DECODE.equals(array.getObject(0))) {
            flate = true;
        } else {
            throw ReadFailures.unreadable("We couldn't read this file");
        }
        try (InputStream raw = stream.createRawInputStream(); InputStream in = flate ? new InflaterInputStream(raw) : raw) {
            byte[] buffer = new byte[8192];
            long n = 0;
            int r;
            while ((r = in.read(buffer)) != -1) {
                n += r;
                if (n > budget) {
                    throw ReadFailures.unreadable("We couldn't read this file");
                }
            }
            return n;
        }
    }

    private static final class GlyphLimitException extends IllegalStateException {
        GlyphLimitException() {
            super("too many glyphs on one page");
        }
    }

    private static final class Stripper extends PDFTextStripper {
        private final int maxGlyphs;
        private int glyphs;

        Stripper(int maxGlyphs) throws IOException {
            super();
            this.maxGlyphs = maxGlyphs;
        }

        @Override
        protected void startPage(PDPage page) throws IOException {
            glyphs = 0;
            super.startPage(page);
        }

        @Override
        protected void processOperator(Operator operator, List<COSBase> operands) throws IOException {
            if (Thread.currentThread().isInterrupted()) {
                throw new InterruptedIOException("statement parse cancelled");
            }
            super.processOperator(operator, operands);
        }

        @Override
        protected void processTextPosition(TextPosition text) {
            glyphs++;
            if (glyphs > maxGlyphs) {
                throw new GlyphLimitException();
            }
            super.processTextPosition(text);
        }
    }
}
```

`BankDetector.java`:

```java
package in.gullak.ingestion.statements;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * The bank from the first lines of the statement, never from the table: a Yes Bank narration "NEFT to HDFC BANK"
 * must not make it an HDFC statement. The first header line that names any bank decides.
 */
public final class BankDetector {
    private static final int HEADER_LINES = 15;

    private record Marker(String text, Bank bank, String unsupportedName) {}

    private static final List<Marker> MARKERS = markers();

    private BankDetector() {}

    public static Bank detect(List<String> lines) {
        for (int i = 0; i < Math.min(HEADER_LINES, lines.size()); i++) {
            String upper = lines.get(i).toUpperCase(Locale.ROOT);
            for (Marker m : MARKERS) {
                if (upper.contains(m.text())) {
                    if (m.bank() != null) {
                        return m.bank();
                    }
                    throw ReadFailures.unsupportedBank(m.unsupportedName());
                }
            }
        }
        throw ReadFailures.unsupportedBank(null);
    }

    private static List<Marker> markers() {
        List<Marker> all = new ArrayList<>();
        for (Bank b : Bank.values()) {
            all.add(new Marker(b.marker(), b, null));
        }
        String[][] unsupported = {
            {"YES BANK", "Yes Bank"}, {"IDFC FIRST BANK", "IDFC First Bank"}, {"PUNJAB NATIONAL BANK", "Punjab National Bank"},
            {"BANK OF BARODA", "Bank of Baroda"}, {"INDUSIND BANK", "IndusInd Bank"}, {"FEDERAL BANK", "Federal Bank"},
            {"CANARA BANK", "Canara Bank"}, {"UNION BANK OF INDIA", "Union Bank of India"}, {"BANK OF INDIA", "Bank of India"},
            {"AU SMALL FINANCE BANK", "AU Small Finance Bank"}, {"IDBI BANK", "IDBI Bank"}, {"RBL BANK", "RBL Bank"},
            {"STANDARD CHARTERED", "Standard Chartered"}, {"HSBC", "HSBC"}, {"CITIBANK", "Citibank"}};
        for (String[] u : unsupported) {
            all.add(new Marker(u[0], null, u[1]));
        }
        all.sort(Comparator.comparingInt((Marker m) -> m.text().length()).reversed());
        return List.copyOf(all);
    }
}
```

`StatementParser.java`:

```java
package in.gullak.ingestion.statements;

import in.gullak.common.error.GullakException;
import in.gullak.common.error.RateLimitedException;
import in.gullak.common.log.Events;
import in.gullak.common.time.Ist;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Reads statements on a small bounded pool of platform threads with a timeout (spec 4.6, standards 2). The request
 * thread waits; on timeout the worker is interrupted, the interruptible stripper stops, the thread goes back.
 */
@Component
public class StatementParser {
    private static final Logger log = LoggerFactory.getLogger(StatementParser.class);

    private final ImportProperties props;
    private final Map<Bank, PdfStatementReader> readers;
    private final Clock clock;
    private final ThreadPoolExecutor pool;

    public StatementParser(ImportProperties props, List<PdfStatementReader> readers, Clock clock) {
        this.props = props;
        this.clock = clock;
        this.readers = readers.stream().collect(Collectors.toUnmodifiableMap(PdfStatementReader::bank, r -> r));
        int threads = props.parserThreads();
        this.pool = new ThreadPoolExecutor(threads, threads, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(threads * 2),
            Thread.ofPlatform().name("statement-parser-", 0).daemon(true).factory(), new ThreadPoolExecutor.AbortPolicy());
    }

    /** The size and kind check every upload passes first. */
    public FileKind sniff(byte[] bytes) {
        if (bytes.length > props.maxFileSize().toBytes()) {
            throw ReadFailures.tooLarge(props.maxFileSize());
        }
        return FileSniffer.sniff(bytes);
    }

    public ParsedStatement readPdf(byte[] bytes, String password) {
        if (sniff(bytes) != FileKind.PDF) {
            throw ReadFailures.invalidFile();
        }
        return bounded(() -> parsePdf(bytes, password));
    }

    public int busyThreads() {
        return pool.getActiveCount();
    }

    @PreDestroy
    void stop() {
        pool.shutdownNow();
    }

    private ParsedStatement parsePdf(byte[] bytes, String password) throws IOException {
        PdfText.Extracted text = PdfText.extract(bytes, password, props);
        Bank bank = BankDetector.detect(text.lines());
        PdfStatementReader reader = readers.get(bank);
        if (reader == null) {
            throw ReadFailures.unsupportedBank(bank.displayName());
        }
        ReaderOutput out = reader.read(text.lines());
        boolean unlocked = text.encrypted() && password != null && !password.isEmpty();
        return statement(FileKind.PDF, bank.name(), bank.displayName(), bank.label(), unlocked, out.lines(), out.unreadable());
    }

    ParsedStatement statement(FileKind kind, String bank, String bankName, String bankLabel, boolean unlocked,
                              List<RawLine> lines, int unreadable) {
        DateWindow.Filtered window = DateWindow.filter(lines, Ist.today(clock));
        if (window.lines().size() > props.maxLines()) {
            throw ReadFailures.tooLong();
        }
        return new ParsedStatement(kind, bank, bankName, bankLabel, unlocked, window.lines(), unreadable + window.outside());
    }

    <T> T bounded(Callable<T> work) {
        Future<T> future;
        try {
            future = pool.submit(work);
        } catch (RejectedExecutionException e) {
            log.warn("{} code=BUSY", Events.IMPORT_FAILED);
            throw new RateLimitedException();
        }
        try {
            return future.get(props.parseTimeout().toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            log.warn("{} code=UNREADABLE reason=timeout", Events.IMPORT_FAILED);
            throw ReadFailures.unreadable("That file took too long to read");
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while reading a statement", e);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof GullakException expected) {
                throw expected;
            }
            if (cause instanceof Error error) {
                throw error;
            }
            log.warn("{} code=UNREADABLE reason={}", Events.IMPORT_FAILED, cause.getClass().getSimpleName());
            throw ReadFailures.unreadable("We couldn't read this file");
        }
    }
}
```

Corrupt PDFs often throw PDFBox runtime exceptions (a missing object, a bad cast). They surface here wrapped in `ExecutionException` and become `UNREADABLE` with a WARN that names only the exception class.

- [ ] **Step 11: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.statements.*'`
Expected: PASS. If `aSlowFileTimesOutAndTheThreadIsReleased` finishes the slow parse inside 300 ms on a very fast machine, double the glyphs per page in `SpecialSamples.slow()` (stay under `max-glyphs-per-page`) rather than shortening the timeout.

Then the whole suite: `cd server && ./gradlew test` (PASS; `SourceRulesTest` confirms no broad catch and no concatenated logging).

- [ ] **Step 12: Red team**

Dispatch `red-team` with task id `plan-04-task-2` against `StatementParser` through a small test harness (no HTTP yet): PDFs with JavaScript, launch actions, embedded files, an XFA form, deep form XObject nesting, LZW and ASCII85 content filters, an object-stream bomb, 10,000 pages, a 10 MB file of `%PDF-` followed by junk, a PNG and a ZIP renamed `.pdf`. Check heap after each (`jcmd <pid> GC.heap_info` on a running test JVM) and that `busyThreads()` returns to 0. Findings to `docs/reports/red-team/plan-04-task-2.md`.

- [ ] **Step 13: Commit**

```bash
git add server/build.gradle.kts server/src/main/resources/application.yml \
  server/src/main/java/in/gullak/ingestion/statements server/src/test/java/in/gullak/ingestion/statements \
  server/src/test/resources/statements
git commit -m "feat(server): PDF statement reading with HDFC layout, safety limits and a bounded parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ICICI, SBI, Axis and Kotak readers, Yes Bank, malformed rows

**Owner:** backend-engineer. **Test IDs:** RD-02, RD-03, RD-04, RD-05, RD-06, RD-15, RD-16. **Red team:** no (Task 2's red team covers hostile files; this task adds layouts only).

**Files:**
- Create (main, `server/src/main/java/in/gullak/ingestion/statements/`): `IciciReader.java`, `SbiReader.java`, `AxisReader.java`, `KotakReader.java`
- Create (test, `.../statements/samples/`): `CommonRows.java`, `IciciSample.java`, `SbiSample.java`, `AxisSample.java`, `KotakSample.java`, `YesBankSample.java`
- Modify (test): `samples/WriteSamples.java`, `TestParsers.java` (`readers()`)
- Create (test): `server/src/test/java/in/gullak/ingestion/statements/BankReadersTest.java`
- Create (generated, committed): `server/src/test/resources/statements/icici.pdf`, `icici.expected.json`, `sbi.pdf`, `sbi.expected.json`, `axis.pdf`, `axis.expected.json`, `kotak.pdf`, `kotak.expected.json`, `hdfc-malformed.pdf`, `hdfc-malformed.expected.json`, `yes-bank.pdf`

**Interfaces:**
- Consumes: `BankLayoutReader(Bank, BankLayout)`, `BankLayout`, `SamplePdf`, `SampleRow`, `SampleMoney`, `Expected`, `HdfcSample.malformed()`, `HdfcSample.expectedMalformed()`.
- Produces: one `@Component` reader per bank (Spring collects all five into `StatementParser`); `TestParsers.readers()` returning all five; `YesBankSample.build()` and `YesBankSample.headerFirst()`.

- [ ] **Step 1: Write the failing test**

`server/src/test/java/in/gullak/ingestion/statements/BankReadersTest.java`:

```java
package in.gullak.ingestion.statements;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.UnprocessableException;
import in.gullak.ingestion.statements.samples.YesBankSample;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class BankReadersTest {
    final StatementParser parser = TestParsers.parser();

    @ParameterizedTest
    @CsvSource({"hdfc,HDFC", "icici,ICICI", "sbi,SBI", "axis,AXIS", "kotak,KOTAK"})
    void eachBankSampleMatchesItsExpectedFile(String sample, String bank) { // RD-01 to RD-05, RD-06
        ParsedStatement s = parser.readPdf(Samples.bytes(sample + ".pdf"), null);
        assertThat(s.bank()).isEqualTo(bank);
        Samples.assertMatches(s, sample);
    }

    @Test
    void threeMalformedRowsAreCountedAndTheRestRead() { // RD-15
        ParsedStatement s = parser.readPdf(Samples.bytes("hdfc-malformed.pdf"), null);
        assertThat(s.unreadable()).isEqualTo(3);
        assertThat(s.lines()).hasSize(17);
        Samples.assertMatches(s, "hdfc-malformed");
    }

    @Test
    void yesBankIsUnsupportedWithItsName() { // RD-16
        UnprocessableException e = catchThrowableOfType(UnprocessableException.class,
            () -> parser.readPdf(Samples.bytes("yes-bank.pdf"), null));
        assertThat(e.code()).isEqualTo(ErrorCode.UNSUPPORTED_BANK);
        assertThat(e.details()).containsEntry("bank", "Yes Bank");
    }

    @Test
    void narrationMentioningHdfcStillDetectsYesBank() throws IOException { // Review Focus
        UnprocessableException e = catchThrowableOfType(UnprocessableException.class,
            () -> parser.readPdf(YesBankSample.headerFirst(), null));
        assertThat(e.details()).containsEntry("bank", "Yes Bank");
    }

    @Test
    void aHeaderNamingNoBankIsUnsupportedWithoutAName() {
        UnprocessableException e = catchThrowableOfType(UnprocessableException.class,
            () -> BankDetector.detect(List.of("Statement of account", "Account No : XXXX1234")));
        assertThat(e.code()).isEqualTo(ErrorCode.UNSUPPORTED_BANK);
        assertThat(e.details()).containsEntry("bank", null);
    }

    @Test
    void stateBankIsNotMistakenForBankOfIndia() {
        assertThat(BankDetector.detect(List.of("STATE BANK OF INDIA", "Account Statement"))).isEqualTo(Bank.SBI);
    }
}
```

- [ ] **Step 2: Run to see it fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.statements.BankReadersTest'`
Expected: compilation fails (`YesBankSample` missing), then, once samples exist, failures for the four unread banks.

- [ ] **Step 3: The four readers**

`IciciReader.java`:

```java
package in.gullak.ingestion.statements;

import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/** ICICI detailed statement: S No. | Value Date | Txn Date | Cheque No. | Remarks | Withdrawal | Deposit | Balance. */
@Component
class IciciReader extends BankLayoutReader {
    IciciReader() {
        super(Bank.ICICI, new BankLayout(
            Pattern.compile("^S No\\. Value Date .*Balance \\(INR\\)$"),
            Pattern.compile("^(?<sno>\\d{1,4}) (?<vdate>\\d{2}/\\d{2}/\\d{4}) (?<date>\\d{2}/\\d{2}/\\d{4}) (?<cheque>-|\\d{1,12}) "
                + "(?<desc>.+?) (?<amount>[\\d,]+\\.\\d{2}) (?<balance>[\\d,]+\\.\\d{2})$"),
            Pattern.compile("^\\d{1,4} \\d{2}/\\d{2}/\\d{4} "),
            DateTimeFormatter.ofPattern("dd/MM/uuuu", Locale.ENGLISH).withResolverStyle(ResolverStyle.STRICT),
            Pattern.compile("Opening Balance\\s*:?\\s*(?<bal>[\\d,]+\\.\\d{2})"),
            Pattern.compile("^(Total|Legends)"),
            Pattern.compile("^(Page \\d+ of \\d+|ICICI Bank Limited|DETAILED STATEMENT)$"),
            false));
    }
}
```

`SbiReader.java`:

```java
package in.gullak.ingestion.statements;

import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.format.ResolverStyle;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/** SBI account statement: Txn Date | Value Date | Description | Ref No./Cheque No. | Debit | Credit | Balance. */
@Component
class SbiReader extends BankLayoutReader {
    SbiReader() {
        super(Bank.SBI, new BankLayout(
            Pattern.compile("^Txn Date Value Date Description .*Balance$"),
            Pattern.compile("^(?<date>\\d{1,2} [A-Z][a-z]{2} \\d{4}) (?<vdate>\\d{1,2} [A-Z][a-z]{2} \\d{4}) (?<desc>.+?) "
                + "(?<ref>(?=\\S*\\d)[A-Z0-9/-]{6,30}) (?<amount>[\\d,]+\\.\\d{2}) (?<balance>[\\d,]+\\.\\d{2})$"),
            Pattern.compile("^\\d{1,2} [A-Z][a-z]{2} \\d{4} "),
            new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern("d MMM uuuu")
                .toFormatter(Locale.ENGLISH).withResolverStyle(ResolverStyle.STRICT),
            Pattern.compile("Balance as on \\d{1,2} [A-Z][a-z]{2} \\d{4}\\s*:\\s*(?<bal>[\\d,]+\\.\\d{2})"),
            Pattern.compile("^(\\*\\*This is a computer generated|Closing Balance)"),
            Pattern.compile("^(Page \\d+ of \\d+|STATE BANK OF INDIA|Account Statement)$"),
            false));
    }
}
```

`AxisReader.java`:

```java
package in.gullak.ingestion.statements;

import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/** Axis statement: Tran Date | CHQNO | PARTICULARS | DR | CR | BAL | SOL. The cheque column is usually empty. */
@Component
class AxisReader extends BankLayoutReader {
    AxisReader() {
        super(Bank.AXIS, new BankLayout(
            Pattern.compile("^Tran Date .*SOL$"),
            Pattern.compile("^(?<date>\\d{2}-\\d{2}-\\d{4}) (?<desc>.+?) (?<amount>[\\d,]+\\.\\d{2}) (?<balance>[\\d,]+\\.\\d{2}) (?<sol>\\d{3,5})$"),
            Pattern.compile("^\\d{2}-\\d{2}-\\d{4} "),
            DateTimeFormatter.ofPattern("dd-MM-uuuu", Locale.ENGLISH).withResolverStyle(ResolverStyle.STRICT),
            Pattern.compile("OPENING BALANCE\\s*:?\\s*(?<bal>[\\d,]+\\.\\d{2})"),
            Pattern.compile("^(TRANSACTION TOTAL|CLOSING BALANCE)"),
            Pattern.compile("^(Page \\d+ of \\d+|AXIS BANK|Statement of Account.*)$"),
            false));
    }
}
```

`KotakReader.java`:

```java
package in.gullak.ingestion.statements;

import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/** Kotak statement: Date | Narration | Chq/Ref No | Withdrawal (Dr)/ Deposit (Cr) | Balance; one amount column with a marker. */
@Component
class KotakReader extends BankLayoutReader {
    KotakReader() {
        super(Bank.KOTAK, new BankLayout(
            Pattern.compile("^Date Narration Chq/Ref No .*Balance$"),
            Pattern.compile("^(?<date>\\d{2}-\\d{2}-\\d{4}) (?<desc>.+?) (?<ref>(?=\\S*\\d)[A-Z0-9-]{6,30}) "
                + "(?<amount>[\\d,]+\\.\\d{2})\\((?<marker>Dr|Cr)\\) (?<balance>[\\d,]+\\.\\d{2})\\((?:Cr|Dr)\\)$"),
            Pattern.compile("^\\d{2}-\\d{2}-\\d{4} "),
            DateTimeFormatter.ofPattern("dd-MM-uuuu", Locale.ENGLISH).withResolverStyle(ResolverStyle.STRICT),
            Pattern.compile("Opening Balance\\s*:?\\s*(?<bal>[\\d,]+\\.\\d{2})"),
            Pattern.compile("^(Statement Summary|Total)"),
            Pattern.compile("^(Page \\d+ of \\d+|Kotak Mahindra Bank.*|Account Statement)$"),
            true));
    }
}
```

In `TestParsers.java`, replace `readers()`:

```java
    public static List<PdfStatementReader> readers() {
        return List.of(new HdfcReader(), new IciciReader(), new SbiReader(), new AxisReader(), new KotakReader());
    }
```

- [ ] **Step 4: The samples**

`samples/CommonRows.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.time.LocalDate;
import java.util.List;

/** 24 invented October 2026 rows shared by the ICICI, SBI, Axis and Kotak samples. */
final class CommonRows {
    static final long OPENING = 90_000_00L;

    private CommonRows() {}

    static List<SampleRow> rows() {
        return List.of(
            row(1, "NEFT CR-ACME TECH PVT LTD-SALARY", 40_000, true),
            row(1, "UPI to landlord.v@okhdfcbank", 8_000, false),
            row(2, "UPI/SWIGGY/swiggy@icici", 342, false),
            row(3, "ATM WDL-ATM CASH KORAMANGALA", 1_000, false),
            row(3, "UPI/MURUGAN TEA STALL", 40, false),
            row(4, "UPI/ZEPTO/zepto@ybl", 287, false),
            row(5, "NETFLIX COM", 649, false),
            row(6, "UPI/KAKA DHABA", 180, false),
            row(7, "NEFT to SBI SIP-SIP MUTUAL FUND", 5_000, false),
            row(8, "UPI to priya.s@oksbi", 600, false),
            row(9, "POS AMAZON RETAIL CARD 4012", 1_299, false),
            row(10, "UPI/BIGBASKET/bigbasket@hdfcbank", 1_140, false),
            row(11, "BESCOM ELECTRICITY BILL", 1_380, false),
            row(12, "UPI/UBER INDIA/uber@icici", 214, false),
            row(13, "SPOTIFY INDIA", 119, false),
            row(14, "UPI/APOLLO PHARMACY/apollo@icici", 466, false),
            row(15, "IRCTC E TICKET", 1_845, false),
            row(16, "BHARATPE*JUICE CORNER", 70, false),
            row(17, "UPI/PVR CINEMAS/pvr@icici", 620, false),
            row(18, "UPI/RAPIDO/rapido@ybl", 96, false),
            row(19, "REFUND AMAZON RETAIL", 299, true),
            row(20, "UPI/ZOMATO/zomato@hdfcbank", 512, false),
            row(21, "UPI/BLINKIT/blinkit@icici", 433, false),
            row(22, "UPI to amit.k@okicici", 150, false));
    }

    private static SampleRow row(int day, String narration, long rupees, boolean credit) {
        return new SampleRow(LocalDate.of(2026, 10, day), narration, rupees * 100, credit);
    }
}
```

`samples/IciciSample.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.io.IOException;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public final class IciciSample {
    private static final float[] X = {30, 52, 100, 148, 175, 380, 450, 515};
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd/MM/uuuu");

    private IciciSample() {}

    public static byte[] build() throws IOException {
        List<SampleRow> rows = CommonRows.rows();
        List<List<SamplePdf.Cell>> cells = new ArrayList<>();
        long balance = CommonRows.OPENING;
        for (int i = 0; i < rows.size(); i++) {
            SampleRow r = rows.get(i);
            balance += r.credit() ? r.paise() : -r.paise();
            String date = r.date().format(DATE);
            cells.add(List.of(cell(0, Integer.toString(i + 1)), cell(1, date), cell(2, date), cell(3, "-"),
                cell(4, r.narration()), cell(r.credit() ? 6 : 5, SampleMoney.western(r.paise())), cell(7, SampleMoney.western(balance))));
        }
        List<String> first = List.of("ICICI Bank Limited", "DETAILED STATEMENT", "Name : PRIYA SHARMA",
            "A/c No : XXXXXXXX7302", "Period : 01/10/2026 - 22/10/2026", "Opening Balance : " + SampleMoney.western(CommonRows.OPENING));
        List<SamplePdf.Cell> header = List.of(cell(0, "S No."), cell(1, "Value Date"), cell(2, "Txn Date"), cell(3, "Cheque No."),
            cell(4, "Transaction Remarks"), cell(5, "Withdrawal (INR)"), cell(6, "Deposit (INR)"), cell(7, "Balance (INR)"));
        return SamplePdf.bytes(SamplePdf.document(SamplePdf.paged(first, List.of("ICICI Bank Limited", "DETAILED STATEMENT"),
            header, cells, List.of("Total", "Legends : UPI - Unified Payments Interface"))));
    }

    public static Expected expected() {
        return Expected.of("ICICI", CommonRows.rows(), Set.of());
    }

    private static SamplePdf.Cell cell(int column, String text) {
        return new SamplePdf.Cell(X[column], text);
    }
}
```

`samples/SbiSample.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.io.IOException;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class SbiSample {
    private static final float[] X = {30, 80, 130, 320, 395, 455, 515};
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("d MMM uuuu", Locale.ENGLISH);

    private SbiSample() {}

    public static byte[] build() throws IOException {
        List<SampleRow> rows = CommonRows.rows();
        List<List<SamplePdf.Cell>> cells = new ArrayList<>();
        long balance = CommonRows.OPENING;
        for (int i = 0; i < rows.size(); i++) {
            SampleRow r = rows.get(i);
            balance += r.credit() ? r.paise() : -r.paise();
            String date = r.date().format(DATE);
            cells.add(List.of(cell(0, date), cell(1, date), cell(2, r.narration()), cell(3, "TRF" + (5_520_100 + i)),
                cell(r.credit() ? 5 : 4, SampleMoney.indian(r.paise())), cell(6, SampleMoney.indian(balance))));
        }
        List<String> first = List.of("STATE BANK OF INDIA", "Account Statement", "Account Name : PRIYA SHARMA",
            "Account Number : XXXXXXX5519", "Balance as on 1 Oct 2026 : " + SampleMoney.indian(CommonRows.OPENING));
        List<SamplePdf.Cell> header = List.of(cell(0, "Txn Date"), cell(1, "Value Date"), cell(2, "Description"),
            cell(3, "Ref No./Cheque No."), cell(4, "Debit"), cell(5, "Credit"), cell(6, "Balance"));
        return SamplePdf.bytes(SamplePdf.document(SamplePdf.paged(first, List.of("STATE BANK OF INDIA", "Account Statement"),
            header, cells, List.of("**This is a computer generated statement"))));
    }

    public static Expected expected() {
        return Expected.of("SBI", CommonRows.rows(), Set.of());
    }

    private static SamplePdf.Cell cell(int column, String text) {
        return new SamplePdf.Cell(X[column], text);
    }
}
```

`samples/AxisSample.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.io.IOException;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public final class AxisSample {
    private static final float[] X = {30, 80, 110, 380, 440, 500, 560};
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd-MM-uuuu");

    private AxisSample() {}

    public static byte[] build() throws IOException {
        List<SampleRow> rows = CommonRows.rows();
        List<List<SamplePdf.Cell>> cells = new ArrayList<>();
        long balance = CommonRows.OPENING;
        for (SampleRow r : rows) {
            balance += r.credit() ? r.paise() : -r.paise();
            cells.add(List.of(cell(0, r.date().format(DATE)), cell(2, r.narration()),
                cell(r.credit() ? 4 : 3, SampleMoney.western(r.paise())), cell(5, SampleMoney.western(balance)), cell(6, "1234")));
        }
        List<String> first = List.of("AXIS BANK", "Statement of Account No : XXXXXXXX9917", "PRIYA SHARMA",
            "OPENING BALANCE : " + SampleMoney.western(CommonRows.OPENING));
        List<SamplePdf.Cell> header = List.of(cell(0, "Tran Date"), cell(1, "CHQNO"), cell(2, "PARTICULARS"),
            cell(3, "DR"), cell(4, "CR"), cell(5, "BAL"), cell(6, "SOL"));
        return SamplePdf.bytes(SamplePdf.document(SamplePdf.paged(first, List.of("AXIS BANK"), header, cells,
            List.of("TRANSACTION TOTAL", "CLOSING BALANCE : " + SampleMoney.western(balance)))));
    }

    public static Expected expected() {
        return Expected.of("AXIS", CommonRows.rows(), Set.of());
    }

    private static SamplePdf.Cell cell(int column, String text) {
        return new SamplePdf.Cell(X[column], text);
    }
}
```

`samples/KotakSample.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.io.IOException;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public final class KotakSample {
    private static final float[] X = {30, 80, 280, 380, 470};
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd-MM-uuuu");

    private KotakSample() {}

    public static byte[] build() throws IOException {
        List<SampleRow> rows = CommonRows.rows();
        List<List<SamplePdf.Cell>> cells = new ArrayList<>();
        long balance = CommonRows.OPENING;
        for (int i = 0; i < rows.size(); i++) {
            SampleRow r = rows.get(i);
            balance += r.credit() ? r.paise() : -r.paise();
            cells.add(List.of(cell(0, r.date().format(DATE)), cell(1, r.narration()), cell(2, "UPI-" + (429_812_340_100L + i)),
                cell(3, SampleMoney.western(r.paise()) + (r.credit() ? "(Cr)" : "(Dr)")), cell(4, SampleMoney.western(balance) + "(Cr)")));
        }
        List<String> first = List.of("Kotak Mahindra Bank Ltd.", "Account Statement", "PRIYA SHARMA", "CRN XXXX2210",
            "01 Oct 2026 to 22 Oct 2026");
        List<SamplePdf.Cell> header = List.of(cell(0, "Date"), cell(1, "Narration"), cell(2, "Chq/Ref No"),
            cell(3, "Withdrawal (Dr)/ Deposit (Cr)"), cell(4, "Balance"));
        return SamplePdf.bytes(SamplePdf.document(SamplePdf.paged(first, List.of("Kotak Mahindra Bank Ltd.", "Account Statement"),
            header, cells, List.of("Statement Summary"))));
    }

    public static Expected expected() {
        return Expected.of("KOTAK", CommonRows.rows(), Set.of());
    }

    private static SamplePdf.Cell cell(int column, String text) {
        return new SamplePdf.Cell(X[column], text);
    }
}
```

`samples/YesBankSample.java`:

```java
package in.gullak.ingestion.statements.samples;

import java.io.IOException;
import java.util.List;

/** RD-16: a bank we do not read. Its table mentions HDFC on purpose (Review Focus). */
public final class YesBankSample {
    private static final float[] X = {30, 90, 330, 420, 500};

    private YesBankSample() {}

    public static byte[] build() throws IOException {
        return draw(List.of("YES BANK", "Statement of Account", "PRIYA SHARMA"));
    }

    /** The bank's name on the second line, after a generic title. */
    public static byte[] headerFirst() throws IOException {
        return draw(List.of("Statement of Account", "YES BANK LTD", "PRIYA SHARMA"));
    }

    private static byte[] draw(List<String> preamble) throws IOException {
        List<List<SamplePdf.Cell>> rows = List.of(
            List.of(cell(0, "01/10/2026"), cell(1, "NEFT to HDFC BANK LTD-RENT"), cell(2, "YBN1001"), cell(3, "12,000.00"), cell(4, "48,000.00")),
            List.of(cell(0, "03/10/2026"), cell(1, "UPI/SWIGGY/swiggy@icici"), cell(2, "YBN1002"), cell(3, "310.00"), cell(4, "47,690.00")));
        List<SamplePdf.Cell> header = List.of(cell(0, "Date"), cell(1, "Description"), cell(2, "Reference"), cell(3, "Debit"), cell(4, "Balance"));
        return SamplePdf.bytes(SamplePdf.document(SamplePdf.paged(preamble, preamble, header, rows, List.of("End of statement"))));
    }

    private static SamplePdf.Cell cell(int column, String text) {
        return new SamplePdf.Cell(X[column], text);
    }
}
```

`samples/WriteSamples.java` (whole file):

```java
package in.gullak.ingestion.statements.samples;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Writes the committed samples: ./gradlew writeStatementSamples. To use a real anonymised statement instead, put
 * its PDF and a hand-checked <name>.expected.json in src/test/resources/statements and drop its lines here.
 */
public final class WriteSamples {
    private WriteSamples() {}

    public static void main(String[] args) throws IOException {
        Path dir = Path.of(args.length > 0 ? args[0] : "src/test/resources/statements");
        Files.createDirectories(dir);
        pdf(dir, "hdfc", HdfcSample.build(), HdfcSample.expected());
        pdf(dir, "icici", IciciSample.build(), IciciSample.expected());
        pdf(dir, "sbi", SbiSample.build(), SbiSample.expected());
        pdf(dir, "axis", AxisSample.build(), AxisSample.expected());
        pdf(dir, "kotak", KotakSample.build(), KotakSample.expected());
        pdf(dir, "hdfc-malformed", HdfcSample.malformed(), HdfcSample.expectedMalformed());
        Files.write(dir.resolve("hdfc-locked.pdf"), HdfcSample.locked());
        Files.write(dir.resolve("hdfc-empty.pdf"), HdfcSample.empty());
        Files.write(dir.resolve("yes-bank.pdf"), YesBankSample.build());
    }

    private static void pdf(Path dir, String name, byte[] bytes, Expected expected) throws IOException {
        Files.write(dir.resolve(name + ".pdf"), bytes);
        Files.writeString(dir.resolve(name + ".expected.json"), expected.json(), StandardCharsets.UTF_8);
    }
}
```

Run: `cd server && ./gradlew writeStatementSamples`
Expected: the new files appear; `hdfc.pdf` is rewritten (its bytes may differ, its expected JSON does not).

- [ ] **Step 5: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.statements.*'`
Expected: PASS. If a layout fails, print the extracted lines in a scratch test (`PdfText.extract(...)` is package-private, so call it from a test in `in.gullak.ingestion.statements`) and fix the reader's regex, not the sample: the reader is what a real statement will meet.

- [ ] **Step 6: Commit**

```bash
git add server/src/main/java/in/gullak/ingestion/statements server/src/test/java/in/gullak/ingestion/statements \
  server/src/test/resources/statements
git commit -m "feat(server): ICICI, SBI, Axis and Kotak statement readers with synthetic samples

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: CSV reading and column mapping

**Owner:** backend-engineer. **Test IDs:** RD-18, RD-19, RD-20, RD-21, RD-22, RD-23. **Red team:** yes: CSV formula injection, a 10 MB single-line file, a million commas, unbalanced quotes, NUL bytes, a mapping pointing past the last column, a header row of 10,000 cells.

**Files:**
- Create (main, `server/src/main/java/in/gullak/ingestion/statements/`): `StatementDateFormat.java`, `CsvTable.java`, `CsvParser.java`, `CsvColumns.java`, `CsvMapping.java`, `CsvMapper.java`, `CsvOutcome.java`
- Modify: `StatementParser.java` (add `readCsv`, `mapCsv`, `csvStatement`)
- Create (test): `server/src/test/java/in/gullak/ingestion/statements/StatementDateFormatTest.java`, `CsvTest.java`
- Create (test resources, hand-written): `server/src/test/resources/statements/csv/standard-comma.csv`, `semicolon.csv`, `unknown-headers.csv`, `ambiguous-dates.csv`, `signed-amount.csv`, `formulas.csv`

**Interfaces:**
- Consumes: `StatementParser.sniff`, `bounded`, `statement`; `AmountParser`, `ReadFailures`, `ValidationException(field, message)`, `Money.MAX_INCOME_PAISE`.
- Produces: `StatementParser#readCsv(byte[]): CsvTable`, `#csvBank(CsvTable): String`, `#mapCsv(CsvTable, Optional<CsvMapping>): CsvOutcome`, `#csvStatement(String bank, List<RawLine> lines, int unreadable): ParsedStatement`; `CsvTable(char delimiter, List<List<String>> rows)`; `CsvOutcome.Mapped(ParsedStatement statement, CsvMapping mapping)` and `CsvOutcome.NeedsMapping(String bank, List<String> headers, List<List<String>> rows, CsvColumns.Suggestion suggestion)`; `CsvMapping(int date, int description, Integer debit, Integer credit, Integer amount, Integer drCr, StatementDateFormat dateFormat)` with `validate(int columns)`; `CsvMapper.apply(List<List<String>> rows, CsvMapping) → Result(lines, unreadable)`; `CsvColumns.signature(headers)` (`csv:` + 16 hex) and `CsvColumns.Suggestion`; `StatementDateFormat` constants `DD_MM_YYYY_SLASH`, `DD_MM_YYYY_DASH`, `DD_MM_YY_SLASH`, `DD_MM_YY_DASH`, `D_MMM_YYYY`, `DD_MMM_YYYY_DASH`, `YYYY_MM_DD`, `MM_DD_YYYY_SLASH`.

- [ ] **Step 1: The CSV samples**

`csv/standard-comma.csv`:

```
Date,Description,Debit,Credit,Balance
01/10/2026,NEFT CR-ACME TECH PVT LTD-SALARY,,"50,000.00","1,75,000.00"
02/10/2026,UPI/SWIGGY/swiggy@icici,389.00,,"1,74,611.00"
14/10/2026,UPI/MURUGAN TEA STALL,45.00,,"1,74,566.00"
15/10/2026,"POS AMAZON RETAIL, BLR","1,499.00",,"1,73,067.00"
20/10/2026,UPI to priya.s@oksbi,"1,200.00",,"1,71,867.00"
21/10/2026,REFUND AMAZON RETAIL,,299.00,"1,72,166.00"
```

`csv/semicolon.csv`:

```
Txn Date;Narration;Withdrawal Amt;Deposit Amt;Closing Balance
03-10-2026;UPI/ZEPTO/zepto@ybl;312.00;;64,000.00
13-10-2026;ATM WDL-ATM CASH MG ROAD;2,000.00;;62,000.00
22-10-2026;IMPS-CR-RAHUL;;1,500.00;63,500.00
```

`csv/unknown-headers.csv`:

```
Posted On,Remarks,Amt,Type
2026-10-05,UPI/KAKA DHABA,150.00,DR
2026-10-06,UPI/THIRDWAVECOFFEE/okhdfc,250.00,DR
2026-10-07,CASHBACK,25.00,CR
```

`csv/ambiguous-dates.csv`:

```
Date,Description,Debit,Credit
05/10/2026,UPI/SWIGGY/swiggy@icici,389.00,
06/10/2026,UPI/ZEPTO/zepto@ybl,312.00,
```

`csv/signed-amount.csv`:

```
Date,Description,Amount
2 Oct 2026,UPI/MURUGAN TEA STALL,-45.00
14 Oct 2026,"POS AMAZON RETAIL, BLR","-1,234.00"
21 Oct 2026,REFUND AMAZON RETAIL,299
```

`csv/formulas.csv`:

```
Date,Description,Debit,Credit
14/10/2026,"=HYPERLINK(""http://evil.test"",""click"")",45.00,
15/10/2026,+SUM(1;2),60.00,
16/10/2026,@cmd|' /C calc'!A0,70.00,
```

- [ ] **Step 2: Write the failing tests**

`StatementDateFormatTest.java` (RD-23, format half):

```java
package in.gullak.ingestion.statements;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class StatementDateFormatTest {
    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "DD_MM_YYYY_SLASH|23/10/2026|2026-10-23", "DD_MM_YYYY_SLASH|5/10/2026|2026-10-05",
        "DD_MM_YYYY_DASH|23-10-2026|2026-10-23", "DD_MM_YY_SLASH|23/10/26|2026-10-23", "DD_MM_YY_DASH|23-10-26|2026-10-23",
        "D_MMM_YYYY|23 Oct 2026|2026-10-23", "D_MMM_YYYY|23 OCT 2026|2026-10-23", "DD_MMM_YYYY_DASH|23-Oct-2026|2026-10-23",
        "YYYY_MM_DD|2026-10-23|2026-10-23", "MM_DD_YYYY_SLASH|10/23/2026|2026-10-23"})
    void eachDeclaredFormatParses(StatementDateFormat format, String text, LocalDate expected) {
        assertThat(format.parse(text)).contains(expected);
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {"DD_MM_YYYY_SLASH|31/02/2026", "DD_MM_YYYY_SLASH|23/10/26", "DD_MM_YY_SLASH|23/10/2026",
        "YYYY_MM_DD|23-10-2026", "D_MMM_YYYY|23 Octo 2026", "DD_MM_YYYY_SLASH|"})
    void aDateThatDoesNotFitItsFormatIsRefused(StatementDateFormat format, String text) {
        assertThat(format.parse(text)).isEmpty();
    }

    @Test
    void ambiguousDatesAreNeverGuessed() {
        assertThat(CsvMapper.detect(List.of("05/10/2026", "06/10/2026"))).isEmpty();
        assertThat(CsvMapper.detect(List.of("05/10/2026", "14/10/2026"))).contains(StatementDateFormat.DD_MM_YYYY_SLASH);
        assertThat(CsvMapper.detect(List.of("2 Oct 2026", "21 Oct 2026"))).contains(StatementDateFormat.D_MMM_YYYY);
        assertThat(CsvMapper.detect(List.of("23-10-26"))).contains(StatementDateFormat.DD_MM_YY_DASH);
        assertThat(CsvMapper.detect(List.of("yesterday"))).isEmpty();
    }
}
```

`CsvTest.java`:

```java
package in.gullak.ingestion.statements;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.ValidationException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class CsvTest {
    final StatementParser parser = TestParsers.parser();

    private CsvOutcome read(String name, Optional<CsvMapping> saved) {
        return parser.mapCsv(parser.readCsv(Samples.bytes("csv/" + name)), saved);
    }

    private ParsedStatement mapped(String name) {
        CsvOutcome outcome = read(name, Optional.empty());
        assertThat(outcome).isInstanceOf(CsvOutcome.Mapped.class);
        return ((CsvOutcome.Mapped) outcome).statement();
    }

    @Test
    void commaSeparatedWithStandardHeadersIsRead() { // RD-18
        ParsedStatement s = mapped("standard-comma.csv");
        assertThat(s.kind()).isEqualTo(FileKind.CSV);
        assertThat(s.bank()).startsWith("csv:").hasSize(20);
        assertThat(s.lines()).hasSize(6);
        assertThat(s.lines().get(0)).isEqualTo(new RawLine(1, LocalDate.of(2026, 10, 1), 5_000_000, Direction.CREDIT,
            "NEFT CR-ACME TECH PVT LTD-SALARY"));
        assertThat(s.lines().get(3).description()).isEqualTo("POS AMAZON RETAIL, BLR");
        assertThat(s.lines().get(3).amountPaise()).isEqualTo(149_900);
        assertThat(s.unreadable()).isZero();
    }

    @Test
    void semicolonSeparatedIsRead() { // RD-19
        ParsedStatement s = mapped("semicolon.csv");
        assertThat(s.lines()).extracting(RawLine::amountPaise).containsExactly(31_200L, 200_000L, 150_000L);
        assertThat(s.lines()).extracting(RawLine::direction).containsExactly(Direction.DEBIT, Direction.DEBIT, Direction.CREDIT);
        assertThat(s.lines().get(1).date()).isEqualTo(LocalDate.of(2026, 10, 13));
    }

    @Test
    void unknownHeadersAskForAMappingWithTheHeadersListed() { // RD-20
        CsvOutcome outcome = read("unknown-headers.csv", Optional.empty());
        assertThat(outcome).isInstanceOf(CsvOutcome.NeedsMapping.class);
        CsvOutcome.NeedsMapping needs = (CsvOutcome.NeedsMapping) outcome;
        assertThat(needs.headers()).containsExactly("Posted On", "Remarks", "Amt", "Type");
        assertThat(needs.rows()).hasSize(3);
        assertThat(needs.suggestion().description()).isEqualTo(1);
        assertThat(needs.suggestion().drCr()).isEqualTo(3);
        assertThat(needs.suggestion().date()).isNull();
    }

    @Test
    void aSavedMappingIsUsedWithoutAsking() { // RD-21
        CsvMapping mapping = new CsvMapping(0, 1, null, null, 2, 3, StatementDateFormat.YYYY_MM_DD);
        CsvOutcome outcome = read("unknown-headers.csv", Optional.of(mapping));
        ParsedStatement s = ((CsvOutcome.Mapped) outcome).statement();
        assertThat(s.lines()).extracting(RawLine::direction).containsExactly(Direction.DEBIT, Direction.DEBIT, Direction.CREDIT);
        assertThat(s.lines().get(2).amountPaise()).isEqualTo(2_500);
    }

    @Test
    void everyAmountStyleParsesToPaiseWithTheRightDirection() { // RD-22
        ParsedStatement signed = mapped("signed-amount.csv");
        assertThat(signed.lines()).extracting(RawLine::amountPaise).containsExactly(4_500L, 123_400L, 29_900L);
        assertThat(signed.lines()).extracting(RawLine::direction).containsExactly(Direction.DEBIT, Direction.DEBIT, Direction.CREDIT);
        CsvMapper.Result both = CsvMapper.apply(List.of(List.of("14/10/2026", "ODD ROW", "45.00", "45.00")),
            new CsvMapping(0, 1, 2, 3, null, null, StatementDateFormat.DD_MM_YYYY_SLASH));
        assertThat(both.lines()).isEmpty();
        assertThat(both.unreadable()).isEqualTo(1);
        CsvMapper.Result negativeDebit = CsvMapper.apply(List.of(List.of("14/10/2026", "SHOP", "-45.00", "")),
            new CsvMapping(0, 1, 2, 3, null, null, StatementDateFormat.DD_MM_YYYY_SLASH));
        assertThat(negativeDebit.lines()).singleElement().satisfies(l -> {
            assertThat(l.amountPaise()).isEqualTo(4_500);
            assertThat(l.direction()).isEqualTo(Direction.DEBIT);
        });
    }

    @Test
    void ambiguousDatesAskForTheFormat() { // RD-23
        CsvOutcome outcome = read("ambiguous-dates.csv", Optional.empty());
        assertThat(outcome).isInstanceOf(CsvOutcome.NeedsMapping.class);
        assertThat(((CsvOutcome.NeedsMapping) outcome).suggestion().complete()).isTrue();
    }

    @Test
    void aRowWhoseDateDoesNotFitTheDeclaredFormatIsUnreadable() { // RD-23
        CsvMapper.Result r = CsvMapper.apply(List.of(List.of("2026-10-05", "SHOP", "45.00", "")),
            new CsvMapping(0, 1, 2, 3, null, null, StatementDateFormat.DD_MM_YYYY_SLASH));
        assertThat(r.unreadable()).isEqualTo(1);
    }

    @Test
    void formulasAreKeptAsPlainText() {
        ParsedStatement s = mapped("formulas.csv");
        assertThat(s.lines()).extracting(RawLine::description).containsExactly(
            "=HYPERLINK(\"http://evil.test\",\"click\")", "+SUM(1;2)", "@cmd|' /C calc'!A0");
    }

    @Test
    void windows1252TextAndAPreambleAreHandled() {
        String text = "Account statement for PRIYA\nCafé customer\nDate,Description,Debit,Credit\n14/10/2026,CAFÉ COFFEE DAY,180.00,\n";
        byte[] bytes = text.getBytes(Charset.forName("windows-1252"));
        ParsedStatement s = ((CsvOutcome.Mapped) parser.mapCsv(parser.readCsv(bytes), Optional.empty())).statement();
        assertThat(s.lines()).singleElement().extracting(RawLine::description).isEqualTo("CAFÉ COFFEE DAY");
    }

    @Test
    void aMappingPastTheLastColumnIsAFieldError() {
        assertThatThrownBy(() -> new CsvMapping(0, 9, 2, null, null, null, StatementDateFormat.YYYY_MM_DD).validate(4))
            .isInstanceOf(ValidationException.class).hasFieldOrPropertyWithValue("field", "description");
        assertThatThrownBy(() -> new CsvMapping(0, 1, 2, null, 3, null, StatementDateFormat.YYYY_MM_DD).validate(4))
            .isInstanceOf(ValidationException.class).hasFieldOrPropertyWithValue("field", "amount");
        assertThatThrownBy(() -> new CsvMapping(0, 1, null, null, null, null, StatementDateFormat.YYYY_MM_DD).validate(4))
            .isInstanceOf(ValidationException.class);
        assertThatThrownBy(() -> new CsvMapping(0, 0, 2, null, null, null, StatementDateFormat.YYYY_MM_DD).validate(4))
            .isInstanceOf(ValidationException.class);
    }

    @Test
    void aFileWithoutADelimiterIsNotACsv() {
        assertThat(Failures.codeOf(() -> parser.readCsv("just some words\nand more".getBytes(StandardCharsets.UTF_8))))
            .isEqualTo(ErrorCode.INVALID_FILE);
    }

    @Test
    void theSignatureDependsOnlyOnTheHeaders() {
        assertThat(CsvColumns.signature(List.of("Date", "Description", "Debit", "Credit")))
            .isEqualTo(CsvColumns.signature(List.of(" date ", "DESCRIPTION", "Debit", "credit")))
            .isNotEqualTo(CsvColumns.signature(List.of("Date", "Narration", "Debit", "Credit")));
    }
}
```

- [ ] **Step 3: Run to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.statements.CsvTest' --tests 'in.gullak.ingestion.statements.StatementDateFormatTest'`
Expected: compilation fails.

- [ ] **Step 4: Write the CSV code**

`StatementDateFormat.java`:

```java
package in.gullak.ingestion.statements;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.Locale;
import java.util.Optional;

/** The date formats a CSV mapping may declare (spec 3.2 #1). Parsing is strict: 31/02 is refused, never rolled. */
public enum StatementDateFormat {
    DD_MM_YYYY_SLASH("d/M/uuuu"),
    DD_MM_YYYY_DASH("d-M-uuuu"),
    DD_MM_YY_SLASH("d/M/uu"),
    DD_MM_YY_DASH("d-M-uu"),
    D_MMM_YYYY("d MMM uuuu"),
    DD_MMM_YYYY_DASH("d-MMM-uuuu"),
    YYYY_MM_DD("uuuu-M-d"),
    MM_DD_YYYY_SLASH("M/d/uuuu");

    private final DateTimeFormatter formatter;

    StatementDateFormat(String pattern) {
        this.formatter = new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern(pattern)
            .toFormatter(Locale.ENGLISH).withResolverStyle(ResolverStyle.STRICT);
    }

    public Optional<LocalDate> parse(String text) {
        if (text == null || text.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(LocalDate.parse(text.strip(), formatter));
        } catch (DateTimeParseException e) {
            return Optional.empty();
        }
    }
}
```

`CsvTable.java`:

```java
package in.gullak.ingestion.statements;

import java.util.List;

/** Every non-blank row of the file as cells; statement text, never logged. */
public record CsvTable(char delimiter, List<List<String>> rows) {
    public CsvTable {
        rows = rows.stream().map(List::copyOf).toList();
    }
}
```

`CsvParser.java`:

```java
package in.gullak.ingestion.statements;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** RFC 4180 with the leniency bank exports need: comma, semicolon or tab; UTF-8 or Windows-1252; CRLF or LF. */
final class CsvParser {
    private static final int MAX_CELL = 500;

    private CsvParser() {}

    static CsvTable parse(byte[] bytes, int maxRows) {
        String text = isUtf8(bytes) ? new String(bytes, StandardCharsets.UTF_8) : new String(bytes, Charset.forName("windows-1252"));
        if (text.startsWith("﻿")) {
            text = text.substring(1);
        }
        char delimiter = delimiter(text);
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        cell.append('"');
                        i++;
                    } else {
                        quoted = false;
                    }
                } else if (cell.length() < MAX_CELL * 2) {
                    cell.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == delimiter) {
                row.add(clean(cell));
                cell.setLength(0);
                if (row.size() > 200) {
                    throw ReadFailures.unreadable("That file has too many columns to be a statement");
                }
            } else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') {
                    i++;
                }
                row.add(clean(cell));
                cell.setLength(0);
                addRow(rows, row, maxRows);
                row = new ArrayList<>();
            } else if (cell.length() < MAX_CELL * 2) {
                cell.append(c);
            }
        }
        row.add(clean(cell));
        addRow(rows, row, maxRows);
        if (rows.isEmpty()) {
            throw ReadFailures.unreadable("That file is empty");
        }
        return new CsvTable(delimiter, rows);
    }

    private static void addRow(List<List<String>> rows, List<String> row, int maxRows) {
        if (row.stream().allMatch(String::isEmpty)) {
            return;
        }
        rows.add(List.copyOf(row));
        if (rows.size() > maxRows + 50) {
            throw ReadFailures.tooLong();
        }
    }

    private static String clean(StringBuilder cell) {
        StringBuilder out = new StringBuilder(cell.length());
        boolean space = false;
        for (int i = 0; i < cell.length(); i++) {
            char c = cell.charAt(i);
            if (Character.isWhitespace(c) || c == ' ') {
                space = true;
                continue;
            }
            if (Character.isISOControl(c)) {
                continue;
            }
            if (space && !out.isEmpty()) {
                out.append(' ');
            }
            space = false;
            out.append(c);
        }
        return out.length() > MAX_CELL ? out.substring(0, MAX_CELL) : out.toString();
    }

    private static char delimiter(String text) {
        int comma = 0;
        int semicolon = 0;
        int tab = 0;
        boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '"') {
                quoted = !quoted;
            } else if (!quoted && (c == '\n' || c == '\r') && comma + semicolon + tab > 0) {
                break;
            } else if (!quoted && c == ',') {
                comma++;
            } else if (!quoted && c == ';') {
                semicolon++;
            } else if (!quoted && c == '\t') {
                tab++;
            }
        }
        if (comma + semicolon + tab == 0) {
            throw ReadFailures.invalidFile();
        }
        return tab >= comma && tab >= semicolon ? '\t' : semicolon > comma ? ';' : ',';
    }

    /** Strict UTF-8 check without exceptions: overlong forms and stray continuation bytes fail. */
    static boolean isUtf8(byte[] b) {
        int i = 0;
        while (i < b.length) {
            int c = b[i] & 0xFF;
            int extra;
            if (c < 0x80) {
                extra = 0;
            } else if (c >= 0xC2 && c <= 0xDF) {
                extra = 1;
            } else if (c >= 0xE0 && c <= 0xEF) {
                extra = 2;
            } else if (c >= 0xF0 && c <= 0xF4) {
                extra = 3;
            } else {
                return false;
            }
            if (i + extra >= b.length && extra > 0) {
                return false;
            }
            for (int k = 1; k <= extra; k++) {
                if ((b[i + k] & 0xC0) != 0x80) {
                    return false;
                }
            }
            i += extra + 1;
        }
        return true;
    }
}
```

`CsvColumns.java`:

```java
package in.gullak.ingestion.statements;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Header names: the guess for the mapping screen, and the signature a saved mapping is keyed by. */
public final class CsvColumns {
    public record Suggestion(Integer date, Integer description, Integer debit, Integer credit, Integer amount, Integer drCr) {
        public boolean complete() {
            return date != null && description != null && (debit != null || credit != null || amount != null);
        }

        CsvMapping toMapping(StatementDateFormat format) {
            boolean split = debit != null || credit != null;
            return new CsvMapping(date, description, debit, credit, split ? null : amount, split ? null : drCr, format);
        }
    }

    private static final List<String> DATE = List.of("txn date", "transaction date", "tran date", "date", "posting date", "value date", "value dt");
    private static final List<String> DESCRIPTION = List.of("description", "narration", "particulars", "transaction remarks", "remarks",
        "details", "transaction details");
    private static final List<String> DEBIT = List.of("debit", "withdrawal", "withdrawal amt", "withdrawal amount", "withdrawals",
        "debit amount", "dr amount", "money out");
    private static final List<String> CREDIT = List.of("credit", "deposit", "deposit amt", "deposit amount", "deposits", "credit amount",
        "cr amount", "money in");
    private static final List<String> AMOUNT = List.of("amount", "transaction amount", "txn amount");
    private static final List<String> DR_CR = List.of("dr/cr", "cr/dr", "type", "debit/credit", "dr cr");

    private CsvColumns() {}

    public static Suggestion suggest(List<String> headers) {
        List<String> norm = headers.stream().map(CsvColumns::norm).toList();
        Set<Integer> used = new HashSet<>();
        Integer date = find(norm, DATE, used);
        Integer description = find(norm, DESCRIPTION, used);
        Integer debit = find(norm, DEBIT, used);
        Integer credit = find(norm, CREDIT, used);
        Integer amount = find(norm, AMOUNT, used);
        Integer drCr = find(norm, DR_CR, used);
        return new Suggestion(date, description, debit, credit, amount, drCr);
    }

    /** "csv:" and the first 16 hex characters of SHA-256 over the normalised header names. */
    public static String signature(List<String> headers) {
        String joined = String.join("|", headers.stream().map(CsvColumns::norm).toList());
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(joined.getBytes(StandardCharsets.UTF_8));
            return "csv:" + HexFormat.of().formatHex(digest).substring(0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    /** The header row: the first of the first 30 rows that names a date and a description, else the first wide row. */
    static int headerRow(List<List<String>> rows) {
        for (int i = 0; i < Math.min(30, rows.size()); i++) {
            Suggestion s = suggest(rows.get(i));
            if (s.date() != null && s.description() != null) {
                return i;
            }
        }
        for (int i = 0; i < Math.min(30, rows.size()); i++) {
            if (rows.get(i).stream().filter(c -> !c.isEmpty()).count() >= 2) {
                return i;
            }
        }
        return -1;
    }

    static String norm(String header) {
        return header.toLowerCase(Locale.ROOT).replace("(inr)", "").replace("(₹)", "").replaceAll("\\binr\\b", "")
            .replaceAll("[^a-z0-9/ ]", " ").replaceAll("\\s+", " ").strip();
    }

    private static Integer find(List<String> headers, List<String> names, Set<Integer> used) {
        for (String name : names) {
            for (int i = 0; i < headers.size(); i++) {
                if (!used.contains(i) && headers.get(i).equals(name)) {
                    used.add(i);
                    return i;
                }
            }
        }
        return null;
    }
}
```

`CsvMapping.java`:

```java
package in.gullak.ingestion.statements;

import in.gullak.common.error.ValidationException;
import java.util.HashSet;
import java.util.Set;

/**
 * Which column is which, by zero-based index. Either {@code debit} and/or {@code credit} (two columns), or
 * {@code amount} alone (negative means money out) or {@code amount} with {@code drCr} (a Dr/Cr marker column).
 */
public record CsvMapping(int date, int description, Integer debit, Integer credit, Integer amount, Integer drCr,
                         StatementDateFormat dateFormat) {

    public void validate(int columns) {
        check("date", date, columns);
        check("description", description, columns);
        boolean split = debit != null || credit != null;
        if (split && amount != null) {
            throw new ValidationException("amount", "Use one amount column or separate money in and out columns, not both");
        }
        if (!split && amount == null) {
            throw new ValidationException("amount", "Pick the column with the amounts");
        }
        if (drCr != null && amount == null) {
            throw new ValidationException("drCr", "A Dr/Cr column goes with a single amount column");
        }
        if (dateFormat == null) {
            throw new ValidationException("dateFormat", "Pick how the dates are written");
        }
        Set<Integer> seen = new HashSet<>();
        for (Integer index : new Integer[] {date, description, debit, credit, amount, drCr}) {
            if (index != null && !seen.add(index)) {
                throw new ValidationException("description", "Each column can be used once");
            }
        }
        if (debit != null) {
            check("debit", debit, columns);
        }
        if (credit != null) {
            check("credit", credit, columns);
        }
        if (amount != null) {
            check("amount", amount, columns);
        }
        if (drCr != null) {
            check("drCr", drCr, columns);
        }
    }

    private static void check(String field, int index, int columns) {
        if (index < 0 || index >= columns) {
            throw new ValidationException(field, "That column isn't in the file");
        }
    }
}
```

`CsvMapper.java`:

```java
package in.gullak.ingestion.statements;

import in.gullak.common.money.Money;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;

/** Applies a mapping to data rows. A row that does not fit is counted, never guessed. */
public final class CsvMapper {
    public record Result(List<RawLine> lines, int unreadable) {}

    private CsvMapper() {}

    public static Result apply(List<List<String>> rows, CsvMapping m) {
        List<RawLine> lines = new ArrayList<>();
        int unreadable = 0;
        for (List<String> row : rows) {
            Optional<RawLine> line = line(lines.size() + 1, row, m);
            if (line.isPresent()) {
                lines.add(line.get());
            } else {
                unreadable++;
            }
        }
        return new Result(List.copyOf(lines), unreadable);
    }

    /** The one format that reads every value; empty when none does or when two read them differently (RD-23). */
    public static Optional<StatementDateFormat> detect(List<String> cells) {
        List<String> values = cells.stream().filter(c -> c != null && !c.isBlank()).toList();
        if (values.isEmpty()) {
            return Optional.empty();
        }
        StatementDateFormat chosen = null;
        List<LocalDate> chosenDates = null;
        for (StatementDateFormat f : StatementDateFormat.values()) {
            List<LocalDate> dates = new ArrayList<>();
            for (String v : values) {
                Optional<LocalDate> d = f.parse(v);
                if (d.isEmpty()) {
                    break;
                }
                dates.add(d.get());
            }
            if (dates.size() != values.size()) {
                continue;
            }
            if (chosen == null) {
                chosen = f;
                chosenDates = dates;
            } else if (!chosenDates.equals(dates)) {
                return Optional.empty();
            }
        }
        return Optional.ofNullable(chosen);
    }

    private static Optional<RawLine> line(int rowNo, List<String> row, CsvMapping m) {
        Optional<LocalDate> date = m.dateFormat().parse(cell(row, m.date()));
        String description = cell(row, m.description());
        if (date.isEmpty() || description.isEmpty()) {
            return Optional.empty();
        }
        long amount;
        Direction direction;
        if (m.amount() != null) {
            OptionalLong value = AmountParser.paise(cell(row, m.amount()));
            if (value.isEmpty() || value.getAsLong() == 0) {
                return Optional.empty();
            }
            amount = Math.abs(value.getAsLong());
            if (m.drCr() != null) {
                Optional<Direction> marker = AmountParser.marker(cell(row, m.drCr()));
                if (marker.isEmpty()) {
                    return Optional.empty();
                }
                direction = marker.get();
            } else {
                direction = value.getAsLong() < 0 ? Direction.DEBIT : Direction.CREDIT;
            }
        } else {
            long out = nonZero(m.debit() == null ? "" : cell(row, m.debit()));
            long in = nonZero(m.credit() == null ? "" : cell(row, m.credit()));
            if ((out == 0) == (in == 0)) {
                return Optional.empty();
            }
            amount = out != 0 ? out : in;
            direction = out != 0 ? Direction.DEBIT : Direction.CREDIT;
        }
        if (amount > Money.MAX_INCOME_PAISE) {
            return Optional.empty();
        }
        String text = description.length() > 200 ? description.substring(0, 200) : description;
        return Optional.of(new RawLine(rowNo, date.get(), amount, direction, text));
    }

    private static long nonZero(String text) {
        OptionalLong v = AmountParser.paise(text);
        return v.isPresent() ? Math.abs(v.getAsLong()) : 0;
    }

    private static String cell(List<String> row, int index) {
        return index < row.size() ? row.get(index) : "";
    }
}
```

`CsvOutcome.java`:

```java
package in.gullak.ingestion.statements;

import java.util.List;

public sealed interface CsvOutcome {
    record Mapped(ParsedStatement statement, CsvMapping mapping) implements CsvOutcome {}

    /** {@code rows} are the data rows after the header; the caller stores them (encrypted) until the user maps them. */
    record NeedsMapping(String bank, List<String> headers, List<List<String>> rows, CsvColumns.Suggestion suggestion)
        implements CsvOutcome {}
}
```

In `StatementParser.java`, add these public methods after `readPdf` (and the imports `java.util.Optional`):

```java
    public CsvTable readCsv(byte[] bytes) {
        if (sniff(bytes) != FileKind.CSV) {
            throw ReadFailures.invalidFile();
        }
        return bounded(() -> CsvParser.parse(bytes, props.maxLines()));
    }

    /** Uses the saved mapping, or the headers when they are standard and the dates are unambiguous; else asks. */
    public CsvOutcome mapCsv(CsvTable table, Optional<CsvMapping> saved) {
        int headerRow = CsvColumns.headerRow(table.rows());
        if (headerRow < 0) {
            throw ReadFailures.unreadable("We couldn't find the column names in that file");
        }
        List<String> headers = table.rows().get(headerRow);
        List<List<String>> data = table.rows().subList(headerRow + 1, table.rows().size());
        String bank = CsvColumns.signature(headers);
        CsvColumns.Suggestion suggestion = CsvColumns.suggest(headers);
        CsvMapping mapping = saved.orElse(null);
        if (mapping == null && suggestion.complete()) {
            List<String> dateCells = data.stream().map(r -> suggestion.date() < r.size() ? r.get(suggestion.date()) : "").toList();
            mapping = CsvMapper.detect(dateCells).map(suggestion::toMapping).orElse(null);
        }
        if (mapping == null) {
            return new CsvOutcome.NeedsMapping(bank, headers, List.copyOf(data), suggestion);
        }
        mapping.validate(headers.size());
        CsvMapper.Result result = CsvMapper.apply(data, mapping);
        return new CsvOutcome.Mapped(csvStatement(bank, result.lines(), result.unreadable()), mapping);
    }

    public ParsedStatement csvStatement(String bank, List<RawLine> lines, int unreadable) {
        return statement(FileKind.CSV, bank, "CSV statement", "CSV", false, lines, unreadable);
    }

    /** The signature a saved mapping is looked up by, before mapping. */
    public String csvBank(CsvTable table) {
        int headerRow = CsvColumns.headerRow(table.rows());
        if (headerRow < 0) {
            throw ReadFailures.unreadable("We couldn't find the column names in that file");
        }
        return CsvColumns.signature(table.rows().get(headerRow));
    }
```

- [ ] **Step 5: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.statements.*'`
Expected: PASS.

- [ ] **Step 6: Red team**

Dispatch `red-team` with task id `plan-04-task-4` against `StatementParser.readCsv` and `mapCsv` with the inputs in the header of this task, plus a CSV whose description cells are 100 KB each. Expected: bounded memory, `UNREADABLE` or `INVALID_FILE`, never a 500, and formulas returned as text. Findings to `docs/reports/red-team/plan-04-task-4.md`.

- [ ] **Step 7: Commit**

```bash
git add server/src/main/java/in/gullak/ingestion/statements server/src/test/java/in/gullak/ingestion/statements \
  server/src/test/resources/statements/csv
git commit -m "feat(server): CSV statements with header detection, saved mappings and unambiguous dates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Categorising, suggestions and line kinds

**Owner:** backend-engineer. **Test IDs:** CAT-01, CAT-02, CAT-03, CAT-04, CAT-05, CAT-06, CAT-07 (rule-lookup half; the learning half is Task 8), CAT-08, CAT-09 (new: suggested chips and hints for unknown lines), MAT-14 and MAT-19 (classification half). **Red team:** no (pure functions; their inputs are attacked through the API in Tasks 7–10).

**Files:**
- Create (main, `server/src/main/java/in/gullak/ingestion/categorise/`): `CategoryCodes.java`, `MerchantText.java`, `MerchantDictionary.java`, `GuessSource.java`, `Guess.java`, `Categoriser.java`, `Hint.java`, `Suggestion.java`, `Suggester.java`, `LineKind.java`, `LineClassifier.java`
- Create (test, `server/src/test/java/in/gullak/ingestion/categorise/`): `MerchantTextTest.java`, `CategoriserTest.java`, `SuggesterTest.java`, `LineClassifierTest.java`

**Interfaces:**
- Consumes: `in.gullak.ingestion.statements.Direction`; Plan 3's twelve category codes (as strings).
- Produces: `CategoryCodes` (constants, `ALL`, `REGEX`); `MerchantText.normalise/squash/tokens/vpa/personalVpa/key/displayName`; `MerchantDictionary.DEFAULT` and `lookup(raw): Optional<Entry>`; `Categoriser(MerchantDictionary)#categorise(String raw, Function<String, Optional<String>> userRuleByKey): Optional<Guess>`; `Guess(String categoryCode, GuessSource source, String displayName)`; `GuessSource { USER_RULE, DICTIONARY, PERSONAL_UPI }`; `Suggester#suggest(String raw, Optional<Guess> guess): Suggestion(List<String> categories, Hint hint)`; `Hint { CAFE, RESTAURANT, FOOD_STALL, JUICE, KIRANA, PRODUCE, SERVICE, DELIVERY, PERSON, UNKNOWN }`; `LineKind { SPEND, CREDIT, ATM, SAVINGS }`; `LineClassifier.kind(Direction, String raw)` and `LineClassifier.paymentMethod(String raw)` (`upi`, `card` or `unknown`).

- [ ] **Step 1: Write the failing tests**

`MerchantTextTest.java`:

```java
package in.gullak.ingestion.categorise;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class MerchantTextTest {
    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "UPI/THIRDWAVECOFFEE/okhdfc|THIRDWAVECOFFEE",
        "UPI/SWIGGY/swiggy@icici|SWIGGY",
        "BHARATPE*MOMO POINT|MOMO POINT",
        "PYU*BLINKIT8841|BLINKIT",
        "PG*ZMT8812|ZMT",
        "POS AMAZON RETAIL CARD 4012|AMAZON RETAIL CARD",
        "NEFT CR-ACME TECH PVT LTD-SALARY|ACME TECH PVT LTD SALARY",
        "UPI to priya.s@oksbi|VPA:PRIYA.S@OKSBI",
        "UPI to 98xxxxxx10@ybl|VPA:98XXXXXX10@YBL",
        "UPI/paytmqr2810050501@paytm|PAYTMQR2810050501",
        "  upi/kaka   dhaba |KAKA DHABA",
        "0000429812345678|UNKNOWN"})
    void keysAreStableAcrossReferenceNumbersAndPrefixes(String raw, String key) {
        assertThat(MerchantText.key(raw)).isEqualTo(key);
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {"VPA:PRIYA.S@OKSBI|priya.s", "KAKA DHABA|Kaka Dhaba", "MOMO POINT|Momo Point"})
    void displayNamesAreReadable(String key, String name) {
        assertThat(MerchantText.displayName(key)).isEqualTo(name);
    }
}
```

`CategoriserTest.java`:

```java
package in.gullak.ingestion.categorise;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class CategoriserTest {
    static final Function<String, Optional<String>> NO_RULES = key -> Optional.empty();
    final Categoriser categoriser = new Categoriser(MerchantDictionary.DEFAULT);

    private String code(String raw) {
        return categoriser.categorise(raw, NO_RULES).map(Guess::categoryCode).orElse(null);
    }

    @Test
    void dictionaryHit() { // CAT-01
        assertThat(code("SWIGGY*ORDER")).isEqualTo(CategoryCodes.FOOD_DELIVERY);
        assertThat(categoriser.categorise("SWIGGY*ORDER", NO_RULES).orElseThrow().displayName()).isEqualTo("Swiggy");
    }

    @ParameterizedTest
    @ValueSource(strings = {"PYU*BLINKIT8841", "ZEPTO", "INSTAMART", "UPI/SWIGGY INSTAMART/instamart@icici"})
    void quickCommerce(String raw) { // CAT-02
        assertThat(code(raw)).isEqualTo(CategoryCodes.QUICK_COMMERCE);
    }

    @Test
    void personalUpiHandle() { // CAT-03
        Guess g = categoriser.categorise("UPI to priya.s@oksbi", NO_RULES).orElseThrow();
        assertThat(g.categoryCode()).isEqualTo(CategoryCodes.UPI_TO_PEOPLE);
        assertThat(g.source()).isEqualTo(GuessSource.PERSONAL_UPI);
    }

    @Test
    void businessHandleInTheDictionary() { // CAT-04
        assertThat(code("UPI/THIRDWAVECOFFEE/okhdfc")).isEqualTo(CategoryCodes.EATING_OUT);
    }

    @Test
    void unknownTextIsUncategorised() { // CAT-05
        assertThat(categoriser.categorise("BHARATPE*MOMO POINT", NO_RULES)).isEmpty();
        assertThat(categoriser.categorise("UPI/paytmqr2810050501@paytm", NO_RULES)).isEmpty();
    }

    @Test
    void aUserRuleWinsOverTheDictionary() { // CAT-06
        Categoriser withDhaba = new Categoriser(new MerchantDictionary(List.of(
            new MerchantDictionary.Entry("DHABA", CategoryCodes.OTHER, "Dhaba", false))));
        Function<String, Optional<String>> rules = key -> Optional.ofNullable(Map.of("KAKA DHABA", CategoryCodes.EATING_OUT).get(key));
        assertThat(withDhaba.categorise("UPI/KAKA DHABA", NO_RULES).orElseThrow().categoryCode()).isEqualTo(CategoryCodes.OTHER);
        Guess g = withDhaba.categorise("UPI/KAKA DHABA", rules).orElseThrow();
        assertThat(g.categoryCode()).isEqualTo(CategoryCodes.EATING_OUT);
        assertThat(g.source()).isEqualTo(GuessSource.USER_RULE);
        assertThat(g.displayName()).isEqualTo("Kaka Dhaba");
    }

    @Test
    void aLearnedRuleCategorisesTheNextImport() { // CAT-07 (lookup half)
        Function<String, Optional<String>> learned = key -> key.equals("KAKA DHABA") ? Optional.of(CategoryCodes.EATING_OUT) : Optional.empty();
        assertThat(categoriser.categorise("UPI/KAKA DHABA", learned).map(Guess::source)).contains(GuessSource.USER_RULE);
        Function<String, Optional<String>> person = key -> key.equals("VPA:PRIYA.S@OKSBI") ? Optional.of(CategoryCodes.EATING_OUT) : Optional.empty();
        assertThat(categoriser.categorise("UPI to priya.s@oksbi", person).map(Guess::categoryCode)).contains(CategoryCodes.EATING_OUT);
    }

    @ParameterizedTest
    @ValueSource(strings = {"swiggy", " SWIGGY ", "Swiggy", "s w i g g y"})
    void caseAndSpacingDoNotMatter(String raw) { // CAT-08
        assertThat(code(raw)).isEqualTo(CategoryCodes.FOOD_DELIVERY);
    }

    @Test
    void shortNamesMatchWholeWordsOnly() {
        assertThat(code("UPI/OLA/olacabs@icici")).isEqualTo(CategoryCodes.TRAVEL);
        assertThat(code("UPI/COCA COLA CANTEEN")).isNull();
        assertThat(code("UPI/JIOMART/jiomart@sbi")).isEqualTo(CategoryCodes.GROCERIES);
        assertThat(code("JIO PREPAID RECHARGE")).isEqualTo(CategoryCodes.BILLS);
        assertThat(code("AMAZON PRIME VIDEO")).isEqualTo(CategoryCodes.SUBSCRIPTIONS);
    }
}
```

`SuggesterTest.java` (CAT-09):

```java
package in.gullak.ingestion.categorise;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class SuggesterTest {
    final Suggester suggester = new Suggester();
    final Categoriser categoriser = new Categoriser(MerchantDictionary.DEFAULT);

    private Suggestion of(String raw) {
        return suggester.suggest(raw, categoriser.categorise(raw, key -> Optional.empty()));
    }

    @Test
    void unknownShopsGetChipsAndAHint() { // CAT-09
        assertThat(of("UPI/MURUGAN TEA STALL")).isEqualTo(new Suggestion(List.of("eating_out", "other"), Hint.CAFE));
        assertThat(of("BHARATPE*MOMO POINT")).isEqualTo(new Suggestion(List.of("eating_out", "food_delivery", "other"), Hint.FOOD_STALL));
        assertThat(of("UPI/KAKA DHABA").hint()).isEqualTo(Hint.RESTAURANT);
        assertThat(of("BHARATPE*JUICE CORNER").hint()).isEqualTo(Hint.JUICE);
        assertThat(of("UPI/SHARMA GENERAL STORE")).isEqualTo(new Suggestion(List.of("shopping", "groceries", "other"), Hint.KIRANA));
        assertThat(of("PAYTM*CHAIPOINT").hint()).isEqualTo(Hint.CAFE);
        assertThat(of("PG*ZMT8812").categories()).startsWith("food_delivery");
        assertThat(of("UPI/LAKSHMI TAILORS").hint()).isEqualTo(Hint.SERVICE);
        assertThat(of("UPI/RAJU FRUIT CART").hint()).isEqualTo(Hint.PRODUCE);
    }

    @Test
    void aPersonIsSuggestedUpiToPeopleFirst() { // CAT-09
        assertThat(of("UPI to priya.s@oksbi")).isEqualTo(new Suggestion(List.of("upi_to_people", "eating_out", "other"), Hint.PERSON));
    }

    @Test
    void nothingKnownStillOffersOther() { // CAT-09
        assertThat(of("UPI/XYZ12 ENTERPRISES")).isEqualTo(new Suggestion(List.of("other"), Hint.UNKNOWN));
    }
}
```

`LineClassifierTest.java`:

```java
package in.gullak.ingestion.categorise;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.ingestion.statements.Direction;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class LineClassifierTest {
    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "DEBIT|ATM WDL-ATM CASH MG ROAD|ATM", "DEBIT|NWD-4012-ATM KORAMANGALA|ATM", "DEBIT|CASH WITHDRAWAL SELF|ATM",
        "DEBIT|NEFT to SBI SIP-SIP MUTUAL FUND|SAVINGS", "DEBIT|ACH D-ZERODHA BROKING|SAVINGS", "DEBIT|RD INSTALLMENT 12|SAVINGS",
        "DEBIT|UPI/GOSSIP CAFE|SPEND", "DEBIT|UPI/3RD WAVE STORES|SPEND", "CREDIT|NEFT CR-ACME TECH PVT LTD-SALARY|CREDIT",
        "CREDIT|ATM CASH DEPOSIT|CREDIT"})
    void kinds(Direction direction, String raw, LineKind kind) { // MAT-14, MAT-19 (classification)
        assertThat(LineClassifier.kind(direction, raw)).isEqualTo(kind);
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "UPI/SWIGGY/swiggy@icici|upi", "UPI to priya.s@oksbi|upi", "BHARATPE*MOMO POINT|upi", "PAYTM*CHAIPOINT|upi",
        "POS AMAZON RETAIL CARD 4012|card", "ECOM NETFLIX|card", "NETFLIX COM|unknown", "NEFT CR-ACME|unknown"})
    void paymentMethods(String raw, String method) {
        assertThat(LineClassifier.paymentMethod(raw)).isEqualTo(method);
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.categorise.*'`
Expected: compilation fails.

- [ ] **Step 3: Write the code**

`CategoryCodes.java`:

```java
package in.gullak.ingestion.categorise;

import java.util.List;

/** The twelve category codes of spec 2.4, as stored in Plan 3's categories table. */
public final class CategoryCodes {
    public static final String FOOD_DELIVERY = "food_delivery";
    public static final String EATING_OUT = "eating_out";
    public static final String QUICK_COMMERCE = "quick_commerce";
    public static final String GROCERIES = "groceries";
    public static final String SHOPPING = "shopping";
    public static final String SUBSCRIPTIONS = "subscriptions";
    public static final String TRAVEL = "travel";
    public static final String BILLS = "bills_recharges";
    public static final String ENTERTAINMENT = "entertainment";
    public static final String HEALTH = "health";
    public static final String UPI_TO_PEOPLE = "upi_to_people";
    public static final String OTHER = "other";

    public static final List<String> ALL = List.of(FOOD_DELIVERY, EATING_OUT, QUICK_COMMERCE, GROCERIES, SHOPPING,
        SUBSCRIPTIONS, TRAVEL, BILLS, ENTERTAINMENT, HEALTH, UPI_TO_PEOPLE, OTHER);

    /** For {@code @Pattern} on request fields. */
    public static final String REGEX = "food_delivery|eating_out|quick_commerce|groceries|shopping|subscriptions|travel"
        + "|bills_recharges|entertainment|health|upi_to_people|other";

    private CategoryCodes() {}
}
```

`MerchantText.java`:

```java
package in.gullak.ingestion.categorise;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns statement text into a stable merchant key ("UPI/THIRDWAVECOFFEE/okhdfc" → "THIRDWAVECOFFEE"), which is what
 * rules, payees and learned pairs are hashed from. Reference numbers, payment prefixes and bank handles are dropped
 * so the same shop gives the same key every month. A personal UPI handle is its own key ("VPA:PRIYA.S@OKSBI").
 */
public final class MerchantText {
    private static final Pattern VPA = Pattern.compile("([a-z0-9][a-z0-9._-]{1,63})@([a-z][a-z0-9]{1,31})", Pattern.CASE_INSENSITIVE);
    private static final Pattern PREFIX = Pattern.compile(
        "^(UPI[/-]|UPI TO |UPI |BHARATPE\\*|PYU\\*|PAYTM\\*|PG\\*|POS |ECOM |NEFT TO |NEFT CR-|NEFT-|NEFT |IMPS-CR-|IMPS-|IMPS |ACH D-|NACH-)");
    private static final List<String> QR_PREFIXES = List.of("paytmqr", "bharatpe", "mab.", "yespay.", "ibkpos", "pos.", "gpay-", "upiswiggy");
    private static final Pattern QR_NUMBER = Pattern.compile("^q\\d+.*");

    private MerchantText() {}

    public static String normalise(String raw) {
        return raw == null ? "" : raw.replace(' ', ' ').toUpperCase(Locale.ROOT).replaceAll("\\s+", " ").strip();
    }

    public static String squash(String raw) {
        return normalise(raw).replaceAll("[^A-Z0-9]", "");
    }

    public static List<String> tokens(String raw) {
        return Arrays.stream(normalise(raw).split("[^A-Z0-9]+")).filter(t -> !t.isEmpty()).toList();
    }

    /** The first UPI handle in the text, lower case. */
    public static Optional<String> vpa(String raw) {
        Matcher m = VPA.matcher(raw == null ? "" : raw);
        return m.find() ? Optional.of(m.group().toLowerCase(Locale.ROOT)) : Optional.empty();
    }

    /** A phone number or a name-like handle; merchant QR handles are not personal. */
    public static boolean personalVpa(String vpa) {
        String local = vpa.substring(0, vpa.indexOf('@'));
        if (local.matches("[0-9x]{10}")) {
            return true;
        }
        if (QR_NUMBER.matcher(local).matches()) {
            return false;
        }
        return QR_PREFIXES.stream().noneMatch(local::startsWith);
    }

    public static String key(String raw) {
        Optional<String> vpa = vpa(raw);
        if (vpa.isPresent() && personalVpa(vpa.get()) && !raw.toUpperCase(Locale.ROOT).matches(".*/[A-Z0-9 .&-]+/.*@.*")) {
            return "VPA:" + vpa.get().toUpperCase(Locale.ROOT);
        }
        String n = normalise(raw);
        String before;
        do {
            before = n;
            n = PREFIX.matcher(n).replaceFirst("");
        } while (!n.equals(before));
        int slash = n.indexOf('/');
        if (slash > 0) {
            n = n.substring(0, slash);
        }
        n = VPA.matcher(n).replaceAll(" ");
        List<String> kept = new ArrayList<>();
        for (String token : n.split("[^A-Z0-9]+")) {
            String t = token.replaceAll("\\d+$", "");
            if (t.isEmpty() || t.chars().filter(Character::isDigit).count() >= 3) {
                continue;
            }
            kept.add(t);
        }
        String key = String.join(" ", kept);
        if (key.isEmpty() && vpa.isPresent()) {
            // a merchant QR handle is the only name the shop has: keep it whole, digits included
            key = vpa.get().substring(0, vpa.get().indexOf('@')).toUpperCase(Locale.ROOT);
        }
        if (key.isEmpty()) {
            return "UNKNOWN";
        }
        return key.length() > 60 ? key.substring(0, 60) : key;
    }

    /** What the spend list shows for a statement line no dictionary knows (decision 2 in the plan). */
    public static String displayName(String key) {
        if (key.startsWith("VPA:")) {
            return key.substring(4, key.indexOf('@')).toLowerCase(Locale.ROOT);
        }
        StringBuilder out = new StringBuilder();
        for (String word : key.split(" ")) {
            if (word.isEmpty()) {
                continue;
            }
            if (!out.isEmpty()) {
                out.append(' ');
            }
            out.append(word.charAt(0)).append(word.substring(1).toLowerCase(Locale.ROOT));
        }
        return out.length() > 80 ? out.substring(0, 80) : out.toString();
    }
}
```

The `/NAME/handle@psp` check keeps "UPI/SWIGGY/swiggy@icici" a business (key `SWIGGY`) even though `swiggy@icici` looks like a handle; "UPI to priya.s@oksbi" has no business segment and stays personal.

`MerchantDictionary.java`:

```java
package in.gullak.ingestion.categorise;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * The global merchant dictionary (spec 2.4). Patterns are squashed upper-case text; longer patterns are tried first,
 * so INSTAMART beats SWIGGY and AMAZONPRIME beats AMAZON. Short, common-letter names match whole words only.
 */
public final class MerchantDictionary {
    public record Entry(String pattern, String category, String displayName, boolean wholeWord) {}

    public static final MerchantDictionary DEFAULT = new MerchantDictionary(List.of(
        e("SWIGGY", CategoryCodes.FOOD_DELIVERY, "Swiggy"), e("ZOMATO", CategoryCodes.FOOD_DELIVERY, "Zomato"),
        e("EATSURE", CategoryCodes.FOOD_DELIVERY, "EatSure"), e("DOMINOS", CategoryCodes.FOOD_DELIVERY, "Domino's"),
        e("FAASOS", CategoryCodes.FOOD_DELIVERY, "Faasos"), w("BOX8", CategoryCodes.FOOD_DELIVERY, "Box8"),
        e("ZEPTO", CategoryCodes.QUICK_COMMERCE, "Zepto"), e("BLINKIT", CategoryCodes.QUICK_COMMERCE, "Blinkit"),
        e("INSTAMART", CategoryCodes.QUICK_COMMERCE, "Instamart"), e("BBNOW", CategoryCodes.QUICK_COMMERCE, "BB Now"),
        e("FLIPKARTMINUTES", CategoryCodes.QUICK_COMMERCE, "Flipkart Minutes"), e("DUNZO", CategoryCodes.QUICK_COMMERCE, "Dunzo"),
        e("BIGBASKET", CategoryCodes.GROCERIES, "BigBasket"), e("DMART", CategoryCodes.GROCERIES, "DMart"),
        e("AVENUESUPERMARTS", CategoryCodes.GROCERIES, "DMart"), e("JIOMART", CategoryCodes.GROCERIES, "JioMart"),
        e("NATURESBASKET", CategoryCodes.GROCERIES, "Nature's Basket"), e("RELIANCEFRESH", CategoryCodes.GROCERIES, "Reliance Fresh"),
        e("AMAZON", CategoryCodes.SHOPPING, "Amazon"), e("FLIPKART", CategoryCodes.SHOPPING, "Flipkart"),
        e("MYNTRA", CategoryCodes.SHOPPING, "Myntra"), e("MEESHO", CategoryCodes.SHOPPING, "Meesho"),
        e("AJIO", CategoryCodes.SHOPPING, "Ajio"), e("NYKAA", CategoryCodes.SHOPPING, "Nykaa"),
        e("TATACLIQ", CategoryCodes.SHOPPING, "Tata CLiQ"), e("DECATHLON", CategoryCodes.SHOPPING, "Decathlon"),
        e("IKEA", CategoryCodes.SHOPPING, "IKEA"), e("CROMA", CategoryCodes.SHOPPING, "Croma"),
        e("RELIANCEDIGITAL", CategoryCodes.SHOPPING, "Reliance Digital"),
        e("NETFLIX", CategoryCodes.SUBSCRIPTIONS, "Netflix"), e("SPOTIFY", CategoryCodes.SUBSCRIPTIONS, "Spotify"),
        e("HOTSTAR", CategoryCodes.SUBSCRIPTIONS, "Hotstar"), e("JIOCINEMA", CategoryCodes.SUBSCRIPTIONS, "JioCinema"),
        e("AMAZONPRIME", CategoryCodes.SUBSCRIPTIONS, "Amazon Prime"), e("PRIMEVIDEO", CategoryCodes.SUBSCRIPTIONS, "Prime Video"),
        e("YOUTUBEPREMIUM", CategoryCodes.SUBSCRIPTIONS, "YouTube Premium"), e("GOOGLEONE", CategoryCodes.SUBSCRIPTIONS, "Google One"),
        e("APPLECOMBILL", CategoryCodes.SUBSCRIPTIONS, "Apple"), e("SONYLIV", CategoryCodes.SUBSCRIPTIONS, "SonyLIV"),
        e("ZEE5", CategoryCodes.SUBSCRIPTIONS, "ZEE5"),
        w("UBER", CategoryCodes.TRAVEL, "Uber"), w("OLA", CategoryCodes.TRAVEL, "Ola"), e("OLACABS", CategoryCodes.TRAVEL, "Ola"),
        e("RAPIDO", CategoryCodes.TRAVEL, "Rapido"), e("IRCTC", CategoryCodes.TRAVEL, "IRCTC"),
        e("MAKEMYTRIP", CategoryCodes.TRAVEL, "MakeMyTrip"), e("GOIBIBO", CategoryCodes.TRAVEL, "Goibibo"),
        e("REDBUS", CategoryCodes.TRAVEL, "redBus"), e("INDIGO", CategoryCodes.TRAVEL, "IndiGo"),
        e("AIRINDIA", CategoryCodes.TRAVEL, "Air India"), w("DMRC", CategoryCodes.TRAVEL, "Delhi Metro"),
        w("BMRCL", CategoryCodes.TRAVEL, "Namma Metro"), e("FASTAG", CategoryCodes.TRAVEL, "FASTag"),
        e("AIRTEL", CategoryCodes.BILLS, "Airtel"), w("JIO", CategoryCodes.BILLS, "Jio"),
        e("VODAFONE", CategoryCodes.BILLS, "Vi"), w("BSNL", CategoryCodes.BILLS, "BSNL"), e("BESCOM", CategoryCodes.BILLS, "BESCOM"),
        e("TATAPOWER", CategoryCodes.BILLS, "Tata Power"), e("ADANIELECTRICITY", CategoryCodes.BILLS, "Adani Electricity"),
        e("MSEDCL", CategoryCodes.BILLS, "MSEDCL"), w("BBPS", CategoryCodes.BILLS, "Bill payment"),
        e("ACTFIBERNET", CategoryCodes.BILLS, "ACT Fibernet"), e("MAHANAGARGAS", CategoryCodes.BILLS, "Mahanagar Gas"),
        e("INDANE", CategoryCodes.BILLS, "Indane"),
        e("BOOKMYSHOW", CategoryCodes.ENTERTAINMENT, "BookMyShow"), w("PVR", CategoryCodes.ENTERTAINMENT, "PVR"),
        w("INOX", CategoryCodes.ENTERTAINMENT, "INOX"),
        e("APOLLO", CategoryCodes.HEALTH, "Apollo"), e("PHARMEASY", CategoryCodes.HEALTH, "PharmEasy"),
        e("NETMEDS", CategoryCodes.HEALTH, "Netmeds"), e("TATA1MG", CategoryCodes.HEALTH, "Tata 1mg"),
        e("PRACTO", CategoryCodes.HEALTH, "Practo"), e("CULTFIT", CategoryCodes.HEALTH, "cult.fit"),
        e("STARBUCKS", CategoryCodes.EATING_OUT, "Starbucks"), e("THIRDWAVE", CategoryCodes.EATING_OUT, "Third Wave Coffee"),
        e("CHAAYOS", CategoryCodes.EATING_OUT, "Chaayos"), e("CAFECOFFEEDAY", CategoryCodes.EATING_OUT, "Cafe Coffee Day"),
        w("CCD", CategoryCodes.EATING_OUT, "Cafe Coffee Day"), e("MCDONALDS", CategoryCodes.EATING_OUT, "McDonald's"),
        w("KFC", CategoryCodes.EATING_OUT, "KFC"), e("BURGERKING", CategoryCodes.EATING_OUT, "Burger King"),
        e("HALDIRAM", CategoryCodes.EATING_OUT, "Haldiram's"), e("BARBEQUENATION", CategoryCodes.EATING_OUT, "Barbeque Nation"),
        w("SUBWAY", CategoryCodes.EATING_OUT, "Subway")));

    private final List<Entry> entries;

    public MerchantDictionary(List<Entry> entries) {
        this.entries = entries.stream().sorted(Comparator.comparingInt((Entry e) -> e.pattern().length()).reversed()).toList();
    }

    public Optional<Entry> lookup(String raw) {
        String squashed = MerchantText.squash(raw);
        List<String> tokens = MerchantText.tokens(raw);
        for (Entry e : entries) {
            if (e.wholeWord()) {
                for (String t : tokens) {
                    if (t.equals(e.pattern()) || t.matches(e.pattern() + "\\d+")) {
                        return Optional.of(e);
                    }
                }
            } else if (squashed.contains(e.pattern())) {
                return Optional.of(e);
            }
        }
        return Optional.empty();
    }

    private static Entry e(String pattern, String category, String name) {
        return new Entry(pattern, category, name, false);
    }

    private static Entry w(String pattern, String category, String name) {
        return new Entry(pattern, category, name, true);
    }
}
```

`GuessSource.java`:

```java
package in.gullak.ingestion.categorise;

public enum GuessSource { USER_RULE, DICTIONARY, PERSONAL_UPI }
```

`Guess.java`:

```java
package in.gullak.ingestion.categorise;

public record Guess(String categoryCode, GuessSource source, String displayName) {}
```

`Categoriser.java`:

```java
package in.gullak.ingestion.categorise;

import java.util.Optional;
import java.util.function.Function;

/** User rule, then dictionary, then "a person's UPI handle"; anything else is unknown and goes to sort (spec 2.4). */
public final class Categoriser {
    private final MerchantDictionary dictionary;

    public Categoriser(MerchantDictionary dictionary) {
        this.dictionary = dictionary;
    }

    /** {@code userRuleByKey} maps a {@link MerchantText#key} to the user's category for it. */
    public Optional<Guess> categorise(String raw, Function<String, Optional<String>> userRuleByKey) {
        String key = MerchantText.key(raw);
        Optional<MerchantDictionary.Entry> entry = dictionary.lookup(raw);
        Optional<String> rule = userRuleByKey.apply(key);
        if (rule.isPresent()) {
            return Optional.of(new Guess(rule.get(), GuessSource.USER_RULE, MerchantText.displayName(key)));
        }
        if (entry.isPresent()) {
            return Optional.of(new Guess(entry.get().category(), GuessSource.DICTIONARY, entry.get().displayName()));
        }
        if (key.startsWith("VPA:")) {
            return Optional.of(new Guess(CategoryCodes.UPI_TO_PEOPLE, GuessSource.PERSONAL_UPI, MerchantText.displayName(key)));
        }
        return Optional.empty();
    }
}
```

`Hint.java`:

```java
package in.gullak.ingestion.categorise;

/** Why a card was suggested what it was; the app turns each into copy ("Looks like a café"). */
public enum Hint { CAFE, RESTAURANT, FOOD_STALL, JUICE, KIRANA, PRODUCE, SERVICE, DELIVERY, PERSON, UNKNOWN }
```

`Suggestion.java`:

```java
package in.gullak.ingestion.categorise;

import java.util.List;

/** Up to three category codes for the sort card's chips, always ending with "other", and a hint. */
public record Suggestion(List<String> categories, Hint hint) {
    public Suggestion {
        categories = List.copyOf(categories);
    }
}
```

`Suggester.java`:

```java
package in.gullak.ingestion.categorise;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** Keyword hints for lines no rule or dictionary knows: the chips the swipe card starts with. */
public final class Suggester {
    private record Rule(List<String> words, Hint hint, List<String> categories) {}

    private static final List<Rule> RULES = List.of(
        new Rule(List.of("ZMT", "SWGY"), Hint.DELIVERY, List.of(CategoryCodes.FOOD_DELIVERY, CategoryCodes.EATING_OUT)),
        new Rule(List.of("JUICE", "SHAKE", "LASSI"), Hint.JUICE, List.of(CategoryCodes.EATING_OUT)),
        new Rule(List.of("TEA", "CHAI", "CHAAY", "CAFE", "COFFEE", "SANDWICH", "BAKERY", "BAKERS"), Hint.CAFE, List.of(CategoryCodes.EATING_OUT)),
        new Rule(List.of("MOMO", "MOMOS", "CHAAT", "PANIPURI", "VADA", "DOSA", "ROLL", "ROLLS", "PAAN", "SNACKS"), Hint.FOOD_STALL,
            List.of(CategoryCodes.EATING_OUT, CategoryCodes.FOOD_DELIVERY)),
        new Rule(List.of("DHABA", "RESTAURANT", "HOTEL", "BIRYANI", "KITCHEN", "MESS", "CANTEEN", "BHAVAN"), Hint.RESTAURANT,
            List.of(CategoryCodes.EATING_OUT)),
        new Rule(List.of("STORE", "STORES", "KIRANA", "GENERAL", "SUPERMARKET", "MART", "PROVISION", "PROVISIONS", "TRADERS"), Hint.KIRANA,
            List.of(CategoryCodes.SHOPPING, CategoryCodes.GROCERIES)),
        new Rule(List.of("FRUIT", "FRUITS", "VEG", "VEGETABLES", "SABZI", "DAIRY", "MILK"), Hint.PRODUCE, List.of(CategoryCodes.GROCERIES)),
        new Rule(List.of("TAILOR", "TAILORS", "SALON", "LAUNDRY", "PARLOUR", "DRYCLEAN", "CARWASH"), Hint.SERVICE, List.of(CategoryCodes.SHOPPING)));

    public Suggestion suggest(String raw, Optional<Guess> guess) {
        if (guess.isPresent() && guess.get().source() == GuessSource.PERSONAL_UPI) {
            return new Suggestion(List.of(CategoryCodes.UPI_TO_PEOPLE, CategoryCodes.EATING_OUT, CategoryCodes.OTHER), Hint.PERSON);
        }
        List<String> tokens = List.of(MerchantText.key(raw).split(" "));
        for (Rule rule : RULES) {
            for (String word : rule.words()) {
                boolean hit = tokens.stream().anyMatch(t -> t.equals(word) || (word.length() >= 4 && t.startsWith(word)));
                if (hit) {
                    Set<String> chips = new LinkedHashSet<>();
                    guess.ifPresent(g -> chips.add(g.categoryCode()));
                    chips.addAll(rule.categories());
                    List<String> out = new ArrayList<>(chips);
                    out.remove(CategoryCodes.OTHER);
                    out = new ArrayList<>(out.subList(0, Math.min(2, out.size())));
                    out.add(CategoryCodes.OTHER);
                    return new Suggestion(out, rule.hint());
                }
            }
        }
        return new Suggestion(List.of(CategoryCodes.OTHER), Hint.UNKNOWN);
    }
}
```

`LineKind.java`:

```java
package in.gullak.ingestion.categorise;

/** SPEND counts in the budget; CREDIT, ATM (cash to a wallet) and SAVINGS never do (spec 2.1, 2.5). */
public enum LineKind { SPEND, CREDIT, ATM, SAVINGS }
```

`LineClassifier.java`:

```java
package in.gullak.ingestion.categorise;

import in.gullak.ingestion.statements.Direction;
import java.util.List;
import java.util.Set;

public final class LineClassifier {
    private static final Set<String> SAVINGS_TOKENS = Set.of("SIP", "MF", "PPF", "NPS", "RD", "FD", "ZERODHA", "GROWW", "KUVERA");
    private static final List<String> SAVINGS_TEXT = List.of("MUTUALFUND", "RECURRINGDEPOSIT", "FIXEDDEPOSIT");
    private static final List<String> ATM_TEXT = List.of("ATMWDL", "CASHWDL", "CASHWITHDRAWAL");
    private static final Set<String> CARD_TOKENS = Set.of("POS", "CARD", "ECOM", "VPS", "IPS");

    private LineClassifier() {}

    public static LineKind kind(Direction direction, String raw) {
        if (direction == Direction.CREDIT) {
            return LineKind.CREDIT;
        }
        List<String> tokens = MerchantText.tokens(raw);
        String squashed = MerchantText.squash(raw);
        String normal = MerchantText.normalise(raw);
        if (tokens.contains("ATM") || ATM_TEXT.stream().anyMatch(squashed::contains) || normal.startsWith("ATW-") || normal.startsWith("NWD-")) {
            return LineKind.ATM;
        }
        if (tokens.stream().anyMatch(SAVINGS_TOKENS::contains) || SAVINGS_TEXT.stream().anyMatch(squashed::contains)) {
            return LineKind.SAVINGS;
        }
        return LineKind.SPEND;
    }

    /** upi, card or unknown, from the narration. Statement lines are never cash. */
    public static String paymentMethod(String raw) {
        List<String> tokens = MerchantText.tokens(raw);
        if (tokens.stream().anyMatch(CARD_TOKENS::contains)) {
            return "card";
        }
        String normal = MerchantText.normalise(raw);
        if (tokens.contains("UPI") || MerchantText.vpa(raw).isPresent()
            || normal.startsWith("BHARATPE*") || normal.startsWith("PAYTM*") || normal.startsWith("PYU*")) {
            return "upi";
        }
        return "unknown";
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.categorise.*'`
Expected: PASS. Then `cd server && ./gradlew test` (ArchUnit: `categorise` depends only on `statements` and the JDK).

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/in/gullak/ingestion/categorise server/src/test/java/in/gullak/ingestion/categorise
git commit -m "feat(server): merchant keys, dictionary, user-rule categorising, sort suggestions and line kinds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Matching engine

**Owner:** backend-engineer. **Test IDs:** MAT-01 to MAT-11, MAT-13 (rule), MAT-15 (rule), MAT-16, MAT-17, MAT-18 (rules), MAT-20 (maths). The same IDs are proven end to end through the API in Tasks 7 and 9. **Red team:** no.

**Files:**
- Create (main, `server/src/main/java/in/gullak/ingestion/matching/`): `PendingSpend.java`, `LineCandidate.java`, `Confidence.java`, `Link.java`, `MatchScorer.java`, `Matcher.java`, `FixedCostInfo.java`, `FixedLine.java`, `FixedHit.java`, `FixedCostDetector.java`, `CashCover.java`, `LoggingAccuracy.java`
- Create (test, `server/src/test/java/in/gullak/ingestion/matching/`): `MatcherTest.java`, `FixedCostDetectorTest.java`, `CashCoverTest.java`, `LoggingAccuracyTest.java`

**Interfaces:**
- Consumes: `MerchantText.squash` (Task 5).
- Produces: `PendingSpend(UUID id, LocalDate date, Instant occurredAt, long amountPaise, String paymentMethod, String merchantName, String categoryCode)`; `LineCandidate(UUID lineId, int rowNo, LocalDate date, long amountPaise, String paymentMethod, String squashedKey, String keyHash, String guessedCategory)`; `Confidence { HIGH, MEDIUM }`; `Link(UUID lineId, UUID spendId, int score, Confidence confidence)`; `MatchScorer.score(spend, line, learnedPair): OptionalInt`, `MatchScorer.HIGH = 90`, `MatchScorer.MEDIUM = 60`; `Matcher.match(List<LineCandidate>, List<PendingSpend>, BiPredicate<PendingSpend, LineCandidate> learned): List<Link>`; `FixedCostInfo(UUID id, String name, long amountPaise, String payeeHash, Integer usualDay)`; `FixedLine(UUID lineId, LocalDate date, long amountPaise, String keyHash, boolean dictionaryHit)`; `FixedHit(UUID lineId, UUID fixedCostId, boolean recognised)`; `FixedCostDetector.detect(lines, costs): List<FixedHit>`; `CashCover.toCash(List<PendingSpend> unmatched, LocalDate from, LocalDate to): List<UUID>`, `CashCover.miscCash(long withdrawnPaise, long loggedCashPaise): OptionalLong`; `LoggingAccuracy.percent(int confirmed, int statementOnly): OptionalInt`, `LoggingAccuracy.earnsBonus(OptionalInt): boolean`.

- [ ] **Step 1: Write the failing tests**

`MatcherTest.java`:

```java
package in.gullak.ingestion.matching;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.ingestion.categorise.MerchantText;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.BiPredicate;
import org.junit.jupiter.api.Test;

class MatcherTest {
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    static final BiPredicate<PendingSpend, LineCandidate> NONE = (s, l) -> false;
    int row = 0;

    static PendingSpend spend(String date, String time, long rupees, String method, String merchant, String category) {
        Instant at = LocalDateTime.parse(date + "T" + time).atZone(IST).toInstant();
        return new PendingSpend(UUID.randomUUID(), LocalDate.parse(date), at, rupees * 100, method, merchant, category);
    }

    LineCandidate line(String date, long rupees, String method, String raw, String guessed) {
        String key = MerchantText.key(raw);
        return new LineCandidate(UUID.randomUUID(), ++row, LocalDate.parse(date), rupees * 100, method,
            MerchantText.squash(key), "hash:" + key, guessed);
    }

    @Test
    void highConfidenceUpi() { // MAT-01
        PendingSpend s = spend("2026-10-09", "09:12", 250, "upi", "Third Wave", "eating_out");
        LineCandidate l = line("2026-10-09", 250, "upi", "UPI/THIRDWAVECOFFEE/okhdfc", "eating_out");
        assertThat(Matcher.match(List.of(l), List.of(s), NONE))
            .singleElement().satisfies(link -> {
                assertThat(link.spendId()).isEqualTo(s.id());
                assertThat(link.confidence()).isEqualTo(Confidence.HIGH);
            });
    }

    @Test
    void cardThreeDaysLaterLinks() { // MAT-02
        PendingSpend s = spend("2026-10-17", "19:00", 1_499, "card", null, "shopping");
        assertThat(Matcher.match(List.of(line("2026-10-20", 1_499, "card", "POS 4012 RETAIL", null)), List.of(s), NONE)).hasSize(1);
    }

    @Test
    void cardFourDaysLaterDoesNot() { // MAT-03
        PendingSpend s = spend("2026-10-17", "19:00", 1_499, "card", null, "shopping");
        assertThat(Matcher.match(List.of(line("2026-10-21", 1_499, "card", "POS 4012 RETAIL", null)), List.of(s), NONE)).isEmpty();
    }

    @Test
    void amountWithinFiveRupeesLinks() { // MAT-04
        PendingSpend s = spend("2026-10-09", "09:12", 250, "upi", "Third Wave", "eating_out");
        assertThat(Matcher.match(List.of(line("2026-10-09", 249, "upi", "UPI/THIRDWAVECOFFEE/okhdfc", "eating_out")), List.of(s), NONE))
            .hasSize(1);
    }

    @Test
    void amountOutsideToleranceDoesNot() { // MAT-05
        PendingSpend s = spend("2026-10-09", "09:12", 250, "upi", "Third Wave", "eating_out");
        assertThat(Matcher.match(List.of(line("2026-10-09", 240, "upi", "UPI/THIRDWAVECOFFEE/okhdfc", "eating_out")), List.of(s), NONE))
            .isEmpty();
    }

    @Test
    void cashNeverMatches() { // MAT-06
        PendingSpend s = spend("2026-10-09", "12:00", 60, "cash", "Chai", "eating_out");
        assertThat(Matcher.match(List.of(line("2026-10-09", 60, "upi", "UPI/RAJU CHAI", null)), List.of(s), NONE)).isEmpty();
    }

    @Test
    void twoIdenticalCoffeesOneLineLinksTheEarliest() { // MAT-07
        PendingSpend first = spend("2026-10-09", "09:12", 250, "upi", "Third Wave", "eating_out");
        PendingSpend second = spend("2026-10-09", "16:40", 250, "upi", "Third Wave", "eating_out");
        List<Link> links = Matcher.match(List.of(line("2026-10-09", 250, "upi", "UPI/THIRDWAVECOFFEE/okhdfc", "eating_out")),
            List.of(second, first), NONE);
        assertThat(links).singleElement().extracting(Link::spendId).isEqualTo(first.id());
    }

    @Test
    void dailyChaiLinksEachLineToItsOwnDay() { // MAT-08
        List<PendingSpend> spends = new ArrayList<>();
        List<LineCandidate> lines = new ArrayList<>();
        for (int d = 12; d <= 16; d++) {
            spends.add(spend("2026-10-" + d, "08:30", 20, "upi", "Chai", "eating_out"));
            lines.add(line("2026-10-" + d, 20, "upi", "UPI/RAJU CHAI", null));
        }
        List<Link> links = Matcher.match(lines, spends, NONE);
        assertThat(links).hasSize(5);
        for (Link link : links) {
            LineCandidate l = lines.stream().filter(x -> x.lineId().equals(link.lineId())).findFirst().orElseThrow();
            PendingSpend s = spends.stream().filter(x -> x.id().equals(link.spendId())).findFirst().orElseThrow();
            assertThat(s.date()).isEqualTo(l.date());
        }
    }

    @Test
    void exactAmountAndDayWithUnrelatedTextIsMedium() { // MAT-09
        PendingSpend s = spend("2026-10-13", "18:00", 90, "upi", "Momos", "eating_out");
        assertThat(Matcher.match(List.of(line("2026-10-13", 90, "upi", "UPI/SHARMA GENERAL STORE", null)), List.of(s), NONE))
            .singleElement().extracting(Link::confidence).isEqualTo(Confidence.MEDIUM);
    }

    @Test
    void lowConfidenceKeepsBoth() { // MAT-10
        PendingSpend upi = spend("2026-10-09", "09:12", 250, "upi", "Third Wave", "eating_out");
        assertThat(Matcher.match(List.of(line("2026-10-11", 247, "upi", "UPI/THIRDWAVECOFFEE/okhdfc", "eating_out")), List.of(upi), NONE))
            .isEmpty();
        PendingSpend unknown = spend("2026-10-09", "09:12", 250, "unknown", null, "other");
        assertThat(Matcher.match(List.of(line("2026-10-09", 247, "unknown", "NEFT XYZ", null)), List.of(unknown), NONE)).isEmpty();
    }

    @Test
    void aLearnedPairIsHighWhateverTheText() { // MAT-11
        PendingSpend s = spend("2026-10-09", "09:12", 250, "upi", "Third Wave", "eating_out");
        LineCandidate l = line("2026-10-09", 250, "upi", "UPI/TW BLR 2/okhdfc", null);
        assertThat(Matcher.match(List.of(l), List.of(s), NONE)).singleElement().extracting(Link::confidence).isEqualTo(Confidence.MEDIUM);
        assertThat(Matcher.match(List.of(l), List.of(s), (sp, li) -> true))
            .singleElement().extracting(Link::confidence).isEqualTo(Confidence.HIGH);
    }

    @Test
    void aLineBeforeTheSpendNeverMatches() {
        PendingSpend s = spend("2026-10-10", "09:00", 1_499, "card", "Amazon", "shopping");
        assertThat(Matcher.match(List.of(line("2026-10-09", 1_499, "card", "POS AMAZON RETAIL", null)), List.of(s), NONE)).isEmpty();
    }
}
```

`FixedCostDetectorTest.java`:

```java
package in.gullak.ingestion.matching;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class FixedCostDetectorTest {
    final UUID rent = UUID.randomUUID();
    final UUID maid = UUID.randomUUID();
    final UUID groceries = UUID.randomUUID();

    static FixedLine line(String date, long rupees, String hash, boolean dictionary) {
        return new FixedLine(UUID.randomUUID(), LocalDate.parse(date), rupees * 100, hash, dictionary);
    }

    @Test
    void firstSightAsksOnce() { // MAT-16
        FixedLine l = line("2026-10-05", 10_000, "h:ramesh", false);
        List<FixedHit> hits = FixedCostDetector.detect(List.of(l), List.of(new FixedCostInfo(rent, "Rent", 10_000_00, null, null)));
        assertThat(hits).containsExactly(new FixedHit(l.lineId(), rent, false));
    }

    @Test
    void aStoredPayeeIsRecognisedWithoutAQuestion() { // MAT-17
        FixedLine nov = line("2026-11-05", 10_000, "h:ramesh", false);
        List<FixedHit> hits = FixedCostDetector.detect(List.of(nov), List.of(new FixedCostInfo(rent, "Rent", 10_000_00, "h:ramesh", 5)));
        assertThat(hits).containsExactly(new FixedHit(nov.lineId(), rent, true));
    }

    @Test
    void tenPercentToleranceHolds() { // MAT-18
        FixedCostInfo known = new FixedCostInfo(rent, "Rent", 10_000_00, "h:ramesh", 5);
        assertThat(FixedCostDetector.detect(List.of(line("2026-11-05", 10_800, "h:ramesh", false)), List.of(known))).hasSize(1);
        assertThat(FixedCostDetector.detect(List.of(line("2026-11-05", 11_500, "h:ramesh", false)), List.of(known))).isEmpty();
        assertThat(FixedCostDetector.detect(List.of(line("2026-11-05", 11_500, "h:ramesh", false)),
            List.of(new FixedCostInfo(rent, "Rent", 10_000_00, null, null)))).isEmpty();
    }

    @Test
    void aRecognisedPayeeOnAnOddDayIsNot() {
        FixedCostInfo known = new FixedCostInfo(rent, "Rent", 10_000_00, "h:ramesh", 5);
        assertThat(FixedCostDetector.detect(List.of(line("2026-11-20", 10_000, "h:ramesh", false)), List.of(known))).isEmpty();
        assertThat(FixedCostDetector.detect(List.of(line("2026-11-01", 10_000, "h:ramesh", false)), List.of(known))).hasSize(1);
        assertThat(FixedCostDetector.detect(List.of(line("2026-10-31", 10_000, "h:ramesh", false)),
            List.of(new FixedCostInfo(rent, "Rent", 10_000_00, "h:ramesh", 2)))).hasSize(1);
    }

    @Test
    void dictionaryMerchantsAreNeverAskedAbout() {
        assertThat(FixedCostDetector.detect(List.of(line("2026-10-05", 1_500, "h:swiggy", true)),
            List.of(new FixedCostInfo(maid, "Maid", 1_500_00, null, null)))).isEmpty();
    }

    @Test
    void eachLineServesOneCostAndEachCostTakesTheNearestAmount() {
        FixedLine exact = line("2026-10-01", 1_500, "h:kamla", false);
        FixedLine near = line("2026-10-03", 1_450, "h:other", false);
        List<FixedHit> hits = FixedCostDetector.detect(List.of(near, exact), List.of(
            new FixedCostInfo(maid, "Maid", 1_500_00, null, null),
            new FixedCostInfo(groceries, "Monthly groceries", 1_500_00, null, null)));
        assertThat(hits).containsExactly(new FixedHit(exact.lineId(), maid, false), new FixedHit(near.lineId(), groceries, false));
    }
}
```

`CashCoverTest.java`:

```java
package in.gullak.ingestion.matching;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import java.util.OptionalLong;
import org.junit.jupiter.api.Test;

class CashCoverTest {
    static final LocalDate FROM = LocalDate.of(2026, 10, 1);
    static final LocalDate TO = LocalDate.of(2026, 10, 22);

    @Test
    void anUnmatchedSpendOnACoveredDayBecomesCash() { // MAT-13
        PendingSpend chai = MatcherTest.spend("2026-10-11", "10:00", 60, "upi", "Chai", "eating_out");
        assertThat(CashCover.toCash(List.of(chai), FROM, TO)).containsExactly(chai.id());
    }

    @Test
    void cardSpendsInTheLastThreeDaysMayStillPost() {
        PendingSpend late = MatcherTest.spend("2026-10-20", "10:00", 900, "card", null, "shopping");
        PendingSpend covered = MatcherTest.spend("2026-10-19", "10:00", 900, "card", null, "shopping");
        assertThat(CashCover.toCash(List.of(late, covered), FROM, TO)).containsExactly(covered.id());
    }

    @Test
    void cashAndUncoveredDaysAreLeftAlone() {
        PendingSpend cash = MatcherTest.spend("2026-10-11", "10:00", 60, "cash", null, "eating_out");
        PendingSpend after = MatcherTest.spend("2026-10-23", "10:00", 60, "upi", null, "eating_out");
        assertThat(CashCover.toCash(List.of(cash, after), FROM, TO)).isEmpty();
    }

    @Test
    void miscCashIsTheShortfall() { // MAT-15
        assertThat(CashCover.miscCash(2_000_00, 1_400_00)).isEqualTo(OptionalLong.of(600_00));
        assertThat(CashCover.miscCash(2_000_00, 2_000_00)).isEmpty();
        assertThat(CashCover.miscCash(0, 0)).isEmpty();
    }
}
```

`LoggingAccuracyTest.java`:

```java
package in.gullak.ingestion.matching;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.OptionalInt;
import org.junit.jupiter.api.Test;

class LoggingAccuracyTest {
    @Test
    void ninetyPercentEarnsTheBonus() { // MAT-20
        assertThat(LoggingAccuracy.percent(9, 1)).isEqualTo(OptionalInt.of(90));
        assertThat(LoggingAccuracy.earnsBonus(LoggingAccuracy.percent(9, 1))).isTrue();
        assertThat(LoggingAccuracy.earnsBonus(LoggingAccuracy.percent(8, 1))).isFalse();
        assertThat(LoggingAccuracy.percent(0, 0)).isEmpty();
        assertThat(LoggingAccuracy.earnsBonus(OptionalInt.empty())).isFalse();
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.matching.*'`
Expected: compilation fails.

- [ ] **Step 3: Write the code**

`PendingSpend.java`:

```java
package in.gullak.ingestion.matching;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/** A logged spend still waiting for the bank. {@code date} is its IST date. {@code merchantName} may be null. */
public record PendingSpend(UUID id, LocalDate date, Instant occurredAt, long amountPaise, String paymentMethod,
                           String merchantName, String categoryCode) {}
```

`LineCandidate.java`:

```java
package in.gullak.ingestion.matching;

import java.time.LocalDate;
import java.util.UUID;

/** A statement debit that may confirm a spend. {@code squashedKey} is MerchantText.squash of its merchant key. */
public record LineCandidate(UUID lineId, int rowNo, LocalDate date, long amountPaise, String paymentMethod,
                            String squashedKey, String keyHash, String guessedCategory) {}
```

`Confidence.java`:

```java
package in.gullak.ingestion.matching;

public enum Confidence { HIGH, MEDIUM }
```

`Link.java`:

```java
package in.gullak.ingestion.matching;

import java.util.UUID;

public record Link(UUID lineId, UUID spendId, int score, Confidence confidence) {}
```

`MatchScorer.java`:

```java
package in.gullak.ingestion.matching;

import in.gullak.ingestion.categorise.MerchantText;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.Map;
import java.util.OptionalInt;

/** The scoring table of spec 2.5, with the weights of decision 9 in the plan. */
public final class MatchScorer {
    public static final int HIGH = 90;
    public static final int MEDIUM = 60;

    private MatchScorer() {}

    /** Empty when the pair can never match: cash, the wrong payment kind, the amount or the date out of range. */
    public static OptionalInt score(PendingSpend s, LineCandidate l, boolean learnedPair) {
        if ("cash".equals(s.paymentMethod()) || !compatible(s.paymentMethod(), l.paymentMethod())) {
            return OptionalInt.empty();
        }
        long diff = Math.abs(s.amountPaise() - l.amountPaise());
        int amount;
        if (diff == 0) {
            amount = 40;
        } else if (diff <= Math.max(500, s.amountPaise() * 2 / 100)) {
            amount = 25;
        } else {
            return OptionalInt.empty();
        }
        long late = ChronoUnit.DAYS.between(s.date(), l.date());
        long maxLate = "upi".equals(s.paymentMethod()) ? 0 : 3;
        if (late < 0 || late > maxLate) {
            return OptionalInt.empty();
        }
        int date = late == 0 ? 30 : 20;
        int method = s.paymentMethod().equals(l.paymentMethod()) && !"unknown".equals(l.paymentMethod()) ? 10 : 0;
        int merchant = merchantScore(s.merchantName(), l.squashedKey());
        int category = l.guessedCategory() != null && l.guessedCategory().equals(s.categoryCode()) ? 5 : 0;
        int total = amount + date + method + merchant + category;
        return OptionalInt.of(learnedPair ? Math.max(total, 100) : total);
    }

    static boolean compatible(String spend, String line) {
        return "unknown".equals(spend) || "unknown".equals(line) || spend.equals(line);
    }

    static int merchantScore(String typed, String lineSquashed) {
        if (typed == null || typed.isBlank() || lineSquashed == null || lineSquashed.isEmpty()) {
            return 0;
        }
        String t = MerchantText.squash(typed);
        if (t.length() >= 3 && (lineSquashed.contains(t) || (lineSquashed.length() >= 3 && t.contains(lineSquashed)))) {
            return 20;
        }
        return dice(t, lineSquashed) >= 0.5 ? 10 : 0;
    }

    static double dice(String a, String b) {
        if (a.length() < 2 || b.length() < 2) {
            return 0;
        }
        Map<String, Integer> grams = new HashMap<>();
        for (int i = 0; i < a.length() - 1; i++) {
            grams.merge(a.substring(i, i + 2), 1, Integer::sum);
        }
        int shared = 0;
        for (int i = 0; i < b.length() - 1; i++) {
            String g = b.substring(i, i + 2);
            Integer n = grams.get(g);
            if (n != null && n > 0) {
                shared++;
                grams.put(g, n - 1);
            }
        }
        return 2.0 * shared / (a.length() - 1 + b.length() - 1);
    }
}
```

`Matcher.java`:

```java
package in.gullak.ingestion.matching;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.OptionalInt;
import java.util.Set;
import java.util.UUID;
import java.util.function.BiPredicate;

/**
 * Pairs statement lines with pending spends: every pair scoring MEDIUM or more, best first (then the earliest spend,
 * then the earliest line), each spend and each line used once. Low scores never link (spec 2.5: nothing merged
 * behind the user's back).
 */
public final class Matcher {
    private record Pair(LineCandidate line, PendingSpend spend, int score) {}

    private Matcher() {}

    public static List<Link> match(List<LineCandidate> lines, List<PendingSpend> spends, BiPredicate<PendingSpend, LineCandidate> learned) {
        List<Pair> pairs = new ArrayList<>();
        for (LineCandidate l : lines) {
            for (PendingSpend s : spends) {
                OptionalInt score = MatchScorer.score(s, l, learned.test(s, l));
                if (score.isPresent() && score.getAsInt() >= MatchScorer.MEDIUM) {
                    pairs.add(new Pair(l, s, score.getAsInt()));
                }
            }
        }
        pairs.sort(Comparator.comparingInt((Pair p) -> -p.score())
            .thenComparing(p -> p.spend().occurredAt())
            .thenComparing(p -> p.line().date())
            .thenComparingInt(p -> p.line().rowNo()));
        Set<UUID> usedLines = new HashSet<>();
        Set<UUID> usedSpends = new HashSet<>();
        List<Link> links = new ArrayList<>();
        for (Pair p : pairs) {
            if (usedLines.contains(p.line().lineId()) || usedSpends.contains(p.spend().id())) {
                continue;
            }
            usedLines.add(p.line().lineId());
            usedSpends.add(p.spend().id());
            links.add(new Link(p.line().lineId(), p.spend().id(), p.score(),
                p.score() >= MatchScorer.HIGH ? Confidence.HIGH : Confidence.MEDIUM));
        }
        return List.copyOf(links);
    }
}
```

`FixedCostInfo.java`:

```java
package in.gullak.ingestion.matching;

import java.util.UUID;

/** A fixed cost; {@code payeeHash} and {@code usualDay} are null until the user confirmed a line for it. */
public record FixedCostInfo(UUID id, String name, long amountPaise, String payeeHash, Integer usualDay) {}
```

`FixedLine.java`:

```java
package in.gullak.ingestion.matching;

import java.time.LocalDate;
import java.util.UUID;

public record FixedLine(UUID lineId, LocalDate date, long amountPaise, String keyHash, boolean dictionaryHit) {}
```

`FixedHit.java`:

```java
package in.gullak.ingestion.matching;

import java.util.UUID;

/** {@code recognised} false means "first sight": the preview asks "Is this your rent?". */
public record FixedHit(UUID lineId, UUID fixedCostId, boolean recognised) {}
```

`FixedCostDetector.java`:

```java
package in.gullak.ingestion.matching;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Spec 2.5, fixed costs: recognise stored payees; otherwise ask once about the nearest likely line. */
public final class FixedCostDetector {
    private FixedCostDetector() {}

    public static List<FixedHit> detect(List<FixedLine> lines, List<FixedCostInfo> costs) {
        List<FixedHit> hits = new ArrayList<>();
        Set<UUID> used = new HashSet<>();
        for (FixedCostInfo cost : costs) {
            if (cost.payeeHash() == null) {
                continue;
            }
            for (FixedLine l : lines) {
                if (!used.contains(l.lineId()) && cost.payeeHash().equals(l.keyHash()) && within10(l.amountPaise(), cost.amountPaise())
                    && nearDay(l.date().getDayOfMonth(), cost.usualDay())) {
                    used.add(l.lineId());
                    hits.add(new FixedHit(l.lineId(), cost.id(), true));
                }
            }
        }
        for (FixedCostInfo cost : costs) {
            if (cost.payeeHash() != null) {
                continue;
            }
            Optional<FixedLine> best = lines.stream()
                .filter(l -> !used.contains(l.lineId()) && !l.dictionaryHit() && within10(l.amountPaise(), cost.amountPaise()))
                .min(Comparator.comparingLong((FixedLine l) -> Math.abs(l.amountPaise() - cost.amountPaise()))
                    .thenComparing(FixedLine::date));
            best.ifPresent(l -> {
                used.add(l.lineId());
                hits.add(new FixedHit(l.lineId(), cost.id(), false));
            });
        }
        return List.copyOf(hits);
    }

    static boolean within10(long line, long cost) {
        return Math.abs(line - cost) * 10 <= cost;
    }

    static boolean nearDay(int day, Integer usual) {
        if (usual == null) {
            return true;
        }
        int d = Math.abs(day - usual);
        return Math.min(d, 31 - d) <= 5;
    }
}
```

`CashCover.java`:

```java
package in.gullak.ingestion.matching;

import java.time.LocalDate;
import java.util.List;
import java.util.OptionalLong;
import java.util.UUID;

/** Spec 2.5: what a covered date means for spends the bank did not show, and the misc-cash offer. */
public final class CashCover {
    private CashCover() {}

    public static List<UUID> toCash(List<PendingSpend> unmatched, LocalDate from, LocalDate to) {
        return unmatched.stream()
            .filter(s -> !"cash".equals(s.paymentMethod()))
            .filter(s -> {
                LocalDate end = "card".equals(s.paymentMethod()) ? to.minusDays(3) : to;
                return !s.date().isBefore(from) && !s.date().isAfter(end);
            })
            .map(PendingSpend::id)
            .toList();
    }

    public static OptionalLong miscCash(long withdrawnPaise, long loggedCashPaise) {
        long difference = withdrawnPaise - loggedCashPaise;
        return difference > 0 ? OptionalLong.of(difference) : OptionalLong.empty();
    }
}
```

`LoggingAccuracy.java`:

```java
package in.gullak.ingestion.matching;

import java.util.OptionalInt;

/** Spec 2.5: confirmed ÷ (confirmed + statement-only spends), floored; 90% or more earns the bonus. */
public final class LoggingAccuracy {
    private LoggingAccuracy() {}

    public static OptionalInt percent(int confirmed, int statementOnly) {
        int total = confirmed + statementOnly;
        return total == 0 ? OptionalInt.empty() : OptionalInt.of(confirmed * 100 / total);
    }

    public static boolean earnsBonus(OptionalInt percent) {
        return percent.isPresent() && percent.getAsInt() >= 90;
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.matching.*'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/main/java/in/gullak/ingestion/matching server/src/test/java/in/gullak/ingestion/matching
git commit -m "feat(server): statement matching scores, assignment, fixed-cost detection and cash rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Schema and the upload API

**Owner:** backend-engineer. **Test IDs:** API-IMP-01, 02, 03, 04, 05, 06, 07 (upload half), 09, 12, 13, 15, 29, 30, 31; RD-13 and RD-24 over HTTP; SEC-10 (gate); MAT-01 and MAT-21 preview halves through the HDFC sample; Review Focus `lateNightSpendMatchesOnlyItsOwnIstDay`. **Red team:** yes: upload abuse (100 a minute, 50 wrong passwords, parallel uploads), path traversal and newlines in the multipart file name, a CSV with formulas, an empty part, two `file` parts, a JSON body sent to `/imports`, and whether any byte of the upload reaches disk or the logs.

**Files:**
- Create: `server/src/main/resources/db/migration/V010__statement_imports.sql` (the first number in this plan's block, V010–V019)
- Modify: `server/src/main/java/in/gullak/common/web/BodyLimitFilter.java`, `server/src/main/resources/application.yml` (JDBC batching), `server/src/main/java/in/gullak/profile/FixedCostEntity.java`, `server/src/main/java/in/gullak/profile/FixedCostService.java`
- Create: `server/src/main/java/in/gullak/profile/FixedCostPayee.java`
- Create (main, `server/src/main/java/in/gullak/ingestion/imports/`): `Bucket.java`, `ImportStatus.java`, `Tag.java`, `StatementImportEntity.java`, `StatementImportRepository.java`, `ImportLineEntity.java`, `ImportLineRepository.java`, `CsvMappingEntity.java`, `CsvMappingRepository.java`, `StatementTxnRepository.java`, `MerchantRuleRepository.java`, `MerchantRuleService.java`, `BankRequestRepository.java`, `BankRequestService.java`, `Cells.java`, `LinePlanner.java`, `ImportViews.java`, `ImportDrafts.java`, `UploadGate.java`, `UploadSource.java`, `ImportService.java`, `ImportController.java`, `BankRequestController.java`, `ImportPreview.java`, `FixedQuestion.java`, `LatestImport.java`, `BankRequestBody.java`
- Create (test): `server/src/test/java/in/gullak/ingestion/imports/ImportTest.java`, `UploadApiTest.java`, `UploadOverHttpApiTest.java`, `UploadGateTest.java`, `server/src/test/java/in/gullak/common/web/BodyLimitExemptionTest.java`

**Interfaces:**
- Consumes: Tasks 1–6; `RateLimiter#check(String key, int limit, Duration window)`; `FieldCipher`; `Ist`; Plan 3's `categories(code)` table and `transactions` columns.
- Produces: tables `statement_imports`, `import_lines`, `csv_mappings`, `merchant_rules`, `merchant_pairs`, `bank_requests`; columns `transactions.needs_review`, `transfer_kind`, `link_confidence`, `merchant_key_hash` and the unique index on `(user_id, fingerprint)`; `fixed_costs.usual_day`. Endpoints: `POST /api/v1/imports` (multipart `file`, optional `password`) → 201 `ImportPreview`; `GET /api/v1/imports/{id}` → 200 `ImportPreview`; `GET /api/v1/imports/latest` → 200 `LatestImport` or 204; `POST /api/v1/banks/requests {bank}` → 201 `{bank}`. Java: `ImportPreview(UUID importId, String status, String kind, String bank, String bankName, String bankLabel, boolean unlocked, int count, int alreadyImported, int unreadableCount, LocalDate from, LocalDate to, int matched, int auto, int fixed, int toSort, List<FixedQuestion> fixedQuestions)`; `FixedQuestion(UUID lineId, UUID fixedCostId, String fixedCostName, long amountPaise, LocalDate date, String answer)`; `LatestImport(UUID importId, String bankLabel, LocalDate from, LocalDate to, Instant committedAt, int count)`; `FixedCostService#payeesFor(UUID): List<FixedCostPayee>`, `#setPayee(UUID userId, UUID id, String payeeHash, int usualDay)`; `FixedCostPayee(UUID id, String name, long amountPaise, String payeePattern, Integer usualDay)`; `LinePlanner#plan(UUID userId, String bank, List<RawLine>)`, `LinePlanner.typedHash(FieldCipher, UUID, String)`, `LinePlanner.keyHash(FieldCipher, UUID, String)`; `ImportDrafts#saveDraft`, `#saveMappingDraft`; `MerchantRuleService#lookupFor(UUID)`; `BankRequestService#ask`, `#recordDetected`; `UploadGate#enter()`; test base `ImportTest` with `upload(...)`, `importId(...)`, `seedManual(...)`, `seedExampleSpends(...)`. NEEDS_COLUMN_MAP details: `importId`, `headers`, `sampleRows` (first 5 data rows), `suggestion` (`date`, `description`, `debit`, `credit`, `amount`, `drCr`, each an index or null). UNSUPPORTED_BANK details: `bank` (name or null).

- [ ] **Step 1: The migration**

`server/src/main/resources/db/migration/V010__statement_imports.sql`:

```sql
-- Plan 4: statement imports. This plan's migration block is V010–V019.
create table statement_imports (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    bank varchar(40) not null,
    kind varchar(4) not null check (kind in ('pdf', 'csv')),
    status varchar(10) not null check (status in ('mapping', 'draft', 'committed', 'discarded')),
    unlocked boolean not null default false,
    period_from date,
    period_to date,
    row_count int not null default 0,
    already_count int not null default 0,
    unreadable_count int not null default 0,
    matched_count int not null default 0,
    auto_count int not null default 0,
    fixed_count int not null default 0,
    to_sort_count int not null default 0,
    tag_seq int not null default 0,
    misc_cash_paise bigint check (misc_cash_paise > 0),
    misc_cash_answered boolean not null default false,
    committed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index statement_imports_user_idx on statement_imports (user_id, created_at desc);
create index statement_imports_open_idx on statement_imports (created_at) where status in ('mapping', 'draft');

-- Draft lines. Statement text only in *_enc columns (FieldCipher); deleted on commit and discard.
create table import_lines (
    id uuid primary key,
    import_id uuid not null references statement_imports (id) on delete cascade,
    user_id uuid not null references users (id) on delete cascade,
    row_no int not null,
    cells_enc bytea,
    occurred_on date,
    amount_paise bigint check (amount_paise > 0),
    direction varchar(6) check (direction in ('debit', 'credit')),
    description_enc bytea,
    merchant_key_hash varchar(64),
    merchant_name varchar(80),
    payment_method varchar(8) check (payment_method in ('upi', 'card', 'unknown')),
    line_kind varchar(8) check (line_kind in ('spend', 'credit', 'atm', 'savings')),
    fingerprint varchar(64),
    bucket varchar(8) check (bucket in ('matched', 'auto', 'fixed', 'sort')),
    category_code varchar(30) references categories (code),
    guess_source varchar(12) check (guess_source in ('user_rule', 'dictionary', 'personal_upi')),
    suggestions varchar(100),
    hint varchar(12),
    match_txn_id uuid,
    match_confidence varchar(6) check (match_confidence in ('high', 'medium')),
    fixed_cost_id uuid references fixed_costs (id),
    fixed_recognised boolean not null default false,
    fixed_answer varchar(3) check (fixed_answer in ('yes', 'no')),
    tag varchar(8) check (tag in ('need', 'want', 'regret')),
    chosen_category varchar(30) references categories (code),
    tag_seq int,
    rule_created boolean not null default false,
    rule_prev_category varchar(30),
    unique (import_id, row_no)
);
create index import_lines_import_idx on import_lines (import_id, bucket);

create table csv_mappings (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    bank varchar(40) not null,
    date_col int not null check (date_col >= 0),
    description_col int not null check (description_col >= 0),
    debit_col int,
    credit_col int,
    amount_col int,
    drcr_col int,
    date_format varchar(20) not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, bank)
);

-- User rules only; the global dictionary lives in code. pattern is FieldCipher.hash of the merchant key.
create table merchant_rules (
    id uuid primary key,
    scope varchar(6) not null check (scope in ('global', 'user')),
    user_id uuid references users (id) on delete cascade,
    pattern varchar(80) not null,
    category_code varchar(30) not null references categories (code),
    fixed_cost_id uuid references fixed_costs (id),
    hits int not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check ((scope = 'user') = (user_id is not null))
);
create unique index merchant_rules_user_pattern_uidx on merchant_rules (user_id, pattern) where scope = 'user';

create table merchant_pairs (
    user_id uuid not null references users (id) on delete cascade,
    typed_hash varchar(64) not null,
    line_hash varchar(64) not null,
    created_at timestamptz not null default now(),
    primary key (user_id, typed_hash, line_hash)
);

create table bank_requests (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    bank varchar(60) not null,
    source varchar(8) not null check (source in ('detected', 'asked')),
    created_at timestamptz not null default now(),
    unique (user_id, bank, source)
);

alter table transactions
    add column needs_review boolean not null default false,
    add column transfer_kind varchar(8) check (transfer_kind in ('atm', 'savings', 'credit')),
    add column link_confidence varchar(6) check (link_confidence in ('high', 'medium')),
    add column merchant_key_hash varchar(64);
alter table transactions add constraint transactions_import_fk foreign key (import_id) references statement_imports (id);
create unique index transactions_user_fingerprint_uidx on transactions (user_id, fingerprint) where fingerprint is not null;
create index transactions_pending_idx on transactions (user_id, occurred_at) where status = 'pending' and deleted_at is null;

alter table fixed_costs add column usual_day int check (usual_day between 1 and 31);
```

If Plan 3 already created an index on `transactions (user_id, fingerprint)` or a foreign key on `import_id`, drop the duplicate statement here and say so in the task report.

In `application.yml`, under `spring.jpa.properties.hibernate` add:

```yaml
        jdbc:
          time_zone: UTC
          batch_size: 100
```

(`time_zone` is already there; add only `batch_size`.)

- [ ] **Step 2: Fixed-cost payees in the profile feature**

`server/src/main/java/in/gullak/profile/FixedCostPayee.java`:

```java
package in.gullak.profile;

import java.util.UUID;

/** A fixed cost as statement matching sees it. {@code payeePattern} is a keyed hash, never readable text. */
public record FixedCostPayee(UUID id, String name, long amountPaise, String payeePattern, Integer usualDay) {}
```

In `FixedCostEntity.java`, add the fields after `active`:

```java
    @Column(name = "payee_pattern", length = 120)
    private String payeePattern;

    @Column(name = "usual_day")
    private Integer usualDay;
```

and these methods next to `toRecord()`:

```java
    void setPayee(String payeePattern, int usualDay) {
        this.payeePattern = payeePattern;
        this.usualDay = usualDay;
    }

    FixedCostPayee toPayee() { return new FixedCostPayee(id, name, amountPaise, payeePattern, usualDay); }
```

In `FixedCostService.java`, add:

```java
    /** Active fixed costs in the order they were added, for statement matching. */
    @Transactional(readOnly = true)
    public List<FixedCostPayee> payeesFor(UUID userId) {
        return repo.findByUserIdAndActiveTrueOrderByCreatedAtAsc(userId).stream().map(FixedCostEntity::toPayee).toList();
    }

    /** A "yes" to "Is this your rent?": from now on that payee is recognised (spec 2.5). */
    @Transactional
    public void setPayee(UUID userId, UUID id, String payeeHash, int usualDay) {
        FixedCostEntity cost = repo.findByIdAndUserIdAndActiveTrue(id, userId).orElseThrow(() -> new NotFoundException("Fixed cost"));
        cost.setPayee(payeeHash, usualDay);
        log.info("{} user={} id={} action=payee", Events.FIXED_COST_CHANGED, userId, id);
    }
```

- [ ] **Step 3: The multipart route skips the JSON body limit**

In `BodyLimitFilter.java`, replace the class comment's last sentence with "Statement uploads (`POST /api/v1/imports`) are multipart and capped by Spring's multipart limits instead." and add:

```java
    static final String UPLOAD_PATH = "/api/v1/imports";

    /** Only the exact multipart upload route is exempt; every other route, including /imports/{id}/..., keeps 64 KB. */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return "POST".equals(request.getMethod()) && UPLOAD_PATH.equals(request.getRequestURI());
    }
```

- [ ] **Step 4: Write the failing tests**

`server/src/test/java/in/gullak/common/web/BodyLimitExemptionTest.java`:

```java
package in.gullak.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class BodyLimitExemptionTest {
    final BodyLimitFilter filter = new BodyLimitFilter(65_536);

    private int run(String method, String uri) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.setContent(new byte[200_000]);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(request, response, chain);
        return chain.getRequest() == null ? response.getStatus() : 200;
    }

    @Test
    void theUploadRouteIsExempt() throws Exception {
        assertThat(run("POST", "/api/v1/imports")).isEqualTo(200);
    }

    @Test
    void everyOtherRouteKeepsTheLimit() throws Exception {
        assertThat(run("POST", "/api/v1/imports/abc/tag")).isEqualTo(413);
        assertThat(run("POST", "/api/v1/imports/")).isEqualTo(413);
        assertThat(run("PUT", "/api/v1/imports")).isEqualTo(413);
        assertThat(run("POST", "/api/v1/banks/requests")).isEqualTo(413);
    }
}
```

`server/src/test/java/in/gullak/ingestion/imports/ImportTest.java`:

```java
package in.gullak.ingestion.imports;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

import com.jayway.jsonpath.JsonPath;
import in.gullak.common.crypto.FieldCipher;
import in.gullak.ingestion.statements.Samples;
import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

/** Upload helpers for the imports API tests. */
public abstract class ImportTest extends ApiTest {
    protected static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    @Autowired protected FieldCipher cipher;

    protected static byte[] sample(String name) {
        return Samples.bytes(name);
    }

    protected static byte[] csv(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    protected ResultActions upload(TestUser user, byte[] bytes, String password) throws Exception {
        return upload(user, bytes, password, "statement.pdf");
    }

    protected ResultActions upload(TestUser user, byte[] bytes, String password, String fileName) throws Exception {
        MockMultipartHttpServletRequestBuilder request = multipart("/api/v1/imports")
            .file(new MockMultipartFile("file", fileName, "application/octet-stream", bytes));
        if (password != null) {
            request.param("password", password);
        }
        return mvc.perform(request.with(auth(user)));
    }

    protected static String importId(ResultActions result) throws Exception {
        String body = result.andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.importId");
    }

    /** A logged spend still pending, at an IST date and time such as "2026-10-09T09:12". */
    protected UUID seedManual(TestUser user, long rupees, String istDateTime, String method, String merchant, String category) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                insert into transactions (id, user_id, client_id, amount_paise, direction, occurred_at, merchant_name,
                    category_code, payment_method, source, status)
                values (?, ?, ?, ?, 'debit', ?, ?, ?, ?, 'manual', 'pending')
                """)
            .params(id, user.id(), UUID.randomUUID(), rupees * 100,
                LocalDateTime.parse(istDateTime).atZone(IST).toInstant().atOffset(ZoneOffset.UTC), merchant, category, method)
            .update();
        return id;
    }

    /** The nine logged spends the HDFC sample confirms: 9 matched, 58 auto, 3 fixed, 14 to sort. */
    protected void seedExampleSpends(TestUser user) {
        seedManual(user, 250, "2026-10-09T09:12", "upi", "Third Wave", "eating_out");
        seedManual(user, 1_499, "2026-10-14T19:00", "card", "Amazon", "shopping");
        seedManual(user, 389, "2026-10-04T20:00", "upi", "Swiggy", "food_delivery");
        seedManual(user, 312, "2026-10-06T18:00", "upi", "Zepto", "quick_commerce");
        seedManual(user, 246, "2026-10-10T09:00", "upi", "Uber", "travel");
        seedManual(user, 410, "2026-10-12T17:00", "upi", "Starbucks", "eating_out");
        seedManual(user, 518, "2026-10-15T19:30", "upi", "Blinkit", "quick_commerce");
        seedManual(user, 85, "2026-10-18T08:40", "upi", "Rapido", "travel");
        seedManual(user, 455, "2026-10-20T21:00", "upi", "Zomato", "food_delivery");
    }
}
```

`server/src/test/java/in/gullak/ingestion/imports/UploadApiTest.java`:

```java
package in.gullak.ingestion.imports;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.ingestion.statements.samples.HdfcSample;
import in.gullak.ingestion.statements.samples.SpecialSamples;
import in.gullak.support.TestUser;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;

@ExtendWith(OutputCaptureExtension.class)
class UploadApiTest extends ImportTest {

    private int imports(TestUser u) {
        return jdbc.sql("select count(*) from statement_imports where user_id = ?").param(u.id()).query(Integer.class).single();
    }

    @Test
    void hdfcSamplePreviewsAsTheMockupShows() throws Exception { // API-IMP-01, MAT-01 (preview)
        TestUser u = exampleUser();
        seedExampleSpends(u);
        upload(u, sample("hdfc.pdf"), null)
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.status").value("DRAFT"))
            .andExpect(jsonPath("$.kind").value("PDF"))
            .andExpect(jsonPath("$.bankLabel").value("HDFC"))
            .andExpect(jsonPath("$.bankName").value("HDFC Bank"))
            .andExpect(jsonPath("$.count").value(84))
            .andExpect(jsonPath("$.from").value("2026-10-01"))
            .andExpect(jsonPath("$.to").value("2026-10-22"))
            .andExpect(jsonPath("$.matched").value(9))
            .andExpect(jsonPath("$.auto").value(58))
            .andExpect(jsonPath("$.fixed").value(3))
            .andExpect(jsonPath("$.toSort").value(14))
            .andExpect(jsonPath("$.alreadyImported").value(0))
            .andExpect(jsonPath("$.unreadableCount").value(0))
            .andExpect(jsonPath("$.fixedQuestions.length()").value(3))
            .andExpect(jsonPath("$.fixedQuestions[?(@.fixedCostName == 'Rent')].amountPaise").value(1_000_000))
            .andExpect(jsonPath("$.fixedQuestions[?(@.fixedCostName == 'Rent')].date").value("2026-10-05"));
        assertThat(jdbc.sql("select count(*) from import_lines l join statement_imports i on i.id = l.import_id where i.user_id = ?")
            .param(u.id()).query(Integer.class).single()).isEqualTo(84);
    }

    @Test
    void lockedWithoutAPasswordCreatesNothing() throws Exception { // API-IMP-02
        TestUser u = exampleUser();
        upload(u, sample("hdfc-locked.pdf"), null)
            .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("PASSWORD_REQUIRED"));
        assertThat(imports(u)).isZero();
    }

    @Test
    void aWrongPasswordCreatesNothingAndIsNeverLogged(CapturedOutput out) throws Exception { // API-IMP-03
        TestUser u = exampleUser();
        upload(u, sample("hdfc-locked.pdf"), "Wr0ngHorse!")
            .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("WRONG_PASSWORD"));
        assertThat(imports(u)).isZero();
        assertThat(out.getAll()).doesNotContain("Wr0ngHorse!").contains("error.expected code=WRONG_PASSWORD");
    }

    @Test
    void theRightPasswordPreviews() throws Exception { // API-IMP-04
        TestUser u = exampleUser();
        upload(u, sample("hdfc-locked.pdf"), HdfcSample.PASSWORD)
            .andExpect(status().isCreated()).andExpect(jsonPath("$.unlocked").value(true)).andExpect(jsonPath("$.count").value(84));
    }

    @Test
    void aScanIsRefused() throws Exception { // API-IMP-05
        upload(exampleUser(), SpecialSamples.scanned(), null)
            .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("SCANNED_PDF"));
    }

    @Test
    void anUnsupportedBankIsNamedAndCounted() throws Exception { // API-IMP-06
        TestUser u = exampleUser();
        upload(u, sample("yes-bank.pdf"), null)
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("UNSUPPORTED_BANK"))
            .andExpect(jsonPath("$.details.bank").value("Yes Bank"));
        assertThat(jdbc.sql("select count(*) from bank_requests where user_id = ? and bank = 'Yes Bank' and source = 'detected'")
            .param(u.id()).query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void anUnknownCsvAsksForTheColumns() throws Exception { // API-IMP-07 (upload half)
        TestUser u = exampleUser();
        upload(u, sample("csv/unknown-headers.csv"), null, "statement.csv")
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("NEEDS_COLUMN_MAP"))
            .andExpect(jsonPath("$.details.headers[0]").value("Posted On"))
            .andExpect(jsonPath("$.details.headers.length()").value(4))
            .andExpect(jsonPath("$.details.sampleRows.length()").value(3))
            .andExpect(jsonPath("$.details.suggestion.description").value(1))
            .andExpect(jsonPath("$.details.importId").isNotEmpty());
        assertThat(jdbc.sql("select status from statement_imports where user_id = ?").param(u.id()).query(String.class).single())
            .isEqualTo("mapping");
    }

    @Test
    void elevenMegabytesIsTooLarge() throws Exception { // API-IMP-09
        upload(exampleUser(), SpecialSamples.oversized(), null)
            .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.code").value("TOO_LARGE"))
            .andExpect(jsonPath("$.message").value("That file is over 10 MB"));
    }

    @Test
    void aPngIsInvalid() throws Exception { // API-IMP-12
        upload(exampleUser(), SpecialSamples.png(), null)
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_FILE"));
    }

    @Test
    void malformedRowsAreCounted() throws Exception { // API-IMP-13
        upload(exampleUser(), sample("hdfc-malformed.pdf"), null)
            .andExpect(status().isCreated()).andExpect(jsonPath("$.unreadableCount").value(3)).andExpect(jsonPath("$.count").value(17));
    }

    @Test
    void theEleventhUploadInAnHourIsRateLimited() throws Exception { // API-IMP-15
        TestUser u = exampleUser();
        for (int i = 0; i < 10; i++) {
            upload(u, SpecialSamples.png(), null).andExpect(status().isBadRequest());
        }
        upload(u, SpecialSamples.png(), null).andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code").value("RATE_LIMITED"));
        clock.advance(Duration.ofMinutes(61));
        upload(u, SpecialSamples.png(), null).andExpect(status().isBadRequest());
    }

    @Test
    void bankRequests() throws Exception { // API-IMP-29, API-IMP-30
        TestUser u = signIn();
        mvc.perform(post("/api/v1/banks/requests").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{\"bank\":\" Yes Bank \"}"))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.bank").value("Yes Bank"));
        mvc.perform(post("/api/v1/banks/requests").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{\"bank\":\"Yes Bank\"}"))
            .andExpect(status().isCreated());
        mvc.perform(post("/api/v1/banks/requests").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{\"bank\":\"\"}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        assertThat(jdbc.sql("select count(*) from bank_requests where user_id = ? and source = 'asked'").param(u.id())
            .query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void noBlobIsStoredWithTheImport() throws Exception { // API-IMP-31 (schema half; the disk half is UploadOverHttpApiTest)
        assertThat(jdbc.sql("""
                select count(*) from information_schema.columns
                where table_name = 'statement_imports' and data_type in ('bytea', 'oid', 'text')
                """).query(Integer.class).single()).isZero();
    }

    @Test
    void lateNightSpendMatchesOnlyItsOwnIstDay() throws Exception { // Review Focus
        String statement = "Date,Description,Debit,Credit\n09/10/2026,UPI/THIRDWAVECOFFEE/okhdfc,250.00,\n14/10/2026,UPI/RAJU CHAI,20.00,\n";
        TestUser night = exampleUser();
        seedManual(night, 250, "2026-10-09T23:50", "upi", "Third Wave", "eating_out");
        upload(night, csv(statement), null, "s.csv").andExpect(status().isCreated()).andExpect(jsonPath("$.matched").value(1));
        TestUser after = exampleUser();
        seedManual(after, 250, "2026-10-10T00:10", "upi", "Third Wave", "eating_out");
        upload(after, csv(statement), null, "s.csv").andExpect(status().isCreated()).andExpect(jsonPath("$.matched").value(0));
    }

    @Test
    void aPreviewCanBeFetchedAgainOnlyByItsOwner() throws Exception {
        TestUser u = exampleUser();
        String id = importId(upload(u, sample("hdfc.pdf"), null).andExpect(status().isCreated()));
        mvc.perform(get("/api/v1/imports/" + id).with(auth(u))).andExpect(status().isOk()).andExpect(jsonPath("$.count").value(84));
        mvc.perform(get("/api/v1/imports/" + id).with(auth(exampleUser()))).andExpect(status().isNotFound());
    }

    @Test
    void latestIsEmptyBeforeAnyCommit() throws Exception {
        mvc.perform(get("/api/v1/imports/latest").with(auth(signIn()))).andExpect(status().isNoContent());
    }

    @Test
    void aMissingFilePartIsAFieldError() throws Exception {
        mvc.perform(multipart("/api/v1/imports").param("password", "x").with(auth(signIn())))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fields[0].field").value("file"));
    }

    @Test
    void anOverlongPasswordIsAFieldError() throws Exception {
        upload(exampleUser(), sample("hdfc-locked.pdf"), "x".repeat(65))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fields[0].field").value("password"));
    }
}
```

`server/src/test/java/in/gullak/ingestion/imports/UploadOverHttpApiTest.java`:

```java
package in.gullak.ingestion.imports;

import static org.assertj.core.api.Assertions.assertThat;

import com.jayway.jsonpath.JsonPath;
import in.gullak.TestcontainersConfiguration;
import in.gullak.auth.InMemoryOtpMailer;
import in.gullak.support.TestClockConfig;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

/** RD-13, RD-24 and API-IMP-31 through real Tomcat multipart handling, which MockMvc skips. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, TestClockConfig.class})
class UploadOverHttpApiTest {
    @LocalServerPort int port;
    @Autowired InMemoryOtpMailer mailer;
    final HttpClient http = HttpClient.newHttpClient();

    private String base() {
        return "http://localhost:" + port + "/api/v1";
    }

    private String token() throws Exception {
        String email = "http-" + UUID.randomUUID() + "@example.test";
        send(json("/auth/otp/request", "{\"email\":\"" + email + "\"}"));
        HttpResponse<String> verified = send(json("/auth/otp/verify",
            "{\"email\":\"" + email + "\",\"code\":\"" + mailer.lastCodeFor(email) + "\",\"device\":\"test\"}"));
        return JsonPath.read(verified.body(), "$.accessToken");
    }

    private HttpRequest json(String path, String body) {
        return HttpRequest.newBuilder(URI.create(base() + path)).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
    }

    private HttpResponse<String> send(HttpRequest request) throws IOException, InterruptedException {
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> upload(String token, byte[] file) throws Exception {
        String boundary = "----gullak" + UUID.randomUUID();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"../../etc/passwd.csv\"\r\n"
            + "Content-Type: text/csv\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(file);
        body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return send(HttpRequest.newBuilder(URI.create(base() + "/imports"))
            .header("Authorization", "Bearer " + token)
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build());
    }

    private static List<Path> tempFiles() throws IOException {
        try (Stream<Path> files = Files.walk(Path.of(System.getProperty("java.io.tmpdir")), 4)) {
            return files.filter(Files::isRegularFile).sorted().toList();
        }
    }

    @Test
    void elevenMegabytesIs413WithTheStandardShape() throws Exception { // RD-13, API-IMP-09 over HTTP
        HttpResponse<String> response = upload(token(), new byte[11 * 1024 * 1024]);
        assertThat(response.statusCode()).isEqualTo(413);
        assertThat((String) JsonPath.read(response.body(), "$.code")).isEqualTo("TOO_LARGE");
    }

    @Test
    void aBodyOver64KbIsAcceptedOnTheUploadRouteAndNothingTouchesDisk() throws Exception { // RD-24, API-IMP-31
        String token = token();
        StringBuilder csv = new StringBuilder("Date,Description,Debit,Credit\n");
        for (int i = 0; i < 4_000; i++) {
            csv.append(String.format("%02d/10/2026,UPI/SHOP NUMBER %d,%d.00,%n", 1 + i % 22, i, 10 + i % 90));
        }
        List<Path> before = tempFiles();
        HttpResponse<String> response = upload(token, csv.toString().getBytes(StandardCharsets.UTF_8));
        assertThat(csv.length()).isGreaterThan(65_536);
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(tempFiles()).isEqualTo(before);
    }
}
```

`server/src/test/java/in/gullak/ingestion/imports/UploadGateTest.java`:

```java
package in.gullak.ingestion.imports;

import static org.assertj.core.api.Assertions.assertThat;

import in.gullak.ingestion.statements.TestParsers;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

class UploadGateTest {
    @Test
    void atMostFourUploadsAreReadAtOnce() throws Exception { // SEC-10 (memory stays bounded)
        UploadGate gate = new UploadGate(TestParsers.props(Duration.ofSeconds(10)));
        CountDownLatch start = new CountDownLatch(1);
        List<Future<?>> done = new ArrayList<>();
        try (ExecutorService pool = Executors.newFixedThreadPool(20)) {
            for (int i = 0; i < 20; i++) {
                done.add(pool.submit(() -> {
                    start.await();
                    try (UploadGate.Permit permit = gate.enter()) {
                        Thread.sleep(50);
                    }
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> f : done) {
                f.get();
            }
        }
        assertThat(gate.peak()).isBetween(1, 4);
    }
}
```

- [ ] **Step 5: Run to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.imports.*' --tests 'in.gullak.common.web.BodyLimitExemptionTest'`
Expected: compilation fails (`UploadGate` and the imports package are missing); `BodyLimitExemptionTest` fails until Step 3 is in.

- [ ] **Step 6: Entities and repositories**

`Bucket.java`:

```java
package in.gullak.ingestion.imports;

import java.util.Locale;

enum Bucket {
    MATCHED, AUTO, FIXED, SORT;

    String db() {
        return name().toLowerCase(Locale.ROOT);
    }

    static Bucket of(String db) {
        return valueOf(db.toUpperCase(Locale.ROOT));
    }
}
```

`ImportStatus.java`:

```java
package in.gullak.ingestion.imports;

import java.util.Locale;

enum ImportStatus {
    MAPPING, DRAFT, COMMITTED, DISCARDED;

    String db() {
        return name().toLowerCase(Locale.ROOT);
    }
}
```

`Tag.java`:

```java
package in.gullak.ingestion.imports;

import java.util.Locale;

/** Spec 2.4 tags. JSON uses the constant names; the database stores lower case. */
public enum Tag {
    NEED, WANT, REGRET;

    String db() {
        return name().toLowerCase(Locale.ROOT);
    }

    static Tag of(String db) {
        return db == null ? null : valueOf(db.toUpperCase(Locale.ROOT));
    }
}
```

`StatementImportEntity.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.ingestion.statements.FileKind;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Locale;
import java.util.UUID;
import org.hibernate.annotations.UpdateTimestamp;
import org.springframework.data.domain.Persistable;

@Entity
@Table(name = "statement_imports")
class StatementImportEntity implements Persistable<UUID> {
    @Id
    private UUID id;
    @Column(name = "user_id", nullable = false)
    private UUID userId;
    @Column(nullable = false, length = 40)
    private String bank;
    @Column(nullable = false, length = 4)
    private String kind;
    @Column(nullable = false, length = 10)
    private String status;
    @Column(nullable = false)
    private boolean unlocked;
    @Column(name = "period_from")
    private LocalDate periodFrom;
    @Column(name = "period_to")
    private LocalDate periodTo;
    @Column(name = "row_count", nullable = false)
    private int rowCount;
    @Column(name = "already_count", nullable = false)
    private int alreadyCount;
    @Column(name = "unreadable_count", nullable = false)
    private int unreadableCount;
    @Column(name = "matched_count", nullable = false)
    private int matchedCount;
    @Column(name = "auto_count", nullable = false)
    private int autoCount;
    @Column(name = "fixed_count", nullable = false)
    private int fixedCount;
    @Column(name = "to_sort_count", nullable = false)
    private int toSortCount;
    @Column(name = "tag_seq", nullable = false)
    private int tagSeq;
    @Column(name = "misc_cash_paise")
    private Long miscCashPaise;
    @Column(name = "misc_cash_answered", nullable = false)
    private boolean miscCashAnswered;
    @Column(name = "committed_at")
    private Instant committedAt;
    @Column(name = "created_at", insertable = false, updatable = false)
    private Instant createdAt;
    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
    @Transient
    private boolean isNew;

    protected StatementImportEntity() {}

    StatementImportEntity(UUID userId, String bank, FileKind kind, ImportStatus status, boolean unlocked) {
        this.id = UUID.randomUUID();
        this.isNew = true;
        this.userId = userId;
        this.bank = bank;
        this.kind = kind.name().toLowerCase(Locale.ROOT);
        this.status = status.db();
        this.unlocked = unlocked;
    }

    void summarise(LocalDate from, LocalDate to, int rows, int already, int unreadable, int matched, int auto, int fixed, int sort) {
        this.periodFrom = from;
        this.periodTo = to;
        this.rowCount = rows;
        this.alreadyCount = already;
        this.unreadableCount = unreadable;
        this.matchedCount = matched;
        this.autoCount = auto;
        this.fixedCount = fixed;
        this.toSortCount = sort;
    }

    void toDraft() {
        this.status = ImportStatus.DRAFT.db();
    }

    /** A line moved between buckets (a fixed-cost "no"). */
    void move(Bucket from, Bucket to) {
        add(from, -1);
        add(to, 1);
    }

    private void add(Bucket bucket, int n) {
        switch (bucket) {
            case MATCHED -> matchedCount += n;
            case AUTO -> autoCount += n;
            case FIXED -> fixedCount += n;
            case SORT -> toSortCount += n;
        }
    }

    int nextTagSeq() {
        return ++tagSeq;
    }

    void commit(Instant at, int matched) {
        this.status = ImportStatus.COMMITTED.db();
        this.committedAt = at;
        this.matchedCount = matched;
    }

    void discard() {
        this.status = ImportStatus.DISCARDED.db();
    }

    void offerMiscCash(long paise) {
        this.miscCashPaise = paise;
    }

    void answerMiscCash() {
        this.miscCashAnswered = true;
    }

    boolean is(ImportStatus s) { return status.equals(s.db()); }
    UUID getUserId() { return userId; }
    String getBank() { return bank; }
    String getKind() { return kind; }
    String getStatus() { return status; }
    boolean isUnlocked() { return unlocked; }
    LocalDate getPeriodFrom() { return periodFrom; }
    LocalDate getPeriodTo() { return periodTo; }
    int getRowCount() { return rowCount; }
    int getAlreadyCount() { return alreadyCount; }
    int getUnreadableCount() { return unreadableCount; }
    int getMatchedCount() { return matchedCount; }
    int getAutoCount() { return autoCount; }
    int getFixedCount() { return fixedCount; }
    int getToSortCount() { return toSortCount; }
    Long getMiscCashPaise() { return miscCashPaise; }
    boolean isMiscCashAnswered() { return miscCashAnswered; }
    Instant getCommittedAt() { return committedAt; }

    @Override
    public UUID getId() { return id; }

    @Override
    public boolean isNew() { return isNew; }

    @PostLoad
    @PostPersist
    void markNotNew() { this.isNew = false; }
}
```

`StatementImportRepository.java`:

```java
package in.gullak.ingestion.imports;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface StatementImportRepository extends JpaRepository<StatementImportEntity, UUID> {
    Optional<StatementImportEntity> findByIdAndUserId(UUID id, UUID userId);

    /** Serialises tag, undo, answers, commit and discard on one import. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from StatementImportEntity i where i.id = :id and i.userId = :userId")
    Optional<StatementImportEntity> lockOwned(@Param("id") UUID id, @Param("userId") UUID userId);

    Optional<StatementImportEntity> findFirstByUserIdAndStatusOrderByCommittedAtDesc(UUID userId, String status);

    @Query("select i.id from StatementImportEntity i where i.status in ('mapping', 'draft') and i.createdAt < :before")
    List<UUID> openCreatedBefore(@Param("before") Instant before);
}
```

`ImportLineEntity.java`:

```java
package in.gullak.ingestion.imports;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.data.domain.Persistable;

/** A draft line. Statement text only in description_enc and cells_enc. */
@Entity
@Table(name = "import_lines")
class ImportLineEntity implements Persistable<UUID> {
    @Id
    private UUID id;
    @Column(name = "import_id", nullable = false)
    private UUID importId;
    @Column(name = "user_id", nullable = false)
    private UUID userId;
    @Column(name = "row_no", nullable = false)
    private int rowNo;
    @Column(name = "cells_enc")
    private byte[] cellsEnc;
    @Column(name = "occurred_on")
    private LocalDate occurredOn;
    @Column(name = "amount_paise")
    private Long amountPaise;
    @Column(length = 6)
    private String direction;
    @Column(name = "description_enc")
    private byte[] descriptionEnc;
    @Column(name = "merchant_key_hash", length = 64)
    private String merchantKeyHash;
    @Column(name = "merchant_name", length = 80)
    private String merchantName;
    @Column(name = "payment_method", length = 8)
    private String paymentMethod;
    @Column(name = "line_kind", length = 8)
    private String lineKind;
    @Column(length = 64)
    private String fingerprint;
    @Column(length = 8)
    private String bucket;
    @Column(name = "category_code", length = 30)
    private String categoryCode;
    @Column(name = "guess_source", length = 12)
    private String guessSource;
    @Column(length = 100)
    private String suggestions;
    @Column(length = 12)
    private String hint;
    @Column(name = "match_txn_id")
    private UUID matchTxnId;
    @Column(name = "match_confidence", length = 6)
    private String matchConfidence;
    @Column(name = "fixed_cost_id")
    private UUID fixedCostId;
    @Column(name = "fixed_recognised", nullable = false)
    private boolean fixedRecognised;
    @Column(name = "fixed_answer", length = 3)
    private String fixedAnswer;
    @Column(length = 8)
    private String tag;
    @Column(name = "chosen_category", length = 30)
    private String chosenCategory;
    @Column(name = "tag_seq")
    private Integer tagSeq;
    @Column(name = "rule_created", nullable = false)
    private boolean ruleCreated;
    @Column(name = "rule_prev_category", length = 30)
    private String rulePrevCategory;
    @Transient
    private boolean isNew;

    protected ImportLineEntity() {}

    /** A CSV row kept until the user maps the columns; row 0 is the header. */
    static ImportLineEntity rawCells(UUID importId, UUID userId, int rowNo, byte[] cellsEnc) {
        ImportLineEntity e = new ImportLineEntity();
        e.id = UUID.randomUUID();
        e.isNew = true;
        e.importId = importId;
        e.userId = userId;
        e.rowNo = rowNo;
        e.cellsEnc = cellsEnc;
        return e;
    }

    static ImportLineEntity planned(UUID importId, UUID userId, LinePlanner.Planned p, byte[] descriptionEnc) {
        ImportLineEntity e = new ImportLineEntity();
        e.id = p.lineId();
        e.isNew = true;
        e.importId = importId;
        e.userId = userId;
        e.rowNo = p.rowNo();
        e.occurredOn = p.raw().date();
        e.amountPaise = p.raw().amountPaise();
        e.direction = p.raw().direction().name().toLowerCase(Locale.ROOT);
        e.descriptionEnc = descriptionEnc;
        e.merchantKeyHash = p.keyHash();
        e.merchantName = p.merchantName();
        e.paymentMethod = p.paymentMethod();
        e.lineKind = p.kind().name().toLowerCase(Locale.ROOT);
        e.fingerprint = p.fingerprint();
        e.bucket = p.bucket().db();
        e.categoryCode = p.categoryCode();
        e.guessSource = p.guessSource() == null ? null : p.guessSource().name().toLowerCase(Locale.ROOT);
        e.suggestions = String.join(",", p.suggestions());
        e.hint = p.hint().name();
        e.matchTxnId = p.matchTxnId();
        e.matchConfidence = p.matchConfidence() == null ? null : p.matchConfidence().name().toLowerCase(Locale.ROOT);
        e.fixedCostId = p.fixedCostId();
        e.fixedRecognised = p.fixedRecognised();
        return e;
    }

    void tag(Tag t, String category, int seq, boolean ruleCreated, String rulePrevCategory) {
        this.tag = t.db();
        this.chosenCategory = category;
        this.tagSeq = seq;
        this.ruleCreated = ruleCreated;
        this.rulePrevCategory = rulePrevCategory;
    }

    void untag() {
        this.tag = null;
        this.chosenCategory = null;
        this.tagSeq = null;
        this.ruleCreated = false;
        this.rulePrevCategory = null;
    }

    void answerYes() {
        this.fixedAnswer = "yes";
    }

    /** "No, it isn't": the line is an ordinary spend again. Returns its new bucket. */
    Bucket answerNo() {
        this.fixedAnswer = "no";
        this.fixedCostId = null;
        boolean known = categoryCode != null && !"personal_upi".equals(guessSource);
        this.bucket = (known ? Bucket.AUTO : Bucket.SORT).db();
        return Bucket.of(bucket);
    }

    List<String> suggestionList() {
        return suggestions == null || suggestions.isEmpty() ? List.of("other") : List.of(suggestions.split(","));
    }

    UUID getImportId() { return importId; }
    int getRowNo() { return rowNo; }
    byte[] getCellsEnc() { return cellsEnc; }
    LocalDate getOccurredOn() { return occurredOn; }
    Long getAmountPaise() { return amountPaise; }
    String getDirection() { return direction; }
    byte[] getDescriptionEnc() { return descriptionEnc; }
    String getMerchantKeyHash() { return merchantKeyHash; }
    String getMerchantName() { return merchantName; }
    String getPaymentMethod() { return paymentMethod; }
    String getLineKind() { return lineKind; }
    String getFingerprint() { return fingerprint; }
    Bucket getBucket() { return Bucket.of(bucket); }
    String getCategoryCode() { return categoryCode; }
    String getGuessSource() { return guessSource; }
    String getHint() { return hint; }
    UUID getMatchTxnId() { return matchTxnId; }
    UUID getFixedCostId() { return fixedCostId; }
    boolean isFixedRecognised() { return fixedRecognised; }
    String getFixedAnswer() { return fixedAnswer; }
    Tag getTag() { return Tag.of(tag); }
    String getChosenCategory() { return chosenCategory; }
    boolean isRuleCreated() { return ruleCreated; }
    String getRulePrevCategory() { return rulePrevCategory; }

    @Override
    public UUID getId() { return id; }

    @Override
    public boolean isNew() { return isNew; }

    @PostLoad
    @PostPersist
    void markNotNew() { this.isNew = false; }
}
```

`ImportLineRepository.java`:

```java
package in.gullak.ingestion.imports;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface ImportLineRepository extends JpaRepository<ImportLineEntity, UUID> {
    List<ImportLineEntity> findByImportIdOrderByRowNoAsc(UUID importId);

    List<ImportLineEntity> findByImportIdAndBucketOrderByOccurredOnAscRowNoAsc(UUID importId, String bucket);

    Optional<ImportLineEntity> findByIdAndImportId(UUID id, UUID importId);

    Optional<ImportLineEntity> findFirstByImportIdAndTagIsNotNullOrderByTagSeqDesc(UUID importId);

    long countByImportIdAndBucketAndTagIsNull(UUID importId, String bucket);

    @Modifying
    @Query("delete from ImportLineEntity l where l.importId = :importId")
    int deleteByImport(@Param("importId") UUID importId);
}
```

`CsvMappingEntity.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.ingestion.statements.CsvMapping;
import in.gullak.ingestion.statements.StatementDateFormat;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.UpdateTimestamp;
import org.springframework.data.domain.Persistable;

@Entity
@Table(name = "csv_mappings")
class CsvMappingEntity implements Persistable<UUID> {
    @Id
    private UUID id;
    @Column(name = "user_id", nullable = false)
    private UUID userId;
    @Column(nullable = false, length = 40)
    private String bank;
    @Column(name = "date_col", nullable = false)
    private int dateCol;
    @Column(name = "description_col", nullable = false)
    private int descriptionCol;
    @Column(name = "debit_col")
    private Integer debitCol;
    @Column(name = "credit_col")
    private Integer creditCol;
    @Column(name = "amount_col")
    private Integer amountCol;
    @Column(name = "drcr_col")
    private Integer drcrCol;
    @Column(name = "date_format", nullable = false, length = 20)
    private String dateFormat;
    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;
    @Transient
    private boolean isNew;

    protected CsvMappingEntity() {}

    CsvMappingEntity(UUID userId, String bank, CsvMapping m) {
        this.id = UUID.randomUUID();
        this.isNew = true;
        this.userId = userId;
        this.bank = bank;
        change(m);
    }

    void change(CsvMapping m) {
        this.dateCol = m.date();
        this.descriptionCol = m.description();
        this.debitCol = m.debit();
        this.creditCol = m.credit();
        this.amountCol = m.amount();
        this.drcrCol = m.drCr();
        this.dateFormat = m.dateFormat().name();
    }

    CsvMapping toMapping() {
        return new CsvMapping(dateCol, descriptionCol, debitCol, creditCol, amountCol, drcrCol, StatementDateFormat.valueOf(dateFormat));
    }

    @Override
    public UUID getId() { return id; }

    @Override
    public boolean isNew() { return isNew; }

    @PostLoad
    @PostPersist
    void markNotNew() { this.isNew = false; }
}
```

`CsvMappingRepository.java`:

```java
package in.gullak.ingestion.imports;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface CsvMappingRepository extends JpaRepository<CsvMappingEntity, UUID> {
    Optional<CsvMappingEntity> findByUserIdAndBank(UUID userId, String bank);
}
```

`StatementTxnRepository.java` (the reads; Task 9 adds the writes):

```java
package in.gullak.ingestion.imports;

import in.gullak.common.db.Db;
import in.gullak.common.time.Ist;
import in.gullak.ingestion.matching.PendingSpend;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Statement-side reads and writes on Plan 3's transactions table. Matching reads (spec 4.3) and the
 * concurrency-sensitive writes (fingerprint on-conflict inserts, conditional link updates) are SQL by design.
 */
@Repository
class StatementTxnRepository {
    private final JdbcClient jdbc;

    StatementTxnRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Pending logged debits (cash included) whose IST date falls in [from, to]. */
    List<PendingSpend> pendingSpends(UUID userId, LocalDate from, LocalDate to) {
        return jdbc.sql("""
                select id, occurred_at, amount_paise, payment_method, merchant_name, category_code from transactions
                where user_id = ? and source = 'manual' and status = 'pending' and direction = 'debit'
                  and deleted_at is null and occurred_at >= ? and occurred_at < ?
                order by occurred_at, id
                """)
            .params(userId, Db.ts(Ist.startOf(from)), Db.ts(Ist.startOf(to.plusDays(1))))
            .query((rs, n) -> {
                Instant at = rs.getObject("occurred_at", OffsetDateTime.class).toInstant();
                return new PendingSpend(rs.getObject("id", UUID.class), LocalDate.ofInstant(at, Ist.ZONE), at,
                    rs.getLong("amount_paise"), rs.getString("payment_method"), rs.getString("merchant_name"),
                    rs.getString("category_code"));
            })
            .list();
    }

    Set<String> existingFingerprints(UUID userId, List<String> fingerprints) {
        Set<String> found = new HashSet<>();
        for (int i = 0; i < fingerprints.size(); i += 1000) {
            List<String> chunk = fingerprints.subList(i, Math.min(fingerprints.size(), i + 1000));
            found.addAll(jdbc.sql("select fingerprint from transactions where user_id = :user and fingerprint in (:fps)")
                .param("user", userId).param("fps", chunk).query(String.class).list());
        }
        return found;
    }

    /** "typedHash|lineHash" for every merchant pair this user has linked before (MAT-11). */
    Set<String> learnedPairs(UUID userId) {
        return new HashSet<>(jdbc.sql("select typed_hash || '|' || line_hash from merchant_pairs where user_id = ?")
            .param(userId).query(String.class).list());
    }
}
```

`MerchantRuleRepository.java` (lookups now; Task 8 adds the upsert):

```java
package in.gullak.ingestion.imports;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** User merchant rules. Rows are keyed by FieldCipher.hash of the merchant key; writes are on-conflict upserts. */
@Repository
class MerchantRuleRepository {
    private final JdbcClient jdbc;

    MerchantRuleRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Map<String, String> userRules(UUID userId) {
        Map<String, String> rules = new HashMap<>();
        jdbc.sql("select pattern, category_code from merchant_rules where scope = 'user' and user_id = ?")
            .param(userId)
            .query(rs -> {
                rules.put(rs.getString("pattern"), rs.getString("category_code"));
            });
        return rules;
    }
}
```

`MerchantRuleService.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.crypto.FieldCipher;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MerchantRuleService {
    private final MerchantRuleRepository rules;
    private final FieldCipher cipher;

    MerchantRuleService(MerchantRuleRepository rules, FieldCipher cipher) {
        this.rules = rules;
        this.cipher = cipher;
    }

    /** A merchant-key → category lookup over the user's rules, for one import. */
    @Transactional(readOnly = true)
    public Function<String, Optional<String>> lookupFor(UUID userId) {
        Map<String, String> byHash = rules.userRules(userId);
        return key -> Optional.ofNullable(byHash.get(LinePlanner.keyHash(cipher, userId, key)));
    }
}
```

`BankRequestRepository.java`:

```java
package in.gullak.ingestion.imports;

import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
class BankRequestRepository {
    private final JdbcClient jdbc;

    BankRequestRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** One row per (user, bank, source); a repeat is a no-op, so demand counts people, not taps. */
    void insert(UUID userId, String bank, String source) {
        jdbc.sql("""
                insert into bank_requests (id, user_id, bank, source) values (?, ?, ?, ?)
                on conflict (user_id, bank, source) do nothing
                """)
            .params(UUID.randomUUID(), userId, bank, source)
            .update();
    }
}
```

`BankRequestService.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.log.Events;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BankRequestService {
    private static final Logger log = LoggerFactory.getLogger(BankRequestService.class);

    private final BankRequestRepository requests;

    BankRequestService(BankRequestRepository requests) {
        this.requests = requests;
    }

    @Transactional
    public String ask(UUID userId, String bank) {
        String name = bank.strip();
        requests.insert(userId, name, "asked");
        log.info("{} user={} source=asked", Events.BANK_REQUESTED, userId);
        return name;
    }

    @Transactional
    public void recordDetected(UUID userId, String bank) {
        if (bank != null) {
            requests.insert(userId, bank, "detected");
            log.info("{} user={} source=detected", Events.BANK_REQUESTED, userId);
        }
    }
}
```

- [ ] **Step 7: Planning, drafts, the service and the controllers**

`Cells.java`:

```java
package in.gullak.ingestion.imports;

import java.util.Arrays;
import java.util.List;

/** CSV cells as one string (unit separator between cells). CsvParser strips control characters from cells. */
final class Cells {
    private static final String SEPARATOR = "\u001F";

    private Cells() {}

    static String encode(List<String> cells) {
        return String.join(SEPARATOR, cells);
    }

    static List<String> decode(String text) {
        return Arrays.asList(text.split(SEPARATOR, -1));
    }
}
```

`LinePlanner.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.crypto.FieldCipher;
import in.gullak.ingestion.categorise.CategoryCodes;
import in.gullak.ingestion.categorise.Categoriser;
import in.gullak.ingestion.categorise.Guess;
import in.gullak.ingestion.categorise.GuessSource;
import in.gullak.ingestion.categorise.Hint;
import in.gullak.ingestion.categorise.LineClassifier;
import in.gullak.ingestion.categorise.LineKind;
import in.gullak.ingestion.categorise.MerchantDictionary;
import in.gullak.ingestion.categorise.MerchantText;
import in.gullak.ingestion.categorise.Suggester;
import in.gullak.ingestion.categorise.Suggestion;
import in.gullak.ingestion.matching.Confidence;
import in.gullak.ingestion.matching.FixedCostDetector;
import in.gullak.ingestion.matching.FixedCostInfo;
import in.gullak.ingestion.matching.FixedHit;
import in.gullak.ingestion.matching.FixedLine;
import in.gullak.ingestion.matching.LineCandidate;
import in.gullak.ingestion.matching.Link;
import in.gullak.ingestion.matching.Matcher;
import in.gullak.ingestion.matching.PendingSpend;
import in.gullak.ingestion.statements.RawLine;
import in.gullak.profile.FixedCostService;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * The pipeline of spec 2.3 for one statement: fingerprint (skip lines already imported), categorise, find fixed
 * costs, dry-run matching, and put each line in a bucket (decision 8). Nothing is written here.
 */
@Component
class LinePlanner {
    private static final Categoriser CATEGORISER = new Categoriser(MerchantDictionary.DEFAULT);
    private static final Suggester SUGGESTER = new Suggester();

    record Planned(UUID lineId, int rowNo, RawLine raw, String keyHash, String merchantName, String paymentMethod,
                   LineKind kind, String categoryCode, GuessSource guessSource, List<String> suggestions, Hint hint,
                   String fingerprint, Bucket bucket, UUID fixedCostId, boolean fixedRecognised, UUID matchTxnId,
                   Confidence matchConfidence) {}

    record Plan(List<Planned> lines, int alreadyImported) {}

    private record Facts(UUID id, int rowNo, RawLine raw, String key, String keyHash, Optional<Guess> guess,
                         Suggestion suggestion, LineKind kind, String method, String fingerprint) {
        LineCandidate candidate() {
            return new LineCandidate(id, rowNo, raw.date(), raw.amountPaise(), method, MerchantText.squash(key), keyHash,
                guess.map(Guess::categoryCode).orElse(null));
        }
    }

    private final FieldCipher cipher;
    private final StatementTxnRepository txns;
    private final FixedCostService fixedCosts;
    private final MerchantRuleService rules;

    LinePlanner(FieldCipher cipher, StatementTxnRepository txns, FixedCostService fixedCosts, MerchantRuleService rules) {
        this.cipher = cipher;
        this.txns = txns;
        this.fixedCosts = fixedCosts;
        this.rules = rules;
    }

    static String keyHash(FieldCipher cipher, UUID userId, String merchantKey) {
        return cipher.hash(userId, "key:" + merchantKey);
    }

    static String typedHash(FieldCipher cipher, UUID userId, String typedMerchant) {
        return cipher.hash(userId, "typed:" + MerchantText.squash(typedMerchant));
    }

    Plan plan(UUID userId, String bank, List<RawLine> raw) {
        Map<String, Integer> seen = new HashMap<>();
        List<String> fingerprints = new ArrayList<>(raw.size());
        for (RawLine r : raw) {
            String base = bank + "|" + r.date() + "|" + r.amountPaise() + "|" + r.direction() + "|" + MerchantText.normalise(r.description());
            int occurrence = seen.merge(base, 1, Integer::sum);
            fingerprints.add(cipher.hash(userId, "fp:" + base + "|" + occurrence));
        }
        Set<String> existing = txns.existingFingerprints(userId, fingerprints);
        Function<String, Optional<String>> ruleLookup = rules.lookupFor(userId);
        List<Facts> facts = new ArrayList<>();
        for (int i = 0; i < raw.size(); i++) {
            if (existing.contains(fingerprints.get(i))) {
                continue;
            }
            RawLine r = raw.get(i);
            String key = MerchantText.key(r.description());
            Optional<Guess> guess = CATEGORISER.categorise(r.description(), ruleLookup);
            facts.add(new Facts(UUID.randomUUID(), facts.size() + 1, r, key, keyHash(cipher, userId, key), guess,
                SUGGESTER.suggest(r.description(), guess), LineClassifier.kind(r.direction(), r.description()),
                LineClassifier.paymentMethod(r.description()), fingerprints.get(i)));
        }

        List<FixedCostInfo> costs = fixedCosts.payeesFor(userId).stream()
            .map(p -> new FixedCostInfo(p.id(), p.name(), p.amountPaise(), p.payeePattern(), p.usualDay())).toList();
        List<FixedLine> fixedLines = facts.stream().filter(f -> f.kind() == LineKind.SPEND)
            .map(f -> new FixedLine(f.id(), f.raw().date(), f.raw().amountPaise(), f.keyHash(),
                f.guess().map(g -> g.source() == GuessSource.DICTIONARY).orElse(false)))
            .toList();
        Map<UUID, FixedHit> fixedByLine = FixedCostDetector.detect(fixedLines, costs).stream()
            .collect(Collectors.toMap(FixedHit::lineId, h -> h));

        List<LineCandidate> candidates = facts.stream()
            .filter(f -> f.kind() == LineKind.SPEND && !fixedByLine.containsKey(f.id()))
            .map(Facts::candidate).toList();
        Map<UUID, Link> linkByLine = new HashMap<>();
        if (!candidates.isEmpty()) {
            LocalDate from = candidates.stream().map(LineCandidate::date).min(Comparator.naturalOrder()).orElseThrow();
            LocalDate to = candidates.stream().map(LineCandidate::date).max(Comparator.naturalOrder()).orElseThrow();
            List<PendingSpend> spends = txns.pendingSpends(userId, from.minusDays(3), to);
            Set<String> pairs = txns.learnedPairs(userId);
            for (Link link : Matcher.match(candidates, spends, (s, l) -> s.merchantName() != null
                && pairs.contains(typedHash(cipher, userId, s.merchantName()) + "|" + l.keyHash()))) {
                linkByLine.put(link.lineId(), link);
            }
        }

        List<Planned> planned = new ArrayList<>(facts.size());
        for (Facts f : facts) {
            FixedHit fixed = fixedByLine.get(f.id());
            Link link = linkByLine.get(f.id());
            Bucket bucket;
            if (f.kind() != LineKind.SPEND) {
                bucket = Bucket.AUTO;
            } else if (fixed != null) {
                bucket = Bucket.FIXED;
            } else if (link != null) {
                bucket = Bucket.MATCHED;
            } else if (f.guess().isPresent() && f.guess().get().source() != GuessSource.PERSONAL_UPI) {
                bucket = Bucket.AUTO;
            } else {
                bucket = Bucket.SORT;
            }
            String category = f.kind() == LineKind.SPEND ? f.guess().map(Guess::categoryCode).orElse(null) : CategoryCodes.OTHER;
            String name = f.guess().map(Guess::displayName).orElse(MerchantText.displayName(f.key()));
            planned.add(new Planned(f.id(), f.rowNo(), f.raw(), f.keyHash(), name, f.method(), f.kind(), category,
                f.guess().map(Guess::source).orElse(null), f.suggestion().categories(), f.suggestion().hint(), f.fingerprint(),
                bucket, fixed == null ? null : fixed.fixedCostId(), fixed != null && fixed.recognised(),
                link == null ? null : link.spendId(), link == null ? null : link.confidence()));
        }
        return new Plan(List.copyOf(planned), raw.size() - facts.size());
    }
}
```

`ImportPreview.java`:

```java
package in.gullak.ingestion.imports;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record ImportPreview(UUID importId, String status, String kind, String bank, String bankName, String bankLabel,
                            boolean unlocked, int count, int alreadyImported, int unreadableCount, LocalDate from,
                            LocalDate to, int matched, int auto, int fixed, int toSort, List<FixedQuestion> fixedQuestions) {}
```

`FixedQuestion.java`:

```java
package in.gullak.ingestion.imports;

import java.time.LocalDate;
import java.util.UUID;

/** "Is this your rent?" {@code answer} is YES, NO or null while unanswered. */
public record FixedQuestion(UUID lineId, UUID fixedCostId, String fixedCostName, long amountPaise, LocalDate date, String answer) {}
```

`LatestImport.java`:

```java
package in.gullak.ingestion.imports;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/** The "Last added" row on the upload start screen. */
public record LatestImport(UUID importId, String bankLabel, LocalDate from, LocalDate to, Instant committedAt, int count) {}
```

`BankRequestBody.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.web.SingleLineText;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record BankRequestBody(@NotBlank @Size(max = 60) @SingleLineText String bank) {}
```

`ImportViews.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.ingestion.statements.Bank;
import in.gullak.profile.FixedCostPayee;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/** Entity → API records. */
final class ImportViews {
    private ImportViews() {}

    static ImportPreview preview(StatementImportEntity imp, List<ImportLineEntity> lines, List<FixedCostPayee> costs) {
        Map<UUID, String> names = costs.stream().collect(Collectors.toMap(FixedCostPayee::id, FixedCostPayee::name));
        List<FixedQuestion> questions = lines.stream()
            .filter(l -> l.getFixedCostId() != null && !l.isFixedRecognised() && l.getBucket() == Bucket.FIXED)
            .map(l -> new FixedQuestion(l.getId(), l.getFixedCostId(), names.getOrDefault(l.getFixedCostId(), ""),
                l.getAmountPaise(), l.getOccurredOn(), l.getFixedAnswer() == null ? null : l.getFixedAnswer().toUpperCase(Locale.ROOT)))
            .toList();
        return new ImportPreview(imp.getId(), imp.getStatus().toUpperCase(Locale.ROOT), imp.getKind().toUpperCase(Locale.ROOT),
            imp.getBank(), bankName(imp.getBank()), bankLabel(imp.getBank()), imp.isUnlocked(), imp.getRowCount(),
            imp.getAlreadyCount(), imp.getUnreadableCount(), imp.getPeriodFrom(), imp.getPeriodTo(), imp.getMatchedCount(),
            imp.getAutoCount(), imp.getFixedCount(), imp.getToSortCount(), questions);
    }

    static LatestImport latest(StatementImportEntity imp) {
        return new LatestImport(imp.getId(), bankLabel(imp.getBank()), imp.getPeriodFrom(), imp.getPeriodTo(),
            imp.getCommittedAt(), imp.getRowCount());
    }

    static String bankName(String bank) {
        return bank.startsWith("csv:") ? "CSV statement" : Bank.valueOf(bank).displayName();
    }

    static String bankLabel(String bank) {
        return bank.startsWith("csv:") ? "CSV" : Bank.valueOf(bank).label();
    }
}
```

`ImportDrafts.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.crypto.FieldCipher;
import in.gullak.ingestion.statements.CsvOutcome;
import in.gullak.ingestion.statements.FileKind;
import in.gullak.ingestion.statements.ParsedStatement;
import in.gullak.ingestion.statements.RawLine;
import in.gullak.profile.FixedCostService;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** The writes behind an upload, each in its own transaction so parsing never holds a database connection. */
@Component
class ImportDrafts {
    private final StatementImportRepository imports;
    private final ImportLineRepository lines;
    private final LinePlanner planner;
    private final FieldCipher cipher;
    private final FixedCostService fixedCosts;

    ImportDrafts(StatementImportRepository imports, ImportLineRepository lines, LinePlanner planner, FieldCipher cipher,
                 FixedCostService fixedCosts) {
        this.imports = imports;
        this.lines = lines;
        this.planner = planner;
        this.cipher = cipher;
        this.fixedCosts = fixedCosts;
    }

    @Transactional
    ImportPreview saveDraft(UUID userId, ParsedStatement s) {
        StatementImportEntity imp = imports.saveAndFlush(new StatementImportEntity(userId, s.bank(), s.kind(), ImportStatus.DRAFT, s.unlocked()));
        return fill(userId, imp, s);
    }

    /** Plans the statement into an existing import row (a new draft, or a CSV whose columns were just mapped). */
    ImportPreview fill(UUID userId, StatementImportEntity imp, ParsedStatement s) {
        LinePlanner.Plan plan = planner.plan(userId, s.bank(), s.lines());
        List<ImportLineEntity> rows = new ArrayList<>(plan.lines().size());
        int matched = 0;
        int auto = 0;
        int fixed = 0;
        int sort = 0;
        for (LinePlanner.Planned p : plan.lines()) {
            rows.add(ImportLineEntity.planned(imp.getId(), userId, p, cipher.encrypt(userId, p.raw().description())));
            switch (p.bucket()) {
                case MATCHED -> matched++;
                case AUTO -> auto++;
                case FIXED -> fixed++;
                case SORT -> sort++;
            }
        }
        lines.saveAll(rows);
        LocalDate from = s.lines().stream().map(RawLine::date).min(Comparator.naturalOrder()).orElse(null);
        LocalDate to = s.lines().stream().map(RawLine::date).max(Comparator.naturalOrder()).orElse(null);
        imp.summarise(from, to, plan.lines().size(), plan.alreadyImported(), s.unreadable(), matched, auto, fixed, sort);
        imp.toDraft();
        return ImportViews.preview(imp, rows, fixedCosts.payeesFor(userId));
    }

    @Transactional
    UUID saveMappingDraft(UUID userId, CsvOutcome.NeedsMapping n) {
        StatementImportEntity imp = imports.saveAndFlush(new StatementImportEntity(userId, n.bank(), FileKind.CSV, ImportStatus.MAPPING, false));
        List<ImportLineEntity> rows = new ArrayList<>(n.rows().size() + 1);
        rows.add(ImportLineEntity.rawCells(imp.getId(), userId, 0, cipher.encrypt(userId, Cells.encode(n.headers()))));
        for (int i = 0; i < n.rows().size(); i++) {
            rows.add(ImportLineEntity.rawCells(imp.getId(), userId, i + 1, cipher.encrypt(userId, Cells.encode(n.rows().get(i)))));
        }
        lines.saveAll(rows);
        return imp.getId();
    }
}
```

`UploadSource.java`:

```java
package in.gullak.ingestion.imports;

import java.io.IOException;

/** The upload as the service sees it. Reading any of it parses the multipart body, so it is read inside the gate. */
public interface UploadSource {
    long size();

    byte[] bytes() throws IOException;

    String password();
}
```

`UploadGate.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.error.RateLimitedException;
import in.gullak.ingestion.statements.ImportProperties;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Component;

/** At most {@code max-concurrent-uploads} files in memory at once, server-wide (SEC-10). A newcomer waits up to 5 s. */
@Component
public class UploadGate {
    public interface Permit extends AutoCloseable {
        @Override
        void close();
    }

    private final Semaphore permits;
    private final AtomicInteger inFlight = new AtomicInteger();
    private final AtomicInteger peak = new AtomicInteger();

    public UploadGate(ImportProperties props) {
        this.permits = new Semaphore(props.maxConcurrentUploads(), true);
    }

    public Permit enter() {
        boolean acquired;
        try {
            acquired = permits.tryAcquire(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RateLimitedException();
        }
        if (!acquired) {
            throw new RateLimitedException();
        }
        int now = inFlight.incrementAndGet();
        peak.accumulateAndGet(now, Math::max);
        return () -> {
            inFlight.decrementAndGet();
            permits.release();
        };
    }

    int peak() {
        return peak.get();
    }
}
```

`ImportService.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.NotFoundException;
import in.gullak.common.error.UnprocessableException;
import in.gullak.common.error.ValidationException;
import in.gullak.common.log.Events;
import in.gullak.common.web.RateLimiter;
import in.gullak.ingestion.statements.CsvMapping;
import in.gullak.ingestion.statements.CsvOutcome;
import in.gullak.ingestion.statements.CsvTable;
import in.gullak.ingestion.statements.FileKind;
import in.gullak.ingestion.statements.ImportProperties;
import in.gullak.ingestion.statements.ReadFailures;
import in.gullak.ingestion.statements.StatementParser;
import in.gullak.profile.FixedCostService;
import java.io.IOException;
import java.time.Duration;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ImportService {
    private static final Logger log = LoggerFactory.getLogger(ImportService.class);

    private final StatementParser parser;
    private final ImportDrafts drafts;
    private final StatementImportRepository imports;
    private final ImportLineRepository lines;
    private final CsvMappingRepository mappings;
    private final BankRequestService banks;
    private final FixedCostService fixedCosts;
    private final RateLimiter limiter;
    private final UploadGate gate;
    private final ImportProperties props;

    ImportService(StatementParser parser, ImportDrafts drafts, StatementImportRepository imports, ImportLineRepository lines,
                  CsvMappingRepository mappings, BankRequestService banks, FixedCostService fixedCosts, RateLimiter limiter,
                  UploadGate gate, ImportProperties props) {
        this.parser = parser;
        this.drafts = drafts;
        this.imports = imports;
        this.lines = lines;
        this.mappings = mappings;
        this.banks = banks;
        this.fixedCosts = fixedCosts;
        this.limiter = limiter;
        this.gate = gate;
        this.props = props;
    }

    /** Spec 2.3 and 4.6: read in memory, preview or a typed failure, bytes dropped. Not transactional: parsing is slow. */
    public ImportPreview upload(UUID userId, UploadSource source) {
        limiter.check("imports:" + userId, props.uploadsPerHour(), Duration.ofHours(1));
        try (UploadGate.Permit permit = gate.enter()) {
            long size = source.size();
            if (size > props.maxFileSize().toBytes()) {
                throw ReadFailures.tooLarge(props.maxFileSize());
            }
            if (size == 0) {
                throw ReadFailures.invalidFile();
            }
            String password = password(source.password());
            byte[] bytes = read(source);
            try {
                FileKind kind = parser.sniff(bytes);
                log.info("{} user={} kind={}", Events.IMPORT_RECEIVED, userId, kind);
                ImportPreview preview;
                if (kind == FileKind.PDF) {
                    preview = drafts.saveDraft(userId, parser.readPdf(bytes, password));
                } else {
                    CsvTable table = parser.readCsv(bytes);
                    CsvOutcome outcome = parser.mapCsv(table, savedMapping(userId, parser.csvBank(table)));
                    preview = switch (outcome) {
                        case CsvOutcome.Mapped m -> drafts.saveDraft(userId, m.statement());
                        case CsvOutcome.NeedsMapping n -> throw needsMapping(drafts.saveMappingDraft(userId, n), n);
                    };
                }
                log.info("{} user={} id={} lines={} already={} unreadable={}", Events.IMPORT_PREVIEWED, userId,
                    preview.importId(), preview.count(), preview.alreadyImported(), preview.unreadableCount());
                return preview;
            } catch (UnprocessableException e) {
                if (e.code() == ErrorCode.UNSUPPORTED_BANK) {
                    banks.recordDetected(userId, (String) e.details().get("bank"));
                }
                log.info("{} user={} code={}", Events.IMPORT_FAILED, userId, e.code());
                throw e;
            } finally {
                Arrays.fill(bytes, (byte) 0);
            }
        }
    }

    @Transactional(readOnly = true)
    public ImportPreview get(UUID userId, UUID importId) {
        StatementImportEntity imp = imports.findByIdAndUserId(importId, userId)
            .filter(i -> i.is(ImportStatus.DRAFT) || i.is(ImportStatus.COMMITTED))
            .orElseThrow(() -> new NotFoundException("Import"));
        return ImportViews.preview(imp, lines.findByImportIdAndBucketOrderByOccurredOnAscRowNoAsc(importId, Bucket.FIXED.db()),
            fixedCosts.payeesFor(userId));
    }

    @Transactional(readOnly = true)
    public Optional<LatestImport> latest(UUID userId) {
        return imports.findFirstByUserIdAndStatusOrderByCommittedAtDesc(userId, ImportStatus.COMMITTED.db()).map(ImportViews::latest);
    }

    Optional<CsvMapping> savedMapping(UUID userId, String bank) {
        return mappings.findByUserIdAndBank(userId, bank).map(CsvMappingEntity::toMapping);
    }

    private static String password(String raw) {
        if (raw == null || raw.isEmpty()) {
            return null;
        }
        if (raw.length() > 64 || raw.chars().anyMatch(Character::isISOControl)) {
            throw new ValidationException("password", "Check the password");
        }
        return raw;
    }

    private static byte[] read(UploadSource source) {
        try {
            return source.bytes();
        } catch (IOException e) {
            log.warn("{} code=UNREADABLE reason=receive", Events.IMPORT_FAILED);
            throw ReadFailures.unreadable("We couldn't receive that file. Try again.");
        }
    }

    static UnprocessableException needsMapping(UUID importId, CsvOutcome.NeedsMapping n) {
        Map<String, Object> suggestion = new LinkedHashMap<>();
        suggestion.put("date", n.suggestion().date());
        suggestion.put("description", n.suggestion().description());
        suggestion.put("debit", n.suggestion().debit());
        suggestion.put("credit", n.suggestion().credit());
        suggestion.put("amount", n.suggestion().amount());
        suggestion.put("drCr", n.suggestion().drCr());
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("importId", importId);
        details.put("headers", n.headers());
        details.put("sampleRows", List.copyOf(n.rows().subList(0, Math.min(5, n.rows().size()))));
        details.put("suggestion", suggestion);
        return new UnprocessableException(ErrorCode.NEEDS_COLUMN_MAP, "Tell us which column is which", details);
    }
}
```

`ImportController.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.error.ValidationException;
import in.gullak.common.web.CurrentUser;
import java.io.IOException;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;

@RestController
@RequestMapping("/api/v1/imports")
class ImportController {
    private final ImportService imports;

    ImportController(ImportService imports) {
        this.imports = imports;
    }

    /** The one multipart endpoint (spec 4.6). The part's file name is never read. */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    ImportPreview upload(@AuthenticationPrincipal Jwt jwt, MultipartHttpServletRequest request) {
        return imports.upload(CurrentUser.id(jwt), new UploadSource() {
            private MultipartFile file() {
                MultipartFile file = request.getFile("file");
                if (file == null) {
                    throw new ValidationException("file", "Choose a file");
                }
                return file;
            }

            @Override
            public long size() {
                return file().getSize();
            }

            @Override
            public byte[] bytes() throws IOException {
                return file().getBytes();
            }

            @Override
            public String password() {
                return request.getParameter("password");
            }
        });
    }

    @GetMapping("/latest")
    ResponseEntity<LatestImport> latest(@AuthenticationPrincipal Jwt jwt) {
        return imports.latest(CurrentUser.id(jwt)).map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @GetMapping("/{id}")
    ImportPreview get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return imports.get(CurrentUser.id(jwt), id);
    }
}
```

`BankRequestController.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.web.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
class BankRequestController {
    private final BankRequestService banks;

    BankRequestController(BankRequestService banks) {
        this.banks = banks;
    }

    @PostMapping("/api/v1/banks/requests")
    @ResponseStatus(HttpStatus.CREATED)
    BankRequestBody ask(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BankRequestBody body) {
        return new BankRequestBody(banks.ask(CurrentUser.id(jwt), body.bank()));
    }
}
```

A multipart request with a JSON body or no body at all fails Spring's `consumes` check (415 `UNSUPPORTED_MEDIA_TYPE`), which Plan 1's handler already shapes.

- [ ] **Step 8: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.imports.*' --tests 'in.gullak.common.web.*'`
Expected: PASS. If `hdfcSamplePreviewsAsTheMockupShows` reports other counts, print the planned buckets with `LinePlanner` in a scratch test and fix the planner or the sample row, never the expected numbers: they are the mockup's.

Then: `cd server && ./gradlew test` (PASS, including ArchUnit: every repository is used only inside `in.gullak.ingestion.imports`, `profile` stays independent of `ingestion`).

- [ ] **Step 9: Red team**

Dispatch `red-team` with task id `plan-04-task-7` against the running local server (`./gradlew bootRun --args='--spring.profiles.active=local'` with `GULLAK_ENC_KEY` set): the attacks in this task's header, plus 100 uploads in a minute from one user and 20 users uploading 10 MB files at once while watching heap (`jcmd <pid> GC.heap_info`), file names `../../etc/passwd.pdf`, `a\nb.pdf` and 300 characters, a `password` field of 10 KB, and `GET /imports/{id}` with another user's id. Expected: 429 after 10, 4 in flight at most, file names never in logs or responses, 404 for other users. Findings to `docs/reports/red-team/plan-04-task-7.md`; a High or Critical finding is fixed in this task.

- [ ] **Step 10: Commit**

```bash
git add server/src/main/resources server/src/main/java/in/gullak/common/web/BodyLimitFilter.java \
  server/src/main/java/in/gullak/profile server/src/main/java/in/gullak/ingestion/imports \
  server/src/test/java/in/gullak/ingestion/imports server/src/test/java/in/gullak/common/web/BodyLimitExemptionTest.java
git commit -m "feat(server): statement import tables, upload preview API with limits, and bank requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Column map, to-sort, tag and undo, fixed-cost answers, discard

**Owner:** backend-engineer. **Test IDs:** API-IMP-07 (map half), API-IMP-08, 10, 11, 16, 17, 18, 19, 20, 21, 22, 26; CAT-07 (end to end); API-IMP-32 (new: fixed-cost answer), API-IMP-34 (new: column-map dry run); JOB-08 (the `discardOlderThan` half; Plan 6 schedules it). **Red team:** yes: tag another user's line, tag a line from another import, undo races (two undos at once), a column map pointing at column 10,000, tagging with a category code that is not one of the twelve, answering a fixed-cost question twice.

**Files:**
- Create (main, `server/src/main/java/in/gullak/ingestion/imports/`): `SortLine.java`, `SortList.java`, `TagRequest.java`, `TagResult.java`, `UndoResult.java`, `FixedAnswerRequest.java`, `ColumnMapRequest.java`, `MappedLine.java`, `ColumnMapPreview.java`, `DiscardResult.java`, `SortService.java`
- Modify: `MerchantRuleRepository.java` (upsert, revert), `ImportLineRepository.java` (`deleteByImport` clears the context), `ImportService.java` (clock, column map, discard, `discardOlderThan`), `ImportController.java` (seven routes)
- Create (test): `server/src/test/java/in/gullak/ingestion/imports/SortApiTest.java`, `ColumnMapApiTest.java`

**Interfaces:**
- Consumes: Task 7's entities, repositories, `ImportDrafts#fill`, `ImportViews`, `FixedCostService#setPayee`, `StatementParser#csvStatement`, `CsvMapper.apply`, `CsvMapping#validate`, `Cells`.
- Produces: `GET /api/v1/imports/{id}/to-sort` → `{lines: SortLine[]}`; `POST /api/v1/imports/{id}/tag {lineId, tag: NEED|WANT|REGRET, category}` → `{lineId, tag, category, left}`; `POST /api/v1/imports/{id}/undo-tag` → `{lineId, left}` or 409 `NOTHING_TO_UNDO`; `POST /api/v1/imports/{id}/fixed-answer {lineId, yes}` → `ImportPreview`; `POST /api/v1/imports/{id}/column-map/preview {date, description, debit, credit, amount, drCr, dateFormat}` → `{lines: MappedLine[], unreadable}`; `POST /api/v1/imports/{id}/column-map` (same body) → 200 `ImportPreview`; `POST /api/v1/imports/{id}/discard` → `{importId, status: "DISCARDED"}`. Java: `SortLine(UUID lineId, LocalDate date, long amountPaise, String raw, String hint, List<String> suggestions, Tag tag, String category)`; `ImportService#discardOlderThan(int days): int` for Plan 6's draft-cleanup job.

- [ ] **Step 1: Write the failing tests**

`SortApiTest.java`:

```java
package in.gullak.ingestion.imports;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.TestUser;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class SortApiTest extends ImportTest {
    static final String JSON = MediaType.APPLICATION_JSON_VALUE;

    @Autowired ImportService importService;

    String hdfcDraft(TestUser u) throws Exception {
        return importId(upload(u, sample("hdfc.pdf"), null).andExpect(status().isCreated()));
    }

    List<Map<String, Object>> toSort(TestUser u, String id) throws Exception {
        String body = mvc.perform(get("/api/v1/imports/" + id + "/to-sort").with(auth(u))).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.lines");
    }

    String lineWithRaw(List<Map<String, Object>> lines, String raw) {
        return lines.stream().filter(l -> raw.equals(l.get("raw"))).map(l -> (String) l.get("lineId")).findFirst().orElseThrow();
    }

    ResultActions tag(TestUser u, String id, String lineId, String tag, String category) throws Exception {
        return mvc.perform(post("/api/v1/imports/" + id + "/tag").with(auth(u)).contentType(JSON)
            .content("{\"lineId\":\"" + lineId + "\",\"tag\":\"" + tag + "\",\"category\":\"" + category + "\"}"));
    }

    @Test
    void theToSortListHasFourteenCardsWithChips() throws Exception { // API-IMP-16
        TestUser u = exampleUser();
        String id = hdfcDraft(u);
        List<Map<String, Object>> lines = toSort(u, id);
        assertThat(lines).hasSize(14);
        assertThat(lines).allSatisfy(l -> {
            assertThat((List<String>) l.get("suggestions")).isNotEmpty().endsWith("other");
            assertThat(l.get("tag")).isNull();
        });
        assertThat(lines).extracting(l -> l.get("raw")).contains("UPI/MURUGAN TEA STALL", "UPI to priya.s@oksbi");
        Map<String, Object> priya = lines.stream().filter(l -> "UPI to priya.s@oksbi".equals(l.get("raw"))).findFirst().orElseThrow();
        assertThat(priya.get("hint")).isEqualTo("PERSON");
        assertThat((List<String>) priya.get("suggestions")).first().isEqualTo("upi_to_people");
        assertThat(lines.get(0).get("date")).isEqualTo("2026-10-02");
    }

    @Test
    void anotherUsersListIsNotFound() throws Exception { // API-IMP-17
        String id = hdfcDraft(exampleUser());
        mvc.perform(get("/api/v1/imports/" + id + "/to-sort").with(auth(signIn()))).andExpect(status().isNotFound());
    }

    @Test
    void taggingLearnsARule() throws Exception { // API-IMP-18, CAT-07
        TestUser u = exampleUser();
        String id = hdfcDraft(u);
        String kaka = lineWithRaw(toSort(u, id), "UPI/KAKA DHABA");
        tag(u, id, kaka, "NEED", "eating_out").andExpect(status().isOk())
            .andExpect(jsonPath("$.left").value(13)).andExpect(jsonPath("$.tag").value("NEED"));
        assertThat(jdbc.sql("select category_code from merchant_rules where user_id = ? and scope = 'user'").param(u.id())
            .query(String.class).list()).containsExactly("eating_out");
    }

    @Test
    void theNextStatementUsesTheLearnedRule() throws Exception { // CAT-07
        TestUser u = exampleUser();
        byte[] statement = csv("Date,Description,Debit,Credit\n14/10/2026,UPI/KAKA DHABA,150.00,\n15/10/2026,UPI/MURUGAN TEA STALL,45.00,\n");
        String first = importId(upload(u, statement, null, "a.csv").andExpect(jsonPath("$.toSort").value(2)));
        tag(u, first, lineWithRaw(toSort(u, first), "UPI/KAKA DHABA"), "WANT", "eating_out").andExpect(status().isOk());
        upload(u, statement, null, "a.csv").andExpect(status().isCreated())
            .andExpect(jsonPath("$.toSort").value(1)).andExpect(jsonPath("$.auto").value(1));
    }

    @Test
    void aTagThatIsNotOneOfTheThreeIsRefused() throws Exception { // API-IMP-19
        TestUser u = exampleUser();
        String id = hdfcDraft(u);
        tag(u, id, lineWithRaw(toSort(u, id), "UPI/KAKA DHABA"), "maybe", "eating_out")
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION"));
        tag(u, id, lineWithRaw(toSort(u, id), "UPI/KAKA DHABA"), "NEED", "crypto").andExpect(status().isBadRequest());
    }

    @Test
    void aLineOutsideTheSortListIsNotFound() throws Exception { // API-IMP-20
        TestUser u = exampleUser();
        String id = hdfcDraft(u);
        tag(u, id, UUID.randomUUID().toString(), "NEED", "other").andExpect(status().isNotFound());
        String autoLine = jdbc.sql("select id::text from import_lines where import_id = ?::uuid and bucket = 'auto' limit 1")
            .param(id).query(String.class).single();
        tag(u, id, autoLine, "NEED", "other").andExpect(status().isNotFound());
        String otherImport = hdfcDraft(u);
        tag(u, otherImport, lineWithRaw(toSort(u, id), "UPI/KAKA DHABA"), "NEED", "other").andExpect(status().isNotFound());
    }

    @Test
    void undoRevertsTheLastTagAndItsRule() throws Exception { // API-IMP-21
        TestUser u = exampleUser();
        String id = hdfcDraft(u);
        List<Map<String, Object>> lines = toSort(u, id);
        tag(u, id, lineWithRaw(lines, "UPI/MURUGAN TEA STALL"), "NEED", "eating_out").andExpect(status().isOk());
        String kaka = lineWithRaw(lines, "UPI/KAKA DHABA");
        tag(u, id, kaka, "REGRET", "eating_out").andExpect(status().isOk());
        mvc.perform(post("/api/v1/imports/" + id + "/undo-tag").with(auth(u)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.lineId").value(kaka)).andExpect(jsonPath("$.left").value(13));
        assertThat(toSort(u, id)).filteredOn(l -> l.get("tag") != null).hasSize(1);
        assertThat(jdbc.sql("select count(*) from merchant_rules where user_id = ?").param(u.id()).query(Integer.class).single()).isEqualTo(1);
    }

    @Test
    void undoWithNothingTaggedConflicts() throws Exception { // API-IMP-22
        TestUser u = exampleUser();
        mvc.perform(post("/api/v1/imports/" + hdfcDraft(u) + "/undo-tag").with(auth(u)))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NOTHING_TO_UNDO"));
    }

    @Test
    void discardLeavesNothing() throws Exception { // API-IMP-26
        TestUser u = exampleUser();
        String id = hdfcDraft(u);
        mvc.perform(post("/api/v1/imports/" + id + "/discard").with(auth(u)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DISCARDED"));
        assertThat(jdbc.sql("select count(*) from import_lines where import_id = ?::uuid").param(id).query(Integer.class).single()).isZero();
        assertThat(jdbc.sql("select count(*) from transactions where user_id = ? and source = 'statement'").param(u.id())
            .query(Integer.class).single()).isZero();
        mvc.perform(get("/api/v1/imports/" + id).with(auth(u))).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/imports/" + id + "/discard").with(auth(u))).andExpect(status().isNotFound());
    }

    @Test
    void yesToTheRentQuestionStoresThePayee() throws Exception { // API-IMP-32, MAT-16
        TestUser u = exampleUser();
        String body = upload(u, sample("hdfc.pdf"), null).andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(body, "$.importId");
        List<String> rentLine = JsonPath.read(body, "$.fixedQuestions[?(@.fixedCostName == 'Rent')].lineId");
        mvc.perform(post("/api/v1/imports/" + id + "/fixed-answer").with(auth(u)).contentType(JSON)
                .content("{\"lineId\":\"" + rentLine.getFirst() + "\",\"yes\":true}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.fixedQuestions[?(@.fixedCostName == 'Rent')].answer").value("YES"))
            .andExpect(jsonPath("$.fixed").value(3));
        Map<String, Object> rent = jdbc.sql("select payee_pattern, usual_day from fixed_costs where user_id = ? and name = 'Rent'")
            .param(u.id()).query().singleRow();
        assertThat((String) rent.get("payee_pattern")).matches("[0-9a-f]{64}");
        assertThat(rent.get("usual_day")).isEqualTo(5);
    }

    @Test
    void noToTheMaidQuestionMakesItAnOrdinaryLine() throws Exception { // API-IMP-32
        TestUser u = exampleUser();
        String body = upload(u, sample("hdfc.pdf"), null).andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(body, "$.importId");
        List<String> maidLine = JsonPath.read(body, "$.fixedQuestions[?(@.fixedCostName == 'Maid')].lineId");
        mvc.perform(post("/api/v1/imports/" + id + "/fixed-answer").with(auth(u)).contentType(JSON)
                .content("{\"lineId\":\"" + maidLine.getFirst() + "\",\"yes\":false}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.fixed").value(2)).andExpect(jsonPath("$.toSort").value(15))
            .andExpect(jsonPath("$.fixedQuestions.length()").value(2));
        assertThat(toSort(u, id)).hasSize(15);
    }

    @Test
    void oldDraftsAreDiscardedByTheCleanupHook() throws Exception { // JOB-08 (service half)
        TestUser u = exampleUser();
        String old = hdfcDraft(u);
        String recent = hdfcDraft(u);
        jdbc.sql("update statement_imports set created_at = now() - interval '8 days' where id = ?::uuid").param(old).update();
        jdbc.sql("update statement_imports set created_at = now() - interval '6 days' where id = ?::uuid").param(recent).update();
        assertThat(importService.discardOlderThan(7)).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.sql("select status from statement_imports where id = ?::uuid").param(old).query(String.class).single()).isEqualTo("discarded");
        assertThat(jdbc.sql("select status from statement_imports where id = ?::uuid").param(recent).query(String.class).single()).isEqualTo("draft");
    }
}
```

The cleanup test compares against the database's `now()`, so `discardOlderThan` uses the database clock for "older than", not the test's `MutableClock` (decision recorded in Step 3).

`ColumnMapApiTest.java`:

```java
package in.gullak.ingestion.imports;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.support.TestUser;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class ColumnMapApiTest extends ImportTest {
    static final String MAP = "{\"date\":0,\"description\":1,\"amount\":2,\"drCr\":3,\"dateFormat\":\"YYYY_MM_DD\"}";

    String needsMap(TestUser u) throws Exception {
        String body = upload(u, sample("csv/unknown-headers.csv"), null, "s.csv")
            .andExpect(status().isUnprocessableEntity()).andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.details.importId");
    }

    ResultActions post(TestUser u, String path, String json) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.post(path).with(auth(u))
            .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    @Test
    void theDryRunShowsTheFirstThreeLines() throws Exception { // API-IMP-34
        TestUser u = exampleUser();
        String id = needsMap(u);
        post(u, "/api/v1/imports/" + id + "/column-map/preview", MAP).andExpect(status().isOk())
            .andExpect(jsonPath("$.lines.length()").value(3))
            .andExpect(jsonPath("$.lines[0].description").value("UPI/KAKA DHABA"))
            .andExpect(jsonPath("$.lines[0].amountPaise").value(15000))
            .andExpect(jsonPath("$.lines[2].direction").value("CREDIT"))
            .andExpect(jsonPath("$.unreadable").value(0));
        post(u, "/api/v1/imports/" + id + "/column-map/preview", MAP.replace("YYYY_MM_DD", "DD_MM_YYYY_SLASH"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.lines.length()").value(0)).andExpect(jsonPath("$.unreadable").value(3));
    }

    @Test
    void mappingPreviewsAndIsRemembered() throws Exception { // API-IMP-07, API-IMP-10, API-IMP-08
        TestUser u = exampleUser();
        String id = needsMap(u);
        post(u, "/api/v1/imports/" + id + "/column-map", MAP).andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("DRAFT")).andExpect(jsonPath("$.count").value(3))
            .andExpect(jsonPath("$.bankLabel").value("CSV"));
        assertThat(jdbc.sql("select count(*) from csv_mappings where user_id = ?").param(u.id()).query(Integer.class).single()).isEqualTo(1);
        assertThat(jdbc.sql("select count(*) from import_lines where import_id = ?::uuid and cells_enc is not null").param(id)
            .query(Integer.class).single()).isZero();
        upload(u, sample("csv/unknown-headers.csv"), null, "s.csv").andExpect(status().isCreated()).andExpect(jsonPath("$.count").value(3));
    }

    @Test
    void aMapWithoutADateIsRefused() throws Exception { // API-IMP-11
        TestUser u = exampleUser();
        post(u, "/api/v1/imports/" + needsMap(u) + "/column-map", "{\"description\":1,\"amount\":2,\"dateFormat\":\"YYYY_MM_DD\"}")
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fields[0].field").value("date"));
    }

    @Test
    void aColumnPastTheEndIsAFieldError() throws Exception {
        TestUser u = exampleUser();
        post(u, "/api/v1/imports/" + needsMap(u) + "/column-map", MAP.replace("\"description\":1", "\"description\":9"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fields[0].field").value("description"));
    }

    @Test
    void anotherUsersMapIsNotFound() throws Exception {
        String id = needsMap(exampleUser());
        post(signIn(), "/api/v1/imports/" + id + "/column-map", MAP).andExpect(status().isNotFound());
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.imports.SortApiTest' --tests 'in.gullak.ingestion.imports.ColumnMapApiTest'`
Expected: 404s and compilation errors (`SortService`, the request records and the routes are missing).

- [ ] **Step 3: Write the code**

Request and response records (each its own file in `in.gullak.ingestion.imports`):

```java
package in.gullak.ingestion.imports;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** A swipe card. {@code raw} is the owner's own statement text (decision 1); never logged. */
public record SortLine(UUID lineId, LocalDate date, long amountPaise, String raw, String hint, List<String> suggestions,
                       Tag tag, String category) {}
```

```java
package in.gullak.ingestion.imports;

import java.util.List;

public record SortList(List<SortLine> lines) {}
```

```java
package in.gullak.ingestion.imports;

import in.gullak.ingestion.categorise.CategoryCodes;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.UUID;

public record TagRequest(@NotNull UUID lineId, @NotNull Tag tag, @NotNull @Pattern(regexp = CategoryCodes.REGEX) String category) {}
```

```java
package in.gullak.ingestion.imports;

import java.util.UUID;

public record TagResult(UUID lineId, Tag tag, String category, int left) {}
```

```java
package in.gullak.ingestion.imports;

import java.util.UUID;

public record UndoResult(UUID lineId, int left) {}
```

```java
package in.gullak.ingestion.imports;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record FixedAnswerRequest(@NotNull UUID lineId, @NotNull Boolean yes) {}
```

```java
package in.gullak.ingestion.imports;

import in.gullak.ingestion.statements.CsvMapping;
import in.gullak.ingestion.statements.StatementDateFormat;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/** Zero-based column indexes chosen on the mapping screen (spec 3.2 #1). */
public record ColumnMapRequest(
    @NotNull @Min(0) @Max(199) Integer date,
    @NotNull @Min(0) @Max(199) Integer description,
    @Min(0) @Max(199) Integer debit,
    @Min(0) @Max(199) Integer credit,
    @Min(0) @Max(199) Integer amount,
    @Min(0) @Max(199) Integer drCr,
    @NotNull StatementDateFormat dateFormat) {

    CsvMapping toMapping() {
        return new CsvMapping(date, description, debit, credit, amount, drCr, dateFormat);
    }
}
```

```java
package in.gullak.ingestion.imports;

import in.gullak.ingestion.statements.Direction;
import in.gullak.ingestion.statements.RawLine;
import java.time.LocalDate;

public record MappedLine(int rowNo, LocalDate date, String description, long amountPaise, Direction direction) {
    static MappedLine of(RawLine l) {
        return new MappedLine(l.rowNo(), l.date(), l.description(), l.amountPaise(), l.direction());
    }
}
```

```java
package in.gullak.ingestion.imports;

import java.util.List;

public record ColumnMapPreview(List<MappedLine> lines, int unreadable) {}
```

```java
package in.gullak.ingestion.imports;

import java.util.UUID;

public record DiscardResult(UUID importId, String status) {}
```

In `ImportLineRepository.java`, replace `deleteByImport`'s annotation so the bulk delete flushes pending changes first and leaves no stale entities behind:

```java
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ImportLineEntity l where l.importId = :importId")
    int deleteByImport(@Param("importId") UUID importId);
```

Callers change an entity before calling it and re-read it afterwards if they need it again.

In `MerchantRuleRepository.java`, add:

```java
    record Change(boolean created, String previous) {}

    /** Learn or relearn a rule; returns what to put back on undo. Runs under the import's row lock. */
    Change upsert(UUID userId, String pattern, String category) {
        String previous = jdbc.sql("select category_code from merchant_rules where scope = 'user' and user_id = ? and pattern = ?")
            .params(userId, pattern).query(String.class).optional().orElse(null);
        Boolean created = jdbc.sql("""
                insert into merchant_rules (id, scope, user_id, pattern, category_code, hits) values (?, 'user', ?, ?, ?, 1)
                on conflict (user_id, pattern) where scope = 'user'
                do update set category_code = excluded.category_code, hits = merchant_rules.hits + 1, updated_at = now()
                returning (xmax = 0)
                """)
            .params(UUID.randomUUID(), userId, pattern, category).query(Boolean.class).single();
        return new Change(created, created ? null : previous);
    }

    void revert(UUID userId, String pattern, boolean created, String previous) {
        if (created) {
            jdbc.sql("delete from merchant_rules where scope = 'user' and user_id = ? and pattern = ?").params(userId, pattern).update();
        } else if (previous != null) {
            jdbc.sql("""
                    update merchant_rules set category_code = ?, hits = greatest(hits - 1, 1), updated_at = now()
                    where scope = 'user' and user_id = ? and pattern = ?
                    """)
                .params(previous, userId, pattern).update();
        }
    }
```

`SortService.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.crypto.FieldCipher;
import in.gullak.common.error.ConflictException;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.NotFoundException;
import in.gullak.profile.FixedCostService;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Swipe-to-sort (spec 2.3) and the fixed-cost question (spec 2.5) on a draft import. */
@Service
public class SortService {
    private final StatementImportRepository imports;
    private final ImportLineRepository lines;
    private final MerchantRuleRepository rules;
    private final FieldCipher cipher;
    private final FixedCostService fixedCosts;

    SortService(StatementImportRepository imports, ImportLineRepository lines, MerchantRuleRepository rules, FieldCipher cipher,
                FixedCostService fixedCosts) {
        this.imports = imports;
        this.lines = lines;
        this.rules = rules;
        this.cipher = cipher;
        this.fixedCosts = fixedCosts;
    }

    @Transactional(readOnly = true)
    public SortList toSort(UUID userId, UUID importId) {
        draft(imports.findByIdAndUserId(importId, userId).orElseThrow(() -> new NotFoundException("Import")));
        return new SortList(lines.findByImportIdAndBucketOrderByOccurredOnAscRowNoAsc(importId, Bucket.SORT.db()).stream()
            .map(l -> new SortLine(l.getId(), l.getOccurredOn(), l.getAmountPaise(), cipher.decrypt(userId, l.getDescriptionEnc()),
                l.getHint(), l.suggestionList(), l.getTag(), l.getChosenCategory()))
            .toList());
    }

    @Transactional
    public TagResult tag(UUID userId, UUID importId, TagRequest r) {
        StatementImportEntity imp = locked(userId, importId);
        ImportLineEntity line = lines.findByIdAndImportId(r.lineId(), importId)
            .filter(l -> l.getBucket() == Bucket.SORT).orElseThrow(() -> new NotFoundException("Line"));
        if (line.getTag() != null) {
            rules.revert(userId, line.getMerchantKeyHash(), line.isRuleCreated(), line.getRulePrevCategory());
        }
        MerchantRuleRepository.Change change = rules.upsert(userId, line.getMerchantKeyHash(), r.category());
        line.tag(r.tag(), r.category(), imp.nextTagSeq(), change.created(), change.previous());
        return new TagResult(line.getId(), r.tag(), r.category(), left(importId));
    }

    @Transactional
    public UndoResult undo(UUID userId, UUID importId) {
        locked(userId, importId);
        ImportLineEntity last = lines.findFirstByImportIdAndTagIsNotNullOrderByTagSeqDesc(importId)
            .orElseThrow(() -> new ConflictException(ErrorCode.NOTHING_TO_UNDO, "Nothing to undo"));
        rules.revert(userId, last.getMerchantKeyHash(), last.isRuleCreated(), last.getRulePrevCategory());
        last.untag();
        return new UndoResult(last.getId(), left(importId));
    }

    @Transactional
    public ImportPreview answerFixed(UUID userId, UUID importId, FixedAnswerRequest r) {
        StatementImportEntity imp = locked(userId, importId);
        ImportLineEntity line = lines.findByIdAndImportId(r.lineId(), importId)
            .filter(l -> l.getBucket() == Bucket.FIXED && !l.isFixedRecognised()).orElseThrow(() -> new NotFoundException("Line"));
        if (line.getFixedAnswer() == null) {
            if (r.yes()) {
                fixedCosts.setPayee(userId, line.getFixedCostId(), line.getMerchantKeyHash(), line.getOccurredOn().getDayOfMonth());
                line.answerYes();
            } else {
                imp.move(Bucket.FIXED, line.answerNo());
            }
        }
        return ImportViews.preview(imp, lines.findByImportIdAndBucketOrderByOccurredOnAscRowNoAsc(importId, Bucket.FIXED.db()),
            fixedCosts.payeesFor(userId));
    }

    private int left(UUID importId) {
        return (int) lines.countByImportIdAndBucketAndTagIsNull(importId, Bucket.SORT.db());
    }

    private StatementImportEntity locked(UUID userId, UUID importId) {
        return draft(imports.lockOwned(importId, userId).orElseThrow(() -> new NotFoundException("Import")));
    }

    static StatementImportEntity draft(StatementImportEntity imp) {
        if (imp.is(ImportStatus.COMMITTED)) {
            throw new ConflictException(ErrorCode.ALREADY_COMMITTED, "This statement is already added");
        }
        if (!imp.is(ImportStatus.DRAFT)) {
            throw new NotFoundException("Import");
        }
        return imp;
    }
}
```

In `ImportService.java`, add two constructor parameters and fields, `FieldCipher cipher` and `JdbcClient jdbc`, plus the imports `java.time.Instant`, `java.time.OffsetDateTime`, `java.util.ArrayList`, `in.gullak.common.crypto.FieldCipher`, `in.gullak.common.error.ConflictException`, `in.gullak.ingestion.statements.CsvMapper`, `in.gullak.ingestion.statements.ParsedStatement` and `org.springframework.jdbc.core.simple.JdbcClient`. The constructor becomes:

```java
    ImportService(StatementParser parser, ImportDrafts drafts, StatementImportRepository imports, ImportLineRepository lines,
                  CsvMappingRepository mappings, BankRequestService banks, FixedCostService fixedCosts, RateLimiter limiter,
                  UploadGate gate, ImportProperties props, FieldCipher cipher, JdbcClient jdbc) {
        this.parser = parser;
        this.drafts = drafts;
        this.imports = imports;
        this.lines = lines;
        this.mappings = mappings;
        this.banks = banks;
        this.fixedCosts = fixedCosts;
        this.limiter = limiter;
        this.gate = gate;
        this.props = props;
        this.cipher = cipher;
        this.jdbc = jdbc;
    }
```

with fields `private final FieldCipher cipher;` and `private final JdbcClient jdbc;`. Services may use `JdbcClient` (only controllers may not); here it reads the database clock once: drafts are stamped by the database's `now()`, so "older than" is measured on that same clock, not on the application's `Clock`. Then add these methods:

```java
    @Transactional(readOnly = true)
    public ColumnMapPreview previewColumns(UUID userId, UUID importId, ColumnMapRequest r) {
        StatementImportEntity imp = imports.findByIdAndUserId(importId, userId).orElseThrow(() -> new NotFoundException("Import"));
        requireMapping(imp);
        List<List<String>> rows = rawRows(userId, importId);
        CsvMapping mapping = r.toMapping();
        mapping.validate(rows.getFirst().size());
        CsvMapper.Result result = CsvMapper.apply(rows.subList(1, Math.min(4, rows.size())), mapping);
        return new ColumnMapPreview(result.lines().stream().map(MappedLine::of).toList(), result.unreadable());
    }

    @Transactional
    public ImportPreview applyColumns(UUID userId, UUID importId, ColumnMapRequest r) {
        StatementImportEntity imp = imports.lockOwned(importId, userId).orElseThrow(() -> new NotFoundException("Import"));
        if (imp.is(ImportStatus.DRAFT)) {
            return get(userId, importId);
        }
        requireMapping(imp);
        List<List<String>> rows = rawRows(userId, importId);
        CsvMapping mapping = r.toMapping();
        mapping.validate(rows.getFirst().size());
        CsvMapper.Result result = CsvMapper.apply(rows.subList(1, rows.size()), mapping);
        ParsedStatement statement = parser.csvStatement(imp.getBank(), result.lines(), result.unreadable());
        String bank = imp.getBank();
        lines.deleteByImport(importId);
        StatementImportEntity fresh = imports.findById(importId).orElseThrow(() -> new NotFoundException("Import"));
        ImportPreview preview = drafts.fill(userId, fresh, statement);
        mappings.findByUserIdAndBank(userId, bank).ifPresentOrElse(e -> e.change(mapping),
            () -> mappings.save(new CsvMappingEntity(userId, bank, mapping)));
        log.info("{} user={} id={} lines={}", Events.IMPORT_PREVIEWED, userId, importId, preview.count());
        return preview;
    }

    @Transactional
    public DiscardResult discard(UUID userId, UUID importId) {
        StatementImportEntity imp = imports.lockOwned(importId, userId).orElseThrow(() -> new NotFoundException("Import"));
        if (imp.is(ImportStatus.COMMITTED)) {
            throw new ConflictException(ErrorCode.ALREADY_COMMITTED, "This statement is already added");
        }
        if (imp.is(ImportStatus.DISCARDED)) {
            throw new NotFoundException("Import");
        }
        imp.discard();
        lines.deleteByImport(importId);
        log.info("{} user={} id={}", Events.IMPORT_DISCARDED, userId, importId);
        return new DiscardResult(importId, "DISCARDED");
    }

    /** For Plan 6's cleanup job (spec 2.3: a draft older than 7 days is discarded). Returns how many were discarded. */
    @Transactional
    public int discardOlderThan(int days) {
        Instant now = jdbc.sql("select now()").query(OffsetDateTime.class).single().toInstant();
        List<UUID> ids = imports.openCreatedBefore(now.minus(Duration.ofDays(days)));
        for (UUID id : ids) {
            imports.findById(id).ifPresent(StatementImportEntity::discard);
            lines.deleteByImport(id);
        }
        log.info("{} count={}", Events.IMPORT_DISCARDED, ids.size());
        return ids.size();
    }

    private List<List<String>> rawRows(UUID userId, UUID importId) {
        List<List<String>> rows = new ArrayList<>();
        for (ImportLineEntity l : lines.findByImportIdOrderByRowNoAsc(importId)) {
            rows.add(Cells.decode(cipher.decrypt(userId, l.getCellsEnc())));
        }
        if (rows.isEmpty()) {
            throw new NotFoundException("Import");
        }
        return rows;
    }

    private static void requireMapping(StatementImportEntity imp) {
        if (imp.is(ImportStatus.COMMITTED)) {
            throw new ConflictException(ErrorCode.ALREADY_COMMITTED, "This statement is already added");
        }
        if (!imp.is(ImportStatus.MAPPING)) {
            throw new NotFoundException("Import");
        }
    }
```

`fill` is called on the re-read entity after the bulk delete cleared the persistence context, so its counts are saved.

In `ImportController.java`, add a `SortService sort` constructor parameter and field, and these routes (imports: `jakarta.validation.Valid`, `org.springframework.web.bind.annotation.RequestBody`):

```java
    @GetMapping("/{id}/to-sort")
    SortList toSort(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return sort.toSort(CurrentUser.id(jwt), id);
    }

    @PostMapping("/{id}/tag")
    TagResult tag(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody TagRequest body) {
        return sort.tag(CurrentUser.id(jwt), id, body);
    }

    @PostMapping("/{id}/undo-tag")
    UndoResult undo(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return sort.undo(CurrentUser.id(jwt), id);
    }

    @PostMapping("/{id}/fixed-answer")
    ImportPreview answerFixed(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody FixedAnswerRequest body) {
        return sort.answerFixed(CurrentUser.id(jwt), id, body);
    }

    @PostMapping("/{id}/column-map/preview")
    ColumnMapPreview previewColumns(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody ColumnMapRequest body) {
        return imports.previewColumns(CurrentUser.id(jwt), id, body);
    }

    @PostMapping("/{id}/column-map")
    ImportPreview applyColumns(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody ColumnMapRequest body) {
        return imports.applyColumns(CurrentUser.id(jwt), id, body);
    }

    @PostMapping("/{id}/discard")
    DiscardResult discard(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return imports.discard(CurrentUser.id(jwt), id);
    }
```

- [ ] **Step 4: Run the tests**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.imports.*'`
Expected: PASS. Then `cd server && ./gradlew test`.

- [ ] **Step 5: Red team**

Dispatch `red-team` with task id `plan-04-task-8` with the attacks in this task's header, plus 50 parallel `tag` calls on one import and two parallel `undo-tag` calls (expected: serialised by the row lock; the rule table ends consistent with the remaining tags). Findings to `docs/reports/red-team/plan-04-task-8.md`.

- [ ] **Step 6: Commit**

```bash
git add server/src/main/java/in/gullak/ingestion/imports server/src/test/java/in/gullak/ingestion/imports
git commit -m "feat(server): column mapping, swipe-to-sort tags with undo and learned rules, fixed-cost answers, discard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Commit, links, unlink, misc cash, Plan 3 hooks

**Owner:** backend-engineer. **Test IDs:** API-IMP-14, 23, 24, 25, 27, 28; API-IMP-33 (new: misc cash answered once); MAT-12, MAT-13, MAT-15, MAT-17, MAT-19 (Plan 4 half), MAT-20, MAT-21; SEC-02; XP-07; API-SP-27 and API-SP-33 (the rule and release halves Plan 3 cannot do alone); Review Focus `identicalLinesOnOneDayBothImportOnceAndReuploadSkipsBoth`. **Red team:** yes: double commit races, commit while the same spends are being edited, unlink another user's spend, read `merchant_raw_enc` through any API, misc cash accepted twice, delete a linked spend then re-import.

**Files:**
- Create: `server/src/main/java/in/gullak/gamification/BadgeTrigger.java`
- Create (main, `server/src/main/java/in/gullak/ingestion/imports/`): `CommitResult.java`, `MiscCashRequest.java`, `MiscCashResult.java`, `SavingsTransfer.java`, `SavingsTransferListener.java`, `CommitService.java`, `MatchService.java`
- Modify: `StatementTxnRepository.java` (writes), `MerchantRuleService.java` (`learnFromEdit`), `ImportController.java` (commit, misc-cash)
- Modify (Plan 3's files): `server/src/main/java/in/gullak/gamification/XpKind.java` (append `IMPORT_SORTED(10, null)` and `LOGGING_ACCURACY(50, null)`), `server/src/main/java/in/gullak/ingestion/TransactionService.java`, its controller, its entity and response record (hooks below)
- Create (test): `server/src/test/java/in/gullak/support/RecordingBadgeTrigger.java`, `server/src/test/java/in/gullak/support/RecordingSavingsListener.java`, `server/src/test/java/in/gullak/ingestion/imports/CommitApiTest.java`, `UnlinkApiTest.java`

**Interfaces:**
- Consumes: Plan 3's `XpService#award(UUID userId, XpKind kind, String refType, UUID refId): int` (XP earned; 0 when already awarded for that reference) and `enum XpKind(int xp, Integer dailyCap)`; Plan 3's `TransactionService#delete(UUID userId, UUID id)`, its category update path, `POST /api/v1/transactions/{id}/unlink`, `PATCH /api/v1/transactions/{id}` with `{category}`, `DELETE /api/v1/transactions/{id}`, and `ErrorCode.NOT_LINKED`; Tasks 6–8.
- Produces: `POST /api/v1/imports/{id}/commit` → 200 `CommitResult(UUID importId, int created, int matched, int needsReview, int xpAwarded, Integer accuracyPercent, Summary summary, MiscCash miscCash)` with `Summary(int need, int want, int regret)` and `MiscCash(long withdrawnPaise, long loggedPaise, long differencePaise)` (null when nothing to offer); `POST /api/v1/imports/{id}/misc-cash {accept}` → `MiscCashResult(boolean created, UUID transactionId)`; `MatchService#unlink(UUID userId, UUID txnId)` and `#releaseLink(UUID userId, UUID txnId)`; `MerchantRuleService#learnFromEdit(UUID userId, UUID txnId, String category)`; **for Plan 5**: `in.gullak.ingestion.imports.SavingsTransferListener#onSavingsTransfer(SavingsTransfer)` with `SavingsTransfer(UUID userId, UUID transactionId, long amountPaise, LocalDate date)`, called inside the commit transaction for every savings line; **for Plan 6**: `in.gullak.gamification.BadgeTrigger#fire(UUID userId, String trigger, UUID refId)` with `BadgeTrigger.SORTED = "sorted"` and `BadgeTrigger.HONEST_LOGGER = "honest_logger"`, called inside the commit transaction; XP kinds `import_sorted` (10, ref `import`) and `logging_accuracy` (50, ref `import`). Spend responses gain `linkConfidence` (`HIGH`, `MEDIUM` or null).

- [ ] **Step 1: The hooks other plans implement**

Append two kinds to Plan 3's `server/src/main/java/in/gullak/gamification/XpKind.java` (spec 2.6: +10 for sorting a statement, +50 for logging accuracy of 90% or more; no daily cap), after `SPEND_LOGGED(5, 10)`:

```java
    SPEND_LOGGED(5, 10),
    IMPORT_SORTED(10, null),
    LOGGING_ACCURACY(50, null);
```

`server/src/main/java/in/gullak/gamification/BadgeTrigger.java`:

```java
package in.gullak.gamification;

import java.util.UUID;

/**
 * Something happened that may earn a badge. Plan 4 fires these; Plan 6's badge service implements this interface
 * and decides whether a badge is earned (the Sorted badge only the first time). Called inside the caller's
 * transaction. Lives in gamification so ingestion depends on gamification, never the other way round.
 */
public interface BadgeTrigger {
    String SORTED = "sorted";
    String HONEST_LOGGER = "honest_logger";

    void fire(UUID userId, String trigger, UUID refId);
}
```

`SavingsTransfer.java`:

```java
package in.gullak.ingestion.imports;

import java.time.LocalDate;
import java.util.UUID;

/** A statement line that moved money to savings (SIP, RD, FD, mutual fund). Kept out of the daily budget. */
public record SavingsTransfer(UUID userId, UUID transactionId, long amountPaise, LocalDate date) {}
```

`SavingsTransferListener.java`:

```java
package in.gullak.ingestion.imports;

/** Plan 5 implements this to confirm a goal contribution (spec 2.2, MAT-19). Called inside the commit transaction. */
public interface SavingsTransferListener {
    void onSavingsTransfer(SavingsTransfer transfer);
}
```

`server/src/test/java/in/gullak/support/RecordingBadgeTrigger.java`:

```java
package in.gullak.support;

import in.gullak.gamification.BadgeTrigger;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import org.springframework.stereotype.Component;

/** Test-only: records what Plan 4 fires until Plan 6 implements badges. */
@Component
public class RecordingBadgeTrigger implements BadgeTrigger {
    public record Fired(UUID userId, String trigger, UUID refId) {}

    private final ConcurrentLinkedQueue<Fired> fired = new ConcurrentLinkedQueue<>();

    @Override
    public void fire(UUID userId, String trigger, UUID refId) {
        fired.add(new Fired(userId, trigger, refId));
    }

    public List<String> triggersFor(UUID userId) {
        return fired.stream().filter(f -> f.userId().equals(userId)).map(Fired::trigger).toList();
    }
}
```

`server/src/test/java/in/gullak/support/RecordingSavingsListener.java`:

```java
package in.gullak.support;

import in.gullak.ingestion.imports.SavingsTransfer;
import in.gullak.ingestion.imports.SavingsTransferListener;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import org.springframework.stereotype.Component;

/** Test-only: records savings transfers until Plan 5 confirms goal contributions. */
@Component
public class RecordingSavingsListener implements SavingsTransferListener {
    private final ConcurrentLinkedQueue<SavingsTransfer> transfers = new ConcurrentLinkedQueue<>();

    @Override
    public void onSavingsTransfer(SavingsTransfer transfer) {
        transfers.add(transfer);
    }

    public List<SavingsTransfer> transfersFor(UUID userId) {
        return transfers.stream().filter(t -> t.userId().equals(userId)).toList();
    }
}
```

- [ ] **Step 2: Write the failing tests**

`CommitApiTest.java`:

```java
package in.gullak.ingestion.imports;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.gamification.BadgeTrigger;
import in.gullak.support.RecordingBadgeTrigger;
import in.gullak.support.RecordingSavingsListener;
import in.gullak.support.TestUser;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

class CommitApiTest extends ImportTest {
    @Autowired RecordingBadgeTrigger badges;
    @Autowired RecordingSavingsListener savings;

    String draft(TestUser u, byte[] file, String name) throws Exception {
        return importId(upload(u, file, null, name).andExpect(status().isCreated()));
    }

    void tagAll(TestUser u, String id, int howMany) throws Exception {
        String body = mvc.perform(get("/api/v1/imports/" + id + "/to-sort").with(auth(u))).andReturn().getResponse().getContentAsString();
        List<String> ids = JsonPath.read(body, "$.lines[*].lineId");
        for (String lineId : ids.subList(0, Math.min(howMany, ids.size()))) {
            mvc.perform(post("/api/v1/imports/" + id + "/tag").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"lineId\":\"" + lineId + "\",\"tag\":\"NEED\",\"category\":\"eating_out\"}"))
                .andExpect(status().isOk());
        }
    }

    ResultActions commit(TestUser u, String id) throws Exception {
        return mvc.perform(post("/api/v1/imports/" + id + "/commit").with(auth(u)));
    }

    int count(String sql, Object... params) {
        return jdbc.sql(sql).params(params).query(Integer.class).single();
    }

    @Test
    void commitCreatesTransactionsLinksSpendsAndAwardsXp() throws Exception { // API-IMP-23, XP-07, MAT-01
        TestUser u = exampleUser();
        seedExampleSpends(u);
        String id = draft(u, sample("hdfc.pdf"), "s.pdf");
        tagAll(u, id, 14);
        commit(u, id).andExpect(status().isOk())
            .andExpect(jsonPath("$.created").value(84))
            .andExpect(jsonPath("$.matched").value(9))
            .andExpect(jsonPath("$.needsReview").value(0))
            .andExpect(jsonPath("$.xpAwarded").value(10))
            .andExpect(jsonPath("$.summary.need").value(14));
        assertThat(count("select count(*) from transactions where import_id = ?::uuid", id)).isEqualTo(84);
        assertThat(count("select count(*) from transactions where user_id = ? and source = 'manual' and status = 'confirmed'", u.id())).isEqualTo(9);
        assertThat(count("select count(*) from transactions where import_id = ?::uuid and linked_txn_id is not null and not counts_in_budget", id))
            .isEqualTo(9);
        Map<String, Object> coffee = jdbc.sql("""
                select category_code, link_confidence, merchant_raw_enc is not null as has_raw from transactions
                where user_id = ? and source = 'manual' and merchant_name = 'Third Wave'
                """).param(u.id()).query().singleRow();
        assertThat(coffee.get("category_code")).isEqualTo("eating_out");
        assertThat(coffee.get("link_confidence")).isEqualTo("high");
        assertThat(coffee.get("has_raw")).isEqualTo(true);
        assertThat(count("select count(*) from xp_events where user_id = ? and kind = 'IMPORT_SORTED'", u.id())).isEqualTo(1);
        assertThat(badges.triggersFor(u.id())).contains(BadgeTrigger.SORTED).doesNotContain(BadgeTrigger.HONEST_LOGGER);
        assertThat(count("select count(*) from import_lines where import_id = ?::uuid", id)).isZero();
        assertThat(count("select count(*) from transactions where import_id = ?::uuid and fixed_cost_id is not null and not counts_in_budget", id))
            .isEqualTo(3);
        mvc.perform(get("/api/v1/imports/latest").with(auth(u))).andExpect(status().isOk())
            .andExpect(jsonPath("$.bankLabel").value("HDFC")).andExpect(jsonPath("$.count").value(84));
    }

    @Test
    void commitTwiceConflicts() throws Exception { // API-IMP-24
        TestUser u = exampleUser();
        String id = draft(u, sample("hdfc.pdf"), "s.pdf");
        commit(u, id).andExpect(status().isOk());
        commit(u, id).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ALREADY_COMMITTED"));
    }

    @Test
    void parallelCommitsCommitOnce() throws Exception {
        TestUser u = exampleUser();
        String id = draft(u, sample("hdfc.pdf"), "s.pdf");
        List<Integer> statuses = new ArrayList<>();
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            List<Future<Integer>> results = new ArrayList<>();
            for (int i = 0; i < 2; i++) {
                Callable<Integer> call = () -> commit(u, id).andReturn().getResponse().getStatus();
                results.add(pool.submit(call));
            }
            for (Future<Integer> f : results) {
                statuses.add(f.get());
            }
        }
        assertThat(statuses).containsExactlyInAnyOrder(200, 409);
        assertThat(count("select count(*) from transactions where import_id = ?::uuid", id)).isEqualTo(84);
    }

    @Test
    void untaggedLinesAreSavedAsOtherForReview() throws Exception { // API-IMP-25
        TestUser u = exampleUser();
        String id = draft(u, sample("hdfc.pdf"), "s.pdf");
        tagAll(u, id, 10);
        commit(u, id).andExpect(status().isOk()).andExpect(jsonPath("$.needsReview").value(4)).andExpect(jsonPath("$.xpAwarded").value(0));
        assertThat(count("select count(*) from transactions where import_id = ?::uuid and needs_review and category_code = 'other'", id))
            .isEqualTo(4);
        assertThat(badges.triggersFor(u.id())).doesNotContain(BadgeTrigger.SORTED);
    }

    @Test
    void nothingCanChangeAfterCommit() throws Exception { // API-IMP-27
        TestUser u = exampleUser();
        String id = draft(u, sample("hdfc.pdf"), "s.pdf");
        commit(u, id).andExpect(status().isOk());
        mvc.perform(post("/api/v1/imports/" + id + "/discard").with(auth(u)))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ALREADY_COMMITTED"));
        mvc.perform(post("/api/v1/imports/" + id + "/undo-tag").with(auth(u))).andExpect(status().isConflict());
    }

    @Test
    void anotherUsersCommitIsNotFound() throws Exception { // API-IMP-28
        String id = draft(exampleUser(), sample("hdfc.pdf"), "s.pdf");
        commit(signIn(), id).andExpect(status().isNotFound());
    }

    @Test
    void theSameStatementTwiceImportsNothingNew() throws Exception { // API-IMP-14, MAT-21
        TestUser u = exampleUser();
        commit(u, draft(u, sample("hdfc.pdf"), "s.pdf")).andExpect(status().isOk());
        upload(u, sample("hdfc.pdf"), null).andExpect(status().isCreated())
            .andExpect(jsonPath("$.count").value(0)).andExpect(jsonPath("$.alreadyImported").value(84));
    }

    @Test
    void identicalLinesOnOneDayBothImportOnceAndReuploadSkipsBoth() throws Exception { // Review Focus
        TestUser u = exampleUser();
        byte[] chai = csv("Date,Description,Debit,Credit\n14/10/2026,UPI/RAJU CHAI,20.00,\n14/10/2026,UPI/RAJU CHAI,20.00,\n");
        commit(u, draft(u, chai, "c.csv")).andExpect(status().isOk()).andExpect(jsonPath("$.created").value(2));
        upload(u, chai, null, "c.csv").andExpect(jsonPath("$.count").value(0)).andExpect(jsonPath("$.alreadyImported").value(2));
    }

    @Test
    void unmatchedLoggedSpendsOnCoveredDaysBecomeCash() throws Exception { // MAT-13
        TestUser u = exampleUser();
        UUID chai = seedManual(u, 60, "2026-10-11T10:00", "upi", "Chai", "eating_out");
        UUID late = seedManual(u, 60, "2026-10-23T10:00", "upi", "Chai", "eating_out");
        String id = draft(u, csv("Date,Description,Debit,Credit\n01/10/2026,UPI/SWIGGY/swiggy@icici,389.00,\n14/10/2026,UPI/ZEPTO/zepto@ybl,312.00,\n"), "c.csv");
        commit(u, id).andExpect(status().isOk());
        assertThat(jdbc.sql("select payment_method || '/' || status from transactions where id = ?").param(chai).query(String.class).single())
            .isEqualTo("cash/pending");
        assertThat(jdbc.sql("select payment_method from transactions where id = ?").param(late).query(String.class).single()).isEqualTo("upi");
    }

    @Test
    void atmCashBeyondLoggedCashIsOfferedOnce() throws Exception { // MAT-14, MAT-15, API-IMP-33
        TestUser u = exampleUser();
        seedManual(u, 900, "2026-10-14T13:00", "cash", "Vegetables", "groceries");
        seedManual(u, 500, "2026-10-15T13:00", "cash", "Auto", "travel");
        String id = draft(u, csv("Date,Description,Debit,Credit\n13/10/2026,ATM WDL-ATM CASH MG ROAD,\"2,000.00\",\n20/10/2026,UPI/ZEPTO/zepto@ybl,312.00,\n"), "c.csv");
        commit(u, id).andExpect(status().isOk())
            .andExpect(jsonPath("$.miscCash.withdrawnPaise").value(200_000))
            .andExpect(jsonPath("$.miscCash.loggedPaise").value(140_000))
            .andExpect(jsonPath("$.miscCash.differencePaise").value(60_000));
        assertThat(count("select count(*) from transactions where import_id = ?::uuid and transfer_kind = 'atm' and not counts_in_budget", id))
            .isEqualTo(1);
        mvc.perform(post("/api/v1/imports/" + id + "/misc-cash").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{\"accept\":true}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.created").value(true));
        mvc.perform(post("/api/v1/imports/" + id + "/misc-cash").with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{\"accept\":true}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.created").value(false));
        assertThat(count("select count(*) from transactions where user_id = ? and merchant_name = 'Misc cash' and amount_paise = 60000 "
            + "and payment_method = 'cash' and counts_in_budget", u.id())).isEqualTo(1);
    }

    @Test
    void aConfirmedPayeeIsRecognisedNextMonth() throws Exception { // MAT-17
        TestUser u = exampleUser();
        String body = upload(u, csv("Date,Description,Debit,Credit\n05/10/2026,UPI to ramesh@okaxis,\"10,000.00\",\n14/10/2026,UPI/ZEPTO/zepto@ybl,312.00,\n"),
            null, "oct.csv").andReturn().getResponse().getContentAsString();
        String oct = JsonPath.read(body, "$.importId");
        List<String> rent = JsonPath.read(body, "$.fixedQuestions[?(@.fixedCostName == 'Rent')].lineId");
        mvc.perform(post("/api/v1/imports/" + oct + "/fixed-answer").with(auth(u)).contentType(MediaType.APPLICATION_JSON)
            .content("{\"lineId\":\"" + rent.getFirst() + "\",\"yes\":true}")).andExpect(status().isOk());
        commit(u, oct).andExpect(status().isOk());
        clock.set(Instant.parse("2026-11-16T08:00:00Z"));
        String nov = importId(upload(u, csv("Date,Description,Debit,Credit\n05/11/2026,UPI to ramesh@okaxis,\"10,000.00\",\n14/11/2026,UPI/ZEPTO/zepto@ybl,280.00,\n"),
                null, "nov.csv")
            .andExpect(status().isCreated()).andExpect(jsonPath("$.fixed").value(1)).andExpect(jsonPath("$.fixedQuestions.length()").value(0)));
        commit(u, nov).andExpect(status().isOk());
        String rentId = jdbc.sql("select id::text from fixed_costs where user_id = ? and name = 'Rent'").param(u.id()).query(String.class).single();
        assertThat(count("select count(*) from transactions where import_id = ?::uuid and fixed_cost_id = ?::uuid and not counts_in_budget",
            nov, rentId)).isEqualTo(1);
    }

    @Test
    void aSavingsTransferStaysOutOfTheBudgetAndCallsTheGoalHook() throws Exception { // MAT-19 (Plan 4 half)
        TestUser u = exampleUser();
        String id = draft(u, csv("Date,Description,Debit,Credit\n07/10/2026,NEFT to SBI SIP-SIP MUTUAL FUND,\"6,700.00\",\n14/10/2026,UPI/ZEPTO/zepto@ybl,312.00,\n"), "c.csv");
        commit(u, id).andExpect(status().isOk());
        assertThat(count("select count(*) from transactions where import_id = ?::uuid and transfer_kind = 'savings' and not counts_in_budget", id))
            .isEqualTo(1);
        assertThat(savings.transfersFor(u.id())).singleElement().satisfies(t -> assertThat(t.amountPaise()).isEqualTo(670_000));
    }

    @Test
    void ninetyPercentLoggingEarnsTheBonus() throws Exception { // MAT-20
        TestUser u = exampleUser();
        seedExampleSpends(u);
        String statement = """
            Date,Description,Debit,Credit
            04/10/2026,UPI/SWIGGY/swiggy@icici,389.00,
            06/10/2026,UPI/ZEPTO/zepto@ybl,312.00,
            09/10/2026,UPI/THIRDWAVECOFFEE/okhdfc,250.00,
            10/10/2026,UPI/UBER INDIA/uber@icici,246.00,
            12/10/2026,UPI/STARBUCKS/starbucks@hdfcbank,410.00,
            15/10/2026,UPI/BLINKIT/blinkit@icici,520.00,
            17/10/2026,POS AMAZON RETAIL CARD 4012,"1,499.00",
            18/10/2026,UPI/RAPIDO/rapido@ybl,85.00,
            20/10/2026,UPI/ZOMATO/zomato@hdfcbank,455.00,
            21/10/2026,UPI/BIGBASKET/bigbasket@hdfcbank,640.00,
            """;
        commit(u, draft(u, statement.getBytes(StandardCharsets.UTF_8), "c.csv")).andExpect(status().isOk())
            .andExpect(jsonPath("$.matched").value(9)).andExpect(jsonPath("$.accuracyPercent").value(90))
            .andExpect(jsonPath("$.xpAwarded").value(60));
        assertThat(count("select count(*) from xp_events where user_id = ? and kind = 'LOGGING_ACCURACY' and xp = 50", u.id())).isEqualTo(1);
        assertThat(badges.triggersFor(u.id())).contains(BadgeTrigger.HONEST_LOGGER);
    }

    @Test
    void statementTextIsCiphertextInTheDatabase() throws Exception { // SEC-02
        TestUser u = exampleUser();
        commit(u, draft(u, sample("hdfc.pdf"), "s.pdf")).andExpect(status().isOk());
        byte[] raw = jdbc.sql("select merchant_raw_enc from transactions where user_id = ? and merchant_name = 'Murugan Tea Stall'")
            .param(u.id()).query(byte[].class).single();
        assertThat(new String(raw, StandardCharsets.ISO_8859_1)).doesNotContain("MURUGAN").doesNotContain("TEA");
        assertThat(cipher.decrypt(u.id(), raw)).isEqualTo("UPI/MURUGAN TEA STALL");
        assertThat(count("select count(*) from transactions where user_id = ? and source = 'statement' "
            + "and convert_from(merchant_raw_enc, 'LATIN1') like '%MURUGAN%'", u.id())).isZero();
    }
}
```

`UnlinkApiTest.java` (exercises Plan 3's routes through this task's hooks):

```java
package in.gullak.ingestion.imports;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.TestUser;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class UnlinkApiTest extends ImportTest {
    static final String COFFEE = "Date,Description,Debit,Credit\n09/10/2026,UPI/THIRDWAVECOFFEE/okhdfc,250.00,\n14/10/2026,UPI/KAKA DHABA,150.00,\n";

    UUID linkedCoffee(TestUser u) throws Exception {
        UUID spend = seedManual(u, 250, "2026-10-09T09:12", "upi", "Third Wave", "eating_out");
        String id = importId(upload(u, csv(COFFEE), null, "c.csv").andExpect(status().isCreated()));
        mvc.perform(post("/api/v1/imports/" + id + "/commit").with(auth(u))).andExpect(status().isOk());
        return spend;
    }

    Map<String, Object> row(UUID id) {
        return jdbc.sql("select status, linked_txn_id, counts_in_budget, payment_method from transactions where id = ?").param(id).query().singleRow();
    }

    UUID lineOf(UUID spend) {
        return jdbc.sql("select id from transactions where linked_txn_id = ?").param(spend).query(UUID.class).single();
    }

    @Test
    void unlinkSeparatesTheTwoRecords() throws Exception { // MAT-12, API-SP-34
        TestUser u = exampleUser();
        UUID spend = linkedCoffee(u);
        UUID line = lineOf(spend);
        assertThat(row(spend).get("status")).isEqualTo("confirmed");
        assertThat(jdbc.sql("select count(*) from merchant_pairs where user_id = ?").param(u.id()).query(Integer.class).single()).isEqualTo(1);
        mvc.perform(post("/api/v1/transactions/" + spend + "/unlink").with(auth(u))).andExpect(status().isOk());
        assertThat(row(spend)).containsEntry("status", "pending").containsEntry("linked_txn_id", null);
        assertThat(row(line)).containsEntry("status", "statement_only").containsEntry("counts_in_budget", true).containsEntry("linked_txn_id", null);
        assertThat(jdbc.sql("select count(*) from merchant_pairs where user_id = ?").param(u.id()).query(Integer.class).single()).isZero();
        mvc.perform(post("/api/v1/transactions/" + spend + "/unlink").with(auth(u)))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NOT_LINKED"));
    }

    @Test
    void anotherUsersUnlinkIsNotFound() throws Exception {
        UUID spend = linkedCoffee(exampleUser());
        mvc.perform(post("/api/v1/transactions/" + spend + "/unlink").with(auth(signIn()))).andExpect(status().isNotFound());
    }

    @Test
    void deletingALinkedSpendKeepsTheBankLine() throws Exception { // API-SP-33
        TestUser u = exampleUser();
        UUID spend = linkedCoffee(u);
        UUID line = lineOf(spend);
        mvc.perform(delete("/api/v1/transactions/" + spend).with(auth(u))).andExpect(status().isNoContent());
        assertThat(row(line)).containsEntry("status", "statement_only").containsEntry("counts_in_budget", true);
    }

    @Test
    void editingTheCategoryOfAStatementSpendTeachesARule() throws Exception { // API-SP-27
        TestUser u = exampleUser();
        linkedCoffee(u);
        UUID kaka = jdbc.sql("select id from transactions where user_id = ? and merchant_name = 'Kaka Dhaba'").param(u.id()).query(UUID.class).single();
        mvc.perform(patch("/api/v1/transactions/" + kaka).with(auth(u)).contentType(MediaType.APPLICATION_JSON).content("{\"category\":\"eating_out\"}"))
            .andExpect(status().isOk());
        assertThat(jdbc.sql("select category_code from merchant_rules where user_id = ?").param(u.id()).query(String.class).list())
            .containsExactly("eating_out");
    }

    @Test
    void aLearnedPairLinksWithHighConfidenceNextTime() throws Exception { // MAT-11 end to end
        TestUser u = exampleUser();
        UUID first = seedManual(u, 250, "2026-10-09T09:12", "upi", "TW", "eating_out");
        String a = importId(upload(u, csv("Date,Description,Debit,Credit\n09/10/2026,UPI/THIRDWAVECOFFEE/okhdfc,250.00,\n14/10/2026,UPI/X,1.00,\n"),
            null, "a.csv"));
        mvc.perform(post("/api/v1/imports/" + a + "/commit").with(auth(u))).andExpect(status().isOk());
        assertThat(jdbc.sql("select link_confidence from transactions where id = ?").param(first).query(String.class).single()).isEqualTo("medium");
        UUID second = seedManual(u, 250, "2026-10-21T09:00", "upi", "TW", "eating_out");
        String b = importId(upload(u, csv("Date,Description,Debit,Credit\n21/10/2026,UPI/THIRDWAVECOFFEE/okhdfc,250.00,\n14/10/2026,UPI/Y,2.00,\n"),
            null, "b.csv"));
        mvc.perform(post("/api/v1/imports/" + b + "/commit").with(auth(u))).andExpect(status().isOk());
        assertThat(jdbc.sql("select link_confidence from transactions where id = ?").param(second).query(String.class).single()).isEqualTo("high");
    }
}
```

- [ ] **Step 3: Run to see them fail**

Run: `cd server && ./gradlew test --tests 'in.gullak.ingestion.imports.CommitApiTest' --tests 'in.gullak.ingestion.imports.UnlinkApiTest'`
Expected: 404 on `/commit`; `UnlinkApiTest` fails on `NOT_LINKED` before the hooks are in.

- [ ] **Step 4: Writes in `StatementTxnRepository`**

Add to `StatementTxnRepository.java` (imports: `in.gullak.common.db.Db`, `java.util.Optional`, `java.util.Collection`):

```java
    record StatementTxn(UUID userId, long amountPaise, String direction, Instant occurredAt, String merchantName,
                        byte[] merchantRawEnc, String merchantKeyHash, String categoryCode, String tag, String paymentMethod,
                        boolean countsInBudget, UUID fixedCostId, String transferKind, UUID importId, String fingerprint,
                        boolean needsReview) {}

    record LinkRow(UUID id, String source, UUID linkedTxnId) {}

    /** Empty when another import already brought in this line (same fingerprint): never a duplicate, never an error. */
    Optional<UUID> insertStatementTxn(StatementTxn t) {
        return jdbc.sql("""
                insert into transactions (id, user_id, amount_paise, direction, occurred_at, merchant_name, merchant_raw_enc,
                    merchant_key_hash, category_code, tag, payment_method, source, status, counts_in_budget, fixed_cost_id,
                    transfer_kind, import_id, fingerprint, needs_review)
                values (:id, :user, :amount, :direction, :at, :name, :raw, :hash, :category, :tag, :method, 'statement',
                    'statement_only', :counts, :fixed, :transfer, :import, :fp, :review)
                on conflict (user_id, fingerprint) where fingerprint is not null do nothing
                returning id
                """)
            .param("id", UUID.randomUUID()).param("user", t.userId()).param("amount", t.amountPaise())
            .param("direction", t.direction()).param("at", Db.ts(t.occurredAt())).param("name", t.merchantName())
            .param("raw", t.merchantRawEnc()).param("hash", t.merchantKeyHash()).param("category", t.categoryCode())
            .param("tag", t.tag()).param("method", t.paymentMethod()).param("counts", t.countsInBudget())
            .param("fixed", t.fixedCostId()).param("transfer", t.transferKind()).param("import", t.importId())
            .param("fp", t.fingerprint()).param("review", t.needsReview())
            .query(UUID.class).optional();
    }

    /** Confirms a logged spend only if it is still pending and not deleted (it may have been edited meanwhile). */
    boolean linkSpend(UUID userId, UUID spendId, UUID lineTxnId, byte[] rawEnc, String keyHash, String confidence) {
        return jdbc.sql("""
                update transactions set status = 'confirmed', linked_txn_id = ?, link_confidence = ?, merchant_raw_enc = ?,
                    merchant_key_hash = ?, updated_at = now()
                where id = ? and user_id = ? and source = 'manual' and status = 'pending' and deleted_at is null
                """)
            .params(lineTxnId, confidence, rawEnc, keyHash, spendId, userId).update() == 1;
    }

    void linkLine(UUID userId, UUID lineTxnId, UUID spendId, String confidence) {
        jdbc.sql("""
                update transactions set status = 'confirmed', counts_in_budget = false, linked_txn_id = ?, link_confidence = ?,
                    updated_at = now()
                where id = ? and user_id = ?
                """)
            .params(spendId, confidence, lineTxnId, userId).update();
    }

    int markCash(UUID userId, Collection<UUID> ids) {
        if (ids.isEmpty()) {
            return 0;
        }
        return jdbc.sql("""
                update transactions set payment_method = 'cash', updated_at = now()
                where user_id = :user and id in (:ids) and status = 'pending' and payment_method <> 'cash' and deleted_at is null
                """)
            .param("user", userId).param("ids", ids).update();
    }

    long cashLogged(UUID userId, LocalDate from, LocalDate to) {
        return jdbc.sql("""
                select coalesce(sum(amount_paise), 0) from transactions
                where user_id = ? and source = 'manual' and payment_method = 'cash' and direction = 'debit'
                  and deleted_at is null and occurred_at >= ? and occurred_at < ?
                """)
            .params(userId, Db.ts(Ist.startOf(from)), Db.ts(Ist.startOf(to.plusDays(1)))).query(Long.class).single();
    }

    UUID insertMiscCash(UUID userId, long paise, Instant at) {
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                insert into transactions (id, user_id, client_id, amount_paise, direction, occurred_at, merchant_name,
                    category_code, payment_method, source, status)
                values (?, ?, ?, ?, 'debit', ?, 'Misc cash', 'other', 'cash', 'manual', 'pending')
                """)
            .params(id, userId, UUID.randomUUID(), paise, Db.ts(at)).update();
        return id;
    }

    void savePair(UUID userId, String typedHash, String lineHash) {
        jdbc.sql("insert into merchant_pairs (user_id, typed_hash, line_hash) values (?, ?, ?) on conflict do nothing")
            .params(userId, typedHash, lineHash).update();
    }

    void deletePair(UUID userId, String typedHash, String lineHash) {
        jdbc.sql("delete from merchant_pairs where user_id = ? and typed_hash = ? and line_hash = ?")
            .params(userId, typedHash, lineHash).update();
    }

    Optional<LinkRow> linkRow(UUID userId, UUID id) {
        return jdbc.sql("select id, source, linked_txn_id from transactions where id = ? and user_id = ? and deleted_at is null")
            .params(id, userId)
            .query((rs, n) -> new LinkRow(rs.getObject("id", UUID.class), rs.getString("source"), rs.getObject("linked_txn_id", UUID.class)))
            .optional();
    }

    Optional<String> merchantNameOf(UUID userId, UUID id) {
        return jdbc.sql("select merchant_name from transactions where id = ? and user_id = ?").params(id, userId)
            .query(String.class).optional();
    }

    Optional<String> keyHashOf(UUID userId, UUID id) {
        return jdbc.sql("select merchant_key_hash from transactions where id = ? and user_id = ? and merchant_key_hash is not null")
            .params(id, userId).query(String.class).optional();
    }

    void unlinkManual(UUID userId, UUID id) {
        jdbc.sql("""
                update transactions set status = 'pending', linked_txn_id = null, link_confidence = null, merchant_raw_enc = null,
                    merchant_key_hash = null, updated_at = now()
                where id = ? and user_id = ?
                """)
            .params(id, userId).update();
    }

    void unlinkLine(UUID userId, UUID id) {
        jdbc.sql("""
                update transactions set status = 'statement_only', counts_in_budget = true, linked_txn_id = null,
                    link_confidence = null, updated_at = now()
                where id = ? and user_id = ?
                """)
            .params(id, userId).update();
    }
```

If Plan 3's `transactions` table has a `version` column for optimistic locking, add `version = version + 1` to every `update` above.

- [ ] **Step 5: Commit, misc cash, unlink and the rule from an edit**

`CommitResult.java`:

```java
package in.gullak.ingestion.imports;

import java.util.UUID;

public record CommitResult(UUID importId, int created, int matched, int needsReview, int xpAwarded, Integer accuracyPercent,
                           Summary summary, MiscCash miscCash) {
    public record Summary(int need, int want, int regret) {}

    /** "You took out ₹2,000 in cash and logged ₹1,400": offered once, after commit (spec 2.5). */
    public record MiscCash(long withdrawnPaise, long loggedPaise, long differencePaise) {}
}
```

`MiscCashRequest.java`:

```java
package in.gullak.ingestion.imports;

import jakarta.validation.constraints.NotNull;

public record MiscCashRequest(@NotNull Boolean accept) {}
```

`MiscCashResult.java`:

```java
package in.gullak.ingestion.imports;

import java.util.UUID;

public record MiscCashResult(boolean created, UUID transactionId) {}
```

`CommitService.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.crypto.FieldCipher;
import in.gullak.common.error.ConflictException;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.NotFoundException;
import in.gullak.common.log.Events;
import in.gullak.common.time.Ist;
import in.gullak.gamification.BadgeTrigger;
import in.gullak.gamification.XpKind;
import in.gullak.gamification.XpService;
import in.gullak.ingestion.categorise.CategoryCodes;
import in.gullak.ingestion.categorise.LineKind;
import in.gullak.ingestion.categorise.MerchantText;
import in.gullak.ingestion.matching.CashCover;
import in.gullak.ingestion.matching.LineCandidate;
import in.gullak.ingestion.matching.Link;
import in.gullak.ingestion.matching.LoggingAccuracy;
import in.gullak.ingestion.matching.Matcher;
import in.gullak.ingestion.matching.PendingSpend;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.OptionalInt;
import java.util.OptionalLong;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Spec 2.3–2.5: a draft becomes transactions, matched spends are confirmed, the rest of the rules apply. */
@Service
public class CommitService {
    private static final Logger log = LoggerFactory.getLogger(CommitService.class);

    private record Rematch(Map<UUID, Link> links, Map<UUID, PendingSpend> spends) {}

    private final StatementImportRepository imports;
    private final ImportLineRepository lines;
    private final StatementTxnRepository txns;
    private final FieldCipher cipher;
    private final XpService xp;
    private final ObjectProvider<BadgeTrigger> badges;
    private final ObjectProvider<SavingsTransferListener> savings;
    private final Clock clock;

    CommitService(StatementImportRepository imports, ImportLineRepository lines, StatementTxnRepository txns, FieldCipher cipher,
                  XpService xp, ObjectProvider<BadgeTrigger> badges, ObjectProvider<SavingsTransferListener> savings, Clock clock) {
        this.imports = imports;
        this.lines = lines;
        this.txns = txns;
        this.cipher = cipher;
        this.xp = xp;
        this.badges = badges;
        this.savings = savings;
        this.clock = clock;
    }

    @Transactional
    public CommitResult commit(UUID userId, UUID importId) {
        StatementImportEntity imp = SortService.draft(imports.lockOwned(importId, userId).orElseThrow(() -> new NotFoundException("Import")));
        List<ImportLineEntity> all = lines.findByImportIdOrderByRowNoAsc(importId);
        Rematch rematch = rematch(userId, all);
        int created = 0;
        int confirmed = 0;
        int statementOnly = 0;
        int needsReview = 0;
        int need = 0;
        int want = 0;
        int regret = 0;
        long withdrawn = 0;
        Set<UUID> linkedSpends = new HashSet<>();
        List<SavingsTransfer> transfers = new ArrayList<>();
        for (ImportLineEntity l : all) {
            LineKind kind = LineKind.valueOf(l.getLineKind().toUpperCase(Locale.ROOT));
            boolean fixed = l.getBucket() == Bucket.FIXED;
            boolean spend = kind == LineKind.SPEND && !fixed;
            boolean untagged = l.getBucket() == Bucket.SORT && l.getTag() == null;
            String category = !spend ? CategoryCodes.OTHER
                : l.getBucket() == Bucket.SORT ? (l.getTag() != null ? l.getChosenCategory() : CategoryCodes.OTHER)
                : l.getCategoryCode() != null ? l.getCategoryCode() : CategoryCodes.OTHER;
            String transfer = switch (kind) {
                case ATM -> "atm";
                case SAVINGS -> "savings";
                case CREDIT -> "credit";
                case SPEND -> null;
            };
            var inserted = txns.insertStatementTxn(new StatementTxnRepository.StatementTxn(userId, l.getAmountPaise(), l.getDirection(),
                noonIst(l.getOccurredOn()), l.getMerchantName(), l.getDescriptionEnc(), l.getMerchantKeyHash(), category,
                l.getTag() == null ? null : l.getTag().db(), l.getPaymentMethod(), spend, fixed ? l.getFixedCostId() : null,
                transfer, importId, l.getFingerprint(), untagged));
            if (inserted.isEmpty()) {
                continue;
            }
            UUID txnId = inserted.get();
            created++;
            if (untagged) {
                needsReview++;
            }
            if (l.getTag() != null) {
                switch (l.getTag()) {
                    case NEED -> need++;
                    case WANT -> want++;
                    case REGRET -> regret++;
                }
            }
            Link link = rematch.links().get(l.getId());
            String confidence = link == null ? null : link.confidence().name().toLowerCase(Locale.ROOT);
            if (link != null && txns.linkSpend(userId, link.spendId(), txnId, l.getDescriptionEnc(), l.getMerchantKeyHash(), confidence)) {
                txns.linkLine(userId, txnId, link.spendId(), confidence);
                PendingSpend s = rematch.spends().get(link.spendId());
                if (s.merchantName() != null && !s.merchantName().isBlank()) {
                    txns.savePair(userId, LinePlanner.typedHash(cipher, userId, s.merchantName()), l.getMerchantKeyHash());
                }
                linkedSpends.add(link.spendId());
                confirmed++;
            } else if (spend && l.getDirection().equals("debit")) {
                statementOnly++;
            }
            if (kind == LineKind.ATM) {
                withdrawn += l.getAmountPaise();
            }
            if (kind == LineKind.SAVINGS) {
                transfers.add(new SavingsTransfer(userId, txnId, l.getAmountPaise(), l.getOccurredOn()));
            }
        }

        CommitResult.MiscCash misc = null;
        LocalDate from = imp.getPeriodFrom();
        LocalDate to = imp.getPeriodTo();
        if (from != null && to != null) {
            List<PendingSpend> unmatched = txns.pendingSpends(userId, from, to).stream().filter(s -> !linkedSpends.contains(s.id())).toList();
            txns.markCash(userId, CashCover.toCash(unmatched, from, to));
            long logged = txns.cashLogged(userId, from, to);
            OptionalLong difference = CashCover.miscCash(withdrawn, logged);
            if (difference.isPresent()) {
                imp.offerMiscCash(difference.getAsLong());
                misc = new CommitResult.MiscCash(withdrawn, logged, difference.getAsLong());
            }
        }
        for (SavingsTransfer t : transfers) {
            savings.orderedStream().forEach(listener -> listener.onSavingsTransfer(t));
        }

        int xpAwarded = 0;
        boolean sorted = all.stream().noneMatch(l -> l.getBucket() == Bucket.SORT && l.getTag() == null);
        if (sorted) {
            xpAwarded += xp.award(userId, XpKind.IMPORT_SORTED, "import", importId);
            badges.orderedStream().forEach(b -> b.fire(userId, BadgeTrigger.SORTED, importId));
        }
        OptionalInt accuracy = LoggingAccuracy.percent(confirmed, statementOnly);
        if (LoggingAccuracy.earnsBonus(accuracy)) {
            xpAwarded += xp.award(userId, XpKind.LOGGING_ACCURACY, "import", importId);
            badges.orderedStream().forEach(b -> b.fire(userId, BadgeTrigger.HONEST_LOGGER, importId));
        }

        imp.commit(clock.instant(), confirmed);
        lines.deleteByImport(importId);
        log.info("{} user={} id={} created={} matched={} review={}", Events.IMPORT_COMMITTED, userId, importId, created, confirmed, needsReview);
        return new CommitResult(importId, created, confirmed, needsReview, xpAwarded,
            accuracy.isPresent() ? accuracy.getAsInt() : null, new CommitResult.Summary(need, want, regret), misc);
    }

    @Transactional
    public MiscCashResult miscCash(UUID userId, UUID importId, boolean accept) {
        StatementImportEntity imp = imports.lockOwned(importId, userId).orElseThrow(() -> new NotFoundException("Import"));
        if (!imp.is(ImportStatus.COMMITTED)) {
            throw new NotFoundException("Import");
        }
        if (imp.getMiscCashPaise() == null || imp.isMiscCashAnswered()) {
            return new MiscCashResult(false, null);
        }
        imp.answerMiscCash();
        if (!accept) {
            return new MiscCashResult(false, null);
        }
        UUID id = txns.insertMiscCash(userId, imp.getMiscCashPaise(), noonIst(imp.getPeriodTo()));
        log.info("{} user={} id={} source=misc_cash", Events.SPEND_CREATED, userId, id);
        return new MiscCashResult(true, id);
    }

    /** Re-runs matching for the lines matched at preview, against the spends as they are now (decision 14). */
    private Rematch rematch(UUID userId, List<ImportLineEntity> all) {
        List<LineCandidate> candidates = all.stream().filter(l -> l.getBucket() == Bucket.MATCHED).map(l -> {
            String key = MerchantText.key(cipher.decrypt(userId, l.getDescriptionEnc()));
            return new LineCandidate(l.getId(), l.getRowNo(), l.getOccurredOn(), l.getAmountPaise(), l.getPaymentMethod(),
                MerchantText.squash(key), l.getMerchantKeyHash(), l.getCategoryCode());
        }).toList();
        if (candidates.isEmpty()) {
            return new Rematch(Map.of(), Map.of());
        }
        LocalDate from = candidates.stream().map(LineCandidate::date).min(Comparator.naturalOrder()).orElseThrow();
        LocalDate to = candidates.stream().map(LineCandidate::date).max(Comparator.naturalOrder()).orElseThrow();
        List<PendingSpend> spends = txns.pendingSpends(userId, from.minusDays(3), to);
        Set<String> pairs = txns.learnedPairs(userId);
        Map<UUID, Link> links = new HashMap<>();
        for (Link link : Matcher.match(candidates, spends, (s, l) -> s.merchantName() != null
            && pairs.contains(LinePlanner.typedHash(cipher, userId, s.merchantName()) + "|" + l.keyHash()))) {
            links.put(link.lineId(), link);
        }
        Map<UUID, PendingSpend> byId = new HashMap<>();
        spends.forEach(s -> byId.put(s.id(), s));
        return new Rematch(links, byId);
    }

    private static Instant noonIst(LocalDate date) {
        return Ist.startOf(date).plus(Duration.ofHours(12));
    }
}
```

`MatchService.java`:

```java
package in.gullak.ingestion.imports;

import in.gullak.common.crypto.FieldCipher;
import in.gullak.common.error.ConflictException;
import in.gullak.common.error.ErrorCode;
import in.gullak.common.error.NotFoundException;
import in.gullak.common.log.Events;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Undoing a link (spec 2.5: every link can be undone from the spend detail), from either side of it. */
@Service
public class MatchService {
    private static final Logger log = LoggerFactory.getLogger(MatchService.class);

    private final StatementTxnRepository txns;
    private final FieldCipher cipher;

    MatchService(StatementTxnRepository txns, FieldCipher cipher) {
        this.txns = txns;
        this.cipher = cipher;
    }

    /** MAT-12: two records again, the spend back to pending, the line statement-only, the learned pair forgotten. */
    @Transactional
    public void unlink(UUID userId, UUID txnId) {
        StatementTxnRepository.LinkRow row = txns.linkRow(userId, txnId).orElseThrow(() -> new NotFoundException("Spend"));
        if (row.linkedTxnId() == null) {
            throw new ConflictException(ErrorCode.NOT_LINKED, "This spend isn't linked to a bank line");
        }
        release(userId, row);
    }

    /** Called by Plan 3's delete before it soft-deletes either side of a link (API-SP-33). No-op when not linked. */
    @Transactional
    public void releaseLink(UUID userId, UUID txnId) {
        txns.linkRow(userId, txnId).filter(r -> r.linkedTxnId() != null).ifPresent(r -> release(userId, r));
    }

    private void release(UUID userId, StatementTxnRepository.LinkRow row) {
        UUID manual = "manual".equals(row.source()) ? row.id() : row.linkedTxnId();
        UUID line = manual.equals(row.id()) ? row.linkedTxnId() : row.id();
        Optional<String> typed = txns.merchantNameOf(userId, manual);
        Optional<String> lineHash = txns.keyHashOf(userId, line);
        txns.unlinkManual(userId, manual);
        txns.unlinkLine(userId, line);
        if (typed.isPresent() && lineHash.isPresent()) {
            txns.deletePair(userId, LinePlanner.typedHash(cipher, userId, typed.get()), lineHash.get());
        }
        log.info("{} user={} id={}", Events.SPEND_UNLINKED, userId, manual);
    }
}
```

Add to `MerchantRuleService.java` (new constructor parameter and field `StatementTxnRepository txns`):

```java
    /** Spec 2.4: changing the category of a statement spend teaches a rule that wins next time (API-SP-27). */
    @Transactional
    public void learnFromEdit(UUID userId, UUID txnId, String category) {
        txns.keyHashOf(userId, txnId).ifPresent(hash -> rules.upsert(userId, hash, category));
    }
```

In `ImportController.java`, add a `CommitService commits` constructor parameter and field and the routes:

```java
    @PostMapping("/{id}/commit")
    CommitResult commit(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return commits.commit(CurrentUser.id(jwt), id);
    }

    @PostMapping("/{id}/misc-cash")
    MiscCashResult miscCash(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody MiscCashRequest body) {
        return commits.miscCash(CurrentUser.id(jwt), id, body.accept());
    }
```

- [ ] **Step 6: Hook Plan 3's spends into links and rules**

Plan 3's code is in `in.gullak.ingestion` (one package up from `imports`, the same ArchUnit slice). Make these four edits there, adapting names if Plan 3 used others, and note each in the task report:

1. `TransactionService`: add `MatchService matches` and `MerchantRuleService rules` constructor parameters. In `delete(UUID userId, UUID id)`, after the row is found and before it is soft-deleted:

```java
        matches.releaseLink(userId, id);
```

2. In the update path, after the category has been changed on a row whose `source` is `statement` or that is linked:

```java
        if (patch.category() != null && !patch.category().equals(previousCategory)) {
            rules.learnFromEdit(userId, id, patch.category());
        }
```

3. In the controller, the body of the `POST /transactions/{id}/unlink` handler becomes:

```java
        matches.unlink(CurrentUser.id(jwt), id);
        return transactions.get(CurrentUser.id(jwt), id);
```

(inject `MatchService` into the controller; it is a service, so the controller rules hold).

4. The transaction entity gains `@Column(name = "link_confidence", length = 6) private String linkConfidence;`, and the spend response record gains `String linkConfidence` filled with `linkConfidence == null ? null : linkConfidence.toUpperCase(Locale.ROOT)`. The list query `GET /transactions` excludes the statement side of a link: add `and not (source = 'statement' and linked_txn_id is not null)` (or the JPA equivalent), so a confirmed spend shows once.

- [ ] **Step 7: Run the tests**

Run: `cd server && ./gradlew test`
Expected: PASS, including Plan 3's spend tests (a delete of an unlinked spend is unchanged by `releaseLink`).

- [ ] **Step 8: Red team**

Dispatch `red-team` with task id `plan-04-task-9`: the attacks in this task's header, plus: does any endpoint return `merchant_raw_enc` or its decryption for a committed transaction (it must not; only `to-sort` shows raw text, and only for drafts); is `merchant_raw_enc` ciphertext in a `pg_dump`; can a user link their spend to another user's line through a crafted import (no: every query filters by user). Findings to `docs/reports/red-team/plan-04-task-9.md`; a High or Critical finding is fixed in this task.

- [ ] **Step 9: Commit**

```bash
git add server/src/main/java/in/gullak/gamification/BadgeTrigger.java server/src/main/java/in/gullak/ingestion \
  server/src/test/java/in/gullak/support server/src/test/java/in/gullak/ingestion/imports
git commit -m "feat(server): commit statements, confirm logged spends, unlink, misc cash, savings and badge hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Security sweep, docs and test-case edits

**Owner:** qa-engineer. **Test IDs:** SEC-10, SEC-11 (over HTTP), API-X-01 (every import route), LOG-03 and LOG-05 (imports), API-IMP-35 (new: latest import), API-IMP-36 (new: the file name is never stored or logged; path traversal in it is harmless). **Red team:** yes: a final pass over the whole upload surface with everything in Tasks 2, 4, 7, 8 and 9 re-run against the integrated build.

**Files:**
- Create: `server/src/test/java/in/gullak/security/ImportSecurityApiTest.java`
- Modify: `README.md` (configuration table), `docs/engineering-standards.md` (event vocabulary), `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md` (rows below)

**Interfaces:**
- Consumes: everything in Tasks 1–9 and `ImportTest`.
- Produces: the regression net for the upload surface; documentation of `GULLAK_ENC_KEY` and the `gullak.imports.*` settings.

- [ ] **Step 1: Write the sweep**

`server/src/test/java/in/gullak/security/ImportSecurityApiTest.java`:

```java
package in.gullak.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import in.gullak.ingestion.imports.ImportTest;
import in.gullak.ingestion.statements.samples.HdfcSample;
import in.gullak.ingestion.statements.samples.SpecialSamples;
import in.gullak.support.TestUser;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;

@ExtendWith(OutputCaptureExtension.class)
class ImportSecurityApiTest extends ImportTest {
    static final String JSON = MediaType.APPLICATION_JSON_VALUE;

    @Test
    void everyImportRouteAnswers404ToAnotherUser() throws Exception { // API-X-01, API-IMP-17, API-IMP-28
        TestUser owner = exampleUser();
        TestUser other = signIn();
        String id = importId(upload(owner, sample("hdfc.pdf"), null).andExpect(status().isCreated()));
        String body = "{\"lineId\":\"00000000-0000-4000-8000-000000000000\",\"tag\":\"NEED\",\"category\":\"other\"}";
        mvc.perform(get("/api/v1/imports/" + id).with(auth(other))).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/imports/" + id + "/to-sort").with(auth(other))).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/imports/" + id + "/tag").with(auth(other)).contentType(JSON).content(body)).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/imports/" + id + "/undo-tag").with(auth(other))).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/imports/" + id + "/fixed-answer").with(auth(other)).contentType(JSON)
            .content("{\"lineId\":\"00000000-0000-4000-8000-000000000000\",\"yes\":true}")).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/imports/" + id + "/commit").with(auth(other))).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/imports/" + id + "/discard").with(auth(other))).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/imports/" + id + "/misc-cash").with(auth(other)).contentType(JSON).content("{\"accept\":true}"))
            .andExpect(status().isNotFound());
        String mapping = "{\"date\":0,\"description\":1,\"amount\":2,\"drCr\":3,\"dateFormat\":\"YYYY_MM_DD\"}";
        mvc.perform(post("/api/v1/imports/" + id + "/column-map").with(auth(other)).contentType(JSON).content(mapping))
            .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/imports/" + id + "/column-map/preview").with(auth(other)).contentType(JSON).content(mapping))
            .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/imports/" + id + "/to-sort")).andExpect(status().isUnauthorized());
    }

    @Test
    void aHundredUploadsInAMinuteAreRateLimited() throws Exception { // SEC-10
        TestUser u = exampleUser();
        int limited = 0;
        for (int i = 0; i < 100; i++) {
            int code = upload(u, SpecialSamples.png(), null).andReturn().getResponse().getStatus();
            if (code == 429) {
                limited++;
            }
        }
        assertThat(limited).isEqualTo(90);
    }

    @Test
    void fiftyWrongPasswordsStopAtTheLimit(CapturedOutput out) throws Exception { // SEC-10
        TestUser u = exampleUser();
        int wrong = 0;
        for (int i = 0; i < 50; i++) {
            String body = upload(u, sample("hdfc-locked.pdf"), "guess-" + i).andReturn().getResponse().getContentAsString();
            if (body.contains("WRONG_PASSWORD")) {
                wrong++;
            }
        }
        assertThat(wrong).isEqualTo(10);
        assertThat(out.getAll()).doesNotContain("guess-7");
    }

    @Test
    void javascriptInAPdfIsInertOverHttp() throws Exception { // SEC-11
        upload(exampleUser(), SpecialSamples.javascript(), null).andExpect(status().isCreated()).andExpect(jsonPath("$.count").value(84));
    }

    @Test
    void fileNamesAreNeverStoredOrLogged(CapturedOutput out) throws Exception { // API-IMP-36
        TestUser u = exampleUser();
        upload(u, sample("hdfc.pdf"), null, "../../etc/passwd-zq81.pdf").andExpect(status().isCreated());
        upload(u, sample("csv/standard-comma.csv"), null, "evil\nname-zq82.csv").andExpect(status().isCreated());
        assertThat(out.getAll()).doesNotContain("zq81").doesNotContain("zq82").doesNotContain("passwd");
    }

    @Test
    void csvFormulasComeBackAsText() throws Exception {
        TestUser u = exampleUser();
        String id = importId(upload(u, sample("csv/formulas.csv"), null, "f.csv").andExpect(status().isCreated()));
        String body = mvc.perform(get("/api/v1/imports/" + id + "/to-sort").with(auth(u))).andReturn().getResponse().getContentAsString();
        List<String> raw = JsonPath.read(body, "$.lines[*].raw");
        assertThat(raw).contains("=HYPERLINK(\"http://evil.test\",\"click\")", "+SUM(1;2)");
    }

    @Test
    void theWholeFlowLeavesNoStatementDataInTheLogs(CapturedOutput out) throws Exception { // LOG-03, LOG-05
        TestUser u = exampleUser();
        seedExampleSpends(u);
        String id = importId(upload(u, sample("hdfc-locked.pdf"), HdfcSample.PASSWORD, "HDFC_Statement_Oct_2026.pdf")
            .andExpect(status().isCreated()));
        String list = mvc.perform(get("/api/v1/imports/" + id + "/to-sort").with(auth(u))).andReturn().getResponse().getContentAsString();
        String first = JsonPath.read(list, "$.lines[0].lineId");
        mvc.perform(post("/api/v1/imports/" + id + "/tag").with(auth(u)).contentType(JSON)
            .content("{\"lineId\":\"" + first + "\",\"tag\":\"NEED\",\"category\":\"eating_out\"}")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/imports/" + id + "/commit").with(auth(u))).andExpect(status().isOk());
        mvc.perform(get("/api/v1/imports/latest").with(auth(u))).andExpect(status().isOk()); // API-IMP-35
        String logs = out.getAll();
        assertThat(logs).contains("import.received user=" + u.id()).contains("import.previewed user=" + u.id())
            .contains("import.committed user=" + u.id());
        assertThat(logs).doesNotContain("MURUGAN").doesNotContain("oksbi").doesNotContain("ramesh").doesNotContain("THIRDWAVE")
            .doesNotContain(HdfcSample.PASSWORD).doesNotContain("HDFC_Statement_Oct_2026").doesNotContain("149900")
            .doesNotContain("1,499.00").doesNotContain("Kaka Dhaba");
    }
}
```

`ImportTest` is public and its helpers are protected, so this test in `in.gullak.security` can extend it.

- [ ] **Step 2: Run it**

Run: `cd server && ./gradlew test --tests 'in.gullak.security.ImportSecurityApiTest'`
Expected: PASS against Tasks 1–9. A failure here is a bug in the task that owns the code; send it back with the failing test.

- [ ] **Step 3: Docs**

In `README.md`'s server configuration table add:

| Setting | Env var | Default | Notes |
|---|---|---|---|
| `gullak.crypto.key` | `GULLAK_ENC_KEY` | none (required) | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts statement text; prod refuses the test key. Losing it makes stored statement text unreadable. |
| `gullak.imports.max-file-size` | | `10MB` | Keep equal to `spring.servlet.multipart.max-file-size`. |
| `gullak.imports.parse-timeout` | | `10s` | A slower file is UNREADABLE and its thread is freed. |
| `gullak.imports.parser-threads` | | `2` | |
| `gullak.imports.max-concurrent-uploads` | | `4` | Uploads held in memory at once, server-wide. |
| `gullak.imports.uploads-per-hour` | | `10` | Per user. |
| `gullak.imports.max-lines` / `max-pages` / `max-decoded-bytes` / `max-glyphs-per-page` | | `5000` / `100` / `32MB` / `50000` | Parser limits (spec 4.7). |

and under local setup: "Set `GULLAK_ENC_KEY` as well: `export GULLAK_ENC_KEY=$(openssl rand -base64 32)`. Regenerate the statement samples with `./gradlew writeStatementSamples`."

In `docs/engineering-standards.md` section 1, add `import.failed` and `bank.requested` to the event vocabulary list.

- [ ] **Step 4: Test-case edits** (in `docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md`)

- Section 3, after CAT-08, add: `| CAT-09 | Suggestions for unknown lines | "UPI/MURUGAN TEA STALL", "BHARATPE*MOMO POINT", "UPI to priya.s@oksbi" | chips ending in Other and a hint: café; food stall; person with UPI to people first |`
- MAT-19 Expected becomes: `transfer kept out of the budget (counts_in_budget false); the savings hook is called (the goal contribution is confirmed by Plan 5)`.
- MAT-20 Expected becomes: `90%, +50 XP, Honest logger trigger fired (the badge row is Plan 6)`.
- Section 4, after RD-25, add: `| RD-26 | Decompression bomb | a page whose content inflates to 40 MB | UNREADABLE before text extraction |`
- API-IMP-07 Expected becomes: `422 NEEDS_COLUMN_MAP {importId, headers, sampleRows (first 5), suggestion}`.
- API-IMP-27 Expected becomes: `409 ALREADY_COMMITTED`.
- After API-IMP-31, add:
  - `| API-IMP-32 | Fixed-cost answer | POST /imports/{id}/fixed-answer {lineId, yes} | 200 preview; yes stores the payee on the fixed cost; no moves the line to sort or auto |`
  - `| API-IMP-33 | Misc cash once | POST /imports/{id}/misc-cash {accept true} twice | 200 created true, then 200 created false |`
  - `| API-IMP-34 | Column-map dry run | POST /imports/{id}/column-map/preview | 200 {lines (first 3), unreadable} |`
  - `| API-IMP-35 | Latest import | GET /imports/latest | 200 {bankLabel, from, to, committedAt, count}; 204 before any commit |`
  - `| API-IMP-36 | File name | upload named "../../etc/passwd.pdf" | 201; the name is in no log and no table |`
- Section 9, after APP-31 (Plan 3's row), add:
  - `| APP-32 | CSV column mapping | first 5 rows shown; a chip row per column; 3 parsed lines previewed; "Looks right" enabled only when they all read |`
  - `| APP-33 | Link status on a spend | "Confirmed by bank" with Unlink, or "Linked" with Undo; either unlinks and the spend is pending again |`
- E2E-04 Checks becomes: `Insights → Add a statement → HDFC sample with password → preview → sort every card → "All sorted" → "See where it went" opens Insights (the Insights totals are checked in Plan 7)`.

- [ ] **Step 5: Red team (final pass)**

Dispatch `red-team` with task id `plan-04-task-10` on the integrated local build: everything in the red-team steps of Tasks 2, 4, 7, 8 and 9, plus SEC-10 and SEC-11 by hand. Findings to `docs/reports/red-team/plan-04.md`.

- [ ] **Step 6: Commit**

```bash
git add server/src/test/java/in/gullak/security/ImportSecurityApiTest.java README.md docs/engineering-standards.md \
  docs/superpowers/specs/2026-10-23-gullak-v1-test-cases.md
git commit -m "test(server): import security sweep; docs for statement settings and new test cases

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: App: multipart client, imports API and hooks, upload store

**Owner:** app-engineer. **Test IDs:** APP-19 (the "wrong password keeps the file in memory" half and the code-to-screen table), ERR-12 (multipart). **Red team:** yes: does the file, the password or statement text ever reach AsyncStorage, the query cache on disk, logs or the reporting sink; is the picker's cache copy deleted when the flow ends.

**Files:**
- Install: `cd app && npx expo install expo-document-picker expo-file-system`
- Modify: `app/src/lib/api-errors.ts`, `app/src/lib/api.ts` (whole file below), `app/src/lib/api.test.ts` (append), `app/src/lib/client.ts`, `app/src/lib/query.ts`, `app/jest.setup.ts`
- Create: `app/src/lib/query.test.ts`
- Create (`app/src/features/imports/`): `api.ts`, `hooks.ts`, `categories.ts`, `copy.ts`, `copy.test.ts`, `picker.ts`, `file-part.ts`, `file-part.web.ts`, `release.ts`, `release.web.ts`, `upload-store.tsx`, `upload-store.test.tsx`, `error-routes.ts`, `error-routes.test.ts`

**Interfaces:**
- Consumes: Plan 2's `createApi`, `ApiError`, `NetworkError`, `UnknownError`, `describeError`, `messageFor`, `log`, `formatDayMonth`, `todayIst`, `queryClient`, `persistOptions`, `todayKey` (`@/features/budget/hooks`), `IconName`; the server API of Tasks 7–9.
- Produces: `Api#postMultipart<T>(path, form: FormData, options?)`; `ApiDeps.multipartFetchFn` and `ApiDeps.uploadTimeoutMs`; `ApiError#details`; `shouldPersist(query)`; `importsApi` (`upload`, `get`, `latest`, `toSort`, `tag`, `undoTag`, `commit`, `discard`, `answerFixed`, `miscCash`, `previewColumns`, `applyColumns`, `requestBank`, `unlink`); the types `ImportPreview`, `FixedQuestion`, `LatestImport`, `SortLine`, `Tag`, `Hint`, `TagResult`, `UndoResult`, `CommitResult`, `DateFormat`, `ColumnMap`, `ColumnMapPreview`, `MappedLine`, `NeedsMapDetails`; hooks `useLatestImport`, `useToSort`, `useTag`, `useUndoTag`, `useCommit`, `useDiscard`, `useFixedAnswer`, `useMiscCash`, `useBankRequest`, `useColumnPreview`, `useApplyColumns`, `useUnlink`, `importKeys`; `CATEGORY_CODES`, `CategoryCode`, `categoryLabel`, `categoryIcon`; `plural`, `hintCopy`, `sortSummary`, `periodText`, `addedText`; `pickStatement()`, `PickedFile`, `MAX_UPLOAD_BYTES`; `filePart(file)`; `releaseStatement(file)`; `UploadProvider` (props `release?`, `initial?`), `useUpload()`, `UploadState`, `ImportFailure`; `routeForImportError(e)`, `ImportRoute`, `failureOf(e)`, `needsMapDetails(failure)`.

- [ ] **Step 1: Write the failing tests**

Append to `app/src/lib/api.test.ts`:

```ts
describe("postMultipart (ERR-12, statement upload)", () => {
  it("posts the form as is, with the bearer token and no JSON content type", async () => {
    const { api, calls } = setup(() => json(201, { importId: "i1" }));
    const form = new FormData();
    form.append("password", "secret");
    await expect(api.postMultipart("/imports", form)).resolves.toEqual({ importId: "i1" });
    expect(calls[0]?.url).toBe("http://test.local/api/v1/imports");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe(form);
    expect(header(calls[0]!, "Content-Type")).toBeUndefined();
    expect(header(calls[0]!, "Authorization")).toBe("Bearer A1");
  });

  it("carries the error details the import screens need", async () => {
    const { api } = setup(() => json(422, { code: "UNSUPPORTED_BANK", message: "We can't read Yes Bank PDFs yet", details: { bank: "Yes Bank" } }));
    const err = await api.postMultipart("/imports", new FormData()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).details).toEqual({ bank: "Yes Bank" });
  });

  it("gives empty details when the server sends none", async () => {
    const { api } = setup(() => json(404, { code: "NOT_FOUND", message: "Import not found" }));
    const err = await api.get("/imports/x").catch((e: unknown) => e);
    expect((err as ApiError).details).toEqual({});
  });

  it("re-sends the same form after refreshing an expired token", async () => {
    const form = new FormData();
    const { api, calls } = setup((_call, n) =>
      n === 1 ? json(401, { code: "TOKEN_EXPIRED", message: "x" }) : n === 2 ? json(200, { accessToken: "A2", refreshToken: "R2", expiresIn: 900 }) : json(201, { ok: true }),
    );
    await api.postMultipart("/imports", form);
    expect(calls[2]?.init.body).toBe(form);
    expect(header(calls[2]!, "Authorization")).toBe("Bearer A2");
  });

  it("uses the multipart fetch for uploads and the normal fetch for JSON", async () => {
    const plain = jest.fn(() => Promise.resolve(json(200, { route: "json" })));
    const multipart = jest.fn(() => Promise.resolve(json(201, { route: "form" })));
    const store: TokenStore = { load: () => Promise.resolve({ accessToken: "A1", refreshToken: "R1" }), save: () => Promise.resolve(), clear: () => Promise.resolve() };
    const api = createApi({
      baseUrl: "http://test.local/api/v1",
      tokens: store,
      onSignedOut: jest.fn(),
      fetchFn: plain as unknown as typeof fetch,
      multipartFetchFn: multipart as unknown as typeof fetch,
    });
    await expect(api.postMultipart("/imports", new FormData())).resolves.toEqual({ route: "form" });
    await expect(api.get("/imports/latest")).resolves.toEqual({ route: "json" });
    expect(multipart).toHaveBeenCalledTimes(1);
    expect(plain).toHaveBeenCalledTimes(1);
  });

  it("maps a dropped upload to NetworkError", async () => {
    const { api } = setup(() => {
      throw new TypeError("Network request failed");
    });
    await expect(api.postMultipart("/imports", new FormData())).rejects.toBeInstanceOf(NetworkError);
  });
});
```

`app/src/lib/query.test.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";
import { shouldPersist } from "./query";

describe("query cache persistence", () => {
  it("never writes import queries to disk; they carry statement text", async () => {
    const qc = new QueryClient();
    await qc.prefetchQuery({ queryKey: ["imports", "abc", "to-sort"], queryFn: () => Promise.resolve({ lines: [] }) });
    await qc.prefetchQuery({ queryKey: ["today"], queryFn: () => Promise.resolve({ budgetPaise: 1 }) });
    const all = qc.getQueryCache().getAll();
    const imports = all.find((q) => q.queryKey[0] === "imports");
    const today = all.find((q) => q.queryKey[0] === "today");
    expect(imports && shouldPersist(imports)).toBe(false);
    expect(today && shouldPersist(today)).toBe(true);
  });
});
```

`app/src/features/imports/error-routes.test.ts` (APP-19):

```ts
import { ApiError, NetworkError } from "@/lib/api-errors";
import { failureOf, needsMapDetails, routeForImportError } from "./error-routes";

const err = (code: string, details: Record<string, unknown> = {}) => new ApiError(code, 422, "x", [], undefined, details);

describe("import error → screen (APP-19)", () => {
  it.each([
    ["PASSWORD_REQUIRED", { pathname: "/upload/password", params: { wrong: "0" } }],
    ["WRONG_PASSWORD", { pathname: "/upload/password", params: { wrong: "1" } }],
    ["SCANNED_PDF", { pathname: "/upload/scanned" }],
    ["NEEDS_COLUMN_MAP", { pathname: "/upload/columns" }],
    ["TOO_LARGE", { pathname: "/upload/problem", params: { code: "TOO_LARGE" } }],
    ["UNREADABLE", { pathname: "/upload/problem", params: { code: "UNREADABLE" } }],
    ["INVALID_FILE", { pathname: "/upload/problem", params: { code: "INVALID_FILE" } }],
  ])("%s opens its screen", (code, route) => {
    expect(routeForImportError(err(code))).toEqual(route);
  });

  it("an unsupported bank carries its name, or nothing when unknown", () => {
    expect(routeForImportError(err("UNSUPPORTED_BANK", { bank: "Yes Bank" }))).toEqual({ pathname: "/upload/bank", params: { bank: "Yes Bank" } });
    expect(routeForImportError(err("UNSUPPORTED_BANK", { bank: null }))).toEqual({ pathname: "/upload/bank", params: { bank: "" } });
  });

  it("anything else stays on the reading screen", () => {
    expect(routeForImportError(err("RATE_LIMITED"))).toBeNull();
    expect(routeForImportError(new NetworkError("network"))).toBeNull();
    expect(routeForImportError(new Error("boom"))).toBeNull();
  });

  it("reads the column-map details only when they have the right shape", () => {
    const good = failureOf(err("NEEDS_COLUMN_MAP", { importId: "i1", headers: ["A", "B"], sampleRows: [["1", "2"]], suggestion: { date: null, description: 1, debit: null, credit: null, amount: null, drCr: null } }));
    expect(needsMapDetails(good)?.headers).toEqual(["A", "B"]);
    expect(needsMapDetails(failureOf(err("NEEDS_COLUMN_MAP", { headers: "nope" })))).toBeNull();
    expect(needsMapDetails(null)).toBeNull();
  });
});
```

`app/src/features/imports/copy.test.ts`:

```ts
import { addedText, hintCopy, periodText, plural, sortSummary } from "./copy";

describe("import copy", () => {
  it("pluralises (APP-18 summary)", () => {
    expect(sortSummary({ need: 13, want: 0, regret: 1 })).toBe("14 spends sorted: 13 needs, 0 wants, 1 regret. We’ll remember these payees next time.");
    expect(sortSummary({ need: 0, want: 1, regret: 2 })).toBe("3 spends sorted: 0 needs, 1 want, 2 regrets. We’ll remember these payees next time.");
    expect(plural(1, "transaction", "transactions")).toBe("1 transaction");
  });

  it("formats the statement period and the last-added line", () => {
    expect(periodText("2026-10-01", "2026-10-22")).toBe("1 Oct – 22 Oct 2026");
    expect(periodText(null, null)).toBe("");
    expect(addedText("2026-10-12T06:00:00Z", 91)).toBe("Added 12 Oct · 91 transactions");
  });

  it("has a hint for every kind the server sends", () => {
    expect(hintCopy.PERSON).toBe("Paid to a person, no note");
    expect(hintCopy.UNKNOWN).toBe("A small shop we don’t know yet");
  });
});
```

`app/src/features/imports/upload-store.test.tsx` (APP-19, file kept):

```tsx
import { act, renderHook } from "@testing-library/react-native";
import React from "react";
import type { PickedFile } from "./picker";
import { UploadProvider, useUpload } from "./upload-store";

const file = (name: string): PickedFile => ({ uri: `file:///cache/${name}`, name, size: 1000, mimeType: "application/pdf" });

function setup() {
  const release = jest.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => <UploadProvider release={release}>{children}</UploadProvider>;
  const hook = renderHook(() => useUpload(), { wrapper });
  return { release, ...hook };
}

describe("upload store", () => {
  it("keeps the file after a wrong password so the retry needs no new pick (APP-19)", () => {
    const { result, release } = setup();
    const picked = file("HDFC.pdf");
    act(() => result.current.setFile(picked));
    act(() => result.current.setPassword("SHARMA14"));
    act(() => result.current.setFailure({ code: "WRONG_PASSWORD", message: "x", details: {} }));
    expect(result.current.file).toBe(picked);
    expect(result.current.failure?.code).toBe("WRONG_PASSWORD");
    expect(release).not.toHaveBeenCalled();
  });

  it("forgets the password once a preview arrives", () => {
    const { result } = setup();
    act(() => result.current.setFile(file("a.pdf")));
    act(() => result.current.setPassword("secret"));
    act(() =>
      result.current.setPreview({
        importId: "i1", status: "DRAFT", kind: "PDF", bank: "HDFC", bankName: "HDFC Bank", bankLabel: "HDFC", unlocked: true,
        count: 1, alreadyImported: 0, unreadableCount: 0, from: "2026-10-01", to: "2026-10-01", matched: 0, auto: 1, fixed: 0, toSort: 0, fixedQuestions: [],
      }),
    );
    expect(result.current.password).toBeNull();
  });

  it("deletes the previous cache copy when another file is chosen, and the last one on reset and unmount", () => {
    const { result, release, unmount } = setup();
    const first = file("a.pdf");
    const second = file("b.pdf");
    act(() => result.current.setFile(first));
    act(() => result.current.setFile(second));
    expect(release).toHaveBeenCalledWith(first);
    act(() => result.current.reset());
    expect(release).toHaveBeenCalledWith(second);
    const third = file("c.pdf");
    act(() => result.current.setFile(third));
    unmount();
    expect(release).toHaveBeenCalledWith(third);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd app && npx jest src/lib src/features/imports`
Expected: FAIL (`postMultipart`, `shouldPersist` and the imports feature do not exist).

- [ ] **Step 3: The client**

`app/src/lib/api-errors.ts`, replace the `ApiError` class:

```ts
/** A 4xx or 5xx the server described in its {code, message} shape. `details` carries extra data some codes send. */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly fields: FieldError[] = [],
    readonly errorId?: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}
```

`app/src/lib/api.ts` (whole file):

```ts
import { randomUUID } from "expo-crypto";
import { ApiError, NetworkError, UnknownError, type FieldError } from "./api-errors";
import { log } from "./log";
import type { TokenStore, Tokens } from "./storage";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestOptions = {
  /** Default true: send the bearer token and refresh it once on TOKEN_EXPIRED. */
  auth?: boolean;
  signal?: AbortSignal;
};

export type Api = {
  request<T>(method: HttpMethod, path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  del<T>(path: string, options?: RequestOptions): Promise<T>;
  /** POST a multipart form (statement uploads). Never sets Content-Type: the runtime adds the boundary. */
  postMultipart<T>(path: string, form: FormData, options?: RequestOptions): Promise<T>;
};

export type ApiDeps = {
  baseUrl: string;
  tokens: TokenStore;
  /** Called once when a refresh is rejected: the session is gone. */
  onSignedOut: () => void;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Used for multipart only. The app passes expo/fetch on native, whose FormData accepts expo-file-system Files. */
  multipartFetchFn?: typeof fetch;
  /** A 10 MB upload on a slow network needs longer than a JSON call. */
  uploadTimeoutMs?: number;
};

type ErrorBody = { code?: unknown; message?: unknown; fields?: unknown; errorId?: unknown; details?: unknown };

type Payload = { kind: "none" } | { kind: "json"; body: unknown } | { kind: "form"; form: FormData };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/me/fixed-costs/3f2…" → "/me/fixed-costs/{id}" so logs never carry ids from URLs. */
function routeOf(path: string): string {
  return path.split("?")[0]?.replace(UUID, "{id}") ?? path;
}

function isFieldError(f: unknown): f is FieldError {
  return typeof f === "object" && f !== null && typeof (f as { field?: unknown }).field === "string" && typeof (f as { message?: unknown }).message === "string";
}

function fieldsOf(raw: unknown): FieldError[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(isFieldError).map((f) => ({ field: f.field, message: f.message }));
}

function detailsOf(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function createApi(deps: ApiDeps): Api {
  const fetchFn = deps.fetchFn ?? fetch;
  const multipartFetch = deps.multipartFetchFn ?? fetchFn;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const uploadTimeoutMs = deps.uploadTimeoutMs ?? 120_000;
  let refreshing: Promise<Tokens> | null = null;

  async function send(method: HttpMethod, path: string, payload: Payload, accessToken: string | null, signal?: AbortSignal): Promise<{ status: number; data: unknown }> {
    const multipart = payload.kind === "form";
    const headers: Record<string, string> = { Accept: "application/json", "X-Request-Id": randomUUID() };
    if (!multipart) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), multipart ? uploadTimeoutMs : timeoutMs);
    signal?.addEventListener("abort", () => controller.abort());
    const started = Date.now();
    const body = payload.kind === "json" ? JSON.stringify(payload.body) : payload.kind === "form" ? payload.form : undefined;
    let res: { status: number; headers: { get(name: string): string | null }; text(): Promise<string> };
    try {
      res = await (multipart ? multipartFetch : fetchFn)(`${deps.baseUrl}${path}`, { method, headers, body, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (signal?.aborted) throw e;
      throw new NetworkError(e instanceof Error && e.name === "AbortError" ? "timeout" : "network");
    }
    clearTimeout(timer);
    const text = await res.text();
    log.info("api.call", { route: routeOf(path), method, status: res.status, ms: Date.now() - started });
    if (res.status === 204 || text === "") return { status: res.status, data: undefined };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) throw new UnknownError(`Unexpected ${contentType || "response"}`, res.status);
    try {
      return { status: res.status, data: JSON.parse(text) as unknown };
    } catch {
      throw new UnknownError("Response was not JSON", res.status);
    }
  }

  function toError(status: number, data: unknown): Error {
    const b = (data ?? {}) as ErrorBody;
    if (typeof b.code === "string") {
      return new ApiError(
        b.code,
        status,
        typeof b.message === "string" ? b.message : "",
        fieldsOf(b.fields),
        typeof b.errorId === "string" ? b.errorId : undefined,
        detailsOf(b.details),
      );
    }
    return new UnknownError(`HTTP ${status}`, status);
  }

  async function refresh(current: Tokens): Promise<Tokens> {
    const { status, data } = await send("POST", "/auth/refresh", { kind: "json", body: { refreshToken: current.refreshToken } }, null);
    if (status >= 400) {
      const err = toError(status, data);
      if (err instanceof ApiError) {
        await deps.tokens.clear();
        deps.onSignedOut();
      }
      throw err;
    }
    const pair = data as Partial<Tokens>;
    if (typeof pair.accessToken !== "string" || typeof pair.refreshToken !== "string") throw new UnknownError("Refresh gave no tokens", status);
    const next = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    await deps.tokens.save(next);
    return next;
  }

  async function core<T>(method: HttpMethod, path: string, payload: Payload, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? true;
    const stored = auth ? await deps.tokens.load() : null;
    let { status, data } = await send(method, path, payload, stored?.accessToken ?? null, options.signal);
    if (status === 401 && auth && stored && (data as ErrorBody)?.code === "TOKEN_EXPIRED") {
      refreshing ??= refresh(stored).finally(() => {
        refreshing = null;
      });
      const fresh = await refreshing;
      ({ status, data } = await send(method, path, payload, fresh.accessToken, options.signal));
    }
    if (status >= 400) throw toError(status, data);
    return data as T;
  }

  function request<T>(method: HttpMethod, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return core<T>(method, path, body === undefined ? { kind: "none" } : { kind: "json", body }, options);
  }

  return {
    request,
    get: (path, options) => request("GET", path, undefined, options),
    post: (path, body, options) => request("POST", path, body, options),
    put: (path, body, options) => request("PUT", path, body, options),
    patch: (path, body, options) => request("PATCH", path, body, options),
    del: (path, options) => request("DELETE", path, undefined, options),
    postMultipart: (path, form, options) => core("POST", path, { kind: "form", form }, options),
  };
}
```

`app/src/lib/client.ts`, replace the `api` export (add `import { fetch as expoFetch } from "expo/fetch";`):

```ts
export const api = createApi({
  baseUrl,
  tokens: tokenStore,
  onSignedOut: () => signedOutListeners.forEach((l) => l()),
  // expo/fetch sends expo-file-system Files inside FormData on Android and iOS; the web uses the browser's fetch.
  multipartFetchFn: process.env.EXPO_OS === "web" ? undefined : (expoFetch as unknown as typeof fetch),
});
```

`app/src/lib/query.ts`, replace `persistOptions` (add `defaultShouldDehydrateQuery` and the `Query` type to the `@tanstack/react-query` import):

```ts
/** Import queries carry statement text and the owner's raw lines: never written to the phone's disk. */
export function shouldPersist(query: Query): boolean {
  return query.queryKey[0] !== "imports" && defaultShouldDehydrateQuery(query);
}

export const persistOptions = { persister, maxAge: WEEK, dehydrateOptions: { shouldDehydrateQuery: shouldPersist } };
```

- [ ] **Step 4: The imports feature's plumbing**

`app/src/features/imports/categories.ts`:

```ts
import type { IconName } from "@/components/ui/icon";

/** Spec 2.4's twelve categories, as the server sends them. */
export const CATEGORY_CODES = [
  "food_delivery", "eating_out", "quick_commerce", "groceries", "shopping", "subscriptions",
  "travel", "bills_recharges", "entertainment", "health", "upi_to_people", "other",
] as const;

export type CategoryCode = (typeof CATEGORY_CODES)[number];

export function isCategoryCode(value: string): value is CategoryCode {
  return (CATEGORY_CODES as readonly string[]).includes(value);
}

export const categoryLabel: Record<CategoryCode, string> = {
  food_delivery: "Food delivery",
  eating_out: "Eating out",
  quick_commerce: "Quick commerce",
  groceries: "Groceries",
  shopping: "Shopping",
  subscriptions: "Subscriptions",
  travel: "Travel",
  bills_recharges: "Bills and recharges",
  entertainment: "Entertainment",
  health: "Health",
  upi_to_people: "UPI to people",
  other: "Other",
};

export const categoryIcon: Record<CategoryCode, IconName> = {
  food_delivery: "food",
  eating_out: "coffee",
  quick_commerce: "cart",
  groceries: "cart",
  shopping: "bag",
  subscriptions: "tv",
  travel: "car",
  bills_recharges: "file",
  entertainment: "tv",
  health: "plus",
  upi_to_people: "people",
  other: "bag",
};
```

If Plan 3 already exports the same list and labels from its spends feature, import those instead and drop the duplicate here; the codes must stay identical.

`app/src/features/imports/api.ts`:

```ts
import { api } from "@/lib/client";
import type { CategoryCode } from "./categories";
import { filePart } from "./file-part";
import type { PickedFile } from "./picker";

export type Tag = "NEED" | "WANT" | "REGRET";
export type Hint = "CAFE" | "RESTAURANT" | "FOOD_STALL" | "JUICE" | "KIRANA" | "PRODUCE" | "SERVICE" | "DELIVERY" | "PERSON" | "UNKNOWN";

export type FixedQuestion = { lineId: string; fixedCostId: string; fixedCostName: string; amountPaise: number; date: string; answer: "YES" | "NO" | null };

export type ImportPreview = {
  importId: string;
  status: "DRAFT" | "COMMITTED";
  kind: "PDF" | "CSV";
  bank: string;
  bankName: string;
  bankLabel: string;
  unlocked: boolean;
  count: number;
  alreadyImported: number;
  unreadableCount: number;
  from: string | null;
  to: string | null;
  matched: number;
  auto: number;
  fixed: number;
  toSort: number;
  fixedQuestions: FixedQuestion[];
};

export type LatestImport = { importId: string; bankLabel: string; from: string | null; to: string | null; committedAt: string; count: number };

export type SortLine = { lineId: string; date: string; amountPaise: number; raw: string; hint: Hint; suggestions: string[]; tag: Tag | null; category: string | null };

export type TagResult = { lineId: string; tag: Tag; category: CategoryCode; left: number };
export type UndoResult = { lineId: string; left: number };

export type CommitResult = {
  importId: string;
  created: number;
  matched: number;
  needsReview: number;
  xpAwarded: number;
  accuracyPercent: number | null;
  summary: { need: number; want: number; regret: number };
  miscCash: { withdrawnPaise: number; loggedPaise: number; differencePaise: number } | null;
};

export type DateFormat =
  | "DD_MM_YYYY_SLASH" | "DD_MM_YYYY_DASH" | "DD_MM_YY_SLASH" | "DD_MM_YY_DASH"
  | "D_MMM_YYYY" | "DD_MMM_YYYY_DASH" | "YYYY_MM_DD" | "MM_DD_YYYY_SLASH";

/** What the mapping screen sends: zero-based column indexes. */
export type ColumnMap = { date: number; description: number; debit: number | null; credit: number | null; amount: number | null; drCr: number | null; dateFormat: DateFormat };

export type MappedLine = { rowNo: number; date: string; description: string; amountPaise: number; direction: "DEBIT" | "CREDIT" };
export type ColumnMapPreview = { lines: MappedLine[]; unreadable: number };

export type ColumnSuggestion = { date: number | null; description: number | null; debit: number | null; credit: number | null; amount: number | null; drCr: number | null };
export type NeedsMapDetails = { importId: string; headers: string[]; sampleRows: string[][]; suggestion: ColumnSuggestion };

export const importsApi = {
  /** The real file name is not sent; the server never reads it anyway (decision 19). */
  upload(file: PickedFile, password: string | null, signal?: AbortSignal): Promise<ImportPreview> {
    const form = new FormData();
    form.append("file", filePart(file), file.name.toLowerCase().endsWith(".csv") ? "statement.csv" : "statement.pdf");
    if (password) form.append("password", password);
    return api.postMultipart<ImportPreview>("/imports", form, { signal });
  },
  get: (id: string) => api.get<ImportPreview>(`/imports/${id}`),
  latest: () => api.get<LatestImport | undefined>("/imports/latest"),
  toSort: (id: string) => api.get<{ lines: SortLine[] }>(`/imports/${id}/to-sort`),
  tag: (id: string, body: { lineId: string; tag: Tag; category: CategoryCode }) => api.post<TagResult>(`/imports/${id}/tag`, body),
  undoTag: (id: string) => api.post<UndoResult>(`/imports/${id}/undo-tag`),
  commit: (id: string) => api.post<CommitResult>(`/imports/${id}/commit`),
  discard: (id: string) => api.post<{ importId: string; status: string }>(`/imports/${id}/discard`),
  answerFixed: (id: string, body: { lineId: string; yes: boolean }) => api.post<ImportPreview>(`/imports/${id}/fixed-answer`, body),
  miscCash: (id: string, accept: boolean) => api.post<{ created: boolean; transactionId: string | null }>(`/imports/${id}/misc-cash`, { accept }),
  previewColumns: (id: string, map: ColumnMap) => api.post<ColumnMapPreview>(`/imports/${id}/column-map/preview`, map),
  applyColumns: (id: string, map: ColumnMap) => api.post<ImportPreview>(`/imports/${id}/column-map`, map),
  requestBank: (bank: string) => api.post<{ bank: string }>("/banks/requests", { bank }),
  unlink: (txnId: string) => api.post<unknown>(`/transactions/${txnId}/unlink`),
};
```

`app/src/features/imports/hooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { todayKey } from "@/features/budget/hooks";
import type { CategoryCode } from "./categories";
import { importsApi, type ColumnMap, type Tag } from "./api";

/** Every key starts with "imports", which query.ts keeps out of the on-disk cache. */
export const importKeys = {
  latest: ["imports", "latest"] as const,
  toSort: (id: string) => ["imports", id, "to-sort"] as const,
  columns: (id: string, map: ColumnMap | null) => ["imports", id, "columns", map] as const,
};

export function useLatestImport() {
  return useQuery({ queryKey: importKeys.latest, queryFn: async () => (await importsApi.latest()) ?? null });
}

export function useToSort(id: string) {
  return useQuery({ queryKey: importKeys.toSort(id), queryFn: () => importsApi.toSort(id), staleTime: Infinity });
}

export function useTag(id: string) {
  return useMutation({ mutationFn: (body: { lineId: string; tag: Tag; category: CategoryCode }) => importsApi.tag(id, body) });
}

export function useUndoTag(id: string) {
  return useMutation({ mutationFn: () => importsApi.undoTag(id) });
}

export function useCommit(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => importsApi.commit(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: todayKey });
      void qc.invalidateQueries({ queryKey: importKeys.latest });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useDiscard() {
  return useMutation({ mutationFn: (id: string) => importsApi.discard(id) });
}

export function useFixedAnswer(id: string) {
  return useMutation({ mutationFn: (body: { lineId: string; yes: boolean }) => importsApi.answerFixed(id, body) });
}

export function useMiscCash(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accept: boolean) => importsApi.miscCash(id, accept),
    onSuccess: () => void qc.invalidateQueries({ queryKey: todayKey }),
  });
}

export function useBankRequest() {
  return useMutation({ mutationFn: (bank: string) => importsApi.requestBank(bank) });
}

export function useColumnPreview(id: string, map: ColumnMap | null) {
  return useQuery({
    queryKey: importKeys.columns(id, map),
    queryFn: () => (map ? importsApi.previewColumns(id, map) : Promise.resolve({ lines: [], unreadable: 0 })),
    enabled: map !== null,
  });
}

export function useApplyColumns(id: string) {
  return useMutation({ mutationFn: (map: ColumnMap) => importsApi.applyColumns(id, map) });
}

export function useUnlink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (txnId: string) => importsApi.unlink(txnId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: todayKey });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
```

`app/src/features/imports/copy.ts`:

```ts
import { formatDayMonth, todayIst } from "@/lib/dates";
import type { Hint } from "./api";

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Sort-card hints; the first eight words come from the SwipeSort mockup. */
export const hintCopy: Record<Hint, string> = {
  CAFE: "Looks like a café",
  RESTAURANT: "Looks like a restaurant",
  FOOD_STALL: "Looks like a food stall",
  JUICE: "Looks like a juice shop",
  KIRANA: "A kirana shop",
  PRODUCE: "Looks like a fruit or vegetable seller",
  SERVICE: "Looks like a local service",
  DELIVERY: "Probably a food delivery app",
  PERSON: "Paid to a person, no note",
  UNKNOWN: "A small shop we don’t know yet",
};

export function sortSummary(s: { need: number; want: number; regret: number }): string {
  const total = s.need + s.want + s.regret;
  return `${plural(total, "spend", "spends")} sorted: ${plural(s.need, "need", "needs")}, ${plural(s.want, "want", "wants")}, ${plural(s.regret, "regret", "regrets")}. We’ll remember these payees next time.`;
}

/** "1 Oct – 22 Oct 2026" */
export function periodText(from: string | null, to: string | null): string {
  if (!from || !to) return "";
  return `${formatDayMonth(from)} – ${formatDayMonth(to)} ${to.slice(0, 4)}`;
}

/** "Added 12 Oct · 91 transactions" */
export function addedText(committedAt: string, count: number): string {
  return `Added ${formatDayMonth(todayIst(new Date(committedAt)))} · ${plural(count, "transaction", "transactions")}`;
}
```

`app/src/features/imports/picker.ts`:

```ts
import * as DocumentPicker from "expo-document-picker";

/** The picked statement, held in memory by the upload flow until it ends (spec 4.6: re-sent after a wrong password). */
export type PickedFile = { uri: string; name: string; size: number | null; mimeType: string | null; webFile?: Blob };

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type PickResult = { kind: "picked"; file: PickedFile } | { kind: "cancelled" } | { kind: "tooLarge"; file: PickedFile };

export async function pickStatement(): Promise<PickResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return { kind: "cancelled" };
  const asset = result.assets[0];
  if (!asset) return { kind: "cancelled" };
  const file: PickedFile = { uri: asset.uri, name: asset.name, size: asset.size ?? null, mimeType: asset.mimeType ?? null, webFile: asset.file };
  if (file.size !== null && file.size > MAX_UPLOAD_BYTES) return { kind: "tooLarge", file };
  return { kind: "picked", file };
}
```

`app/src/features/imports/file-part.ts` (Android and iOS):

```ts
import { File } from "expo-file-system";
import type { PickedFile } from "./picker";

/** expo-file-system's File is a Blob that expo/fetch streams from disk into the multipart body. */
export function filePart(file: PickedFile): Blob {
  return new File(file.uri) as unknown as Blob;
}
```

`app/src/features/imports/file-part.web.ts`:

```ts
import type { PickedFile } from "./picker";

export function filePart(file: PickedFile): Blob {
  if (!file.webFile) throw new Error("No file to send");
  return file.webFile;
}
```

`app/src/features/imports/release.ts`:

```ts
import { File } from "expo-file-system";
import { log } from "@/lib/log";
import type { PickedFile } from "./picker";

/** The picker copied the statement into the app's cache; delete that copy when the flow is done with it. */
export function releaseStatement(file: PickedFile): void {
  try {
    const copy = new File(file.uri);
    if (copy.exists) copy.delete();
  } catch (e) {
    log.warn("upload.release_failed", { reason: e instanceof Error ? e.name : "unknown" });
  }
}
```

`app/src/features/imports/release.web.ts`:

```ts
import type { PickedFile } from "./picker";

/** On the web the browser owns the File; nothing was copied to disk. */
export function releaseStatement(file: PickedFile): void {
  void file;
}
```

`app/src/features/imports/upload-store.tsx`:

```tsx
import React, { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommitResult, ImportPreview } from "./api";
import type { PickedFile } from "./picker";
import { releaseStatement } from "./release";

export type ImportFailure = { code: string; message: string; details: Readonly<Record<string, unknown>> };

export type UploadState = {
  file: PickedFile | null;
  /** Used for one request and forgotten once a preview arrives. Never stored or logged. */
  password: string | null;
  preview: ImportPreview | null;
  failure: ImportFailure | null;
  commit: CommitResult | null;
};

export type UploadStore = UploadState & {
  setFile(file: PickedFile | null): void;
  setPassword(password: string | null): void;
  setPreview(preview: ImportPreview): void;
  setFailure(failure: ImportFailure | null): void;
  setCommit(result: CommitResult): void;
  reset(): void;
};

const EMPTY: UploadState = { file: null, password: null, preview: null, failure: null, commit: null };

const UploadContext = createContext<UploadStore | null>(null);

type Props = { children: React.ReactNode; release?: (file: PickedFile) => void; initial?: Partial<UploadState> };

/** The upload flow's memory: lives as long as the /upload stack. Nothing here is persisted. */
export function UploadProvider({ children, release = releaseStatement, initial }: Props) {
  const [state, setState] = useState<UploadState>({ ...EMPTY, ...initial });
  const fileRef = useRef<PickedFile | null>(initial?.file ?? null);

  useEffect(
    () => () => {
      if (fileRef.current) release(fileRef.current);
    },
    [release],
  );

  const setFile = useCallback(
    (file: PickedFile | null) => {
      const previous = fileRef.current;
      if (previous && previous !== file) release(previous);
      fileRef.current = file;
      setState({ ...EMPTY, file });
    },
    [release],
  );

  const reset = useCallback(() => {
    if (fileRef.current) release(fileRef.current);
    fileRef.current = null;
    setState(EMPTY);
  }, [release]);

  const setPassword = useCallback((password: string | null) => setState((s) => ({ ...s, password })), []);
  const setPreview = useCallback((preview: ImportPreview) => setState((s) => ({ ...s, preview, password: null, failure: null })), []);
  const setFailure = useCallback((failure: ImportFailure | null) => setState((s) => ({ ...s, failure })), []);
  const setCommit = useCallback((commit: CommitResult) => setState((s) => ({ ...s, commit })), []);

  const value = useMemo(
    () => ({ ...state, setFile, setPassword, setPreview, setFailure, setCommit, reset }),
    [state, setFile, setPassword, setPreview, setFailure, setCommit, reset],
  );
  return <UploadContext value={value}>{children}</UploadContext>;
}

export function useUpload(): UploadStore {
  const store = use(UploadContext);
  if (!store) throw new Error("useUpload needs an UploadProvider");
  return store;
}
```

`app/src/features/imports/error-routes.ts`:

```ts
import { ApiError } from "@/lib/api-errors";
import type { NeedsMapDetails } from "./api";
import type { ImportFailure } from "./upload-store";

export type ImportRoute =
  | { pathname: "/upload/password"; params: { wrong: "0" | "1" } }
  | { pathname: "/upload/bank"; params: { bank: string } }
  | { pathname: "/upload/scanned" }
  | { pathname: "/upload/columns" }
  | { pathname: "/upload/problem"; params: { code: "TOO_LARGE" | "UNREADABLE" | "INVALID_FILE" } };

/** APP-19: every import outcome that is not a preview has its own screen. Anything else stays where it is. */
export function routeForImportError(e: unknown): ImportRoute | null {
  if (!(e instanceof ApiError)) return null;
  switch (e.code) {
    case "PASSWORD_REQUIRED":
      return { pathname: "/upload/password", params: { wrong: "0" } };
    case "WRONG_PASSWORD":
      return { pathname: "/upload/password", params: { wrong: "1" } };
    case "UNSUPPORTED_BANK":
      return { pathname: "/upload/bank", params: { bank: typeof e.details.bank === "string" ? e.details.bank : "" } };
    case "SCANNED_PDF":
      return { pathname: "/upload/scanned" };
    case "NEEDS_COLUMN_MAP":
      return { pathname: "/upload/columns" };
    case "TOO_LARGE":
    case "UNREADABLE":
    case "INVALID_FILE":
      return { pathname: "/upload/problem", params: { code: e.code } };
    default:
      return null;
  }
}

export function failureOf(e: ApiError): ImportFailure {
  return { code: e.code, message: e.message, details: e.details };
}

const isIndex = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0);

/** The NEEDS_COLUMN_MAP details, checked, or null. */
export function needsMapDetails(failure: ImportFailure | null): NeedsMapDetails | null {
  if (!failure || failure.code !== "NEEDS_COLUMN_MAP") return null;
  const d = failure.details;
  const headers = d.headers;
  const rows = d.sampleRows;
  const s = d.suggestion as Record<string, unknown> | undefined;
  if (typeof d.importId !== "string" || !Array.isArray(headers) || !headers.every((h) => typeof h === "string")) return null;
  if (!Array.isArray(rows) || !rows.every((r) => Array.isArray(r) && r.every((c) => typeof c === "string"))) return null;
  if (!s || !["date", "description", "debit", "credit", "amount", "drCr"].every((k) => isIndex(s[k] ?? null))) return null;
  return {
    importId: d.importId,
    headers: headers as string[],
    sampleRows: rows as string[][],
    suggestion: {
      date: (s.date as number | null) ?? null,
      description: (s.description as number | null) ?? null,
      debit: (s.debit as number | null) ?? null,
      credit: (s.credit as number | null) ?? null,
      amount: (s.amount as number | null) ?? null,
      drCr: (s.drCr as number | null) ?? null,
    },
  };
}
```

In `app/jest.setup.ts`, add mocks for the two native modules:

```ts
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation((uri: string) => ({ uri, exists: true, delete: jest.fn() })),
}));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
```

- [ ] **Step 5: Run the tests**

Run: `cd app && npm test && npm run lint && npm run typecheck`
Expected: PASS, including Plan 2's `api.test.ts` cases unchanged.

- [ ] **Step 6: Red team**

Dispatch `red-team` with task id `plan-04-task-11`: after an upload, a wrong password and a commit in a dev build, inspect AsyncStorage (`gullak.query-cache` must hold no `imports` query), the app's cache directory (no statement left after leaving the flow), and the reporting sink and console (no password, file name or statement text). Findings to `docs/reports/red-team/plan-04-task-11.md`.

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/package-lock.json app/jest.setup.ts app/src/lib app/src/features/imports
git commit -m "feat(app): multipart uploads through the API client, imports API and hooks, in-memory upload store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: App: start, password, wrong password, reading, preview

**Owner:** app-engineer. **Test IDs:** APP-19 (each code opens its screen from the reading screen; wrong password keeps the file and retries it), Review Focus `networkDropOnReadingKeepsTheFileAndRetries`; APP-29 for the new screens. **Red team:** yes: password field (autofill, screenshots on Android, the password visible in logs or the reporting sink), cancel mid-upload, leaving the flow from each screen, a 10 MB file on a slow network.

**Files:**
- Create (`app/src/features/imports/components/`): `upload-header.tsx`, `info-note.tsx`, `file-row.tsx`, `password-field.tsx`, `reading-steps.tsx`, `fixed-question.tsx`
- Create (`app/src/features/imports/screens/`): `upload-start-screen.tsx`, `password-screen.tsx`, `reading-screen.tsx`, `preview-screen.tsx`
- Create (routes): `app/app/upload/_layout.tsx`, `app/app/upload/index.tsx`, `app/app/upload/password.tsx`, `app/app/upload/reading.tsx`, `app/app/upload/preview.tsx`
- Test: `app/src/features/imports/upload-flow.test.tsx`

**Interfaces:**
- Consumes: Task 11 (`useUpload`, `importsApi`, hooks, `routeForImportError`, `failureOf`, copy helpers, `pickStatement`); Plan 2's `Screen`, `Button`, `Text`, `Icon`, `EmptyState`, `ErrorState`, `ProgressBar`, `Skeleton`, `Gullak`, `formatRupees`, `formatDay`, `describeError`, `messageFor`, theme tokens.
- Produces: routes `/upload` (start), `/upload/password?wrong=0|1`, `/upload/reading`, `/upload/preview`; components `UploadHeader({ onBack? })`, `InfoNote({ icon?, title?, text })`, `FileRow({ name, status, tone })`, `PasswordField`, `ReadingSteps`, `FixedQuestionCard`; screens `UploadStartScreen`, `PasswordScreen`, `ReadingScreen`, `PreviewScreen` (props in the code). Task 13 adds `/upload/bank`, `/upload/scanned`, `/upload/problem`, `/upload/columns`; Task 14 adds `/upload/sort?importId=`.

Copy on these screens is the mockups' (`UploadStart`, `UploadPassword`, `UploadWrongPassword`, `UploadReading`, `Upload`). Three single sentences lose their full stop to follow `.claude/design.md`: "Fills in the spends you didn't log and confirms the ones you did", "Any other bank works as a CSV", "The email your bank sent with the statement says how the password is made". New copy here: the "Read · HDFC Bank" status for a file without a password, "Nothing new", the already-added and unreadable rows, and the fixed-cost question card.

- [ ] **Step 1: Write the failing tests**

`app/src/features/imports/upload-flow.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { ApiError, NetworkError } from "@/lib/api-errors";
import type { ImportPreview } from "./api";
import type { PickedFile, PickResult } from "./picker";
import { PasswordScreen } from "./screens/password-screen";
import { PreviewScreen } from "./screens/preview-screen";
import { ReadingScreen } from "./screens/reading-screen";
import { UploadStartScreen } from "./screens/upload-start-screen";
import { UploadProvider, useUpload, type UploadState } from "./upload-store";

jest.mock("./api", () => ({
  importsApi: { latest: jest.fn(), answerFixed: jest.fn(), discard: jest.fn(), upload: jest.fn() },
}));
import { importsApi } from "./api";
const mocked = importsApi as jest.Mocked<typeof importsApi>;

const hdfc: PickedFile = { uri: "file:///cache/HDFC_Statement_Oct_2026.pdf", name: "HDFC_Statement_Oct_2026.pdf", size: 120_000, mimeType: "application/pdf" };

const preview: ImportPreview = {
  importId: "i1", status: "DRAFT", kind: "PDF", bank: "HDFC", bankName: "HDFC Bank", bankLabel: "HDFC", unlocked: true,
  count: 84, alreadyImported: 0, unreadableCount: 0, from: "2026-10-01", to: "2026-10-22", matched: 9, auto: 58, fixed: 3, toSort: 14,
  fixedQuestions: [{ lineId: "l-rent", fixedCostId: "fc-rent", fixedCostName: "Rent", amountPaise: 1_000_000, date: "2026-10-05", answer: null }],
};

function Probe() {
  const s = useUpload();
  return <Text testID="probe">{`${s.file?.name ?? "no file"}|${s.password ?? "no password"}|${s.failure?.code ?? "no failure"}`}</Text>;
}

function renderWith(ui: React.ReactElement, initial?: Partial<UploadState>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UploadProvider release={jest.fn()} initial={initial}>
        {ui}
        <Probe />
      </UploadProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.latest.mockResolvedValue(undefined);
});

describe("Add a statement", () => {
  it("shows the mockup's copy and the last statement added", async () => {
    mocked.latest.mockResolvedValue({ importId: "i0", bankLabel: "HDFC", from: "2026-09-01", to: "2026-09-30", committedAt: "2026-10-12T06:00:00Z", count: 91 });
    renderWith(<UploadStartScreen onBack={jest.fn()} onPicked={jest.fn()} onProblem={jest.fn()} />);
    expect(screen.getByText("Add a statement")).toBeTruthy();
    expect(screen.getByText("Fills in the spends you didn't log and confirms the ones you did")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose a PDF or CSV" })).toBeTruthy();
    for (const bank of ["HDFC", "ICICI", "SBI", "Axis", "Kotak"]) expect(screen.getByText(bank)).toBeTruthy();
    expect(screen.getByText("Any other bank works as a CSV")).toBeTruthy();
    expect(await screen.findByText("HDFC · 1 Sep – 30 Sep 2026")).toBeTruthy();
    expect(screen.getByText("Added 12 Oct · 91 transactions")).toBeTruthy();
    expect(screen.getByText("Adding the same statement twice is fine. We skip spends we already have and delete the file after reading it.")).toBeTruthy();
  });

  it("hides the last-added row when there is none", async () => {
    renderWith(<UploadStartScreen onBack={jest.fn()} onPicked={jest.fn()} onProblem={jest.fn()} />);
    await waitFor(() => expect(mocked.latest).toHaveBeenCalled());
    expect(screen.queryByText("Last added")).toBeNull();
  });

  it.each<[PickResult, string]>([
    [{ kind: "picked", file: hdfc }, "picked"],
    [{ kind: "tooLarge", file: hdfc }, "tooLarge"],
    [{ kind: "cancelled" }, "cancelled"],
  ])("choosing a file: %s", async (result, kind) => {
    const onPicked = jest.fn();
    const onProblem = jest.fn();
    renderWith(<UploadStartScreen onBack={jest.fn()} onPicked={onPicked} onProblem={onProblem} pick={() => Promise.resolve(result)} />);
    fireEvent.press(screen.getByRole("button", { name: "Choose a PDF or CSV" }));
    await waitFor(() => {
      expect(onPicked).toHaveBeenCalledTimes(kind === "picked" ? 1 : 0);
      expect(onProblem).toHaveBeenCalledTimes(kind === "tooLarge" ? 1 : 0);
    });
    if (kind === "picked") expect(screen.getByTestId("probe")).toHaveTextContent(/HDFC_Statement_Oct_2026.pdf/);
  });
});

describe("Reading (APP-19)", () => {
  it("shows what it found and moves on", async () => {
    const upload = jest.fn(() => Promise.resolve(preview));
    const onSeeResult = jest.fn();
    renderWith(<ReadingScreen upload={upload} onSeeResult={onSeeResult} onRoute={jest.fn()} onCancel={jest.fn()} onChooseAnother={jest.fn()} />, { file: hdfc, password: "GULLAK2026" });
    expect(screen.getByText("Counting your coins")).toBeTruthy();
    expect(await screen.findByText("All read")).toBeTruthy();
    expect(upload).toHaveBeenCalledWith(hdfc, "GULLAK2026", expect.anything());
    expect(screen.getByText("84 found")).toBeTruthy();
    expect(screen.getByText("9 matched")).toBeTruthy();
    expect(screen.getByText("58 sorted")).toBeTruthy();
    expect(screen.getByTestId("probe")).toHaveTextContent(/no password/);
    fireEvent.press(screen.getByRole("button", { name: "See what we found" }));
    expect(onSeeResult).toHaveBeenCalled();
  });

  it.each([
    ["PASSWORD_REQUIRED", {}, { pathname: "/upload/password", params: { wrong: "0" } }],
    ["WRONG_PASSWORD", {}, { pathname: "/upload/password", params: { wrong: "1" } }],
    ["UNSUPPORTED_BANK", { bank: "Yes Bank" }, { pathname: "/upload/bank", params: { bank: "Yes Bank" } }],
    ["SCANNED_PDF", {}, { pathname: "/upload/scanned" }],
    ["NEEDS_COLUMN_MAP", { importId: "i9", headers: ["A"], sampleRows: [], suggestion: {} }, { pathname: "/upload/columns" }],
    ["TOO_LARGE", {}, { pathname: "/upload/problem", params: { code: "TOO_LARGE" } }],
    ["UNREADABLE", {}, { pathname: "/upload/problem", params: { code: "UNREADABLE" } }],
    ["INVALID_FILE", {}, { pathname: "/upload/problem", params: { code: "INVALID_FILE" } }],
  ])("%s opens its screen", async (code, details, route) => {
    const onRoute = jest.fn();
    const upload = jest.fn(() => Promise.reject(new ApiError(code, 422, "x", [], undefined, details)));
    renderWith(<ReadingScreen upload={upload} onSeeResult={jest.fn()} onRoute={onRoute} onCancel={jest.fn()} onChooseAnother={jest.fn()} />, { file: hdfc });
    await waitFor(() => expect(onRoute).toHaveBeenCalledWith(route));
    expect(screen.getByTestId("probe")).toHaveTextContent(new RegExp(`HDFC_Statement_Oct_2026.pdf\\|.*\\|${code}`));
  });

  it("keeps the file and the typed password after a wrong password (APP-19)", async () => {
    const upload = jest.fn(() => Promise.reject(new ApiError("WRONG_PASSWORD", 422, "x")));
    renderWith(<ReadingScreen upload={upload} onSeeResult={jest.fn()} onRoute={jest.fn()} onCancel={jest.fn()} onChooseAnother={jest.fn()} />, { file: hdfc, password: "SHARMA14" });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("HDFC_Statement_Oct_2026.pdf|SHARMA14|WRONG_PASSWORD"));
  });

  it("networkDropOnReadingKeepsTheFileAndRetries", async () => { // Review Focus
    const upload = jest.fn().mockRejectedValueOnce(new NetworkError("network")).mockResolvedValueOnce(preview);
    renderWith(<ReadingScreen upload={upload} onSeeResult={jest.fn()} onRoute={jest.fn()} onCancel={jest.fn()} onChooseAnother={jest.fn()} />, { file: hdfc });
    expect(await screen.findByText("No connection. Check your network and try again.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("All read")).toBeTruthy();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1]?.[0]).toBe(hdfc);
  });

  it("cancel stops the upload", async () => {
    let signal: AbortSignal | undefined;
    const upload = jest.fn((_f: PickedFile, _p: string | null, s?: AbortSignal) => {
      signal = s;
      return new Promise<ImportPreview>(() => undefined);
    });
    const onCancel = jest.fn();
    renderWith(<ReadingScreen upload={upload} onSeeResult={jest.fn()} onRoute={jest.fn()} onCancel={onCancel} onChooseAnother={jest.fn()} />, { file: hdfc });
    fireEvent.press(screen.getByRole("button", { name: "Cancel upload" }));
    expect(signal?.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("PDF password", () => {
  it("unlocks only with a password and keeps it in memory for one request", () => {
    const onSubmit = jest.fn();
    renderWith(<PasswordScreen wrong={false} onSubmit={onSubmit} onChooseAnother={jest.fn()} onBack={jest.fn()} />, { file: hdfc });
    expect(screen.getByText("Password-protected PDF")).toBeTruthy();
    expect(screen.getByText("We use the password once to open the file and never save it")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock and read" })).toBeDisabled();
    fireEvent.changeText(screen.getByLabelText("PDF password"), "SHAR1405");
    fireEvent.press(screen.getByRole("button", { name: "Unlock and read" }));
    expect(onSubmit).toHaveBeenCalled();
    expect(screen.getByTestId("probe")).toHaveTextContent(/SHAR1405/);
  });

  it("shows the wrong-password state with the typed value and Try again", () => {
    renderWith(<PasswordScreen wrong onSubmit={jest.fn()} onChooseAnother={jest.fn()} onBack={jest.fn()} />, { file: hdfc, password: "SHARMA14" });
    expect(screen.getByText("That password didn't open the file. Check capital letters, then try your customer ID or date of birth.")).toBeTruthy();
    expect(screen.getByText("Where to find it")).toBeTruthy();
    expect(screen.getByLabelText("PDF password").props.value).toBe("SHARMA14");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("show and hide the password", () => {
    renderWith(<PasswordScreen wrong={false} onSubmit={jest.fn()} onChooseAnother={jest.fn()} onBack={jest.fn()} />, { file: hdfc });
    expect(screen.getByLabelText("PDF password").props.secureTextEntry).toBe(true);
    fireEvent.press(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("PDF password").props.secureTextEntry).toBe(false);
    expect(screen.getByRole("button", { name: "Hide password" })).toBeTruthy();
  });

  it("asks for the file again when the flow lost it", () => {
    renderWith(<PasswordScreen wrong={false} onSubmit={jest.fn()} onChooseAnother={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByText("Choose the file again")).toBeTruthy();
  });
});

describe("Preview", () => {
  it("shows the counts as the mockup does and starts sorting", () => {
    const onSort = jest.fn();
    renderWith(<PreviewScreen onSort={onSort} onDone={jest.fn()} onChooseAnother={jest.fn()} />, { file: hdfc, preview });
    expect(screen.getByText("84 transactions")).toBeTruthy();
    expect(screen.getByText("1 Oct – 22 Oct 2026")).toBeTruthy();
    expect(screen.getByText("Unlocked · HDFC Bank")).toBeTruthy();
    expect(screen.getByText("Matched to spends you already logged")).toBeTruthy();
    expect(screen.getByText("Sorted automatically (Swiggy, Zepto, Amazon…)")).toBeTruthy();
    expect(screen.getByText("Fixed costs, kept out of your daily budget")).toBeTruthy();
    expect(screen.getByText("Left for you to sort: small shops and UPI to people")).toBeTruthy();
    expect(screen.getByText("We read the file and delete it straight away. Only the transactions are kept, on servers in India.")).toBeTruthy();
    expect(screen.getByText("PDF from HDFC, ICICI, SBI, Axis or Kotak, or a CSV from any bank")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Import and sort 14" }));
    expect(onSort).toHaveBeenCalledWith("i1");
  });

  it("asks about the rent and sends the answer", async () => {
    mocked.answerFixed.mockResolvedValue({ ...preview, fixedQuestions: [{ ...preview.fixedQuestions[0]!, answer: "YES" }] });
    renderWith(<PreviewScreen onSort={jest.fn()} onDone={jest.fn()} onChooseAnother={jest.fn()} />, { file: hdfc, preview });
    expect(screen.getByText("Is this your rent?")).toBeTruthy();
    expect(screen.getByText("₹10,000 on Mon, 5 Oct")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Yes, it's my rent" }));
    await waitFor(() => expect(mocked.answerFixed).toHaveBeenCalledWith("i1", { lineId: "l-rent", yes: true }));
    expect(await screen.findByText("Kept out of your daily budget")).toBeTruthy();
  });

  it("says when nothing is new and discards the empty draft", async () => {
    mocked.discard.mockResolvedValue({ importId: "i1", status: "DISCARDED" });
    const onDone = jest.fn();
    renderWith(<PreviewScreen onSort={jest.fn()} onDone={onDone} onChooseAnother={jest.fn()} />, {
      file: hdfc,
      preview: { ...preview, count: 0, alreadyImported: 84, matched: 0, auto: 0, fixed: 0, toSort: 0, fixedQuestions: [] },
    });
    expect(screen.getByText("Nothing new")).toBeTruthy();
    expect(screen.getByText("84 transactions already added, skipped")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Done" })));
    expect(mocked.discard).toHaveBeenCalledWith("i1");
    expect(onDone).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd app && npx jest src/features/imports/upload-flow.test.tsx`
Expected: FAIL (the screens do not exist).

- [ ] **Step 3: Components**

`components/upload-header.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { radius, spacing } from "@/theme";

export function UploadHeader({ onBack }: { onBack?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm, minHeight: 48 }}>
      {onBack ? (
        <Button title="Back" iconOnly icon={<Icon name="left" size={20} />} variant="secondary" onPress={onBack} style={{ width: 48, height: 48, borderRadius: radius.full }} />
      ) : null}
      <Text variant="title" accessibilityRole="header">
        Bank statement
      </Text>
    </View>
  );
}
```

`components/info-note.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Icon, type IconName } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors, fonts, radius, spacing } from "@/theme";

/** The sand info panel of the upload mockups. */
export function InfoNote({ icon, title, text }: { icon?: IconName; title?: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: spacing.cm, alignItems: "flex-start", padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.sand }}>
      {icon ? <Icon name={icon} size={20} /> : null}
      <View style={{ flex: 1, gap: spacing.sm }}>
        {title ? (
          <Text variant="label" style={{ fontFamily: fonts.ui700 }} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        <Text variant="label">{text}</Text>
      </View>
    </View>
  );
}
```

`components/file-row.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors, radius, spacing } from "@/theme";

/** The picked file's name lives only in the app; the server never receives it. */
export function FileRow({ name, status, tone }: { name: string; status: string; tone: "ok" | "locked" | "bad" }) {
  const icon = tone === "ok" ? "check" : tone === "locked" ? "lock" : "alert";
  const ink = tone === "ok" ? colors.good : tone === "locked" ? colors.muted : colors.bad;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm, padding: spacing.cm, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
      <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: tone === "bad" ? colors.badTint : colors.accentTint, alignItems: "center", justifyContent: "center" }}>
        <Icon name="file" size={20} color={tone === "bad" ? colors.bad : colors.accentDeep} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
        <Text variant="body" numberOfLines={1}>
          {name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Icon name={icon} size={14} color={ink} />
          <Text variant="caption">{status}</Text>
        </View>
      </View>
    </View>
  );
}
```

`components/password-field.tsx`:

```tsx
import React, { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors, fonts, radius, spacing, touchTarget, type } from "@/theme";

/** The statement password. Not autofilled, not autocorrected, shown on request; the wrong state starts visible (mockup). */
export function PasswordField({ value, onChangeText, error }: { value: string; onChangeText: (v: string) => void; error?: string }) {
  const [show, setShow] = useState(error !== undefined);
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="label" nativeID="pdf-password-label">
        PDF password
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 52, borderWidth: error ? 2 : 1, borderColor: error ? colors.bad : colors.control, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, paddingLeft: spacing.md, paddingRight: spacing.xs }}>
        <TextInput
          accessibilityLabel="PDF password"
          accessibilityLabelledBy="pdf-password-label"
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          textContentType="none"
          style={[type.body, { flex: 1, paddingVertical: spacing.sm, letterSpacing: 1 }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={show ? "Hide password" : "Show password"}
          onPress={() => setShow((s) => !s)}
          style={{ minWidth: 64, minHeight: touchTarget, alignItems: "center", justifyContent: "center" }}
        >
          <Text variant="label" style={{ fontFamily: fonts.ui700, textDecorationLine: "underline" }}>
            {show ? "Hide" : "Show"}
          </Text>
        </Pressable>
      </View>
      {error ? (
        <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
          <Icon name="alert" size={16} color={colors.bad} />
          <Text variant="label" color={colors.bad} style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
```

`components/reading-steps.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { colors, radius, spacing } from "@/theme";

const LABELS = ["Opened the file", "Read the transactions", "Matching your logged spends", "Sorting by shop"];

/** The server reads in one request, so while it works the first step is active; when it answers, all four tick. */
export function ReadingSteps({ done, notes }: { done: boolean; notes: readonly [string, string, string, string] }) {
  return (
    <View accessibilityLiveRegion="polite" style={{ padding: spacing.md, gap: spacing.cm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, borderCurve: "continuous" }}>
      {LABELS.map((label, i) => {
        const complete = done;
        const active = !done && i === 0;
        return (
          <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm, minHeight: 32 }}>
            <View style={{ width: 28, height: 28, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: complete ? colors.good : "transparent", borderWidth: complete ? 0 : active ? 3 : 2, borderColor: active ? colors.ink : colors.control }}>
              {complete ? <Icon name="check" size={16} color={colors.onAccent} strokeWidth={2.5} /> : null}
            </View>
            <Text variant={active ? "bodyStrong" : "body"} color={complete || active ? colors.ink : colors.muted} style={{ flex: 1 }}>
              {label}
            </Text>
            {complete && notes[i] ? <Text variant="labelMuted">{notes[i]}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}
```

`components/fixed-question.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { formatDay } from "@/lib/dates";
import { formatRupees } from "@/lib/money";
import { colors, radius, spacing } from "@/theme";
import type { FixedQuestion } from "../api";

/** Spec 2.5: "Is this your rent?", asked once per payee. */
export function FixedQuestionCard({ q, busy, onAnswer }: { q: FixedQuestion; busy: boolean; onAnswer: (yes: boolean) => void }) {
  const name = q.fixedCostName.toLowerCase();
  return (
    <View style={{ padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
      <Text variant="bodyStrong">{`Is this your ${name}?`}</Text>
      <Text variant="labelMuted">{`${formatRupees(q.amountPaise)} on ${formatDay(q.date)}`}</Text>
      {q.answer === "YES" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Icon name="check" size={16} color={colors.good} />
          <Text variant="label" color={colors.goodDeep}>
            Kept out of your daily budget
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button title={`Yes, it's my ${name}`} variant="secondary" loading={busy} onPress={() => onAnswer(true)} style={{ flex: 1 }} />
          <Button title="No, it isn't" variant="ghost" disabled={busy} onPress={() => onAnswer(false)} />
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 4: Screens**

`screens/upload-start-screen.tsx`:

```tsx
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { log } from "@/lib/log";
import { colors, fonts, radius, spacing } from "@/theme";
import { InfoNote } from "../components/info-note";
import { UploadHeader } from "../components/upload-header";
import { addedText, periodText } from "../copy";
import { useLatestImport } from "../hooks";
import { pickStatement, type PickResult } from "../picker";
import { useUpload } from "../upload-store";

const BANKS = ["HDFC", "ICICI", "SBI", "Axis", "Kotak"] as const;

type Props = { onBack: () => void; onPicked: () => void; onProblem: (code: "TOO_LARGE") => void; pick?: () => Promise<PickResult> };

export function UploadStartScreen({ onBack, onPicked, onProblem, pick = pickStatement }: Props) {
  const { setFile } = useUpload();
  const latest = useLatestImport();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await pick();
      if (result.kind === "picked") {
        setFile(result.file);
        onPicked();
      } else if (result.kind === "tooLarge") {
        setFile(result.file);
        onProblem("TOO_LARGE");
      }
    } catch (e) {
      log.warn("upload.pick_failed", { reason: e instanceof Error ? e.name : "unknown" });
      setError("Couldn't open your files. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="upload-start">
      <UploadHeader onBack={onBack} />
      <View style={{ gap: spacing.xs }}>
        <Text variant="heading" accessibilityRole="header">
          Add a statement
        </Text>
        <Text variant="bodyMuted">Fills in the spends you didn't log and confirms the ones you did</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose a PDF or CSV"
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={() => void choose()}
        style={({ pressed }) => ({ minHeight: 176, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 2, borderStyle: "dashed", borderColor: colors.control, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 })}
      >
        <View style={{ width: 56, height: 56, borderRadius: radius.full, backgroundColor: colors.accentTint, alignItems: "center", justifyContent: "center" }}>
          <Icon name="upload" size={28} color={colors.accentDeep} />
        </View>
        <Text variant="bodyStrong">Choose a PDF or CSV</Text>
        <Text variant="labelMuted">From your phone, email or Drive</Text>
      </Pressable>
      {error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        <Text variant="label" style={{ fontFamily: fonts.ui700 }} accessibilityRole="header">
          Reads PDFs from
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {BANKS.map((bank) => (
            <View key={bank} style={{ minHeight: 32, paddingHorizontal: spacing.cm, borderRadius: radius.lg, backgroundColor: colors.sand, justifyContent: "center" }}>
              <Text variant="label">{bank}</Text>
            </View>
          ))}
        </View>
        <Text variant="labelMuted">Any other bank works as a CSV</Text>
      </View>
      {latest.isLoading ? <Skeleton height={64} /> : null}
      {latest.isError ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text variant="labelMuted" style={{ flex: 1 }}>
            Couldn't load your last statement
          </Text>
          <Button title="Retry" variant="ghost" onPress={() => void latest.refetch()} />
        </View>
      ) : null}
      {latest.data ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="label" style={{ fontFamily: fonts.ui700 }} accessibilityRole="header">
            Last added
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm, padding: spacing.cm, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
            <Icon name="check" size={20} color={colors.good} />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text variant="label" style={{ fontFamily: fonts.ui700 }}>{`${latest.data.bankLabel} · ${periodText(latest.data.from, latest.data.to)}`}</Text>
              <Text variant="caption">{addedText(latest.data.committedAt, latest.data.count)}</Text>
            </View>
          </View>
        </View>
      ) : null}
      <InfoNote icon="lock" text="Adding the same statement twice is fine. We skip spends we already have and delete the file after reading it." />
    </Screen>
  );
}
```

`screens/password-screen.tsx`:

```tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { FileRow } from "../components/file-row";
import { InfoNote } from "../components/info-note";
import { PasswordField } from "../components/password-field";
import { UploadHeader } from "../components/upload-header";
import { useUpload } from "../upload-store";

type Props = { wrong: boolean; onSubmit: () => void; onChooseAnother: () => void; onBack: () => void };

export function PasswordScreen({ wrong, onSubmit, onChooseAnother, onBack }: Props) {
  const { file, password, setPassword } = useUpload();
  const [value, setValue] = useState(password ?? "");
  if (!file) {
    return (
      <Screen testID="upload-password">
        <UploadHeader onBack={onBack} />
        <EmptyState title="Choose the file again" body="The statement is no longer open on this phone" action={<Button title="Choose a file" onPress={onChooseAnother} />} />
      </Screen>
    );
  }
  return (
    <Screen
      testID="upload-password"
      footer={
        <>
          <Button
            title={wrong ? "Try again" : "Unlock and read"}
            disabled={value.length === 0}
            onPress={() => {
              setPassword(value);
              onSubmit();
            }}
          />
          <Button title="Choose another file" variant="secondary" onPress={onChooseAnother} />
        </>
      }
    >
      <UploadHeader onBack={onBack} />
      <FileRow name={file.name} status="Password protected" tone="locked" />
      <Text variant="heading" accessibilityRole="header">
        Password-protected PDF
      </Text>
      {wrong ? null : <Text variant="bodyMuted">Banks usually set this to your customer ID or date of birth. The email the statement came with says which.</Text>}
      <PasswordField
        value={value}
        onChangeText={setValue}
        error={wrong ? "That password didn't open the file. Check capital letters, then try your customer ID or date of birth." : undefined}
      />
      {wrong ? (
        <InfoNote title="Where to find it" text="The email your bank sent with the statement says how the password is made" />
      ) : (
        <InfoNote icon="lock" text="We use the password once to open the file and never save it" />
      )}
    </Screen>
  );
}
```

`screens/reading-screen.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { Gullak } from "@/features/gullak/gullak";
import { describeError, isApiError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { spacing } from "@/theme";
import { importsApi, type ImportPreview } from "../api";
import { ReadingSteps } from "../components/reading-steps";
import { UploadHeader } from "../components/upload-header";
import { failureOf, routeForImportError, type ImportRoute } from "../error-routes";
import { useUpload } from "../upload-store";

type Props = {
  onSeeResult: () => void;
  onRoute: (route: ImportRoute) => void;
  onCancel: () => void;
  onChooseAnother: () => void;
  upload?: typeof importsApi.upload;
};

type State = { kind: "working" } | { kind: "done"; preview: ImportPreview } | { kind: "error"; message: string };

/** Sends the file once on arrival; Try again re-sends the same file from memory (spec 4.6). */
export function ReadingScreen({ onSeeResult, onRoute, onCancel, onChooseAnother, upload = importsApi.upload }: Props) {
  const store = useUpload();
  const { file, password, setPreview, setFailure } = store;
  const [state, setState] = useState<State>({ kind: "working" });
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const started = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(() => {
    if (!file) return;
    const c = new AbortController();
    controller.current = c;
    setState({ kind: "working" });
    upload(file, password, c.signal)
      .then((preview) => {
        if (!mounted.current || c.signal.aborted) return;
        setPreview(preview);
        setState({ kind: "done", preview });
      })
      .catch((e: unknown) => {
        if (!mounted.current || c.signal.aborted) return;
        const route = routeForImportError(e);
        if (route && isApiError(e)) {
          setFailure(failureOf(e));
          onRoute(route);
          return;
        }
        setState({ kind: "error", message: describeError(e, messageFor) });
      });
  }, [file, password, upload, setPreview, setFailure, onRoute]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
  }, [run]);

  if (!file) {
    return (
      <Screen testID="upload-reading">
        <UploadHeader />
        <EmptyState title="Choose the file again" body="The statement is no longer open on this phone" action={<Button title="Choose a file" onPress={onChooseAnother} />} />
      </Screen>
    );
  }

  const done = state.kind === "done";
  const p = done ? state.preview : null;
  return (
    <Screen
      testID="upload-reading"
      footer={
        done ? (
          <Button title="See what we found" onPress={onSeeResult} />
        ) : state.kind === "working" ? (
          <Button
            title="Cancel upload"
            variant="secondary"
            onPress={() => {
              controller.current?.abort();
              onCancel();
            }}
          />
        ) : (
          <Button title="Choose another file" variant="secondary" onPress={onChooseAnother} />
        )
      }
    >
      <UploadHeader />
      <View style={{ alignItems: "center", gap: spacing.cm, paddingTop: spacing.lg }}>
        <Gullak mood={done ? "celebrating" : state.kind === "error" ? "nervous" : "calm"} stage="clay" size={152} />
        <Text variant="heading" accessibilityRole="header">
          {done ? "All read" : "Counting your coins"}
        </Text>
        <Text variant="labelMuted" numberOfLines={1}>
          {file.name}
        </Text>
      </View>
      {state.kind === "error" ? (
        <ErrorState title="That didn't go through" body={state.message} onRetry={run} retryLabel="Try again" />
      ) : (
        <>
          <ProgressBar value={done ? 100 : 25} label="Reading statement" />
          <ReadingSteps done={done} notes={["", p ? `${p.count} found` : "", p ? `${p.matched} matched` : "", p ? `${p.auto} sorted` : ""]} />
        </>
      )}
    </Screen>
  );
}
```

Plan 2's `ErrorState` labels its button "Retry"; the reading screen needs "Try again" (the mockup's word for a resend). Add an optional `retryLabel?: string` prop to `app/src/components/ui/error-state.tsx` (default `"Retry"`) and use it as the button title: `<Button title={retryLabel} ... />`.

`screens/preview-screen.tsx`:

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { colors, radius, spacing } from "@/theme";
import { FileRow } from "../components/file-row";
import { FixedQuestionCard } from "../components/fixed-question";
import { InfoNote } from "../components/info-note";
import { UploadHeader } from "../components/upload-header";
import { periodText, plural } from "../copy";
import { useDiscard, useFixedAnswer } from "../hooks";
import { useUpload } from "../upload-store";

type Props = { onSort: (importId: string) => void; onDone: () => void; onChooseAnother: () => void };

type Row = { icon: IconName; bg: string; ink: string; text: string; count: number; testID: string };

export function PreviewScreen({ onSort, onDone, onChooseAnother }: Props) {
  const { file, preview, setPreview } = useUpload();
  const answer = useFixedAnswer(preview?.importId ?? "");
  const discard = useDiscard();
  const [error, setError] = useState<string | null>(null);

  if (!preview) {
    return (
      <Screen testID="upload-preview">
        <UploadHeader onBack={onChooseAnother} />
        <EmptyState title="Nothing to show" body="Choose a statement to see what's in it" action={<Button title="Choose a file" onPress={onChooseAnother} />} />
      </Screen>
    );
  }

  const leave = (then: () => void) => {
    discard.mutate(preview.importId, { onSettled: then });
  };

  const rows: Row[] = [
    { icon: "check", bg: colors.goodTint, ink: colors.good, text: "Matched to spends you already logged", count: preview.matched, testID: "row-matched" },
    { icon: "cart", bg: colors.accentTint, ink: colors.accentDeep, text: "Sorted automatically (Swiggy, Zepto, Amazon…)", count: preview.auto, testID: "row-auto" },
    { icon: "home", bg: colors.sand, ink: colors.ink, text: "Fixed costs, kept out of your daily budget", count: preview.fixed, testID: "row-fixed" },
    { icon: "people", bg: colors.warnTint, ink: colors.warnInk, text: "Left for you to sort: small shops and UPI to people", count: preview.toSort, testID: "row-sort" },
  ];
  const empty = preview.count === 0;
  const status = `${preview.unlocked ? "Unlocked" : "Read"} · ${preview.bankName}`;

  return (
    <Screen
      testID="upload-preview"
      footer={
        <>
          {empty ? (
            <Button title="Done" loading={discard.isPending} onPress={() => leave(onDone)} />
          ) : (
            <Button title={preview.toSort > 0 ? `Import and sort ${preview.toSort}` : "Import"} onPress={() => onSort(preview.importId)} />
          )}
          <Button title="Choose another file" variant="secondary" onPress={() => leave(onChooseAnother)} />
          <Text variant="caption" align="center">
            PDF from HDFC, ICICI, SBI, Axis or Kotak, or a CSV from any bank
          </Text>
        </>
      }
    >
      <UploadHeader onBack={() => leave(onChooseAnother)} />
      {file ? <FileRow name={file.name} status={status} tone="ok" /> : null}
      <View style={{ gap: spacing.xs }}>
        <Text variant="heading" accessibilityRole="header" testID="preview-count">
          {empty && preview.alreadyImported > 0 ? "Nothing new" : plural(preview.count, "transaction", "transactions")}
        </Text>
        {preview.from ? <Text variant="labelMuted">{periodText(preview.from, preview.to)}</Text> : null}
      </View>
      {empty ? (
        <Text variant="body">{preview.alreadyImported > 0 ? "Every transaction in this statement is already in Gullak" : "This statement has no transactions"}</Text>
      ) : (
        <View style={{ borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.cm }}>
          {rows.map((r) => (
            <View key={r.testID} testID={r.testID} style={{ flexDirection: "row", alignItems: "center", gap: spacing.cm }}>
              <View style={{ width: 32, height: 32, borderRadius: radius.full, backgroundColor: r.bg, alignItems: "center", justifyContent: "center" }}>
                <Icon name={r.icon} size={16} color={r.ink} />
              </View>
              <Text variant="label" style={{ flex: 1 }}>
                {r.text}
              </Text>
              <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
                {String(r.count)}
              </Text>
            </View>
          ))}
        </View>
      )}
      {preview.alreadyImported > 0 ? <Text variant="labelMuted">{`${plural(preview.alreadyImported, "transaction", "transactions")} already added, skipped`}</Text> : null}
      {preview.unreadableCount > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon name="alert" size={16} color={colors.bad} />
          <Text variant="label">{`${plural(preview.unreadableCount, "line", "lines")} couldn't be read`}</Text>
        </View>
      ) : null}
      {preview.fixedQuestions.map((q) => (
        <FixedQuestionCard
          key={q.lineId}
          q={q}
          busy={answer.isPending}
          onAnswer={(yes) => {
            setError(null);
            answer.mutate({ lineId: q.lineId, yes }, { onSuccess: setPreview, onError: (e) => setError(describeError(e, messageFor)) });
          }}
        />
      ))}
      {error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <InfoNote icon="lock" text="We read the file and delete it straight away. Only the transactions are kept, on servers in India." />
    </Screen>
  );
}
```

The fixed-question card says "No, it isn't" rather than a bare "No": `docs/ux-test-findings.md` records that buttons without context confused testers.

- [ ] **Step 5: Routes**

`app/app/upload/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import React from "react";
import { UploadProvider } from "@/features/imports/upload-store";
import { colors } from "@/theme";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

/** The upload flow: one in-memory store for the picked file, dropped (and its cache copy deleted) when the flow closes. */
export default function UploadLayout() {
  return (
    <UploadProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }} />
    </UploadProvider>
  );
}
```

`app/app/upload/index.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { UploadStartScreen } from "@/features/imports/screens/upload-start-screen";

export default function UploadStartRoute() {
  const router = useRouter();
  return (
    <UploadStartScreen
      onBack={() => router.back()}
      onPicked={() => router.push("/upload/reading")}
      onProblem={(code) => router.push({ pathname: "/upload/problem", params: { code } })}
    />
  );
}
```

`app/app/upload/password.tsx`:

```tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { PasswordScreen } from "@/features/imports/screens/password-screen";

export default function PasswordRoute() {
  const router = useRouter();
  const { wrong } = useLocalSearchParams<{ wrong?: string }>();
  return (
    <PasswordScreen
      key={wrong ?? "0"}
      wrong={wrong === "1"}
      onSubmit={() => router.replace("/upload/reading")}
      onChooseAnother={() => router.replace("/upload")}
      onBack={() => router.replace("/upload")}
    />
  );
}
```

`app/app/upload/reading.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { ReadingScreen } from "@/features/imports/screens/reading-screen";

export default function ReadingRoute() {
  const router = useRouter();
  return (
    <ReadingScreen
      onSeeResult={() => router.replace("/upload/preview")}
      onRoute={(route) => router.replace(route)}
      onCancel={() => router.replace("/upload")}
      onChooseAnother={() => router.replace("/upload")}
    />
  );
}
```

`app/app/upload/preview.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { PreviewScreen } from "@/features/imports/screens/preview-screen";

export default function PreviewRoute() {
  const router = useRouter();
  return (
    <PreviewScreen
      onSort={(importId) => router.push({ pathname: "/upload/sort", params: { importId } })}
      onDone={() => router.dismissTo("/(tabs)/insights")}
      onChooseAnother={() => router.replace("/upload")}
    />
  );
}
```

The `/upload/sort` route arrives in Task 14 and `/upload/problem` in Task 13. Until then `npm run typecheck` with typed routes may reject those two literals; land Tasks 12–14 on one branch and run typecheck at the end of Task 14 if so, and say so in this task's report.

- [ ] **Step 6: Run the tests**

Run: `cd app && npx jest src/features/imports && npm run lint`
Expected: PASS.

- [ ] **Step 7: Red team**

Dispatch `red-team` with task id `plan-04-task-12` on a dev build against the local server: the attacks in this task's header. Findings to `docs/reports/red-team/plan-04-task-12.md`.

- [ ] **Step 8: Commit**

```bash
git add app/app/upload app/src/features/imports app/src/components/ui/error-state.tsx
git commit -m "feat(app): statement upload start, PDF password, reading and preview screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: App: bank not supported, scanned, problem, CSV column mapping

**Owner:** app-engineer. **Test IDs:** APP-19 (the screens behind UNSUPPORTED_BANK, SCANNED_PDF, NEEDS_COLUMN_MAP, TOO_LARGE, UNREADABLE, INVALID_FILE), APP-32 (new: CSV column mapping), APP-29 for the new screens. **Red team:** yes: column chips with headers that are 500 characters or contain markup, a bank name with emoji or newlines in the route param, asking for support 20 times.

**Files:**
- Create (`app/src/features/imports/screens/`): `bank-error-screen.tsx`, `scanned-screen.tsx`, `problem-screen.tsx`, `column-map-screen.tsx`
- Create (routes): `app/app/upload/bank.tsx`, `app/app/upload/scanned.tsx`, `app/app/upload/problem.tsx`, `app/app/upload/columns.tsx`
- Test: `app/src/features/imports/error-screens.test.tsx`, `app/src/features/imports/column-map.test.tsx`

**Interfaces:**
- Consumes: Tasks 11 and 12 (`useUpload`, `useBankRequest`, `useColumnPreview`, `useApplyColumns`, `needsMapDetails`, `UploadHeader`, `FileRow`, `InfoNote`); Plan 2's primitives; Plan 3's `/add` quick-add route.
- Produces: routes `/upload/bank?bank=`, `/upload/scanned`, `/upload/problem?code=`, `/upload/columns`; `BankErrorScreen`, `ScannedScreen`, `ProblemScreen`, `ColumnMapScreen`, and `toColumnMap(draft, mode)`.

Copy: `UploadBankError` and `UploadScanned` mockups verbatim (the bank name comes from the server). The mockup's Gullak mood "sweating" is Plan 2's `nervous`. The problem screen and the column-mapping screen have no mockup; their copy is written here to `.claude/design.md`'s rules (spec 3.2 #1 gives the mapping screen's content).

- [ ] **Step 1: Write the failing tests**

`app/src/features/imports/error-screens.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { ApiError } from "@/lib/api-errors";
import type { PickedFile } from "./picker";
import { BankErrorScreen } from "./screens/bank-error-screen";
import { ProblemScreen } from "./screens/problem-screen";
import { ScannedScreen } from "./screens/scanned-screen";
import { UploadProvider } from "./upload-store";

jest.mock("./api", () => ({ importsApi: { requestBank: jest.fn() } }));
import { importsApi } from "./api";
const mocked = importsApi as jest.Mocked<typeof importsApi>;

const scan: PickedFile = { uri: "file:///cache/IMG_20261022_statement.pdf", name: "IMG_20261022_statement.pdf", size: 900_000, mimeType: "application/pdf" };

function renderWith(ui: React.ReactElement, file: PickedFile | null = null) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UploadProvider release={jest.fn()} initial={{ file }}>
        {ui}
      </UploadProvider>
    </QueryClientProvider>,
  );
}

describe("Bank not supported (APP-19)", () => {
  it("names the bank, explains the CSV and records the request", async () => {
    mocked.requestBank.mockResolvedValue({ bank: "Yes Bank" });
    const onUploadCsv = jest.fn();
    renderWith(<BankErrorScreen bank="Yes Bank" onUploadCsv={onUploadCsv} onBack={jest.fn()} />);
    expect(screen.getByText("Yes Bank not supported")).toBeTruthy();
    expect(screen.getByText("Upload a CSV from Yes Bank net banking instead. It has the same transactions.")).toBeTruthy();
    expect(screen.getByText("Open Yes Bank net banking or the app and go to account statement")).toBeTruthy();
    expect(screen.getByText("Pick the dates you want and choose CSV as the format")).toBeTruthy();
    expect(screen.getByText("Upload that file here. You only map the columns the first time.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Ask for Yes Bank support" }));
    expect(await screen.findByText("Noted. We'll tell you when Yes Bank PDFs work.")).toBeTruthy();
    expect(mocked.requestBank).toHaveBeenCalledWith("Yes Bank");
    fireEvent.press(screen.getByRole("button", { name: "Upload a CSV" }));
    expect(onUploadCsv).toHaveBeenCalled();
  });

  it("without a name it still offers the CSV but no request", () => {
    renderWith(<BankErrorScreen bank="" onUploadCsv={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByText("This bank isn't supported yet")).toBeTruthy();
    expect(screen.queryByText(/Ask for/)).toBeNull();
  });

  it("a failed request says why and keeps the button", async () => {
    mocked.requestBank.mockRejectedValue(new ApiError("RATE_LIMITED", 429, "x"));
    renderWith(<BankErrorScreen bank="Yes Bank" onUploadCsv={jest.fn()} onBack={jest.fn()} />);
    fireEvent.press(screen.getByRole("button", { name: "Ask for Yes Bank support" }));
    expect(await screen.findByText("Too many requests. Wait a minute and try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask for Yes Bank support" })).toBeTruthy();
  });
});

describe("Scanned PDF (APP-19)", () => {
  it("explains and offers the two ways on", () => {
    const onAddByHand = jest.fn();
    renderWith(<ScannedScreen onChooseAnother={jest.fn()} onAddByHand={onAddByHand} onBack={jest.fn()} />, scan);
    expect(screen.getByText("Scanned PDF")).toBeTruthy();
    expect(screen.getByText("Download the original statement from your bank's app or website and upload that. Photos and scanned pages have no text to read.")).toBeTruthy();
    expect(screen.getByText("IMG_20261022_statement.pdf")).toBeTruthy();
    expect(screen.getByText("No readable text found")).toBeTruthy();
    expect(screen.getByText("Net banking or the bank app, under Accounts › Statements. Pick PDF or CSV as the format.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Add spends by hand for now" }));
    expect(onAddByHand).toHaveBeenCalled();
  });
});

describe("Other problems (APP-19)", () => {
  it.each([
    ["TOO_LARGE", "That file is too big"],
    ["UNREADABLE", "We couldn't read that file"],
    ["INVALID_FILE", "That isn't a PDF or CSV"],
    ["SOMETHING_NEW", "We couldn't read that file"],
  ])("%s has its own message", (code, title) => {
    const onChooseAnother = jest.fn();
    renderWith(<ProblemScreen code={code} onChooseAnother={onChooseAnother} onBack={jest.fn()} />);
    expect(screen.getByText(title)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Choose another file" }));
    expect(onChooseAnother).toHaveBeenCalled();
  });
});
```

`app/src/features/imports/column-map.test.tsx` (APP-32):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import type { ImportPreview } from "./api";
import { ColumnMapScreen, toColumnMap } from "./screens/column-map-screen";
import { UploadProvider } from "./upload-store";

jest.mock("./api", () => ({ importsApi: { previewColumns: jest.fn(), applyColumns: jest.fn() } }));
import { importsApi } from "./api";
const mocked = importsApi as jest.Mocked<typeof importsApi>;

const failure = {
  code: "NEEDS_COLUMN_MAP",
  message: "x",
  details: {
    importId: "i9",
    headers: ["Posted On", "Remarks", "Amt", "Type"],
    sampleRows: [["2026-10-05", "UPI/KAKA DHABA", "150.00", "DR"], ["2026-10-06", "UPI/THIRDWAVECOFFEE/okhdfc", "250.00", "DR"], ["2026-10-07", "CASHBACK", "25.00", "CR"]],
    suggestion: { date: null, description: 1, debit: null, credit: null, amount: null, drCr: 3 },
  },
};

const lines = [
  { rowNo: 1, date: "2026-10-05", description: "UPI/KAKA DHABA", amountPaise: 15000, direction: "DEBIT" as const },
  { rowNo: 2, date: "2026-10-06", description: "UPI/THIRDWAVECOFFEE/okhdfc", amountPaise: 25000, direction: "DEBIT" as const },
  { rowNo: 3, date: "2026-10-07", description: "CASHBACK", amountPaise: 2500, direction: "CREDIT" as const },
];

function renderIt(onApplied = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UploadProvider release={jest.fn()} initial={{ failure }}>
        <ColumnMapScreen onApplied={onApplied} onChooseAnother={jest.fn()} onBack={jest.fn()} />
      </UploadProvider>
    </QueryClientProvider>,
  );
  return onApplied;
}

describe("CSV column mapping (APP-32)", () => {
  it("shows the first rows and the columns to choose", () => {
    renderIt();
    expect(screen.getByText("Match the columns")).toBeTruthy();
    expect(screen.getAllByText("Posted On").length).toBeGreaterThan(0);
    expect(screen.getByText("UPI/KAKA DHABA")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Looks right" })).toBeDisabled();
    expect(mocked.previewColumns).not.toHaveBeenCalled();
  });

  it("previews three parsed lines once every column is chosen, then saves", async () => {
    mocked.previewColumns.mockResolvedValue({ lines, unreadable: 0 });
    const applied: ImportPreview = {
      importId: "i9", status: "DRAFT", kind: "CSV", bank: "csv:abc", bankName: "CSV statement", bankLabel: "CSV", unlocked: false,
      count: 3, alreadyImported: 0, unreadableCount: 0, from: "2026-10-05", to: "2026-10-07", matched: 0, auto: 2, fixed: 0, toSort: 1, fixedQuestions: [],
    };
    mocked.applyColumns.mockResolvedValue(applied);
    const onApplied = renderIt();
    fireEvent.press(screen.getByRole("button", { name: "One column and a Dr/Cr column" }));
    fireEvent.press(screen.getByTestId("date-0"));
    fireEvent.press(screen.getByTestId("amount-2"));
    fireEvent.press(screen.getByRole("button", { name: "YYYY-MM-DD" }));
    await waitFor(() =>
      expect(mocked.previewColumns).toHaveBeenLastCalledWith("i9", { date: 0, description: 1, debit: null, credit: null, amount: 2, drCr: 3, dateFormat: "YYYY_MM_DD" }),
    );
    expect(await screen.findByText("Mon, 5 Oct · UPI/KAKA DHABA · ₹150 out")).toBeTruthy();
    expect(screen.getByText("Wed, 7 Oct · CASHBACK · ₹25 in")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Looks right" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(mocked.applyColumns).toHaveBeenCalledWith("i9", { date: 0, description: 1, debit: null, credit: null, amount: 2, drCr: 3, dateFormat: "YYYY_MM_DD" });
  });

  it("keeps Looks right off while the chosen format misreads the rows", async () => {
    mocked.previewColumns.mockResolvedValue({ lines: [], unreadable: 3 });
    renderIt();
    fireEvent.press(screen.getByRole("button", { name: "One column and a Dr/Cr column" }));
    fireEvent.press(screen.getByTestId("date-0"));
    fireEvent.press(screen.getByTestId("amount-2"));
    fireEvent.press(screen.getByRole("button", { name: "DD/MM/YYYY" }));
    expect(await screen.findByText("3 rows of the first 3 didn't read with these choices")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Looks right" })).toBeDisabled();
  });

  it("builds the request for each way amounts are written", () => {
    const base = { date: 0, description: 1, debit: 2, credit: 3, amount: 4, drCr: 5, dateFormat: "DD_MM_YYYY_SLASH" as const };
    expect(toColumnMap(base, "split")).toEqual({ ...base, amount: null, drCr: null });
    expect(toColumnMap(base, "signed")).toEqual({ ...base, debit: null, credit: null, drCr: null });
    expect(toColumnMap(base, "drcr")).toEqual({ ...base, debit: null, credit: null });
    expect(toColumnMap({ ...base, date: null }, "split")).toBeNull();
    expect(toColumnMap({ ...base, debit: null, credit: null }, "split")).toBeNull();
    expect(toColumnMap({ ...base, drCr: null }, "drcr")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd app && npx jest src/features/imports/error-screens.test.tsx src/features/imports/column-map.test.tsx`
Expected: FAIL.

- [ ] **Step 3: The screens**

`screens/bank-error-screen.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { Gullak } from "@/features/gullak/gullak";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { colors, fonts, radius, spacing } from "@/theme";
import { UploadHeader } from "../components/upload-header";
import { useBankRequest } from "../hooks";

type Props = { bank: string; onUploadCsv: () => void; onBack: () => void };

export function BankErrorScreen({ bank, onUploadCsv, onBack }: Props) {
  const ask = useBankRequest();
  const name = bank.replace(/[\r\n\t]/g, " ").trim().slice(0, 60);
  const named = name.length > 0;
  const steps = [
    named ? `Open ${name} net banking or the app and go to account statement` : "Open your bank's net banking or app and go to account statement",
    "Pick the dates you want and choose CSV as the format",
    "Upload that file here. You only map the columns the first time.",
  ];
  return (
    <Screen
      testID="upload-bank"
      footer={
        <>
          <Button title="Upload a CSV" icon={<Icon name="upload" size={18} color={colors.onAccent} />} onPress={onUploadCsv} />
          {named && ask.isSuccess ? (
            <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 }}>
              <Icon name="check" size={16} color={colors.good} />
              <Text variant="label" color={colors.goodDeep}>{`Noted. We'll tell you when ${name} PDFs work.`}</Text>
            </View>
          ) : null}
          {named && !ask.isSuccess ? (
            <Button title={`Ask for ${name} support`} variant="secondary" loading={ask.isPending} onPress={() => ask.mutate(name)} />
          ) : null}
          {ask.isError ? (
            <Text variant="label" color={colors.bad} accessibilityRole="alert">
              {describeError(ask.error, messageFor)}
            </Text>
          ) : null}
        </>
      }
    >
      <UploadHeader onBack={onBack} />
      <View style={{ alignItems: "center", gap: spacing.cm }}>
        <Gullak mood="nervous" stage="clay" size={128} />
        <Text variant="heading" align="center" accessibilityRole="header">
          {named ? `${name} not supported` : "This bank isn't supported yet"}
        </Text>
        <Text variant="bodyMuted" align="center">
          {named ? `Upload a CSV from ${name} net banking instead. It has the same transactions.` : "Upload a CSV from your bank's net banking instead. It has the same transactions."}
        </Text>
      </View>
      <View style={{ gap: spacing.sm }}>
        <Text variant="label" style={{ fontFamily: fonts.ui700 }} accessibilityRole="header">
          Getting the CSV
        </Text>
        {steps.map((step, i) => (
          <View key={step} style={{ flexDirection: "row", gap: spacing.cm, alignItems: "flex-start" }}>
            <View style={{ width: 24, height: 24, borderRadius: radius.full, backgroundColor: colors.sand, alignItems: "center", justifyContent: "center" }}>
              <Text variant="caption" color={colors.ink}>
                {String(i + 1)}
              </Text>
            </View>
            <Text variant="body" style={{ flex: 1 }}>
              {step}
            </Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}
```

`screens/scanned-screen.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { Gullak } from "@/features/gullak/gullak";
import { colors, spacing } from "@/theme";
import { FileRow } from "../components/file-row";
import { InfoNote } from "../components/info-note";
import { UploadHeader } from "../components/upload-header";
import { useUpload } from "../upload-store";

type Props = { onChooseAnother: () => void; onAddByHand: () => void; onBack: () => void };

export function ScannedScreen({ onChooseAnother, onAddByHand, onBack }: Props) {
  const { file } = useUpload();
  return (
    <Screen
      testID="upload-scanned"
      footer={
        <>
          <Button title="Choose another file" icon={<Icon name="upload" size={18} color={colors.onAccent} />} onPress={onChooseAnother} />
          <Button title="Add spends by hand for now" variant="secondary" onPress={onAddByHand} />
        </>
      }
    >
      <UploadHeader onBack={onBack} />
      <View style={{ alignItems: "center", gap: spacing.cm }}>
        <Gullak mood="calm" stage="clay" size={128} />
        <Text variant="heading" align="center" accessibilityRole="header">
          Scanned PDF
        </Text>
        <Text variant="bodyMuted" align="center">
          Download the original statement from your bank's app or website and upload that. Photos and scanned pages have no text to read.
        </Text>
      </View>
      {file ? <FileRow name={file.name} status="No readable text found" tone="bad" /> : null}
      <InfoNote title="Where to find the original" text="Net banking or the bank app, under Accounts › Statements. Pick PDF or CSV as the format." />
    </Screen>
  );
}
```

`screens/problem-screen.tsx`:

```tsx
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { Gullak } from "@/features/gullak/gullak";
import { spacing } from "@/theme";
import { UploadHeader } from "../components/upload-header";

const COPY = {
  TOO_LARGE: { title: "That file is too big", body: "Statements up to 10 MB work. Download a shorter period from your bank and try again." },
  UNREADABLE: { title: "We couldn't read that file", body: "It may be damaged or cut short. Download the statement again from your bank and upload the new copy." },
  INVALID_FILE: { title: "That isn't a PDF or CSV", body: "Choose the statement file your bank gave you. Photos, Excel and Word files don't work." },
} as const;

export function ProblemScreen({ code, onChooseAnother, onBack }: { code: string; onChooseAnother: () => void; onBack: () => void }) {
  const copy = code === "TOO_LARGE" || code === "INVALID_FILE" ? COPY[code] : COPY.UNREADABLE;
  return (
    <Screen testID="upload-problem" footer={<Button title="Choose another file" onPress={onChooseAnother} />}>
      <UploadHeader onBack={onBack} />
      <View style={{ alignItems: "center", gap: spacing.cm, paddingTop: spacing.lg }}>
        <Gullak mood="calm" stage="clay" size={128} />
        <Text variant="heading" align="center" accessibilityRole="header">
          {copy.title}
        </Text>
        <Text variant="bodyMuted" align="center">
          {copy.body}
        </Text>
      </View>
    </Screen>
  );
}
```

`screens/column-map-screen.tsx`:

```tsx
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { formatDay } from "@/lib/dates";
import { messageFor } from "@/lib/errors";
import { formatRupees } from "@/lib/money";
import { colors, fonts, radius, spacing } from "@/theme";
import type { ColumnMap, DateFormat, ImportPreview, NeedsMapDetails } from "../api";
import { UploadHeader } from "../components/upload-header";
import { plural } from "../copy";
import { needsMapDetails } from "../error-routes";
import { useApplyColumns, useColumnPreview } from "../hooks";
import { useUpload } from "../upload-store";

export type Mode = "split" | "signed" | "drcr";

export type Draft = {
  date: number | null;
  description: number | null;
  debit: number | null;
  credit: number | null;
  amount: number | null;
  drCr: number | null;
  dateFormat: DateFormat | null;
};

const MODES: { value: Mode; label: string }[] = [
  { value: "split", label: "Two columns, in and out" },
  { value: "signed", label: "One column with + and −" },
  { value: "drcr", label: "One column and a Dr/Cr column" },
];

const FORMATS: { value: DateFormat; label: string }[] = [
  { value: "DD_MM_YYYY_SLASH", label: "DD/MM/YYYY" },
  { value: "DD_MM_YYYY_DASH", label: "DD-MM-YYYY" },
  { value: "DD_MM_YY_SLASH", label: "DD/MM/YY" },
  { value: "DD_MM_YY_DASH", label: "DD-MM-YY" },
  { value: "D_MMM_YYYY", label: "23 Oct 2026" },
  { value: "DD_MMM_YYYY_DASH", label: "23-Oct-2026" },
  { value: "YYYY_MM_DD", label: "YYYY-MM-DD" },
  { value: "MM_DD_YYYY_SLASH", label: "MM/DD/YYYY" },
];

/** The request the server gets for a choice of columns and amount style, or null until it is complete. */
export function toColumnMap(d: Draft, mode: Mode): ColumnMap | null {
  if (d.date === null || d.description === null || d.dateFormat === null) return null;
  const base = { date: d.date, description: d.description, dateFormat: d.dateFormat };
  if (mode === "split") {
    if (d.debit === null && d.credit === null) return null;
    return { ...base, debit: d.debit, credit: d.credit, amount: null, drCr: null };
  }
  if (d.amount === null) return null;
  if (mode === "drcr") {
    if (d.drCr === null) return null;
    return { ...base, debit: null, credit: null, amount: d.amount, drCr: d.drCr };
  }
  return { ...base, debit: null, credit: null, amount: d.amount, drCr: null };
}

type Props = { onApplied: (preview: ImportPreview) => void; onChooseAnother: () => void; onBack: () => void };

/** Spec 3.2 #1: the first rows, a choice per needed column, three parsed lines, "Looks right". Saved per bank. */
export function ColumnMapScreen({ onApplied, onChooseAnother, onBack }: Props) {
  const { failure } = useUpload();
  const details = needsMapDetails(failure);
  if (!details) {
    return (
      <Screen testID="upload-columns">
        <UploadHeader onBack={onBack} />
        <EmptyState title="Choose the file again" body="The statement is no longer open on this phone" action={<Button title="Choose a file" onPress={onChooseAnother} />} />
      </Screen>
    );
  }
  return <MapForm details={details} onApplied={onApplied} onChooseAnother={onChooseAnother} onBack={onBack} />;
}

function MapForm({ details, onApplied, onChooseAnother, onBack }: Props & { details: NeedsMapDetails }) {
  const { setPreview } = useUpload();
  const s = details.suggestion;
  const [mode, setMode] = useState<Mode>(s.debit === null && s.credit === null && s.amount !== null ? (s.drCr !== null ? "drcr" : "signed") : "split");
  const [draft, setDraft] = useState<Draft>({ ...s, dateFormat: null });
  const map = toColumnMap(draft, mode);
  const preview = useColumnPreview(details.importId, map);
  const apply = useApplyColumns(details.importId);
  const set = (key: keyof Omit<Draft, "dateFormat">) => (index: number) => setDraft((d) => ({ ...d, [key]: index }));
  const ready = map !== null && !preview.isFetching && preview.data !== undefined && preview.data.unreadable === 0 && preview.data.lines.length > 0;

  return (
    <Screen
      testID="upload-columns"
      footer={
        <>
          <Button
            title="Looks right"
            disabled={!ready}
            loading={apply.isPending}
            onPress={() => {
              if (!map) return;
              apply.mutate(map, {
                onSuccess: (p) => {
                  setPreview(p);
                  onApplied(p);
                },
              });
            }}
          />
          <Button title="Choose another file" variant="secondary" onPress={onChooseAnother} />
        </>
      }
    >
      <UploadHeader onBack={onBack} />
      <View style={{ gap: spacing.xs }}>
        <Text variant="heading" accessibilityRole="header">
          Match the columns
        </Text>
        <Text variant="bodyMuted">Pick which column holds each detail. We'll remember it for this bank.</Text>
      </View>

      <Text variant="label" style={{ fontFamily: fonts.ui700 }} accessibilityRole="header">
        First rows of your file
      </Text>
      <ScrollView horizontal contentContainerStyle={{ flexDirection: "column" }} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface }}>
        {[details.headers, ...details.sampleRows.slice(0, 5)].map((row, r) => (
          <View key={r} style={{ flexDirection: "row", borderTopWidth: r === 0 ? 0 : 1, borderTopColor: colors.line }}>
            {details.headers.map((_, c) => (
              <Text key={c} variant={r === 0 ? "label" : "caption"} color={colors.ink} numberOfLines={1} style={{ width: 128, padding: spacing.sm, fontFamily: r === 0 ? fonts.ui700 : fonts.ui400 }}>
                {row[c] ?? ""}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>

      <ColumnPicker label="Date" id="date" headers={details.headers} value={draft.date} onChange={set("date")} />
      <ColumnPicker label="Description" id="description" headers={details.headers} value={draft.description} onChange={set("description")} />
      <View style={{ gap: spacing.sm }}>
        <Text variant="label">Amounts are in</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {MODES.map((m) => (
            <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => setMode(m.value)} />
          ))}
        </View>
      </View>
      {mode === "split" ? (
        <>
          <ColumnPicker label="Money out" id="debit" headers={details.headers} value={draft.debit} onChange={set("debit")} />
          <ColumnPicker label="Money in" id="credit" headers={details.headers} value={draft.credit} onChange={set("credit")} />
        </>
      ) : (
        <ColumnPicker label="Amount" id="amount" headers={details.headers} value={draft.amount} onChange={set("amount")} />
      )}
      {mode === "drcr" ? <ColumnPicker label="Dr/Cr column" id="drcr" headers={details.headers} value={draft.drCr} onChange={set("drCr")} /> : null}
      <View style={{ gap: spacing.sm }}>
        <Text variant="label">Date format</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {FORMATS.map((f) => (
            <Chip key={f.value} label={f.label} selected={draft.dateFormat === f.value} onPress={() => setDraft((d) => ({ ...d, dateFormat: f.value }))} />
          ))}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text variant="label" style={{ fontFamily: fonts.ui700 }} accessibilityRole="header">
          How the first 3 lines read
        </Text>
        {map === null ? <Text variant="labelMuted">Pick every column to see them</Text> : null}
        {map !== null && preview.isFetching ? <Skeleton height={60} /> : null}
        {preview.isError ? (
          <Text variant="label" color={colors.bad} accessibilityRole="alert">
            {describeError(preview.error, messageFor)}
          </Text>
        ) : null}
        {map !== null && !preview.isFetching && preview.data ? (
          <>
            {preview.data.lines.map((l) => (
              <Text key={l.rowNo} variant="label">{`${formatDay(l.date)} · ${l.description} · ${formatRupees(l.amountPaise)} ${l.direction === "DEBIT" ? "out" : "in"}`}</Text>
            ))}
            {preview.data.unreadable > 0 ? (
              <Text variant="label" color={colors.bad}>{`${plural(preview.data.unreadable, "row", "rows")} of the first 3 didn't read with these choices`}</Text>
            ) : null}
          </>
        ) : null}
        {apply.isError ? (
          <Text variant="label" color={colors.bad} accessibilityRole="alert">
            {describeError(apply.error, messageFor)}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

function ColumnPicker({ label, id, headers, value, onChange }: { label: string; id: string; headers: string[]; value: number | null; onChange: (index: number) => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="label">{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {headers.map((h, i) => (
          <Chip key={i} label={(h || `Column ${i + 1}`).slice(0, 40)} selected={value === i} onPress={() => onChange(i)} testID={`${id}-${i}`} />
        ))}
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 4: Routes**

`app/app/upload/bank.tsx`:

```tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { BankErrorScreen } from "@/features/imports/screens/bank-error-screen";

export default function BankRoute() {
  const router = useRouter();
  const { bank } = useLocalSearchParams<{ bank?: string }>();
  return <BankErrorScreen bank={typeof bank === "string" ? bank : ""} onUploadCsv={() => router.replace("/upload")} onBack={() => router.replace("/upload")} />;
}
```

`app/app/upload/scanned.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { ScannedScreen } from "@/features/imports/screens/scanned-screen";

export default function ScannedRoute() {
  const router = useRouter();
  return <ScannedScreen onChooseAnother={() => router.replace("/upload")} onAddByHand={() => router.replace("/add")} onBack={() => router.replace("/upload")} />;
}
```

`app/app/upload/problem.tsx`:

```tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ProblemScreen } from "@/features/imports/screens/problem-screen";

export default function ProblemRoute() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  return <ProblemScreen code={typeof code === "string" ? code : "UNREADABLE"} onChooseAnother={() => router.replace("/upload")} onBack={() => router.replace("/upload")} />;
}
```

`app/app/upload/columns.tsx`:

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { ColumnMapScreen } from "@/features/imports/screens/column-map-screen";

export default function ColumnsRoute() {
  const router = useRouter();
  return <ColumnMapScreen onApplied={() => router.replace("/upload/preview")} onChooseAnother={() => router.replace("/upload")} onBack={() => router.replace("/upload")} />;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd app && npx jest src/features/imports && npm run lint`
Expected: PASS.

- [ ] **Step 6: Red team**

Dispatch `red-team` with task id `plan-04-task-13` with this task's header attacks. Findings to `docs/reports/red-team/plan-04-task-13.md`.

- [ ] **Step 7: Commit**

```bash
git add app/app/upload app/src/features/imports
git commit -m "feat(app): bank-not-supported, scanned, problem and CSV column-mapping screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: App: swipe-to-sort

**Owner:** app-engineer. **Test IDs:** APP-18; Review Focus `doubleTapTagsOnlyOnce`; MAT-15 (the misc-cash offer on the finished state); APP-29 for the screen. **Red team:** no (the server side of tagging and committing was attacked in Tasks 8 and 9).

**Files:**
- Modify: `app/src/components/ui/button.tsx` (an `ink` variant), `app/jest.setup.ts` (gesture-handler test setup)
- Create (`app/src/features/imports/`): `swipe.ts`, `swipe.test.ts`, `components/swipe-card.tsx`, `screens/sort-screen.tsx`, `sort.test.tsx`
- Create (route): `app/app/upload/sort.tsx`

**Interfaces:**
- Consumes: Task 11 (`useToSort`, `useTag`, `useUndoTag`, `useCommit`, `useMiscCash`, `categoryLabel`, `categoryIcon`, `isCategoryCode`, `hintCopy`, `sortSummary`), Plan 2's `UndoBar` (`@/features/profile/components/undo-bar`), `Gullak`, `Chip`, `Button`, `ProgressBar`, `motion.undoWindow`, `formatRupees`, `formatDay`.
- Produces: route `/upload/sort?importId=`; `decideSwipe(tx, ty, vx, vy, width): "NEED" | "WANT" | "REGRET" | null` and `project(velocity)`; `SwipeCard`; `SortScreen({ importId, onBack, onFinishedLater, onSeeInsights, now?, reduceMotion? })`; `Button` variant `ink`.

Motion, per `.claude/skills/expo-animation`: the swipe is a rare, finger-driven moment, so it gets a gesture (`Gesture.Pan`, axis offsets declared), shared values on the UI thread, a projected-velocity decision (a flick counts), a 200 ms ease-out fly-out, a spring back (400 ms, damping 0.8, the finger's velocity) when the swipe does not commit, one light haptic at the moment it commits, and `scheduleOnRN` only in `onEnd`. Taps on Want, Regret and Need do not animate the card (decision 25). Reduce Motion: no fly-out or tilt; the card is replaced at once.

- [ ] **Step 1: Write the failing tests**

`app/src/features/imports/swipe.test.ts`:

```ts
import { decideSwipe, project } from "./swipe";

const W = 350; // threshold 105

describe("swipe decision", () => {
  it("right is Need, left is Want, up is Regret", () => {
    expect(decideSwipe(150, 0, 0, 0, W)).toBe("NEED");
    expect(decideSwipe(-150, 0, 0, 0, W)).toBe("WANT");
    expect(decideSwipe(0, -150, 0, 0, W)).toBe("REGRET");
  });

  it("a short slow drag springs back", () => {
    expect(decideSwipe(40, 10, 50, 0, W)).toBeNull();
    expect(decideSwipe(0, 200, 0, 0, W)).toBeNull();
  });

  it("a flick counts even when the finger barely moved", () => {
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(decideSwipe(30, 0, 1200, 0, W)).toBe("NEED");
    expect(decideSwipe(0, -20, 0, -900, W)).toBe("REGRET");
  });

  it("mostly up and a little sideways is Regret", () => {
    expect(decideSwipe(110, -200, 0, 0, W)).toBe("REGRET");
  });
});
```

`app/src/features/imports/sort.test.tsx` (APP-18):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { State, type PanGesture } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { NetworkError } from "@/lib/api-errors";
import type { CommitResult, SortLine } from "./api";
import { SortScreen } from "./screens/sort-screen";

jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("./api", () => ({ importsApi: { toSort: jest.fn(), tag: jest.fn(), undoTag: jest.fn(), commit: jest.fn(), miscCash: jest.fn() } }));
import { importsApi } from "./api";
const mocked = importsApi as jest.Mocked<typeof importsApi>;

function line(i: number, raw: string, suggestions: string[] = ["eating_out", "other"]): SortLine {
  return { lineId: `l${i}`, date: `2026-10-${String(2 + i).padStart(2, "0")}`, amountPaise: (40 + i) * 100, raw, hint: "CAFE", suggestions, tag: null, category: null };
}

const deck: SortLine[] = Array.from({ length: 14 }, (_, i) => line(i, `UPI/SHOP ${i}`));
deck[0] = line(0, "UPI/MURUGAN TEA STALL");

const committed: CommitResult = {
  importId: "i1", created: 84, matched: 9, needsReview: 0, xpAwarded: 10, accuracyPercent: 11,
  summary: { need: 0, want: 0, regret: 0 }, miscCash: null,
};

let clock = 0;
const now = () => (clock += 1000);

function renderSort(lines: SortLine[], props: Partial<React.ComponentProps<typeof SortScreen>> = {}) {
  mocked.toSort.mockResolvedValue({ lines });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const handlers = { onBack: jest.fn(), onFinishedLater: jest.fn(), onSeeInsights: jest.fn() };
  render(
    <QueryClientProvider client={qc}>
      <SortScreen importId="i1" now={now} reduceMotion {...handlers} {...props} />
    </QueryClientProvider>,
  );
  return handlers;
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.tag.mockImplementation((_id, body) => Promise.resolve({ lineId: body.lineId, tag: body.tag, category: body.category, left: 0 }));
  mocked.undoTag.mockResolvedValue({ lineId: "l0", left: 14 });
  mocked.commit.mockResolvedValue(committed);
});

describe("Swipe-to-sort (APP-18)", () => {
  it("shows the first card with its chips and the counter", async () => {
    renderSort(deck);
    expect(await screen.findByText("14 left")).toBeTruthy();
    expect(screen.getByText("Spends to sort")).toBeTruthy();
    expect(screen.getByText("UPI/MURUGAN TEA STALL")).toBeTruthy();
    expect(screen.getByText("₹40")).toBeTruthy();
    expect(screen.getByText("Fri, 2 Oct")).toBeTruthy();
    expect(screen.getByText("Looks like a café")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eating out" })).toHaveProp("accessibilityState", expect.objectContaining({ selected: true }));
  });

  it("buttons tag with the chosen chip and count down", async () => {
    renderSort(deck);
    await screen.findByText("14 left");
    fireEvent.press(screen.getByRole("button", { name: "Other" }));
    fireEvent.press(screen.getByTestId("tag-want"));
    await waitFor(() => expect(mocked.tag).toHaveBeenCalledWith("i1", { lineId: "l0", tag: "WANT", category: "other" }));
    expect(screen.getByText("13 left")).toBeTruthy();
    fireEvent.press(screen.getByTestId("tag-regret"));
    await waitFor(() => expect(mocked.tag).toHaveBeenLastCalledWith("i1", { lineId: "l1", tag: "REGRET", category: "eating_out" }));
    expect(screen.getByText("12 left")).toBeTruthy();
  });

  it("a swipe tags like a button", async () => {
    renderSort(deck);
    await screen.findByText("14 left");
    fireGestureHandler<PanGesture>(getByGestureTestId("swipe-card"), [
      { state: State.BEGAN, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: 120, translationY: 0, velocityX: 900, velocityY: 0 },
      { state: State.END, translationX: 160, translationY: 0, velocityX: 900, velocityY: 0 },
    ]);
    await waitFor(() => expect(mocked.tag).toHaveBeenCalledWith("i1", { lineId: "l0", tag: "NEED", category: "eating_out" }));
    expect(screen.getByText("13 left")).toBeTruthy();
  });

  it("Undo brings the last card back", async () => {
    renderSort(deck);
    await screen.findByText("14 left");
    fireEvent.press(screen.getByTestId("tag-need"));
    await waitFor(() => expect(mocked.tag).toHaveBeenCalled());
    await act(async () => undefined); // let the tag request settle; Undo waits for it
    fireEvent.press(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mocked.undoTag).toHaveBeenCalledWith("i1"));
    expect(await screen.findByText("14 left")).toBeTruthy();
    expect(screen.getByText("UPI/MURUGAN TEA STALL")).toBeTruthy();
  });

  it("doubleTapTagsOnlyOnce", async () => { // Review Focus
    const frozen = () => 5000;
    renderSort(deck, { now: frozen });
    await screen.findByText("14 left");
    fireEvent.press(screen.getByTestId("tag-need"));
    fireEvent.press(screen.getByTestId("tag-need"));
    await waitFor(() => expect(mocked.tag).toHaveBeenCalledTimes(1));
    expect(screen.getByText("13 left")).toBeTruthy();
  });

  it("finishes with the summary, then commits and opens Insights", async () => {
    const three = [line(0, "UPI/A"), line(1, "UPI/B"), line(2, "UPI/C")];
    const { onSeeInsights } = renderSort(three);
    await screen.findByText("3 left");
    fireEvent.press(screen.getByTestId("tag-need"));
    await waitFor(() => expect(screen.getByText("2 left")).toBeTruthy());
    fireEvent.press(screen.getByTestId("tag-regret"));
    await waitFor(() => expect(screen.getByText("1 left")).toBeTruthy());
    fireEvent.press(screen.getByTestId("tag-regret"));
    expect(await screen.findByText("All sorted")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("3 spends sorted: 1 need, 0 wants, 2 regrets. We’ll remember these payees next time.")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "See where it went" })));
    await waitFor(() => expect(mocked.commit).toHaveBeenCalledWith("i1"));
    await waitFor(() => expect(onSeeInsights).toHaveBeenCalled());
  });

  it("says 1 regret in the singular", async () => {
    renderSort([line(0, "UPI/A")]);
    await screen.findByText("1 left");
    fireEvent.press(screen.getByTestId("tag-regret"));
    expect(await screen.findByText("1 spend sorted: 0 needs, 0 wants, 1 regret. We’ll remember these payees next time.")).toBeTruthy();
  });

  it("finish later commits what is left for review", async () => {
    const { onFinishedLater } = renderSort(deck);
    await screen.findByText("14 left");
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Finish later" })));
    await waitFor(() => expect(mocked.commit).toHaveBeenCalledWith("i1"));
    await waitFor(() => expect(onFinishedLater).toHaveBeenCalled());
  });

  it("a failed tag puts the card back and says why", async () => {
    mocked.tag.mockRejectedValueOnce(new NetworkError("network"));
    renderSort(deck);
    await screen.findByText("14 left");
    fireEvent.press(screen.getByTestId("tag-need"));
    expect(await screen.findByText("No connection. Check your network and try again.")).toBeTruthy();
    expect(screen.getByText("14 left")).toBeTruthy();
  });

  it("offers misc cash once after the commit (MAT-15)", async () => {
    mocked.commit.mockResolvedValue({ ...committed, miscCash: { withdrawnPaise: 200_000, loggedPaise: 140_000, differencePaise: 60_000 } });
    mocked.miscCash.mockResolvedValue({ created: true, transactionId: "t1" });
    renderSort([]);
    expect(await screen.findByText("You took out ₹2,000 in cash and logged ₹1,400. Add the other ₹600 as misc cash?")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Add ₹600 as misc cash" })));
    await waitFor(() => expect(mocked.miscCash).toHaveBeenCalledWith("i1", true));
    expect(screen.queryByText(/misc cash\?/)).toBeNull();
  });

  it("shows an error state with Retry when the list fails", async () => {
    mocked.toSort.mockRejectedValueOnce(new Error("boom"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SortScreen importId="i1" onBack={jest.fn()} onFinishedLater={jest.fn()} onSeeInsights={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd app && npx jest src/features/imports/swipe.test.ts src/features/imports/sort.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Setup, the ink button and the swipe maths**

In `app/jest.setup.ts`, add at the top: `import "react-native-gesture-handler/jestSetup";`.

In `app/src/components/ui/button.tsx`, add to `variants`:

```ts
  ink: { background: colors.ink, border: colors.ink, text: colors.darkText },
```

`app/src/features/imports/swipe.ts`:

```ts
export type SwipeTag = "NEED" | "WANT" | "REGRET";

/** Where a flick would come to rest: Apple's decay form, as in the expo-animation recipes. */
export function project(velocity: number, decelerationRate = 0.998): number {
  "worklet";
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Right is Need, left is Want, up is Regret (spec 2.3). Distance plus projected velocity, so a flick counts. */
export function decideSwipe(tx: number, ty: number, vx: number, vy: number, width: number): SwipeTag | null {
  "worklet";
  const px = tx + project(vx);
  const py = ty + project(vy);
  const threshold = width * 0.3;
  if (py < -threshold && Math.abs(py) > Math.abs(px)) return "REGRET";
  if (px > threshold) return "NEED";
  if (px < -threshold) return "WANT";
  return null;
}
```

- [ ] **Step 4: The card and the screen**

`components/swipe-card.tsx`:

```tsx
import * as Haptics from "expo-haptics";
import React, { useMemo } from "react";
import { ScrollView, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Chip } from "@/components/ui/chip";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { formatDay } from "@/lib/dates";
import { formatRupees } from "@/lib/money";
import { colors, radius, spacing } from "@/theme";
import type { SortLine, Tag } from "../api";
import { categoryIcon, categoryLabel, isCategoryCode, type CategoryCode } from "../categories";
import { hintCopy } from "../copy";
import { decideSwipe } from "../swipe";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

function haptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

type Props = {
  line: SortLine;
  category: CategoryCode;
  onCategory: (code: CategoryCode) => void;
  onTag: (tag: Tag) => void;
  width: number;
  reduceMotion?: boolean;
};

export function SwipeCard({ line, category, onCategory, onTag, width, reduceMotion }: Props) {
  const system = useReducedMotion();
  const reduced = reduceMotion ?? system;
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .withTestId("swipe-card")
        .activeOffsetX([-12, 12])
        .activeOffsetY([-12, 12])
        .onUpdate((e) => {
          x.set(e.translationX);
          y.set(e.translationY > 0 ? e.translationY * 0.3 : e.translationY);
        })
        .onEnd((e) => {
          const tag = decideSwipe(e.translationX, e.translationY, e.velocityX, e.velocityY, width);
          if (tag === null) {
            x.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: e.velocityX }));
            y.set(withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: e.velocityY }));
            return;
          }
          scheduleOnRN(haptic);
          if (reduced) {
            x.set(0);
            y.set(0);
            scheduleOnRN(onTag, tag);
            return;
          }
          const toX = tag === "NEED" ? width * 1.5 : tag === "WANT" ? -width * 1.5 : x.get();
          const toY = tag === "REGRET" ? -width * 2 : y.get();
          x.set(withTiming(toX, { duration: 200, easing: EASE_OUT }));
          y.set(
            withTiming(toY, { duration: 200, easing: EASE_OUT }, (finished) => {
              if (finished) scheduleOnRN(onTag, tag);
            }),
          );
        }),
    [width, reduced, onTag, x, y],
  );

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: y.get() },
      { rotateZ: `${reduced ? 0 : interpolate(x.get(), [-width, 0, width], [-8, 0, 8], Extrapolation.CLAMP)}deg` },
    ],
  }));

  const chips = line.suggestions.filter(isCategoryCode);
  const shown = chips.includes(category) ? chips : [category, ...chips];

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessibilityLabel={`${formatRupees(line.amountPaise)} on ${formatDay(line.date)}, ${line.raw}`}
        style={[{ padding: spacing.lg, gap: spacing.md, borderRadius: radius.card, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }, style]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.accentTint, alignItems: "center", justifyContent: "center" }}>
            <Icon name={categoryIcon[category]} size={24} color={colors.accentDeep} />
          </View>
          <Text variant="labelMuted">{formatDay(line.date)}</Text>
        </View>
        <View style={{ gap: spacing.xs }}>
          <Text variant="hero" style={{ fontVariant: ["tabular-nums"] }}>
            {formatRupees(line.amountPaise)}
          </Text>
          <Text variant="bodyStrong">{line.raw}</Text>
          <Text variant="labelMuted">{hintCopy[line.hint]}</Text>
        </View>
        <View style={{ gap: spacing.sm }}>
          <Text variant="caption">Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {shown.map((code) => (
              <Chip key={code} label={categoryLabel[code]} selected={code === category} onPress={() => onCategory(code)} />
            ))}
          </ScrollView>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Icon name="left" size={14} color={colors.muted} />
            <Text variant="caption">Want</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Icon name="up" size={14} color={colors.muted} />
            <Text variant="caption">Regret</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Text variant="caption">Need</Text>
            <Icon name="right" size={14} color={colors.muted} />
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
```

`screens/sort-screen.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { Gullak } from "@/features/gullak/gullak";
import { UndoBar } from "@/features/profile/components/undo-bar";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { formatRupees } from "@/lib/money";
import { colors, radius, spacing } from "@/theme";
import type { CommitResult, SortLine, Tag } from "../api";
import { isCategoryCode, type CategoryCode } from "../categories";
import { SwipeCard } from "../components/swipe-card";
import { UploadHeader } from "../components/upload-header";
import { sortSummary } from "../copy";
import { useCommit, useMiscCash, useTag, useToSort, useUndoTag } from "../hooks";

const LOCKOUT_MS = 300;

type Props = {
  importId: string;
  onBack: () => void;
  onFinishedLater: () => void;
  onSeeInsights: () => void;
  now?: () => number;
  reduceMotion?: boolean;
};

type Tagged = { line: SortLine; tag: Tag };

function firstCategory(line: SortLine): CategoryCode {
  const first = line.suggestions.find(isCategoryCode);
  return first ?? "other";
}

export function SortScreen({ importId, onBack, onFinishedLater, onSeeInsights, now = Date.now, reduceMotion }: Props) {
  const toSort = useToSort(importId);
  const tagMutation = useTag(importId);
  const undoMutation = useUndoTag(importId);
  const commitMutation = useCommit(importId);
  const misc = useMiscCash(importId);
  const { width } = useWindowDimensions();

  const [queue, setQueue] = useState<SortLine[] | null>(null);
  const [tagged, setTagged] = useState<Tagged[]>([]);
  const [chips, setChips] = useState<Record<string, CategoryCode>>({});
  const [undoable, setUndoable] = useState<Tagged | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [navAfter, setNavAfter] = useState(false);
  const [miscAnswered, setMiscAnswered] = useState(false);
  const lastTag = useRef(Number.NEGATIVE_INFINITY);
  const committing = useRef(false);

  useEffect(() => {
    if (toSort.data && queue === null) {
      setQueue(toSort.data.lines.filter((l) => l.tag === null));
      setTagged(toSort.data.lines.flatMap((l) => (l.tag ? [{ line: l, tag: l.tag }] : [])));
    }
  }, [toSort.data, queue]);

  const total = toSort.data?.lines.length ?? 0;
  const left = queue?.length ?? 0;
  const finished = queue !== null && left === 0;

  const tag = (line: SortLine, t: Tag) => {
    const at = now();
    if (at - lastTag.current < LOCKOUT_MS) return;
    lastTag.current = at;
    const category = chips[line.lineId] ?? firstCategory(line);
    setError(null);
    setQueue((q) => (q ?? []).filter((l) => l.lineId !== line.lineId));
    setTagged((d) => [...d, { line, tag: t }]);
    setUndoable({ line, tag: t });
    tagMutation.mutate(
      { lineId: line.lineId, tag: t, category },
      {
        onError: (e) => {
          setQueue((q) => [line, ...(q ?? [])]);
          setTagged((d) => d.filter((x) => x.line.lineId !== line.lineId));
          setUndoable(null);
          setError(describeError(e, messageFor));
        },
      },
    );
  };

  const undo = () => {
    const last = undoable;
    if (!last) return;
    setUndoable(null);
    undoMutation.mutate(undefined, {
      onSuccess: () => {
        setQueue((q) => [last.line, ...(q ?? [])]);
        setTagged((d) => d.filter((x) => x.line.lineId !== last.line.lineId));
      },
      onError: (e) => setError(describeError(e, messageFor)),
    });
  };

  const commit = useCallback(
    (then?: () => void) => {
      if (committing.current) return;
      committing.current = true;
      commitMutation.mutate(undefined, {
        onSuccess: (r) => {
          setResult(r);
          then?.();
        },
        onError: (e) => {
          committing.current = false;
          setError(describeError(e, messageFor));
        },
      });
    },
    [commitMutation],
  );

  // The commit waits for the last Undo window (decision 24) and for any tag still on its way.
  useEffect(() => {
    if (finished && !undoable && !tagMutation.isPending && !undoMutation.isPending && result === null) commit();
  }, [finished, undoable, tagMutation.isPending, undoMutation.isPending, result, commit]);

  useEffect(() => {
    if (navAfter && result) onSeeInsights();
  }, [navAfter, result, onSeeInsights]);

  const expireUndo = useCallback(() => setUndoable(null), []);

  if (toSort.isLoading || (toSort.data && queue === null)) {
    return (
      <Screen testID="upload-sort">
        <UploadHeader onBack={onBack} />
        <Skeleton height={360} />
      </Screen>
    );
  }
  if (toSort.isError) {
    return (
      <Screen testID="upload-sort">
        <UploadHeader onBack={onBack} />
        <ErrorState body={describeError(toSort.error, messageFor)} onRetry={() => void toSort.refetch()} />
      </Screen>
    );
  }

  const counts = { need: 0, want: 0, regret: 0 };
  for (const t of tagged) counts[t.tag === "NEED" ? "need" : t.tag === "WANT" ? "want" : "regret"] += 1;
  const current = queue?.[0] ?? null;
  const offer = result?.miscCash && !miscAnswered ? result.miscCash : null;

  return (
    <Screen testID="upload-sort">
      <View style={{ gap: spacing.sm }}>
        <UploadHeader onBack={onBack} />
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
          <Text variant="title" accessibilityRole="header">
            Spends to sort
          </Text>
          <Text variant="labelMuted">{finished ? "Done" : `${left} left`}</Text>
        </View>
        <ProgressBar value={total === 0 ? 100 : Math.round(((total - left) * 100) / total)} label="Sorted" />
      </View>

      {error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {current ? (
        <>
          <View>
            <View aria-hidden style={{ position: "absolute", left: spacing.md, right: spacing.md, top: spacing.md, bottom: -spacing.md, borderRadius: radius.card, backgroundColor: colors.stack2 }} />
            <View aria-hidden style={{ position: "absolute", left: spacing.sm, right: spacing.sm, top: spacing.sm, bottom: -spacing.sm, borderRadius: radius.card, backgroundColor: colors.stack1 }} />
            <SwipeCard
              key={current.lineId}
              line={current}
              category={chips[current.lineId] ?? firstCategory(current)}
              onCategory={(code) => setChips((c) => ({ ...c, [current.lineId]: code }))}
              onTag={(t) => tag(current, t)}
              width={width - spacing.md * 2}
              reduceMotion={reduceMotion}
            />
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm, paddingTop: spacing.md }}>
            <Button title="Want" variant="secondary" icon={<Icon name="left" size={18} />} onPress={() => tag(current, "WANT")} style={{ flex: 1 }} testID="tag-want" />
            <Button title="Regret" variant="secondary" icon={<Icon name="up" size={18} />} onPress={() => tag(current, "REGRET")} style={{ flex: 1 }} testID="tag-regret" />
            <Button title="Need" variant="ink" icon={<Icon name="right" size={18} color={colors.darkText} />} onPress={() => tag(current, "NEED")} style={{ flex: 1 }} testID="tag-need" />
          </View>
          <Button title="Finish later" variant="ghost" loading={commitMutation.isPending} onPress={() => commit(onFinishedLater)} />
        </>
      ) : null}

      {finished ? (
        <View style={{ alignItems: "center", gap: spacing.md, paddingTop: spacing.lg }}>
          <Gullak mood="celebrating" stage="clay" size={176} />
          <Text variant="heading" accessibilityRole="header">
            All sorted
          </Text>
          <Text variant="body" align="center">
            {total === 0 ? "Nothing needed sorting this time" : sortSummary(counts)}
          </Text>
          {result && result.xpAwarded > 0 ? (
            <View style={{ paddingHorizontal: spacing.cm, minHeight: 28, justifyContent: "center", borderRadius: radius.full, backgroundColor: colors.warnTint }}>
              <Text variant="label" color={colors.warnInk}>{`+${result.xpAwarded} XP`}</Text>
            </View>
          ) : null}
          {offer ? (
            <View style={{ alignSelf: "stretch", gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.sand }}>
              <Text variant="body">{`You took out ${formatRupees(offer.withdrawnPaise)} in cash and logged ${formatRupees(offer.loggedPaise)}. Add the other ${formatRupees(offer.differencePaise)} as misc cash?`}</Text>
              <Button
                title={`Add ${formatRupees(offer.differencePaise)} as misc cash`}
                variant="secondary"
                loading={misc.isPending}
                onPress={() => misc.mutate(true, { onSuccess: () => setMiscAnswered(true), onError: (e) => setError(describeError(e, messageFor)) })}
              />
              <Button title="No thanks" variant="ghost" onPress={() => misc.mutate(false, { onSettled: () => setMiscAnswered(true) })} />
            </View>
          ) : null}
          <Button
            title="See where it went"
            loading={navAfter && result === null}
            onPress={() => {
              if (result) {
                onSeeInsights();
                return;
              }
              setUndoable(null);
              setNavAfter(true);
            }}
            style={{ alignSelf: "stretch" }}
          />
        </View>
      ) : null}

      {undoable ? (
        <UndoBar message={`Tagged as ${undoable.tag.toLowerCase()}`} onUndo={tagMutation.isPending ? () => undefined : undo} onExpire={expireUndo} />
      ) : null}
    </Screen>
  );
}
```

The `Gullak` celebrates only on this finished state, a rare moment (expo-animation's delight tier).

- [ ] **Step 5: Route**

`app/app/upload/sort.tsx`:

```tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { SortScreen } from "@/features/imports/screens/sort-screen";

export default function SortRoute() {
  const router = useRouter();
  const { importId } = useLocalSearchParams<{ importId?: string }>();
  if (typeof importId !== "string") return null;
  return (
    <SortScreen
      importId={importId}
      onBack={() => router.back()}
      onFinishedLater={() => router.dismissTo("/(tabs)")}
      onSeeInsights={() => router.dismissTo("/(tabs)/insights")}
    />
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `cd app && npm test && npm run lint && npm run typecheck`
Expected: PASS (typecheck now sees every upload route).

- [ ] **Step 7: Feel-check on a device**

On the slowest Android you have, in a release build (`npx expo run:android --variant release`), sort the HDFC sample: flick each way, drag slowly and let go short of the threshold (it must spring back), interrupt a fly-out, and turn on Remove animations (Android) or Reduce Motion (iOS). Record what you tried in the task report.

- [ ] **Step 8: Commit**

```bash
git add app/jest.setup.ts app/src/components/ui/button.tsx app/app/upload/sort.tsx app/src/features/imports
git commit -m "feat(app): swipe-to-sort with undo, finished state and the misc-cash offer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: App: entry points, link badge, E2E-04 and E2E-05

**Owner:** app-engineer. **Test IDs:** APP-33 (new: link status on a spend), E2E-04, E2E-05; APP-29 for the entry points. **Red team:** no.

**Files:**
- Modify: `app/app/_layout.tsx` (the `upload` stack in the signed-in group), `app/app/(tabs)/insights.tsx`, `app/src/features/home/today-section.tsx` (Plan 3's version), Plan 3's spend detail screen (mount `LinkBadge`)
- Create: `app/src/features/imports/components/link-badge.tsx`, `app/src/features/imports/link-badge.test.tsx`, `app/src/features/imports/entry-points.test.tsx`
- Create: `app/e2e/statement.yaml`, `app/e2e/wrong-password.yaml`, `app/e2e/assets/hdfc-locked.pdf` (copied)
- Modify: `app/e2e/README.md`

**Interfaces:**
- Consumes: `useUnlink` (Task 11); the server's `linkConfidence` on spends (Task 9); Plan 3's spend detail screen and its spend type (`id`, `status`, `linkConfidence`); Plan 2's `setup.yaml`, `scripts/email.js`, `scripts/otp.js`.
- Produces: `LinkBadge({ spendId, status, linkConfidence })`; the entry points `/upload` from Insights ("Add a statement" and the header's "Upload statement" icon) and from Home ("Or upload last month's statement"); Maestro flows `statement.yaml` (E2E-04) and `wrong-password.yaml` (E2E-05).

- [ ] **Step 1: Write the failing tests**

`app/src/features/imports/entry-points.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";

const push = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

import InsightsRoute from "../../../app/(tabs)/insights";
import { TodaySection } from "../home/today-section";

describe("Ways into the upload flow", () => {
  it("Insights offers Add a statement and the header upload button", () => {
    render(<InsightsRoute />);
    fireEvent.press(screen.getByRole("button", { name: "Add a statement" }));
    fireEvent.press(screen.getByRole("button", { name: "Upload statement" }));
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledWith("/upload");
  });

  it("Home's first-run section links to it", () => {
    render(<TodaySection />);
    expect(screen.getByRole("link", { name: "Or upload last month's statement" })).toBeTruthy();
  });
});
```

If Plan 3's `TodaySection` takes props (the day's spends), render it the way Plan 3's own tests do with an empty day.

`app/src/features/imports/link-badge.test.tsx` (APP-33):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { ApiError } from "@/lib/api-errors";
import { LinkBadge } from "./components/link-badge";

jest.mock("./api", () => ({ importsApi: { unlink: jest.fn() } }));
import { importsApi } from "./api";
const mocked = importsApi as jest.Mocked<typeof importsApi>;

function renderBadge(props: React.ComponentProps<typeof LinkBadge>) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LinkBadge {...props} />
    </QueryClientProvider>,
  );
}

describe("Link status on a spend (APP-33)", () => {
  it("a high-confidence link says Confirmed by bank and can be unlinked", async () => {
    mocked.unlink.mockResolvedValue({});
    renderBadge({ spendId: "s1", status: "CONFIRMED", linkConfidence: "HIGH" });
    expect(screen.getByText("Confirmed by bank")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(mocked.unlink).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.queryByText("Confirmed by bank")).toBeNull());
  });

  it("a medium link says Linked with Undo", () => {
    renderBadge({ spendId: "s1", status: "CONFIRMED", linkConfidence: "MEDIUM" });
    expect(screen.getByText("Linked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("a pending spend shows nothing", () => {
    renderBadge({ spendId: "s1", status: "PENDING", linkConfidence: null });
    expect(screen.queryByText("Linked")).toBeNull();
    expect(screen.queryByText("Confirmed by bank")).toBeNull();
  });

  it("a failed unlink says why", async () => {
    mocked.unlink.mockRejectedValue(new ApiError("NOT_LINKED", 409, "x"));
    renderBadge({ spendId: "s1", status: "CONFIRMED", linkConfidence: "HIGH" });
    fireEvent.press(screen.getByRole("button", { name: "Unlink" }));
    expect(await screen.findByText("This spend isn't linked to a bank line")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd app && npx jest src/features/imports/entry-points.test.tsx src/features/imports/link-badge.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the code**

`components/link-badge.tsx`:

```tsx
import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { colors, spacing, touchTarget } from "@/theme";
import { useUnlink } from "../hooks";

type Props = { spendId: string; status: string; linkConfidence: "HIGH" | "MEDIUM" | null };

/** Spec 2.5: "Confirmed by bank" for a silent link, "Linked · Undo" for a medium one; either can be undone here. */
export function LinkBadge({ spendId, status, linkConfidence }: Props) {
  const unlink = useUnlink();
  const [gone, setGone] = useState(false);
  if (status !== "CONFIRMED" || linkConfidence === null || gone) return null;
  const high = linkConfidence === "HIGH";
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: touchTarget }}>
        {high ? <Icon name="check" size={16} color={colors.good} /> : null}
        <Text variant="label" color={high ? colors.goodDeep : colors.ink}>
          {high ? "Confirmed by bank" : "Linked"}
        </Text>
        {high ? null : <Text variant="labelMuted">·</Text>}
        <Button title={high ? "Unlink" : "Undo"} variant="ghost" loading={unlink.isPending} onPress={() => unlink.mutate(spendId, { onSuccess: () => setGone(true) })} />
      </View>
      {unlink.isError ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {describeError(unlink.error, messageFor)}
        </Text>
      ) : null}
    </View>
  );
}
```

In Plan 3's spend detail screen, render under the amount: `<LinkBadge spendId={spend.id} status={spend.status} linkConfidence={spend.linkConfidence} />` (import from `@/features/imports/components/link-badge`), and add `linkConfidence: "HIGH" | "MEDIUM" | null` to Plan 3's spend type. A spend whose status changes back to `PENDING` after an unlink shows nothing, and Plan 3's own query invalidation (`["transactions"]`, `todayKey`) refreshes the screen.

`app/app/(tabs)/insights.tsx` (whole file; Plan 7 replaces the body and keeps both entry points):

```tsx
import { useRouter } from "expo-router";
import React from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function InsightsRoute() {
  const router = useRouter();
  return (
    <Screen testID="insights">
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="heading" accessibilityRole="header">
          Insights
        </Text>
        <Button title="Upload statement" iconOnly variant="secondary" icon={<Icon name="upload" size={20} />} onPress={() => router.push("/upload")} />
      </View>
      <EmptyState
        title="Nothing to show yet"
        body="Log spends or upload a statement and your month appears here"
        action={<Button title="Add a statement" onPress={() => router.push("/upload")} />}
      />
    </Screen>
  );
}
```

In `app/src/features/home/today-section.tsx` (Plan 3's version), replace the "Or upload last month's statement" caption with a link (imports: `Link` from `expo-router`, `Pressable` from `react-native`, `touchTarget` from `@/theme`):

```tsx
<Link href="/upload" asChild>
  <Pressable accessibilityRole="link" accessibilityLabel="Or upload last month's statement" style={{ minHeight: touchTarget, alignItems: "center", justifyContent: "center" }}>
    <Text variant="label" style={{ textDecorationLine: "underline" }}>
      Or upload last month's statement
    </Text>
  </Pressable>
</Link>
```

In `app/app/_layout.tsx`, `Navigation` gains the upload stack in the signed-in group:

```tsx
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="upload" />
      </Stack.Protected>
```

(Keep any screens Plan 3 added to that group, such as `add` and `spend/[id]`.)

- [ ] **Step 4: Run the tests**

Run: `cd app && npm test && npm run lint && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: The Maestro flows**

Copy the sample: `mkdir -p app/e2e/assets && cp server/src/test/resources/statements/hdfc-locked.pdf app/e2e/assets/hdfc-locked.pdf`.

`app/e2e/statement.yaml` (E2E-04):

```yaml
# E2E-04: Insights → Add a statement → the HDFC sample with its password → preview → sort every card → All sorted.
# The sample must be on the emulator first: adb push app/e2e/assets/hdfc-locked.pdf /sdcard/Download/hdfc-locked.pdf
appId: in.gullak.app
---
- runFlow: setup.yaml
- tapOn: "Insights"
- tapOn: "Add a statement"
- assertVisible: "Fills in the spends you didn't log and confirms the ones you did"
- tapOn: "Choose a PDF or CSV"
- tapOn:
    text: "Downloads"
    optional: true
- tapOn: "hdfc-locked.pdf"
- assertVisible: "Password-protected PDF"
- tapOn: "PDF password"
- inputText: "GULLAK2026"
- tapOn: "Unlock and read"
- extendedWaitUntil:
    visible: "All read"
    timeout: 20000
- tapOn: "See what we found"
- assertVisible: "84 transactions"
- assertVisible: "Unlocked · HDFC Bank"
- tapOn:
    text: "Import and sort .*"
- assertVisible:
    text: ".* left"
- repeat:
    while:
      notVisible: "All sorted"
    commands:
      - tapOn:
          id: "tag-need"
- assertVisible: "All sorted"
- tapOn: "See where it went"
- assertVisible: "Insights"
```

The setup flow's user has Rent and Cook as fixed costs and no logged spends, so the preview shows 2 fixed lines and 15 to sort (the maid's ₹1,500 has no fixed cost to match); the loop sorts however many there are.

`app/e2e/wrong-password.yaml` (E2E-05):

```yaml
# E2E-05: a wrong password, then the right one, without choosing the file again.
appId: in.gullak.app
---
- runFlow: setup.yaml
- tapOn: "Insights"
- tapOn: "Add a statement"
- tapOn: "Choose a PDF or CSV"
- tapOn:
    text: "Downloads"
    optional: true
- tapOn: "hdfc-locked.pdf"
- tapOn: "PDF password"
- inputText: "WRONG"
- tapOn: "Unlock and read"
- extendedWaitUntil:
    visible: "That password didn't open the file. Check capital letters, then try your customer ID or date of birth."
    timeout: 20000
- assertVisible: "Try again"
- tapOn: "PDF password"
- eraseText: 10
- inputText: "GULLAK2026"
- tapOn: "Try again"
- extendedWaitUntil:
    visible: "All read"
    timeout: 20000
- assertVisible: "hdfc-locked.pdf"
```

Add to `app/e2e/README.md`:

````markdown
## Statement flows (E2E-04, E2E-05)

The server needs `GULLAK_ENC_KEY` set. Push the sample to the emulator once:

```bash
adb push app/e2e/assets/hdfc-locked.pdf /sdcard/Download/hdfc-locked.pdf
cd app && maestro test -e GULLAK_API=http://10.0.2.2:8080/api/v1 e2e/statement.yaml e2e/wrong-password.yaml
```

The sample is synthetic (`./gradlew writeStatementSamples` in `server/`); its password is `GULLAK2026`. If the Android file picker opens somewhere other than Recent or Downloads, the flows tap "Downloads" first.
````

Run both flows on the Android emulator against the local server and record the result in the task report.

- [ ] **Step 6: Commit**

```bash
git add app/app app/src/features app/e2e
git commit -m "feat(app): statement entry points, link status on spends, E2E-04 and E2E-05

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage.** 2.3 statement upload: formats (Tasks 2–4), in-memory reading and the password (Tasks 2, 7, 11), outcomes and their screens (Tasks 7, 12, 13), duplicate statements (Task 9), bank requests (Tasks 7, 13), commit after sort or finish later and the 7-day draft hook (Tasks 8, 9), swipe-to-sort with undo, +10 XP and the Sorted trigger (Tasks 8, 9, 14). 2.4 categories, rules from sort and from edits (Tasks 5, 8, 9). 2.5 scoring, high/medium/low, undo from spend detail, cash on covered dates, ATM, misc cash, fixed costs asked once, savings, accuracy XP and Honest logger (Tasks 6, 7, 9, 14, 15). 4.5 tables and `merchant_raw_enc` (Tasks 1, 7, 9). 4.6 the imports API and the multipart rules (Tasks 7–9). 4.7 uploads and the encryption key (Tasks 1, 2, 7, 10). 4.8 every code has a screen (Tasks 11–13). 3.1 statement screens and 3.2 #1 and #6 (Tasks 12–14).
- **Test IDs.** CAT-01–08 (Task 5; CAT-07 also Task 8), MAT-01–21 (Tasks 6, 7, 9; MAT-14 in Tasks 5 and 9), RD-01–25 (Tasks 2–4, 7), API-IMP-01–31 (Tasks 7–10), SEC-02 (Tasks 1, 9), SEC-03 (Task 1), SEC-10 (Tasks 7, 10), SEC-11 (Tasks 2, 10), APP-18 (Task 14), APP-19 (Tasks 11–13), E2E-04 and E2E-05 (Task 15). New: CAT-09, RD-26, API-IMP-32–36, APP-32, APP-33 (rows added by Task 10).
