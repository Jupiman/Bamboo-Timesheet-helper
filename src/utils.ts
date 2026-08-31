import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function ensureArtifactsDirs(rootDir: string): void {
  const dirs = [
    join(rootDir, "artifacts"),
    join(rootDir, "artifacts", "logs"),
    join(rootDir, "artifacts", "screenshots"),
    join(rootDir, "artifacts", "html"),
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

export function parseMonthOrThrow(month: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("--month must be in YYYY-MM format.");
  }
}

export function getDaysInMonth(month: string): string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const days: string[] = [];
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));

  while (date.getUTCMonth() === monthNumber - 1) {
    days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return days;
}

export function isWeekend(dateIso: string): boolean {
  const day = new Date(`${dateIso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function normalizeEntryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s:.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasVacationEntry(entries: string[]): boolean {
  return entries.some((entry) => normalizeEntryText(entry).includes("vacation"));
}

export function hasExistingWorkEntries(entries: string[]): boolean {
  const filtered = entries
    .map(normalizeEntryText)
    .filter((entry) => entry.length > 0 && !entry.includes("vacation"));

  return filtered.length > 0;
}

export function formatHoursFromMinutes(totalMinutes: number): string {
  return (totalMinutes / 60).toFixed(2);
}
