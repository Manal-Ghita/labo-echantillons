import { CsvParser } from './csv-parser';
const parser = new CsvParser();
describe('CSV adapter', () => {
  it('preserves exact decimal text, UTF-8 BOM, quotes, delimiters and physical line numbers', () => {
    const result = parser.parse(
      Buffer.from(
        '\ufeffTempérature;Note\r\n150.123456789012345678901234567890;"film;PET"\r\n120;"deux\nlignes et ""citation"""\r\n',
      ),
      ';',
    );
    expect(result.headers).toEqual(['Température', 'Note']);
    expect(result.records).toEqual([
      { line: 2, cells: ['150.123456789012345678901234567890', 'film;PET'] },
      { line: 3, cells: ['120', 'deux\nlignes et "citation"'] },
    ]);
  });
  it.each([
    'a,a\n1,2',
    'a,\n1,2',
    'a\n"missing',
    'a\n"closed"bad',
    'a\nb"ad',
    'a\n',
    'a\n\0',
  ])('rejects malformed CSV %j', (text) =>
    expect(() => parser.parse(Buffer.from(text), ',')).toThrow(),
  );
  it('rejects unsupported delimiters, non UTF-8, long cells and excessive rows/columns', () => {
    expect(() => parser.parse(Buffer.from('a|b\n1|2'), '|')).toThrow();
    expect(() => parser.parse(Buffer.from([0xff]), ';')).toThrow();
    expect(() =>
      parser.parse(Buffer.from('a\n' + 'x'.repeat(10001)), ';'),
    ).toThrow();
    expect(() =>
      parser.parse(Buffer.from('a\n' + '1\n'.repeat(501)), ';'),
    ).toThrow();
    expect(() =>
      parser.parse(
        Buffer.from(
          Array.from({ length: 51 }, (_, i) => `c${i}`).join(';') + '\n1',
        ),
        ';',
      ),
    ).toThrow();
  });
  it('keeps inconsistent record width for line-level preview errors and accepts tabular CSV', () => {
    expect(parser.parse(Buffer.from('a\tb\n1\t2\n3'), '\t').records[1]).toEqual(
      { line: 3, cells: ['3'] },
    );
  });
});
