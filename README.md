# Faster csv-reader

[![csv-reader-speed-01-run-20261121 on make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/keikuroba/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/keikuroba/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Entry for make.fun bounty `csv-reader-speed-01-run-20261121`: a faster drop-in
for make.fun's own csv-reader 1.0.0 that answers exactly as it does on every
case.

## Program

`solve.js` (dependency-free ES module) exports `run(input)`, which returns
csv-reader 1.0.0's reading of one case's input `{text, header}` as the JSON
value `{columns, rows, errors}`. `main.ts` is the harness driver: it reads
every case from `/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

## Method

The reference reader walks the text one character at a time, building every
field a character at a time. This entry walks it in bulk instead:

- A record with no quote before its line break is read as one slice and
  split on commas in a single C++ call; a stray CR inside it is counted
  (one `stray_cr` error each) and stripped before the split.
- A quoted field is scanned with `indexOf('"')` jumps, doubling `""` into
  one quote, and line breaks inside quotes are counted from the scanned
  segments only; a `\r` inside quotes is folded to `\n` as the reference
  does.
- An unclosed quote falls back to the reference's rule: the quote is a
  literal character and the rest is re-read as unquoted.
- Every error (`stray_cr`, `quote_junk`, `unterminated_quote`, `short_row`,
  `long_row`) is recorded with the same `{code, line, row}` and in the same
  order the reference records it, and rows are padded or cut to the first
  record's width exactly as the reference does.

No caching between cases, no network, no dependencies, no WebAssembly.
