/**
 * Bulk-import parsing and validation — pure, no I/O.
 *
 * Automotive supplier files are messy in specific, predictable ways: Persian
 * digits in price columns, ٫ as a decimal mark, thousands separators, Arabic
 * letter forms in brand names, trailing whitespace around part numbers, and
 * an "OEM" column that is sometimes a list. Every one of those is normalised
 * here rather than at the database, and anything that cannot be normalised
 * confidently becomes a reported error — never a silently coerced value.
 */
import { toLatinDigits } from '@/lib/fa';

/* ── CSV ──────────────────────────────────────────────────────────────── */

/**
 * RFC 4180 reader: quoted fields, escaped quotes, embedded commas and
 * newlines, CRLF, and a UTF-8 BOM (which Excel writes and which would
 * otherwise corrupt the first header name).
 *
 * Written rather than pulled in: the format is small, and a dependency here
 * would have to be licence-reviewed for a hundred lines of logic.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < input.length) {
    const ch = input[i]!;

    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"' && field === '') { quoted = true; i += 1; continue; }
    if (ch === delimiter) { endField(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { endRow(); i += 1; continue; }
    field += ch; i += 1;
  }

  // A file not ending in a newline still has a final row.
  if (field !== '' || row.length > 0) endRow();

  // Drop rows that are entirely empty — trailing blank lines are not data.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Picks the delimiter from the header line: comma, semicolon or tab. */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

/* ── column mapping ───────────────────────────────────────────────────── */

/**
 * Header aliases. Suppliers name the same column half a dozen ways, and a
 * Persian header is as likely as an English one, so both are accepted.
 */
const COLUMN_ALIASES: Record<string, readonly string[]> = {
  sku: ['sku', 'code', 'کد', 'کد کالا', 'کد فنی'],
  titleFa: ['title', 'title_fa', 'name', 'نام', 'عنوان', 'نام کالا'],
  titleEn: ['title_en', 'name_en', 'عنوان انگلیسی'],
  oemNumber: ['oem', 'oem_number', 'شماره فنی', 'کد oem'],
  mpn: ['mpn', 'manufacturer_part_number', 'کد سازنده'],
  brand: ['brand', 'برند', 'مارک'],
  category: ['category', 'دسته', 'دسته بندی', 'دسته‌بندی', 'گروه'],
  manufacturer: ['manufacturer', 'سازنده', 'تولیدکننده'],
  price: ['price', 'قیمت', 'قیمت فروش'],
  salePrice: ['sale_price', 'discount_price', 'قیمت با تخفیف', 'قیمت ویژه'],
  stock: ['stock', 'quantity', 'qty', 'موجودی', 'تعداد'],
  weightGrams: ['weight', 'weight_grams', 'وزن'],
  warrantyMonths: ['warranty', 'warranty_months', 'گارانتی', 'ضمانت'],
  countryOfOrigin: ['country', 'origin', 'کشور', 'ساخت'],
  condition: ['condition', 'وضعیت'],
  productFamily: ['family', 'product_family', 'خانواده'],
  descriptionFa: ['description', 'توضیحات', 'شرح'],
  tags: ['tags', 'برچسب', 'برچسب‌ها'],
  isActive: ['active', 'is_active', 'فعال', 'وضعیت انتشار'],
  fitment: ['fitment', 'compatibility', 'سازگاری', 'خودرو'],
  references: ['references', 'cross_reference', 'کد معادل', 'معادل'],
};

/** Normalises a header cell so `کد کالا`, `Kod Kala ` and `SKU` all match. */
function normaliseHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[ي]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[‌_\-.]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export type ColumnKey = keyof typeof COLUMN_ALIASES;

/** header index → canonical field name; unknown columns are simply ignored. */
export function mapColumns(header: readonly string[]): Map<number, ColumnKey> {
  const lookup = new Map<string, ColumnKey>();
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) lookup.set(normaliseHeader(alias), key as ColumnKey);
  }

  const mapping = new Map<number, ColumnKey>();
  header.forEach((cell, index) => {
    const key = lookup.get(normaliseHeader(cell));
    if (key && ![...mapping.values()].includes(key)) mapping.set(index, key);
  });
  return mapping;
}

/* ── value coercion ───────────────────────────────────────────────────── */

/**
 * Money and counts arrive as `۱٬۲۵۰٬۰۰۰`, `1,250,000`, `1250000 تومان` or
 * `1.250.000`. Persian digits fold first, then separators are stripped — but
 * only separators. A value with any leftover non-numeric character is
 * rejected rather than parsed to whatever `parseInt` happens to return.
 */
export function parseIntegerCell(raw: string): number | null | 'INVALID' {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const latin = toLatinDigits(trimmed)
    .replace(/[٬,\s]/g, '')       // thousands separators
    .replace(/[٫]/g, '.')          // Persian decimal mark
    .replace(/تومان|ريال|ریال|عدد/g, '')
    .trim();

  // A trailing `.0` is a spreadsheet artefact, not a fractional Toman.
  const withoutTrailingZeros = latin.replace(/\.0+$/, '');
  if (!/^-?\d+$/.test(withoutTrailingZeros)) return 'INVALID';

  const value = Number(withoutTrailingZeros);
  return Number.isSafeInteger(value) ? value : 'INVALID';
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'بله', 'فعال', 'دارد']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'خیر', 'غیرفعال', 'ندارد']);

export function parseBooleanCell(raw: string): boolean | null | 'INVALID' {
  const value = toLatinDigits(raw.trim()).toLowerCase();
  if (value === '') return null;
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  return 'INVALID';
}

const CONDITIONS = new Set(['new', 'refurbished', 'used']);
const CONDITION_FA: Record<string, string> = {
  'نو': 'new', 'بازسازی شده': 'refurbished', 'بازسازی‌شده': 'refurbished', 'کارکرده': 'used', 'دست دوم': 'used',
};

export function parseConditionCell(raw: string): 'new' | 'refurbished' | 'used' | null | 'INVALID' {
  const value = raw.trim().toLowerCase();
  if (value === '') return null;
  if (CONDITIONS.has(value)) return value as 'new' | 'refurbished' | 'used';
  const mapped = CONDITION_FA[raw.trim()];
  return (mapped as 'new' | 'refurbished' | 'used' | undefined) ?? 'INVALID';
}

/* ── fitment and reference cells ──────────────────────────────────────── */

export interface ParsedFitment {
  modelSlug: string;
  engineCode: string | null;
  trimCode: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  fitmentType: 'DIRECT' | 'WITH_MODIFICATION' | 'NOT_COMPATIBLE';
}

const FITMENT_TYPES = new Set(['DIRECT', 'WITH_MODIFICATION', 'NOT_COMPATIBLE']);

/**
 * `peugeot-206|TU5|TIP5|1390-1400|DIRECT; pride-131||||NOT_COMPATIBLE`
 *
 * Only the model is required. Everything after it narrows the fitment, and an
 * omitted field means "any" — the same NULL-means-any semantics the matcher
 * uses, so a spreadsheet cannot express a rule the engine cannot evaluate.
 */
export function parseFitmentCell(raw: string): { fitments: ParsedFitment[]; errors: string[] } {
  const fitments: ParsedFitment[] = [];
  const errors: string[] = [];

  for (const entry of raw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [model = '', engine = '', trim = '', years = '', type = ''] = entry.split('|').map((s) => s.trim());
    if (!model) { errors.push(`ورودی سازگاری «${entry}» مدل خودرو ندارد.`); continue; }

    let yearFrom: number | null = null;
    let yearTo: number | null = null;
    if (years) {
      const parts = toLatinDigits(years).split('-').map((s) => s.trim());
      const from = parts[0] ? parseIntegerCell(parts[0]) : null;
      const to = parts[1] !== undefined ? (parts[1] ? parseIntegerCell(parts[1]) : null) : from;
      if (from === 'INVALID' || to === 'INVALID') {
        errors.push(`بازهٔ سال «${years}» در ورودی سازگاری معتبر نیست.`);
        continue;
      }
      yearFrom = from;
      yearTo = to;
      if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
        errors.push(`بازهٔ سال «${years}» وارونه است.`);
        continue;
      }
    }

    const fitmentType = type ? type.toUpperCase() : 'DIRECT';
    if (!FITMENT_TYPES.has(fitmentType)) {
      errors.push(`نوع سازگاری «${type}» شناخته نشد (DIRECT، WITH_MODIFICATION یا NOT_COMPATIBLE).`);
      continue;
    }

    fitments.push({
      modelSlug: model,
      engineCode: engine || null,
      trimCode: trim || null,
      yearFrom,
      yearTo,
      fitmentType: fitmentType as ParsedFitment['fitmentType'],
    });
  }

  return { fitments, errors };
}

export interface ParsedReference {
  relationType: 'SUPERSEDES' | 'SUPERSEDED_BY' | 'ALTERNATE' | 'CROSS_REFERENCE';
  targetNumber: string;
  targetBrand: string | null;
}

const REFERENCE_TYPES = new Set(['SUPERSEDES', 'SUPERSEDED_BY', 'ALTERNATE', 'CROSS_REFERENCE']);

/** `CROSS_REFERENCE:W712/52:MANN; SUPERSEDES:1109N3:Peugeot` */
export function parseReferenceCell(raw: string): { references: ParsedReference[]; errors: string[] } {
  const references: ParsedReference[] = [];
  const errors: string[] = [];

  for (const entry of raw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [type = '', number = '', brand = ''] = entry.split(':').map((s) => s.trim());
    const relationType = type.toUpperCase();
    if (!REFERENCE_TYPES.has(relationType)) {
      errors.push(`نوع ارتباط «${type}» شناخته نشد.`);
      continue;
    }
    if (!number) { errors.push(`ورودی «${entry}» شمارهٔ قطعه ندارد.`); continue; }
    references.push({
      relationType: relationType as ParsedReference['relationType'],
      targetNumber: number,
      targetBrand: brand || null,
    });
  }

  return { references, errors };
}

/* ── row validation ───────────────────────────────────────────────────── */

export interface ImportRowError {
  /** 1-based line number in the original file, header included. */
  line: number;
  column: string | null;
  message: string;
}

export interface ParsedProductRow {
  line: number;
  sku: string;
  titleFa: string | null;
  titleEn: string | null;
  oemNumber: string | null;
  mpn: string | null;
  brand: string | null;
  category: string | null;
  manufacturer: string | null;
  price: number | null;
  salePrice: number | null;
  stock: number | null;
  weightGrams: number | null;
  warrantyMonths: number | null;
  countryOfOrigin: string | null;
  condition: 'new' | 'refurbished' | 'used' | null;
  productFamily: string | null;
  descriptionFa: string | null;
  tags: string[] | null;
  isActive: boolean | null;
  fitments: ParsedFitment[] | null;
  references: ParsedReference[] | null;
}

export interface ParseResult {
  rows: ParsedProductRow[];
  errors: ImportRowError[];
  /** Canonical field names actually present in the file. */
  columns: ColumnKey[];
  totalRows: number;
}

const COLUMN_LABEL_FA: Record<string, string> = {
  sku: 'کد کالا', titleFa: 'نام کالا', price: 'قیمت', salePrice: 'قیمت با تخفیف',
  stock: 'موجودی', weightGrams: 'وزن', warrantyMonths: 'ضمانت', isActive: 'فعال',
  condition: 'وضعیت', fitment: 'سازگاری', references: 'کدهای معادل',
};

export const MAX_IMPORT_ROWS = 5_000;

/**
 * Parses and validates a whole file.
 *
 * Every row is checked; the reader does not stop at the first bad line,
 * because an importer that reports one error per upload is unusable on a
 * 2,000-row supplier file. Rows with errors are excluded from `rows`, so a
 * commit can never write a row this function rejected.
 */
export function parseProductCsv(text: string): ParseResult {
  const table = parseDelimited(text, detectDelimiter(text));
  if (table.length === 0) {
    return { rows: [], errors: [{ line: 0, column: null, message: 'فایل خالی است.' }], columns: [], totalRows: 0 };
  }

  const [header, ...body] = table;
  const mapping = mapColumns(header!);
  const columns = [...mapping.values()];
  const errors: ImportRowError[] = [];

  if (!columns.includes('sku')) {
    errors.push({ line: 1, column: 'sku', message: 'ستون «کد کالا» (SKU) در فایل پیدا نشد.' });
    return { rows: [], errors, columns, totalRows: body.length };
  }
  if (body.length > MAX_IMPORT_ROWS) {
    errors.push({
      line: 1, column: null,
      message: `فایل ${body.length} ردیف دارد؛ حداکثر ${MAX_IMPORT_ROWS} ردیف در هر بار پردازش می‌شود.`,
    });
    return { rows: [], errors, columns, totalRows: body.length };
  }

  const rows: ParsedProductRow[] = [];
  const seenSkus = new Map<string, number>();

  body.forEach((cells, index) => {
    const line = index + 2; // header is line 1
    const rowErrors: ImportRowError[] = [];
    const cell = (key: ColumnKey): string => {
      for (const [columnIndex, columnKey] of mapping) {
        if (columnKey === key) return (cells[columnIndex] ?? '').trim();
      }
      return '';
    };

    const number = (key: ColumnKey): number | null => {
      const parsed = parseIntegerCell(cell(key));
      if (parsed === 'INVALID') {
        rowErrors.push({ line, column: COLUMN_LABEL_FA[key] ?? key, message: `مقدار «${cell(key)}» عدد معتبر نیست.` });
        return null;
      }
      return parsed;
    };

    const sku = cell('sku');
    if (!sku) {
      rowErrors.push({ line, column: COLUMN_LABEL_FA.sku!, message: 'کد کالا خالی است.' });
    } else if (seenSkus.has(sku)) {
      rowErrors.push({
        line, column: COLUMN_LABEL_FA.sku!,
        message: `کد کالا «${sku}» در ردیف ${seenSkus.get(sku)} هم آمده است.`,
      });
    } else {
      seenSkus.set(sku, line);
    }

    const price = number('price');
    const salePrice = number('salePrice');
    const stock = number('stock');

    if (price !== null && price < 0) {
      rowErrors.push({ line, column: COLUMN_LABEL_FA.price!, message: 'قیمت نمی‌تواند منفی باشد.' });
    }
    if (salePrice !== null && price !== null && salePrice >= price) {
      rowErrors.push({
        line, column: COLUMN_LABEL_FA.salePrice!,
        message: 'قیمت با تخفیف باید کمتر از قیمت اصلی باشد.',
      });
    }
    if (stock !== null && stock < 0) {
      rowErrors.push({ line, column: COLUMN_LABEL_FA.stock!, message: 'موجودی نمی‌تواند منفی باشد.' });
    }

    const isActiveRaw = parseBooleanCell(cell('isActive'));
    if (isActiveRaw === 'INVALID') {
      rowErrors.push({ line, column: COLUMN_LABEL_FA.isActive!, message: `مقدار «${cell('isActive')}» بله/خیر نیست.` });
    }

    const conditionRaw = parseConditionCell(cell('condition'));
    if (conditionRaw === 'INVALID') {
      rowErrors.push({
        line, column: COLUMN_LABEL_FA.condition!,
        message: `وضعیت «${cell('condition')}» شناخته نشد (نو، بازسازی‌شده یا کارکرده).`,
      });
    }

    const fitmentCell = cell('fitment');
    const { fitments, errors: fitmentErrors } = fitmentCell
      ? parseFitmentCell(fitmentCell)
      : { fitments: [], errors: [] };
    for (const message of fitmentErrors) {
      rowErrors.push({ line, column: COLUMN_LABEL_FA.fitment!, message });
    }

    const referenceCell = cell('references');
    const { references, errors: referenceErrors } = referenceCell
      ? parseReferenceCell(referenceCell)
      : { references: [], errors: [] };
    for (const message of referenceErrors) {
      rowErrors.push({ line, column: COLUMN_LABEL_FA.references!, message });
    }

    if (rowErrors.length > 0) { errors.push(...rowErrors); return; }

    const tagsCell = cell('tags');
    rows.push({
      line,
      sku,
      titleFa: cell('titleFa') || null,
      titleEn: cell('titleEn') || null,
      oemNumber: cell('oemNumber') || null,
      mpn: cell('mpn') || null,
      brand: cell('brand') || null,
      category: cell('category') || null,
      manufacturer: cell('manufacturer') || null,
      price,
      salePrice,
      stock,
      weightGrams: number('weightGrams'),
      warrantyMonths: number('warrantyMonths'),
      countryOfOrigin: cell('countryOfOrigin') || null,
      condition: conditionRaw === 'INVALID' ? null : conditionRaw,
      productFamily: cell('productFamily') || null,
      descriptionFa: cell('descriptionFa') || null,
      tags: tagsCell ? tagsCell.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : null,
      isActive: isActiveRaw === 'INVALID' ? null : isActiveRaw,
      fitments: fitmentCell ? fitments : null,
      references: referenceCell ? references : null,
    });
  });

  return { rows, errors, columns, totalRows: body.length };
}
