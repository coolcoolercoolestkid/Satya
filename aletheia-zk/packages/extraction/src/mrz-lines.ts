/**
 * Find the two TD3 MRZ lines inside a blob of text.
 *
 * The decoders in this package (PDF text layer, image OCR) do not hand back two tidy
 * lines. A PDF text layer interleaves the MRZ with the visual-zone text and scatters
 * spaces between glyph runs; OCR returns one string per detected line, with the odd stray
 * space. Both, though, share one property the visual zone never has: a run of exactly 44
 * characters drawn only from the MRZ alphabet `[A-Z0-9<]`. That run is what this module
 * looks for, and nothing here interprets a single field — parsing is `parseTd3Mrz`'s job.
 *
 * Whitespace is removed *within* a text segment before matching, because OCR and PDF both
 * inject spaces into a line that has none, but newlines are kept as segment boundaries so
 * two stacked MRZ lines are never welded into one 88-character run.
 */

/** The fixed width of every TD3 MRZ line. Re-exported for callers that scan raw text. */
export const TD3_LINE_LENGTH = 44;

const MRZ_LINE = /[A-Z0-9<]{44}/g;

/**
 * Every 44-character MRZ-alphabet run in `text`, in reading order.
 *
 * Splitting on newlines first keeps each visual line separate, so a document with the two
 * MRZ lines on separate lines yields two entries rather than one merged run. Spaces are
 * stripped inside each line because a fixed-width MRZ has none — any space is an artifact
 * of the layer that produced the text.
 */
export function findMrzLines(text: string): string[] {
  const lines: string[] = [];
  for (const segment of text.split(/\r?\n/)) {
    const compact = segment.replace(/\s+/g, "").toUpperCase();
    for (const match of compact.matchAll(MRZ_LINE)) {
      lines.push(match[0]);
    }
  }
  return lines;
}

/**
 * Pick the passport line pair from the runs `findMrzLines` returned: the first run that
 * begins with the passport document code `P`, together with the run immediately after it.
 * A TD3 MRZ is exactly two lines, line 1 starting `P`; scanning for that anchor tolerates
 * a document whose text layer carried visual-zone junk that also happened to be 44 wide.
 *
 * Returns `null` when no such pair exists, which the caller reports as "no MRZ found"
 * rather than guessing.
 */
export function pairTd3Lines(lines: string[]): [string, string] | null {
  for (let i = 0; i + 1 < lines.length; i++) {
    const line1 = lines[i];
    const line2 = lines[i + 1];
    if (line1 !== undefined && line2 !== undefined && line1.startsWith("P")) {
      return [line1, line2];
    }
  }
  return null;
}
