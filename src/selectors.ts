export const selectors = {
  loginWithMicrosoft: 'a[href*="/sso/microsoft_login"]',
  timesheetMenu: 'a[data-bi-id="my-time-widget-timesheet-button"]',
  monthPicker: ".TimesheetHeader__period .fab-SelectToggle",
  dayRow: ".TimesheetSlat",
  existingEntryText:
    ".TimesheetSlat__firstAndLast, .TimeEntry, .TimesheetSlat__extraInfoItem [data-fabric-component='BodyText']",
  addTimeEntryButton: "a.TimesheetSlat__addEntryLink",
  startTimeInput: ".ClockField input.ClockField__formInput",
  endTimeInput: ".ClockField input.ClockField__formInput",
  commentInput: "",
  saveEntryButton: "button:has-text('Save')",
  entryVerificationRow: ".TimesheetSlat__firstAndLast, .TimeEntry",
  finalSubmitButton:
    "button:has-text('Submit'), button:has-text('Approve'), button:has-text('Save & Submit')",
} as const;

export function getDayRowSelector(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date passed to getDayRowSelector: ${date}`);
  }

  const shortMonth = parsed.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const dayNumber = parsed.getUTCDate();

  return `.TimesheetSlat:has(.TimesheetSlat__dayDate:has-text('${shortMonth} ${dayNumber}'))`;
}
