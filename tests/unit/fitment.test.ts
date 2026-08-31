import { describe, expect, it } from 'vitest';
import {
  configurationApplies,
  evaluateCompatibility,
  specificity,
  VERDICT_LABEL_FA,
  type ConfigurationSpec,
  type FitmentRecord,
  type VehicleSpec,
} from '@/domain/fitment';

const MODEL = 'model-206';
const OTHER_MODEL = 'model-pride';
const GEN_2 = 'gen-2';
const TRIM_5 = 'trim-tip5';
const ENGINE_TU5 = 'engine-tu5';
const ENGINE_TU3 = 'engine-tu3';

const config = (o: Partial<ConfigurationSpec> = {}): ConfigurationSpec => ({
  modelId: MODEL, generationId: null, trimId: null, engineId: null,
  yearFrom: null, yearTo: null, ...o,
});

const vehicle = (o: Partial<VehicleSpec> = {}): VehicleSpec => ({
  modelId: MODEL, generationId: null, trimId: null, engineId: null, year: null, ...o,
});

const fitment = (
  fitmentType: FitmentRecord['fitmentType'],
  configuration: ConfigurationSpec,
  note: string | null = null,
): FitmentRecord => ({ fitmentType, configuration, note });

describe('configurationApplies', () => {
  it('rejects a different model outright', () => {
    expect(configurationApplies(config(), vehicle({ modelId: OTHER_MODEL }))).toBe('NO');
  });

  it('a configuration with no narrowing applies to any vehicle of that model', () => {
    expect(configurationApplies(config(), vehicle())).toBe('YES');
    expect(configurationApplies(config(), vehicle({ engineId: ENGINE_TU5, year: 1400 }))).toBe('YES');
  });

  it('matches when a narrowed field equals the vehicle', () => {
    expect(configurationApplies(config({ engineId: ENGINE_TU5 }), vehicle({ engineId: ENGINE_TU5 }))).toBe('YES');
  });

  it('rejects when a narrowed field differs from a known vehicle field', () => {
    expect(configurationApplies(config({ engineId: ENGINE_TU5 }), vehicle({ engineId: ENGINE_TU3 }))).toBe('NO');
  });

  it('is indeterminate when it narrows on a field the customer has not supplied', () => {
    expect(configurationApplies(config({ engineId: ENGINE_TU5 }), vehicle({ engineId: null }))).toBe('INDETERMINATE');
    expect(configurationApplies(config({ trimId: TRIM_5 }), vehicle({ trimId: null }))).toBe('INDETERMINATE');
  });

  it('applies a year window inclusively', () => {
    const c = config({ yearFrom: 1390, yearTo: 1400 });
    expect(configurationApplies(c, vehicle({ year: 1390 }))).toBe('YES');
    expect(configurationApplies(c, vehicle({ year: 1400 }))).toBe('YES');
    expect(configurationApplies(c, vehicle({ year: 1389 }))).toBe('NO');
    expect(configurationApplies(c, vehicle({ year: 1401 }))).toBe('NO');
  });

  it('handles open-ended year windows', () => {
    expect(configurationApplies(config({ yearFrom: 1395 }), vehicle({ year: 1404 }))).toBe('YES');
    expect(configurationApplies(config({ yearFrom: 1395 }), vehicle({ year: 1390 }))).toBe('NO');
    expect(configurationApplies(config({ yearTo: 1395 }), vehicle({ year: 1390 }))).toBe('YES');
  });

  it('is indeterminate when a year window is set but the vehicle year is unknown', () => {
    expect(configurationApplies(config({ yearFrom: 1390, yearTo: 1400 }), vehicle({ year: null })))
      .toBe('INDETERMINATE');
  });

  it('rejects on a known mismatch even when another field is indeterminate', () => {
    // Engine is wrong; the unknown trim must not soften that into "maybe".
    expect(
      configurationApplies(
        config({ engineId: ENGINE_TU5, trimId: TRIM_5 }),
        vehicle({ engineId: ENGINE_TU3, trimId: null }),
      ),
    ).toBe('NO');
  });
});

describe('specificity', () => {
  it('counts the narrowing fields', () => {
    expect(specificity(config())).toBe(0);
    expect(specificity(config({ engineId: ENGINE_TU5 }))).toBe(1);
    expect(specificity(config({ engineId: ENGINE_TU5, trimId: TRIM_5 }))).toBe(2);
    expect(specificity(config({ generationId: GEN_2, trimId: TRIM_5, engineId: ENGINE_TU5, yearFrom: 1390 }))).toBe(4);
  });

  it('counts an open-ended year window once, not twice', () => {
    expect(specificity(config({ yearFrom: 1390, yearTo: 1400 }))).toBe(1);
    expect(specificity(config({ yearFrom: 1390 }))).toBe(1);
  });
});

describe('evaluateCompatibility', () => {
  it('returns UNKNOWN — never "incompatible" — when there is no data at all', () => {
    const result = evaluateCompatibility([], vehicle());
    expect(result.verdict).toBe('UNKNOWN');
    expect(result.matched).toBeNull();
    expect(result.reasonFa).toContain('ثبت نشده');
  });

  it('returns UNKNOWN when every fitment is for another model', () => {
    const result = evaluateCompatibility(
      [fitment('DIRECT', config({ modelId: OTHER_MODEL }))],
      vehicle(),
    );
    expect(result.verdict).toBe('UNKNOWN');
  });

  it('confirms a direct fit', () => {
    const result = evaluateCompatibility([fitment('DIRECT', config())], vehicle());
    expect(result.verdict).toBe('COMPATIBLE');
    expect(result.reasonFa).toContain('سازگار است');
  });

  it('reports a fit that needs modification, including the note', () => {
    const result = evaluateCompatibility(
      [fitment('WITH_MODIFICATION', config(), 'نیازمند تعویض واشر')],
      vehicle(),
    );
    expect(result.verdict).toBe('COMPATIBLE_WITH_MODIFICATION');
    expect(result.reasonFa).toContain('نیازمند تعویض واشر');
  });

  it('reports an explicitly recorded exclusion', () => {
    const result = evaluateCompatibility(
      [fitment('NOT_COMPATIBLE', config({ engineId: ENGINE_TU3 }))],
      vehicle({ engineId: ENGINE_TU3 }),
    );
    expect(result.verdict).toBe('INCOMPATIBLE');
  });

  it('lets a specific exclusion override a broad fit', () => {
    // "fits 206" in general, but explicitly not with the TU3 engine.
    const result = evaluateCompatibility(
      [
        fitment('DIRECT', config()),
        fitment('NOT_COMPATIBLE', config({ engineId: ENGINE_TU3 }), 'قطر متفاوت'),
      ],
      vehicle({ engineId: ENGINE_TU3 }),
    );
    expect(result.verdict).toBe('INCOMPATIBLE');
    expect(result.reasonFa).toContain('قطر متفاوت');
  });

  it('still fits the same broad record for a different engine', () => {
    const result = evaluateCompatibility(
      [
        fitment('DIRECT', config()),
        fitment('NOT_COMPATIBLE', config({ engineId: ENGINE_TU3 })),
      ],
      vehicle({ engineId: ENGINE_TU5 }),
    );
    expect(result.verdict).toBe('COMPATIBLE');
  });

  it('prefers a more specific fit over a broader one', () => {
    const result = evaluateCompatibility(
      [
        fitment('WITH_MODIFICATION', config()),
        fitment('DIRECT', config({ engineId: ENGINE_TU5, trimId: TRIM_5 })),
      ],
      vehicle({ engineId: ENGINE_TU5, trimId: TRIM_5 }),
    );
    expect(result.verdict).toBe('COMPATIBLE');
  });

  it('resolves an equal-specificity conflict against claiming a fit', () => {
    // Contradictory data at the same level: the safe answer is "does not fit".
    const result = evaluateCompatibility(
      [
        fitment('DIRECT', config({ engineId: ENGINE_TU5 })),
        fitment('NOT_COMPATIBLE', config({ engineId: ENGINE_TU5 })),
      ],
      vehicle({ engineId: ENGINE_TU5 }),
    );
    expect(result.verdict).toBe('INCOMPATIBLE');
  });

  it('asks for more detail instead of guessing when narrowing data is missing', () => {
    const result = evaluateCompatibility(
      [fitment('DIRECT', config({ engineId: ENGINE_TU5 }))],
      vehicle({ engineId: null }),
    );
    expect(result.verdict).toBe('UNKNOWN');
    expect(result.needsMoreVehicleDetail).toBe(true);
    expect(result.reasonFa).toContain('کامل کنید');
  });

  it('never claims a fit from an indeterminate match alone', () => {
    const result = evaluateCompatibility(
      [
        fitment('DIRECT', config({ engineId: ENGINE_TU5, yearFrom: 1395, yearTo: 1400 })),
        fitment('DIRECT', config({ modelId: OTHER_MODEL })),
      ],
      vehicle({ engineId: null, year: null }),
    );
    expect(result.verdict).toBe('UNKNOWN');
  });

  it('has a Persian label for every verdict', () => {
    for (const v of ['COMPATIBLE', 'COMPATIBLE_WITH_MODIFICATION', 'INCOMPATIBLE', 'UNKNOWN'] as const) {
      expect(VERDICT_LABEL_FA[v]).toMatch(/[؀-ۿ]/);
    }
  });
});
