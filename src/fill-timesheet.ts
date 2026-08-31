import "dotenv/config";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPrompter,
  parseCliArgs,
  promptEditExistingWorkDay,
  waitForManualLoginPrompt,
} from "./cli.js";
import {
  deleteDayEntries,
  fillDayEntries,
  inspectDay,
  launchBrowser,
  loginManually,
  navigateToTimesheet,
  saveFailureDiagnostics,
  selectPeriod,
  verifyDayEntries,
  waitForBambooHome,
} from "./bamboohr.js";
import { JsonLogger } from "./logger.js";
import { selectors } from "./selectors.js";
import type { RunSummary } from "./types.js";
import {
  ensureArtifactsDirs,
  formatHoursFromMinutes,
  getDaysInMonth,
  hasExistingWorkEntries,
  hasVacationEntry,
  isWeekend,
} from "./utils.js";
import { validateIntervals } from "./validation.js";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFile), "..");
const baseUrl = process.env.BAMBOOHR_BASE_URL ?? "https://onearc.bamboohr.com";
const scheduleConfigPath =
  process.env.WEEKDAY_TEMPLATES_PATH ?? resolve(projectRoot, "config", "weekday-templates.json");

type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri";

interface IntervalTemplate {
  start: string;
  end: string;
}

interface WeekdayTemplateConfig {
  weekdayTemplates: Record<WeekdayKey, IntervalTemplate[]>;
}

function createSummary(selectedPeriod: "this" | "past", totalCalendarDays: number): RunSummary {
  return {
    selectedPeriod,
    totalCalendarDays,
    weekendsSkipped: 0,
    vacationDaysSkipped: 0,
    daysAlreadyContainingWorkEntries: 0,
    daysManuallyCompleted: 0,
    daysManuallySkipped: 0,
    daysLeftForReview: 0,
    totalHoursEntered: 0,
  };
}

function printSummary(summary: RunSummary): void {
  console.log("\nRun summary:");
  console.log(`- selected period: ${summary.selectedPeriod}`);
  console.log(`- total calendar days: ${summary.totalCalendarDays}`);
  console.log(`- weekends skipped: ${summary.weekendsSkipped}`);
  console.log(`- vacation days skipped: ${summary.vacationDaysSkipped}`);
  console.log(`- days already containing work entries: ${summary.daysAlreadyContainingWorkEntries}`);
  console.log(`- days manually completed: ${summary.daysManuallyCompleted}`);
  console.log(`- days manually skipped: ${summary.daysManuallySkipped}`);
  console.log(`- days left for review: ${summary.daysLeftForReview}`);
  console.log(`- total hours entered during this run: ${summary.totalHoursEntered.toFixed(2)}`);
}

function isIntervalTemplate(value: unknown): value is IntervalTemplate {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as Partial<IntervalTemplate>;
  return typeof maybe.start === "string" && typeof maybe.end === "string";
}

function parseWeekdayTemplateConfig(raw: unknown): WeekdayTemplateConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid template config: root must be an object.");
  }

  const weekdayTemplates = (raw as { weekdayTemplates?: unknown }).weekdayTemplates;
  if (!weekdayTemplates || typeof weekdayTemplates !== "object") {
    throw new Error("Invalid template config: weekdayTemplates is required.");
  }

  const requiredKeys: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri"];
  for (const key of requiredKeys) {
    const value = (weekdayTemplates as Record<string, unknown>)[key];
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`Invalid template config: weekdayTemplates.${key} must be a non-empty array.`);
    }

    for (const interval of value) {
      if (!isIntervalTemplate(interval)) {
        throw new Error(`Invalid template config: weekdayTemplates.${key} contains invalid interval entries.`);
      }
    }
  }

  return {
    weekdayTemplates: weekdayTemplates as Record<WeekdayKey, IntervalTemplate[]>,
  };
}

async function loadWeekdayTemplateConfig(): Promise<WeekdayTemplateConfig> {
  const json = await readFile(scheduleConfigPath, "utf8");
  const parsed: unknown = JSON.parse(json);
  const config = parseWeekdayTemplateConfig(parsed);

  for (const key of ["mon", "tue", "wed", "thu", "fri"] as WeekdayKey[]) {
    const check = validateIntervals(config.weekdayTemplates[key]);
    if (!check.valid) {
      throw new Error(
        `Invalid template intervals for '${key}' in ${scheduleConfigPath}: ${check.errors.join(" | ")}`,
      );
    }
  }

  return config;
}

function getAutoIntervalsForDate(
  dateIso: string,
  config: WeekdayTemplateConfig,
): Array<{ start: string; end: string }> {
  const dayOfWeek = new Date(`${dateIso}T00:00:00Z`).getUTCDay();

  const keyByDay: Partial<Record<number, WeekdayKey>> = {
    1: "mon",
    2: "tue",
    3: "wed",
    4: "thu",
    5: "fri",
  };

  const key = keyByDay[dayOfWeek];
  if (key) {
    return config.weekdayTemplates[key];
  }

  return [];
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));

  // Compute the calendar month locally relative to execution timestamp
  const now = new Date();
  if (options.period === "past") {
    now.setMonth(now.getMonth() - 1);
  }
  const year = now.getFullYear();
  const monthStr = String(now.getMonth() + 1).padStart(2, "0");
  const month = `${year}-${monthStr}`;

  const templateConfig = await loadWeekdayTemplateConfig();

  ensureArtifactsDirs(projectRoot);
  const logger = new JsonLogger(projectRoot);
  const rl = createPrompter();

  logger.info("run_started", {
    period: options.period,
    month,
    dryRun: options.dryRun,
    debug: options.debug,
    continueOnError: options.continueOnError,
    templateConfigPath: scheduleConfigPath,
  });

  const { browser, page } = await launchBrowser(options);
  const days = getDaysInMonth(month);
  const summary = createSummary(options.period, days.length);
  let skipExistingEntriesForRestOfRun = false;

  try {
    console.log("Opening BambooHR login page...");
    await loginManually(page, baseUrl);

    console.log("Login with Microsoft was opened. Complete login and MFA manually.");
    await waitForManualLoginPrompt(rl);
    await waitForBambooHome(page, baseUrl);

    console.log("Navigating to timesheet...");
    await navigateToTimesheet(page);
    await selectPeriod(page, options.period);

    for (const date of days) {
      if (isWeekend(date)) {
        summary.weekendsSkipped += 1;
        logger.info("day_skipped_weekend", { date });
        continue;
      }

      const inspection = await inspectDay(page, date);
      const entries = inspection.existingEntries;

      console.log(`\nDate: ${date}`);
      if (entries.length === 0) {
        console.log("Existing entries: (none)");
      } else {
        console.log("Existing entries:");
        for (const entry of entries) {
          console.log(`- ${entry}`);
        }
      }

      if (hasVacationEntry(entries)) {
        summary.vacationDaysSkipped += 1;
        logger.info("day_skipped_vacation", { date, entries });
        console.log("Skipping day because it contains 8 hours of Vacation.");
        continue;
      }

      const existingWork = hasExistingWorkEntries(entries);
      let replaceExistingEntries = false;
      if (existingWork) {
        summary.daysAlreadyContainingWorkEntries += 1;
        logger.info("day_has_existing_work", { date, entries });

        if (options.dryRun) {
          console.log("Dry run: day has existing work entries and is not eligible by default.");
          continue;
        }

        if (skipExistingEntriesForRestOfRun) {
          console.log("Skipping day with existing work entries (no-all selected earlier).");
          logger.info("day_skipped_existing_due_to_no_all", { date });
          continue;
        }

        const decision = await promptEditExistingWorkDay(rl, date);
        if (decision === "no-all") {
          skipExistingEntriesForRestOfRun = true;
          console.log("Selected no-all. Remaining days with existing work entries will be skipped.");
          logger.info("user_selected_no_all_for_existing_entries", { date });
          continue;
        }

        if (decision === "no") {
          console.log("Skipping day with existing work entries.");
          continue;
        }

        replaceExistingEntries = true;
      }

      if (options.dryRun) {
        summary.daysLeftForReview += 1;
        logger.info("dry_run_eligible_day", { date, entriesCount: entries.length });
        console.log("Dry run: eligible day identified; no data entered.");
        continue;
      }

      const intervals = getAutoIntervalsForDate(date, templateConfig);
      if (intervals.length === 0) {
        summary.daysLeftForReview += 1;
        logger.warn("no_template_for_day", { date });
        console.log("No template configured for this day. Marking for review.");
        continue;
      }

      const check = validateIntervals(intervals);
      if (!check.valid) {
        console.log("Validation failed unexpectedly. Marking day for review.");
        summary.daysLeftForReview += 1;
        logger.error("validation_failed_after_prompt", { date, errors: check.errors });
        continue;
      }

      const totalHours = formatHoursFromMinutes(check.totalMinutes);
      console.log(
        `Applying template for ${date}: ${intervals.map((i) => `${i.start}-${i.end}`).join(", ")} (${totalHours} hours).`,
      );

      try {
        if (replaceExistingEntries) {
          console.log("Deleting existing time entries before applying the template.");
          await deleteDayEntries(page, date);
        }

        await fillDayEntries(page, date, intervals);
        const verified = await verifyDayEntries(page, date, intervals);

        if (!verified) {
          throw new Error("UI verification failed after entering intervals.");
        }

        summary.daysManuallyCompleted += 1;
        summary.totalHoursEntered += check.totalMinutes / 60;
        logger.info("day_completed", { date, intervals, totalHours });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await saveFailureDiagnostics(page, projectRoot, `day-${date}`, logger);
        logger.error("day_failed", { date, message });
        console.error(`Failed on ${date}: ${message}`);

        if (!options.continueOnError) {
          console.error("Stopping because --continue-on-error is not enabled.");
          break;
        }
      }
    }

    if (await page.locator(selectors.finalSubmitButton).count()) {
      logger.info("final_submit_buttons_visible", {
        note: "No final submit action performed by automation.",
      });
    }

    printSummary(summary);
    logger.info("run_completed", summary);
    console.log(`\nStructured log file: ${logger.path}`);
    console.log("Browser remains open for manual review and manual final submission.");
    console.log("After you finish manual review/submission, close the browser window to end this CLI process.");
    if (browser.isConnected() && !page.isClosed()) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          page.off("close", done);
          browser.off("disconnected", done);
          resolve();
        };

        page.on("close", done);
        browser.on("disconnected", done);
      });
    }

    if (browser.isConnected()) {
      await browser.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("fatal_error", { message });

    try {
      await saveFailureDiagnostics(page, projectRoot, "fatal", logger);
    } catch {
      // Ignore secondary failures while capturing diagnostics.
    }

    console.error(`Fatal error: ${message}`);
    printSummary(summary);
    console.error("Stopping safely.");
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unhandled error: ${message}`);
  process.exit(1);
});