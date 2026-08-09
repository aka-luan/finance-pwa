import type { PGlite } from '@electric-sql/pglite';

export const BACKUP_FORMAT: string;
export const BACKUP_VERSION: number;
export const BACKUP_TABLES: readonly string[];

export interface Backup {
  format: string;
  version: number;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export function exportBackup(db: PGlite): Promise<Backup>;

export function serializeBackup(backup: Backup): string;

export function parseBackup(text: string): Backup;

export function importBackup(db: PGlite, backup: Backup): Promise<void>;
