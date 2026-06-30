/**
 * Generate a 256-bit (32-byte) AES key, base64-encoded, for the app-version
 * attestation header.
 *
 *   node scripts/gen-attestation-key.mjs
 *
 * Put the SAME value in two places:
 *   1. packages/desktop/.env  ->  VITE_APP_ATTESTATION_KEY=<value>
 *   2. The Vidyasetu backend's secret/env  ->  CRIF_ATTESTATION_KEY=<value>
 *
 * Rotating the key invalidates all older clients' headers — bump the app and
 * roll the key together if you ever need to.
 */
import { randomBytes } from 'node:crypto';

const key = randomBytes(32).toString('base64');
process.stdout.write(key + '\n');
