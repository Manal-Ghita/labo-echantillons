import { BadRequestException } from '@nestjs/common';

export type ParsedSource = {
  headers: string[];
  records: { line: number; cells: string[] }[];
};
export interface MeasurementParser {
  parse(buffer: Buffer, delimiter: string): ParsedSource;
}
export class CsvParser implements MeasurementParser {
  parse(buffer: Buffer, delimiter: string): ParsedSource {
    const fail = (message: string): never => {
      throw new BadRequestException([`CSV : ${message}`]);
    };
    if (![';', ',', '\t'].includes(delimiter)) fail('séparateur non autorisé.');
    if (buffer.length > 10485760) fail('10 Mio maximum pour un import.');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return fail('encodage UTF-8 requis.');
    }
    if (text.includes(String.fromCharCode(0))) fail('caractère NUL interdit.');
    const rows: ParsedSource['records'] = [];
    let cells: string[] = [],
      cell = '',
      quoted = false,
      closed = false,
      line = 1,
      start = 1;
    const field = () => {
      cells.push(cell);
      cell = '';
      closed = false;
      if (cells.length > 50) fail('50 colonnes maximum.');
    };
    const row = () => {
      field();
      if (!(cells.length === 1 && cells[0] === ''))
        rows.push({ line: start, cells });
      cells = [];
      start = line + 1;
      if (rows.length > 501) fail('500 lignes de mesures maximum.');
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            quoted = false;
            closed = true;
          }
        } else {
          cell += c;
          if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
        }
      } else if (c === delimiter) field();
      else if (c === '\n' || c === '\r') {
        row();
        if (c === '\r' && text[i + 1] === '\n') i++;
        line++;
        start = line;
      } else if (c === '"') {
        if (cell || closed) fail(`guillemet inattendu à la ligne ${line}.`);
        quoted = true;
      } else {
        if (closed)
          fail(`caractère après un champ entre guillemets, ligne ${line}.`);
        cell += c;
      }
      if (cell.length > 10000)
        fail(
          `cellule trop longue à la ligne ${line} (10 000 caractères maximum).`,
        );
    }
    if (quoted) fail(`guillemet non fermé à la ligne ${start}.`);
    if (cell || cells.length || closed) row();
    if (rows.length < 2)
      fail('un en-tête et au moins une ligne de mesures sont requis.');
    const headers = rows.shift()!.cells.map((h) => h.trim());
    if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
      fail('les noms de colonnes doivent être non vides et uniques.');
    return { headers, records: rows };
  }
}

// New formats can supply another adapter; they never connect to a machine.
export const measurementParsers: Readonly<Record<string, MeasurementParser>> = {
  CSV: new CsvParser(),
};
