import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Where the public ledger lives. Tests and rehearsals point PM_DATA_DIR elsewhere so they never touch data/.
export const DATA_DIR = process.env.PM_DATA_DIR ?? `${ROOT}data`;

// Load .env from the repo root if present. Values are never printed.
export function loadEnv(): void {
  const path = `${ROOT}.env`;
  if (existsSync(path)) process.loadEnvFile(path);
}

export function isDryRun(): boolean {
  return process.env.DRY_RUN !== 'false';
}
