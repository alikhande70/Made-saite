/**
 * CSV parsing, coercion and per-row validation — the pure half of the bulk
 * importer. These are the checks that stop malformed supplier data from ever
 * reaching a transaction.
 */
import { describe, expect, it } from 'vitest';
import {
  detectDelimiter, mapColumns, parseBooleanCell, parseConditionCell, parseDelimited,
  parseFitmentCell, parseIntegerCell, parseProductCsv, parseReferenceCell, MAX_IMPORT_ROWS,
} from '@/domain/import';

describe('delimited parsing', () => {
  it('handles quoted fields containing the delimiter and newlines', () => {
    const rows = parseDelimited('a,b\n"x,1","line1\nline2"');
    expect(rows).toEqual([['a', 'b'], ['x,1', 'line1\nline2']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseDelimited('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']]);
  });

  it('strips a UTF-8 BOM so the first header name is not corrupted', () => {
    const rows = parseDelimited('﻿sku,price\nA-1,100');
    expect(rows[0]).toEqual(['sku', 'price']);
  });

  it('handles CRLF and a missing trailing newline', () => {
    expect(parseDelimited('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('drops entirely blank lines rather than treating them as rows', () => {
    expect(parseDelimited('a\n1\n\n\n2\n')).toEqual([['a'], ['1'], ['2']]);
  });

  it('detects semicolon and tab delimited files', () => {
    expect(detectDelimiter('sku;price;stock\n')).toBe(';');
    expect(detectDelimiter('sku\tprice\tstock\n')).toBe('\t');
    expect(detectDelimiter('sku,price\n')).toBe(',');
  });
});

describe('header mapping', () => {
  it('accepts Persian, English and spaced aliases for the same column', () => {
    const mapping = mapColumns(['کد کالا', 'Title FA', 'قیمت', 'unknown column']);
    expect([...mapping.values()]).toEqual(['sku', 'titleFa', 'price']);
  });

  it('normalises Arabic letter forms in headers', () => {
    // 'كد كالا' with Arabic kaf must match the Persian spelling.
    expect([...mapColumns(['كد كالا']).values()]).toEqual(['sku']);
  });

  it('ignores a duplicate column rather than letting the later one win', () => {
    const mapping = mapColumns(['sku', 'code']);
    expect([...mapping.values()]).toEqual(['sku']);
  });
});

describe('numeric coercion', () => {
  it('folds Persian and Arabic-Indic digits', () => {
    expect(parseIntegerCell('۱۲۳۴')).toBe(1234);
    expect(parseIntegerCell('٤٥٦')).toBe(456);
  });

  it('strips thousands separators and currency words', () => {
    expect(parseIntegerCell('۱٬۲۵۰٬۰۰۰')).toBe(1_250_000);
    expect(parseIntegerCell('1,250,000')).toBe(1_250_000);
    expect(parseIntegerCell('385000 تومان')).toBe(385_000);
  });

  it('tolerates the spreadsheet ".0" artefact', () => {
    expect(parseIntegerCell('48.0')).toBe(48);
  });

  it('treats an empty cell as "no value", not zero', () => {
    expect(parseIntegerCell('')).toBeNull();
    expect(parseIntegerCell('   ')).toBeNull();
  });

  it('rejects rather than salvages a value it cannot read', () => {
    // parseInt('12abc') would return 12 — silently importing a wrong price.
    expect(parseIntegerCell('12abc')).toBe('INVALID');
    expect(parseIntegerCell('تماس بگیرید')).toBe('INVALID');
    expect(parseIntegerCell('1.5')).toBe('INVALID');
  });

  it('reads Persian and English booleans and rejects anything else', () => {
    expect(parseBooleanCell('بله')).toBe(true);
    expect(parseBooleanCell('0')).toBe(false);
    expect(parseBooleanCell('')).toBeNull();
    expect(parseBooleanCell('شاید')).toBe('INVALID');
  });

  it('maps Persian condition words to the stored enum', () => {
    expect(parseConditionCell('نو')).toBe('new');
    expect(parseConditionCell('کارکرده')).toBe('used');
    expect(parseConditionCell('refurbished')).toBe('refurbished');
    expect(parseConditionCell('نامشخص')).toBe('INVALID');
  });
});

describe('fitment cells', () => {
  it('parses a full narrowing and an open-ended one', () => {
    const { fitments, errors } = parseFitmentCell('peugeot-206|TU5|TIP5|1390-1400|DIRECT; rana||||');
    expect(errors).toEqual([]);
    expect(fitments[0]).toEqual({
      modelSlug: 'peugeot-206', engineCode: 'TU5', trimCode: 'TIP5',
      yearFrom: 1390, yearTo: 1400, fitmentType: 'DIRECT',
    });
    // Omitted fields mean "any" — the same NULL semantics the matcher uses.
    expect(fitments[1]).toEqual({
      modelSlug: 'rana', engineCode: null, trimCode: null,
      yearFrom: null, yearTo: null, fitmentType: 'DIRECT',
    });
  });

  it('records an exclusion', () => {
    const { fitments } = parseFitmentCell('peugeot-206|TU3|||NOT_COMPATIBLE');
    expect(fitments[0]!.fitmentType).toBe('NOT_COMPATIBLE');
  });

  it('reads a single year as a closed one-year window', () => {
    const { fitments } = parseFitmentCell('samand|||1395|');
    expect(fitments[0]!.yearFrom).toBe(1395);
    expect(fitments[0]!.yearTo).toBe(1395);
  });

  it('reports an entry with no model instead of dropping it', () => {
    const { fitments, errors } = parseFitmentCell('|TU5|||DIRECT');
    expect(fitments).toHaveLength(0);
    expect(errors[0]).toContain('مدل خودرو ندارد');
  });

  it('rejects an inverted or unreadable year range', () => {
    expect(parseFitmentCell('samand|||1400-1390|').errors[0]).toContain('وارونه');
    expect(parseFitmentCell('samand|||abc-1390|').errors[0]).toContain('معتبر نیست');
  });

  it('rejects an unknown fitment type rather than defaulting it to DIRECT', () => {
    const { fitments, errors } = parseFitmentCell('samand||||MAYBE');
    expect(fitments).toHaveLength(0);
    expect(errors[0]).toContain('شناخته نشد');
  });
});

describe('reference cells', () => {
  it('parses typed relations with an optional brand', () => {
    const { references, errors } = parseReferenceCell('CROSS_REFERENCE:W 712/52:MANN; SUPERSEDES:1109N3');
    expect(errors).toEqual([]);
    expect(references).toEqual([
      { relationType: 'CROSS_REFERENCE', targetNumber: 'W 712/52', targetBrand: 'MANN' },
      { relationType: 'SUPERSEDES', targetNumber: '1109N3', targetBrand: null },
    ]);
  });

  it('reports an unknown relation type and a missing part number', () => {
    expect(parseReferenceCell('SIMILAR:X-1').errors[0]).toContain('شناخته نشد');
    expect(parseReferenceCell('ALTERNATE:').errors[0]).toContain('شمارهٔ قطعه ندارد');
  });
});

describe('whole-file validation', () => {
  const header = 'sku,title_fa,price,sale_price,stock';

  it('accepts a clean file', () => {
    const result = parseProductCsv(`${header}\nA-1,فیلتر روغن,385000,329000,20`);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.price).toBe(385_000);
  });

  it('refuses a file with no SKU column', () => {
    const result = parseProductCsv('name,price\nفیلتر,100');
    expect(result.rows).toEqual([]);
    expect(result.errors[0]!.message).toContain('کد کالا');
  });

  it('reports every bad row instead of stopping at the first', () => {
    const result = parseProductCsv(
      `${header}\nA-1,الف,abc,,\nA-2,ب,100,,\nA-3,ج,xyz,,`,
    );
    expect(result.rows.map((r) => r.sku)).toEqual(['A-2']);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.line)).toEqual([2, 4]);
  });

  it('flags a duplicate SKU and names the earlier line', () => {
    const result = parseProductCsv(`${header}\nA-1,الف,100,,\nA-1,ب,200,,`);
    expect(result.rows).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('ردیف 2');
  });

  it('rejects a sale price that is not below the price', () => {
    const result = parseProductCsv(`${header}\nA-1,الف,100000,100000,5`);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]!.message).toContain('کمتر از قیمت اصلی');
  });

  it('rejects negative price and stock', () => {
    const result = parseProductCsv(`${header}\nA-1,الف,-5,,\nA-2,ب,100,,-3`);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });

  it('excludes a row with any error from the accepted set', () => {
    const result = parseProductCsv(`${header},fitment\nA-1,الف,100,,5,|TU5|||DIRECT`);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]!.column).toBe('سازگاری');
  });

  it('refuses a file above the row cap rather than truncating it', () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `A-${i},نام,100,,1`).join('\n');
    const result = parseProductCsv(`${header}\n${body}`);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]!.message).toContain('حداکثر');
  });

  it('reports an empty file', () => {
    expect(parseProductCsv('').errors[0]!.message).toContain('خالی');
  });
});
