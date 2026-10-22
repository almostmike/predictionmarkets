import { readFileSync } from 'node:fs';
import { ROOT } from './env.ts';

export interface Rules {
  version: string;
  starting_capital_usd: number;
  position_cap_pct_nav: number;
  max_open_positions: number;
  min_edge_pp: number;
  fee_model: { formula: string; assume_taker_theta: number };
  order_types_allowed: string[];
  max_cross_usd: number;
  daily_entry_limit_usd: number;
  timezone: string;
  drawdown_halt_nav_usd: number;
  max_days_to_resolution: number;
  entry_intents: string[];
  exit_intents: string[];
  exclusions: { keywords: string[] };
  kill_switch_file: string;
}

export function loadRules(path = `${ROOT}config/rules.json`): Rules {
  return JSON.parse(readFileSync(path, 'utf8')) as Rules;
}

// Taker fee per contract at YES price p (mandate rule 6 always assumes the taker fee).
export function takerFeePerContract(rules: Rules, p: number): number {
  return rules.fee_model.assume_taker_theta * p * (1 - p);
}

// Whole-word, case-insensitive keyword hits in any of the given texts.
export function exclusionHits(rules: Rules, texts: Array<string | undefined>): string[] {
  const haystack = texts.filter(Boolean).join(' \n ');
  return rules.exclusions.keywords.filter((kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(haystack);
  });
}
