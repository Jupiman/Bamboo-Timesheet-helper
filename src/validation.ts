import type { TimeInterval, ValidationResult } from "./types.js";

function parseTimeToMinutes(value: string): number {
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    return Number.NaN;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

export function isValidTimeFormat(value: string): boolean {
  return !Number.isNaN(parseTimeToMinutes(value));
}

export function validateIntervals(intervals: TimeInterval[]): ValidationResult {
  const errors: string[] = [];
  const normalized = intervals.map((interval, index) => {
    const startMinutes = parseTimeToMinutes(interval.start);
    const endMinutes = parseTimeToMinutes(interval.end);

    if (Number.isNaN(startMinutes)) {
      errors.push(`Interval ${index + 1}: invalid start time format (${interval.start}). Use HH:mm.`);
    }

    if (Number.isNaN(endMinutes)) {
      errors.push(`Interval ${index + 1}: invalid end time format (${interval.end}). Use HH:mm.`);
    }

    if (!Number.isNaN(startMinutes) && !Number.isNaN(endMinutes) && endMinutes <= startMinutes) {
      errors.push(`Interval ${index + 1}: end time must be later than start time.`);
    }

    return {
      ...interval,
      startMinutes,
      endMinutes,
    };
  });

  const sortable = normalized
    .filter((item) => !Number.isNaN(item.startMinutes) && !Number.isNaN(item.endMinutes))
    .sort((a, b) => a.startMinutes - b.startMinutes);

  for (let i = 1; i < sortable.length; i += 1) {
    if (sortable[i].startMinutes < sortable[i - 1].endMinutes) {
      errors.push(
        `Intervals overlap: ${sortable[i - 1].start}-${sortable[i - 1].end} overlaps ${sortable[i].start}-${sortable[i].end}.`,
      );
    }
  }

  const totalMinutes = sortable.reduce((sum, item) => sum + (item.endMinutes - item.startMinutes), 0);

  return {
    valid: errors.length === 0,
    errors,
    totalMinutes,
  };
}
