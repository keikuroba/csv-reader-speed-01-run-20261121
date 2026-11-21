// Faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Returns exactly csv-reader 1.0.0's answer for every input, but reads the
// text in bulk instead of one character at a time:
//  - a record with no quote before its line break is sliced whole and split
//    on commas in one C++ call; a stray CR inside it is counted (one
//    stray_cr error each) and stripped before the split;
//  - an unquoted field is found with indexOf jumps to the next comma or
//    line break, so a stray CR is the only per-character detour;
//  - a quoted field is scanned with indexOf('"') jumps, "" folding to one
//    quote, and line breaks inside quotes are counted from the scanned
//    segments only; a CR inside quotes folds to LF as the reference does;
//  - an unclosed quote falls back to the reference's rule: the quote is a
//    literal character and the rest is re-read as unquoted.
// Every error (stray_cr, quote_junk, unterminated_quote, short_row,
// long_row) is recorded with the same {code, line, row} and in the same
// order the reference records it; rows are padded or cut to the first
// record's width exactly as the reference does. No caching between cases,
// no network, no dependencies, no WebAssembly.

const COMMA = 1;
const LINE_BREAK = 2;
const END = 3;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // The record's fields, once read: set the width from the first record,
  // take it as the header when header is true, else pad or cut it to the
  // width and push it to rows. Mirrors the reference exactly.
  function commit(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field
  // and how it ended; `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    while (pos < len) {
      const iComma = text.indexOf(',', pos);
      const iLf = text.indexOf('\n', pos);
      let end;
      let kind; // 1: comma, 2: line break, 3: end of text
      if (iComma !== -1 && (iLf === -1 || iComma < iLf)) {
        end = iComma;
        kind = COMMA;
      } else if (iLf !== -1) {
        end = iLf;
        kind = LINE_BREAK;
      } else {
        end = len;
        kind = END;
      }
      // A CR right before the LF is the CRLF line break, not a stray CR.
      let segEnd = end;
      if (kind === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) segEnd = end - 1;
      const seg = text.slice(pos, segEnd);
      const iCr = seg.indexOf('\r');
      if (iCr !== -1) {
        // Rare: stray CRs in this stretch. One error each, dropped.
        const parts = seg.split('\r');
        for (let k = 1; k < parts.length; k++) error('stray_cr');
        value += parts.join('');
        added += seg.length - (parts.length - 1);
        pos = segEnd;
        continue;
      }
      value += seg;
      added += seg.length;
      if (kind === COMMA) {
        pos = end + 1;
        return { value, ended: COMMA, added };
      }
      if (kind === LINE_BREAK) {
        pos = end + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      pos = len;
      return { value, ended: END, added };
    }
    return { value, ended: END, added };
  }

  // One quoted segment [start, end): folds every CR or CRLF to LF and
  // counts the line breaks it holds. Returns the segment's text.
  function foldSegment(start, end) {
    let s = text.slice(start, end);
    if (s.indexOf('\r') !== -1) s = s.replace(/\r\n?/g, '\n');
    if (s.indexOf('\n') !== -1) {
      let n = 0;
      let i = -1;
      while ((i = s.indexOf('\n', i + 1)) !== -1) n++;
      line += n;
    }
    return s;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let start = pos + 1;
    for (;;) {
      const j = text.indexOf('"', start);
      if (j === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (j > start) value += foldSegment(start, j);
      if (text.charCodeAt(j + 1) === 34) {
        value += '"';
        start = j + 2;
        continue;
      }
      pos = j + 1;
      break;
    }
    if (pos >= len) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: no quote before the next line break (or the end of the
    // text), so the whole record is one unquoted line.
    const nl = text.indexOf('\n', pos);
    const hasQuote =
      nl === -1 ? text.indexOf('"', pos) !== -1 : text.slice(pos, nl).indexOf('"') !== -1;
    if (!hasQuote) {
      const end = nl === -1 ? len : nl;
      let segEnd = end;
      if (nl !== -1 && end > pos && text.charCodeAt(end - 1) === 13) segEnd = end - 1;
      const s = text.slice(pos, segEnd);
      const iCr = s.indexOf('\r');
      let fields;
      if (iCr === -1) {
        fields = s.split(',');
      } else {
        const parts = s.split('\r');
        for (let k = 1; k < parts.length; k++) error('stray_cr');
        fields = parts.join('').split(',');
      }
      pos = nl === -1 ? len : nl + 1;
      line += 1;
      // A line that held only stray CRs is left with no characters: no
      // record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '') continue;
      commit(fields);
      continue;
    }

    // General path: read the record a field at a time.
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    commit(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
