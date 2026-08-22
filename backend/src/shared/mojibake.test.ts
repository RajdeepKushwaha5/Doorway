import { describe, expect, it } from 'vitest';
import { repairMojibake } from './mojibake.js';

/**
 * The real string, as the live API served it.
 *
 * A student searching for the CPRG fellowship was shown "AI4Indiaâ€™s",
 * and the damaged text is what the index matches against, not only what the
 * page prints.
 */
describe('repairMojibake', () => {
  it('repairs the apostrophe that reached production', () => {
    expect(repairMojibake('CPRG and AI4Indiaâ€™s Fellowship')).toBe(
      'CPRG and AI4India’s Fellowship',
    );
  });

  it('repairs quotes and dashes', () => {
    expect(repairMojibake('â€œApplied AIâ€ â€“ a six-month programme')).toBe(
      '“Applied AI” – a six-month programme',
    );
  });

  it('repairs an accented name', () => {
    expect(repairMojibake('UniversitÃ© de MontrÃ©al')).toBe(
      'Université de Montréal',
    );
  });

  it('leaves correct text alone, accents included', () => {
    for (const clean of [
      'CPRG and AI4India’s Fellowship',
      'Université de Montréal',
      'Plain ASCII text',
      'आईआई फेलोशिप',
      '',
    ]) {
      expect(repairMojibake(clean)).toBe(clean);
    }
  });

  it('leaves text alone when the premise does not hold', () => {
    // Looks suspicious, is not recoverable as UTF-8, so it must survive intact.
    const odd = 'â€';
    expect(repairMojibake(odd)).toBe(odd);
  });
});
