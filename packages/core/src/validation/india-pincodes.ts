import directory from '../formats/enums/india-pincodes.json';
import { STATE_CODE } from '../formats/enums/commercial-enums.js';

/** Exact PIN membership, including every state recorded for cross-border/conflicting entries. */
const statesByPin = new Map<string, string[]>();
for (const [code, pins] of Object.entries(directory.pinsByCommercialState)) {
  for (const pin of pins.split(' ')) {
    const states = statesByPin.get(pin) ?? [];
    states.push(code);
    statesByPin.set(pin, states);
  }
}
for (const pin of directory.pinsWithoutState) statesByPin.set(pin, []);

export const PIN_DIRECTORY_REFERENCE = `Department of Posts, All India Pincode Directory; snapshot retrieved ${directory.retrieved}; ${directory.source}`;

/** undefined = not listed; [] = listed but state unavailable; multiple = ambiguous. */
export function commercialStatesForPin(pin: string): readonly string[] | undefined {
  return statesByPin.get(pin);
}

/** Infer only when the directory records one state; never choose one side of a shared PIN. */
export function commercialStateFromPin(pin: string): { code: string; name: string } | undefined {
  const codes = commercialStatesForPin(pin);
  if (codes?.length !== 1 || pin.startsWith('9')) return undefined;
  const code = codes[0]!;
  return { code, name: STATE_CODE[code as keyof typeof STATE_CODE] };
}

export function checkCommercialPin(pin: string, stateCode: string): { severity: 'error' | 'warning'; message: string } | undefined {
  if (!pin || stateCode === '77') return undefined;
  const states = commercialStatesForPin(pin);
  if (!states) return { severity: 'error', message: `PIN ${pin} is not listed in the bundled India Post directory. Correct the PIN or verify a newly assigned PIN against an updated directory before generating the file.` };
  if (!states.length || pin.startsWith('9')) return { severity: 'warning', message: `PIN ${pin} is listed, but its geographic state cannot be verified from this directory. Verify the address with India Post.` };
  const names = states.map(code => STATE_CODE[code as keyof typeof STATE_CODE]).join(' / ');
  // CRIF retains the old Daman and Diu code alongside the merged territory code.
  const canonicalState = stateCode === '09' ? '08' : stateCode;
  if (canonicalState && !states.includes(canonicalState)) {
    const selectedName = STATE_CODE[stateCode as keyof typeof STATE_CODE] ?? stateCode;
    return { severity: 'error', message: `PIN ${pin} is listed for ${names}, but the selected State is ${selectedName} (State Code ${stateCode}). Correct the PIN or State before generating the file.` };
  }
  if (states.length > 1) return { severity: 'warning', message: `PIN ${pin} has multiple state entries in the India Post directory (${names}). Verify that the address belongs to the selected State.` };
  return undefined;
}
