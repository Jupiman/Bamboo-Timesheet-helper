#BambooHR Timesheet Helper
##What it is
An assisted command-line tool for entering actual work time into BambooHR via an automated browser window.

##What it does
The helper automatically inputs your pre-configured daily work schedules from your local settings file into your weekdays.

It automatically skips weekends.

It automatically skips any day containing a Vacation entry, so you can fill any remaining time manually.

It never clicks final submission or approval buttons—final review and submission are always manual and performed by you.

##The Workflow
Start: Launch the helper by running the main batch file: run.bat

Log In: A browser window opens to your BambooHR portal, where you manually complete your password login and Multi-Factor Authentication (MFA).

Process Days: The tool automatically navigates to your timesheet and checks each weekday. If a day is empty, it applies your configured template intervals. If a day already has work entries, the command line asks whether you want to edit that day anyway.

Manual Review: The browser remains open at the end so you can manually review the entries.

##Changing Script Behavior
By default, running run.bat automatically targets the current pay period (--period this). You can append optional flags to the command to change how the helper behaves:

###Target the previous pay period:
run.bat --period past

###Simulation Mode (Dry Run):
Inspects your timesheet days and prints existing entries to the console, but never writes any data into BambooHR.
run.bat --dry-run

###Debug Mode:
Enables verbose visual pacing and interactive browser debugging tools.
run.bat --debug

###Continue on Error:
Forces the script to keep processing subsequent days even if a navigation or validation failure occurs on a specific day.
run.bat --continue-on-error