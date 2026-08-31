export interface CliOptions {
  period: "this" | "past";
  dryRun: boolean;
  debug: boolean;
  continueOnError: boolean;
}

export interface TimeInterval {
  start: string;
  end: string;
}

export type DayAction = "enter" | "skip" | "review" | "quit";

export interface DayInspection {
  date: string;
  existingEntries: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  totalMinutes: number;
}

export interface RunSummary {
  selectedPeriod: "this" | "past";
  totalCalendarDays: number;
  weekendsSkipped: number;
  vacationDaysSkipped: number;
  daysAlreadyContainingWorkEntries: number;
  daysManuallyCompleted: number;
  daysManuallySkipped: number;
  daysLeftForReview: number;
  totalHoursEntered: number;
}

export interface LoggerEvent {
  timestamp: string;
  level: "info" | "warn" | "error";
  event: string;
  data?: unknown;
}