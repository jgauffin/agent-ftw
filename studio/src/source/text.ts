/**
 * Character offsets and the conversion to editor coordinates.
 *
 * The source layer speaks in offsets throughout, because a splice is an offset
 * pair and nothing below the extension needs to know about lines. Line and
 * character are computed once, at the boundary where a range becomes something
 * an editor can show.
 */

/** A half-open character range: `text.slice(start, end)` is what it covers. */
export interface Range {
  readonly start: number;
  readonly end: number;
}

/** Zero-based editor coordinates. */
export interface Position {
  readonly line: number;
  readonly character: number;
}

/** One splice. `start === end` is an insertion. */
export interface TextEdit {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

/** Offset → 0-based line/character, for building an editor range. */
export function positionAt(source: string, offset: number): Position {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

/** The whitespace the line containing `offset` starts with. */
export function indentAt(source: string, offset: number): string {
  let lineStart = offset;
  while (lineStart > 0 && source.charCodeAt(lineStart - 1) !== 10) lineStart--;
  let i = lineStart;
  while (i < source.length && (source[i] === " " || source[i] === "\t")) i++;
  return source.slice(lineStart, i);
}
