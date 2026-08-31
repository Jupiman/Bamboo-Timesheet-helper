import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { selectors } from "./selectors.js";
import type { CliOptions, DayInspection, TimeInterval } from "./types.js";
import { JsonLogger } from "./logger.js";

const SELECTOR_KEYS = Object.keys(selectors) as Array<keyof typeof selectors>;

function toUiTime(time24h: string): string {
  const [hh, mm] = time24h.split(":").map(Number);
  const meridiem = hh >= 12 ? "PM" : "AM";
  const normalizedHour = hh % 12 === 0 ? 12 : hh % 12;
  return `${normalizedHour}:${String(mm).padStart(2, "0")} ${meridiem}`;
}

function toClockParts(time24h: string): { clockText: string; meridiem: "AM" | "PM" } {
  const [hh, mm] = time24h.split(":").map(Number);
  const meridiem = hh >= 12 ? "PM" : "AM";
  const normalizedHour = hh % 12 === 0 ? 12 : hh % 12;
  return {
    clockText: `${normalizedHour}:${String(mm).padStart(2, "0")}`,
    meridiem,
  };
}

async function setMeridiemForClockField(
  page: Page,
  toggleButton: ReturnType<Page["locator"]>,
  expectedMeridiem: "AM" | "PM",
): Promise<void> {
  const meridiemButton = toggleButton.first();
  await meridiemButton.waitFor({ state: "visible" });

  const currentMeridiem = (await meridiemButton.locator(".fab-SelectToggle__content").first().textContent())
    ?.trim()
    .toUpperCase();

  if (currentMeridiem === expectedMeridiem) {
    return;
  }

  const menuId = await meridiemButton.getAttribute("data-menu-id");
  await meridiemButton.click();

  if (menuId) {
    const scopedMenu = page.locator(`#${menuId}`).first();
    if (await scopedMenu.count()) {
      await scopedMenu.waitFor({ state: "visible" });
      const option = scopedMenu
        .locator(`[role='option']:has-text('${expectedMeridiem}'), [role='menuitem']:has-text('${expectedMeridiem}'), li:has-text('${expectedMeridiem}')`)
        .first();
      if (await option.count()) {
        await option.click();
      } else {
        await page.keyboard.press(expectedMeridiem === "AM" ? "A" : "P");
        await page.keyboard.press("Enter");
      }
    } else {
      await page.keyboard.press(expectedMeridiem === "AM" ? "A" : "P");
      await page.keyboard.press("Enter");
    }
  } else {
    await page.keyboard.press(expectedMeridiem === "AM" ? "A" : "P");
    await page.keyboard.press("Enter");
  }

  const finalMeridiem = (await meridiemButton.locator(".fab-SelectToggle__content").first().textContent())
    ?.trim()
    .toUpperCase();

  if (finalMeridiem !== expectedMeridiem) {
    throw new Error(
      `Failed to set meridiem. Expected ${expectedMeridiem}, got ${finalMeridiem ?? "(empty)"}.`,
    );
  }
}

async function setClockField(
  page: Page,
  modal: ReturnType<Page["locator"]>,
  inputIndex: number,
  value24h: string,
): Promise<void> {
  const parts = toClockParts(value24h);

  const allInputs = modal.locator("input.ClockField__formInput");
  await allInputs.nth(inputIndex).waitFor({ state: "visible" });
  const input = allInputs.nth(inputIndex);

  // Focus before typing because Bamboo's clock fields are script-enhanced.
  await input.click();
  await input.waitFor({ state: "visible" });
  await input.fill("");
  await input.type(parts.clockText, { delay: 30 });
  await input.press("Tab");

  const allToggles = modal.locator(".ClockField button.fab-SelectToggle");
  await allToggles.nth(inputIndex).waitFor({ state: "visible" });
  await setMeridiemForClockField(page, allToggles.nth(inputIndex), parts.meridiem);

  const finalInputValue = ((await input.inputValue()) ?? "").trim();
  if (finalInputValue.length === 0) {
    throw new Error(`Failed to set clock input ${inputIndex + 1}. Input is empty.`);
  }
}

function parseRowDateLabel(label: string, fallbackYear: number): Date | null {
  const match = label.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const monthMap: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  const monthIdx = monthMap[match[1].toLowerCase()];
  if (monthIdx === undefined) {
    return null;
  }

  const day = Number(match[2]);
  if (Number.isNaN(day)) {
    return null;
  }

  return new Date(Date.UTC(fallbackYear, monthIdx, day));
}

async function getExactDayRow(page: Page, dateIso: string): Promise<ReturnType<Page["locator"]>> {
  const target = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) {
    throw new Error(`Invalid ISO date: ${dateIso}`);
  }

  const fallbackYear = target.getUTCFullYear();
  const rows = page.locator(".TimesheetSlat:has(.TimesheetSlat__dayDate)");
  const count = await rows.count();

  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const label = (await row.locator(".TimesheetSlat__dayDate").first().textContent()) ?? "";
    const parsed = parseRowDateLabel(label, fallbackYear);
    if (!parsed) {
      continue;
    }

    if (
      parsed.getUTCFullYear() === target.getUTCFullYear() &&
      parsed.getUTCMonth() === target.getUTCMonth() &&
      parsed.getUTCDate() === target.getUTCDate()
    ) {
      return row;
    }
  }

  throw new Error(`Could not find an exact row for date ${dateIso}.`);
}

async function getFirstTextIfPresent(locator: ReturnType<Page["locator"]>): Promise<string> {
  if ((await locator.count()) === 0) {
    return "";
  }

  return (await locator.first().textContent())?.trim() ?? "";
}

function assertSelectorsConfigured(): void {
  for (const key of SELECTOR_KEYS) {
    if (selectors[key].includes("PASTE_SELECTOR_HERE")) {
      throw new Error(
        `Selector '${key}' is not configured in src/selectors.ts. Replace placeholders before running.`,
      );
    }
  }
}

export async function launchBrowser(options: CliOptions): Promise<{ browser: Browser; page: Page }> {
  if (options.debug) {
    process.env.PWDEBUG = "1";
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: options.debug ? 120 : 0,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  return { browser, page };
}

export async function loginManually(page: Page, baseUrl: string): Promise<void> {
  assertSelectorsConfigured();

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(selectors.loginWithMicrosoft).waitFor({ state: "visible" });
  await page.locator(selectors.loginWithMicrosoft).click();

  await page.waitForURL(/microsoftonline\.com|bamboohr\.com/i, {
    timeout: 10 * 60 * 1000,
  });
}

export async function waitForBambooHome(page: Page, baseUrl: string): Promise<void> {
  const escaped = baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.waitForURL(new RegExp(`^${escaped.replace(/\/$/, "")}.*`, "i"), {
    timeout: 10 * 60 * 1000,
  });

  if (!/bamboohr\.com/i.test(page.url())) {
    throw new Error("Manual login did not return to a BambooHR URL.");
  }
}

export async function navigateToTimesheet(page: Page): Promise<void> {
  await page.locator(selectors.timesheetMenu).waitFor({ state: "visible" });
  await page.locator(selectors.timesheetMenu).click();
  await page.locator(selectors.monthPicker).waitFor({ state: "visible" });
}

export async function selectPeriod(page: Page, period: "this" | "past"): Promise<void> {
  const picker = page.locator(selectors.monthPicker);
  await picker.waitFor({ state: "visible" });

  const targetText = period === "past" ? "Previous Pay Period" : "This Pay Period";
  const currentText = ((await picker.textContent()) ?? "").trim().toLowerCase();

  if (!currentText.includes(targetText.toLowerCase())) {
    await picker.click();
    const option = page
      .locator(`[role='option']:has-text('${targetText}'), [role='menuitem']:has-text('${targetText}'), .fab-SelectToggle__content:has-text('${targetText}')`)
      .first();

    if (await option.count()) {
      await option.click();
    }
  }

  await page.waitForLoadState("networkidle");
}

export async function inspectDay(page: Page, date: string): Promise<DayInspection> {
  const row = await getExactDayRow(page, date);
  await row.waitFor({ state: "visible" });

  const explicitEntryTexts = (await row.locator(".TimeEntry").allTextContents())
    .map((text) => text.trim())
    .filter((text) => text.length > 0);

  const summaryText = await getFirstTextIfPresent(row.locator(".TimesheetSlat__firstAndLast"));
  const entriesCountText = await getFirstTextIfPresent(row.locator(".TimesheetSlat__entriesCount"));

  const countMatch = entriesCountText.match(/\((\d+)\s+entries?\)/i);
  const savedEntriesCount = countMatch ? Number(countMatch[1]) : 0;

  const now = new Date();
  const todayLocalIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const isToday = date === todayLocalIso;

  const includeSummaryText =
    summaryText.length > 0 &&
    (savedEntriesCount > 0 || explicitEntryTexts.length > 0 || !isToday);

  const extraInfoTexts = (
    await row.locator(".TimesheetSlat__extraInfoItem [data-fabric-component='BodyText'], .TimesheetSlat__extraInfoItem").allTextContents()
  )
    .map((text) => text.trim())
    .filter((text) => text.length > 0);

  const existingEntries = [
    ...explicitEntryTexts,
    ...(includeSummaryText ? [summaryText] : []),
    ...extraInfoTexts,
  ].filter((text, index, arr) => arr.indexOf(text) === index);

  return {
    date,
    existingEntries,
  };
}

export async function deleteDayEntries(page: Page, date: string): Promise<void> {
  const row = await getExactDayRow(page, date);
  await row.waitFor({ state: "visible" });

  while ((await row.locator(".TimeEntry").count()) > 0) {
    const entry = row.locator(".TimeEntry:visible").first();
    if ((await entry.count()) === 0) {
      const summary = row.locator(".TimesheetSlat__firstAndLast").first();
      await summary.waitFor({ state: "visible" });
      await summary.click();
      await entry.waitFor({ state: "visible" });
    }

    await entry.click();

    const editModal = page
      .locator("div[class*='baseModalBody']:has(h3:has-text('Edit Timesheet Entry'))")
      .first();
    await editModal.waitFor({ state: "visible" });

    const deleteButton = editModal.locator("button:has-text('Delete Time Entry')").first();
    await deleteButton.waitFor({ state: "visible" });
    await deleteButton.click();

    const confirmationModal = page
      .locator("div[class*='baseModalBody']:has(h3:has-text('Just Checking...'))")
      .first();
    await confirmationModal.waitFor({ state: "visible" });

    const confirmDeleteButton = confirmationModal
      .locator("button:has-text('Yes, Delete Entry')")
      .first();
    await confirmDeleteButton.waitFor({ state: "visible" });
    await confirmDeleteButton.click();
    await confirmationModal.waitFor({ state: "hidden" });
    await editModal.waitFor({ state: "hidden" });
  }
}

export async function fillDayEntries(page: Page, date: string, intervals: TimeInterval[]): Promise<void> {
  const row = await getExactDayRow(page, date);
  await row.waitFor({ state: "visible" });

  await row.locator(selectors.addTimeEntryButton).first().click();
  const modal = page
    .locator("div[class*='baseModalBody']:has(h3:has-text('Add Timesheet Entry'))")
    .first();
  await modal.waitFor({ state: "visible" });

  for (let i = 0; i < intervals.length; i += 1) {
    if (i > 0) {
      const addEntryButton = modal.locator("button:has-text('Add Entry')").first();
      await addEntryButton.waitFor({ state: "visible" });
      await addEntryButton.click();
    }

    const expectedInputs = (i + 1) * 2;
    await modal.locator("input.ClockField__formInput").nth(expectedInputs - 1).waitFor({ state: "visible" });

    const startInputIndex = i * 2;
    const endInputIndex = i * 2 + 1;
    await setClockField(page, modal, startInputIndex, intervals[i].start);
    await setClockField(page, modal, endInputIndex, intervals[i].end);
  }

  const saveButton = modal.locator(selectors.saveEntryButton).first();
  await saveButton.waitFor({ state: "visible" });

  const saveHandle = await saveButton.elementHandle();
  if (!saveHandle) {
    throw new Error("Could not resolve Save button handle in Add Timesheet Entry modal.");
  }

  await page.waitForFunction((button) => !(button as HTMLButtonElement).disabled, saveHandle, {
    timeout: 10_000,
  });

  await saveButton.click();
  await modal.waitFor({ state: "hidden" });
}

export async function verifyDayEntries(page: Page, date: string, intervals: TimeInterval[]): Promise<boolean> {
  const row = await getExactDayRow(page, date);
  await row.waitFor({ state: "visible" });

  const verificationRows = row.locator(selectors.entryVerificationRow);
  await verificationRows.first().waitFor({ state: "visible" });
  const texts = (await verificationRows.allTextContents()).map((t) => t.toLowerCase());

  return intervals.every((interval) => {
    const start = toUiTime(interval.start).toLowerCase();
    const end = toUiTime(interval.end).toLowerCase();
    return texts.some((text) => text.includes(start) && text.includes(end));
  });
}

export async function saveFailureDiagnostics(
  page: Page,
  rootDir: string,
  tag: string,
  logger: JsonLogger,
): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTag = tag.replace(/[^a-z0-9-_]/gi, "_").toLowerCase();
  const screenshotPath = join(rootDir, "artifacts", "screenshots", `${safeTag}-${stamp}.png`);
  const htmlPath = join(rootDir, "artifacts", "html", `${safeTag}-${stamp}.html`);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(htmlPath, await page.content(), "utf8");

  logger.error("failure_diagnostics_saved", { screenshotPath, htmlPath, tag });
}