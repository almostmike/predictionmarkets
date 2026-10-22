import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Load .env from the repo root if present. Values are never printed.
export function loadEnv(): void {
  const path = `${ROOT}.env`;
  if (existsSync(path)) process.loadEnvFile(path);
}

export function isDryRun(): boolean {
  return process.env.DRY_RUN !== 'false';
}
