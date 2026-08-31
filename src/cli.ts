import { createInterface, Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CliOptions, DayAction, TimeInterval } from "./types.js";
import { formatHoursFromMinutes } from "./utils.js";
import { validateIntervals } from "./validation.js";

export function parseCliArgs(argv: string[]): CliOptions {
  const periodIndex = argv.indexOf("--period");
  let period: "this" | "past" = "this";

  if (periodIndex >= 0 && argv[periodIndex + 1]) {
    const val = argv[periodIndex + 1].toLowerCase().trim();
    if (val === "past") {
      period = "past";
    } else if (val !== "this") {
      console.log(`\x1b[33mInvalid --period specified ("${argv[periodIndex + 1]}"). Defaulting to "this".\x1b[0m`);
    }
  } else {
    console.log(`\x1b[33mNo --period specified. Defaulting to "this" pay period.\x1b[0m`);
  }

  return {
    period,
    dryRun: argv.includes("--dry-run"),
    debug: argv.includes("--debug"),
    continueOnError: argv.includes("--continue-on-error"),
  };
}

export function createPrompter(): Interface {
  return createInterface({ input, output });
}

export async function waitForManualLoginPrompt(rl: Interface): Promise<void> {
  await rl.question("Complete Microsoft login and MFA in the browser, then press Enter here to continue. ");
}

export type ExistingWorkDecision = "yes" | "no" | "no-all";

export async function promptEditExistingWorkDay(
  rl: Interface,
  date: string,
): Promise<ExistingWorkDecision> {
  while (true) {
    const answer = (
      await rl.question(
        `Day ${date} already has work-time entries. Edit it anyway? (yes/no/no-all): `,
      )
    )
      .trim()
      .toLowerCase();

    if (answer === "yes" || answer === "y") {
      return "yes";
    }

    if (answer === "no" || answer === "n") {
      return "no";
    }

    if (answer === "no-all" || answer === "na" || answer === "all-no") {
      return "no-all";
    }

    console.log("Invalid choice. Type yes, no, or no-all.");
  }
}

export async function promptDayAction(rl: Interface, date: string): Promise<DayAction> {
  while (true) {
    const answer = (
      await rl.question(
        `Choose action for ${date} - [enter] time, [skip], [review] later, [quit]: `,
      )
    )
      .trim()
      .toLowerCase();

    if (answer === "enter" || answer === "e") {
      return "enter";
    }

    if (answer === "skip" || answer === "s") {
      return "skip";
    }

    if (answer === "review" || answer === "r") {
      return "review";
    }

    if (answer === "quit" || answer === "q") {
      return "quit";
    }

    console.log("Invalid choice. Type enter, skip, review, or quit.");
  }
}

export async function promptForActualIntervals(rl: Interface, date: string): Promise<TimeInterval[] | null> {
  console.log(`Enter actual intervals for ${date}. Use 24-hour HH:mm format.`);
  console.log("Type 'done' when finished or 'cancel' to abort this day.");

  const intervals: TimeInterval[] = [];

  while (true) {
    const start = (await rl.question("Start time (HH:mm | done | cancel): ")).trim().toLowerCase();

    if (start === "cancel") {
      return null;
    }

    if (start === "done") {
      const check = validateIntervals(intervals);

      if (intervals.length === 0) {
        console.log("At least one interval is required before entering time.");
        continue;
      }

      if (!check.valid) {
        console.log("Intervals are invalid:");
        for (const err of check.errors) {
          console.log(`- ${err}`);
        }
        continue;
      }

      console.log(`Validated total for ${date}: ${formatHoursFromMinutes(check.totalMinutes)} hours.`);
      return intervals;
    }

    const end = (await rl.question("End time (HH:mm): ")).trim().toLowerCase();
    intervals.push({ start, end });

    const check = validateIntervals(intervals);
    if (!check.valid) {
      console.log("Current intervals are invalid:");
      for (const err of check.errors) {
        console.log(`- ${err}`);
      }
      console.log("Last interval removed. Please re-enter.");
      intervals.pop();
      continue;
    }

    console.log(`Current total: ${formatHoursFromMinutes(check.totalMinutes)} hours.`);
  }
}

export async function promptExplicitConfirmation(rl: Interface): Promise<boolean> {
  const answer = (await rl.question("Type 'yes' to confirm writing these intervals into BambooHR: "))
    .trim()
    .toLowerCase();

  return answer === "yes";
}