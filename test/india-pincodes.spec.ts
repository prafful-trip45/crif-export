import { describe, expect, it } from 'vitest';
import directory from '../packages/core/src/formats/enums/india-pincodes.json';
import { checkCommercialPin, commercialStateFromPin, commercialStatesForPin } from '../packages/core/src/validation/india-pincodes.js';

describe('India Post exact PIN directory', () => {
  it('covers all 36 states/UTs and every unique PIN from the source', () => {
    expect(Object.keys(directory.pinsByCommercialState)).toHaveLength(36);
    const pins = new Set([...Object.values(directory.pinsByCommercialState).flatMap(pins => pins.split(' ')), ...directory.pinsWithoutState]);
    expect(pins.size).toBe(directory.pinCount);
    expect(pins.size).toBeGreaterThan(19000);
    for (const pin of pins) expect(commercialStatesForPin(pin)).toBeDefined();
  });

  it.each([
    ['682001', '17'], // Kochi, not Lakshadweep (both 682).
    ['682555', '18'], // Lakshadweep.
    ['160017', '06'], // Chandigarh, not Punjab.
    ['194101', '37'], // Ladakh, not Jammu and Kashmir.
    ['262001', '33'], // Pilibhit, UP, not Uttarakhand (both 262).
    ['262501', '34'], // Pithoragarh, Uttarakhand.
    ['605001', '27'], // Puducherry, not Tamil Nadu.
    ['272001', '33'], ['110001', '25'], ['400001', '20'], ['500001', '36'],
  ])('matches %s to state %s without prefix guessing', (pin, code) => {
    expect(commercialStateFromPin(pin)?.code).toBe(code);
    expect(checkCommercialPin(pin, code)).toBeUndefined();
  });

  it('rejects mismatches and unlisted PINs even inside a recognised prefix', () => {
    expect(checkCommercialPin('682001', '18')?.severity).toBe('error');
    expect(checkCommercialPin('110001', '20')?.severity).toBe('error');
    expect(checkCommercialPin('110999', '25')?.severity).toBe('error');
    expect(commercialStateFromPin('568911')).toBeUndefined();
  });

  it('preserves shared states, warns for ambiguity, and never infers one arbitrarily', () => {
    expect(commercialStatesForPin('396230')).toEqual(expect.arrayContaining(['08', '11']));
    expect(checkCommercialPin('396230', '08')?.severity).toBe('warning');
    expect(checkCommercialPin('396230', '09')?.severity).toBe('warning');
    expect(checkCommercialPin('396230', '11')?.severity).toBe('warning');
    expect(checkCommercialPin('396230', '20')?.severity).toBe('error');
    expect(commercialStateFromPin('396230')).toBeUndefined();
    expect(checkCommercialPin('396210', '09')).toBeUndefined();
  });

  it('distinguishes listed PINs with missing state data from unknown PINs', () => {
    expect(commercialStatesForPin('400201')).toEqual([]);
    expect(checkCommercialPin('400201', '20')?.severity).toBe('warning');
    expect(checkCommercialPin('999999', '20')?.severity).toBe('error');
    expect(checkCommercialPin('', '20')).toBeUndefined();
    expect(checkCommercialPin('123456', '77')).toBeUndefined();
    expect(checkCommercialPin('900099', '35')?.severity).toBe('warning');
  });
});
