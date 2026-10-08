// Site-wide settings. Fill these in once after you publish to GitHub Pages.
// Every value here can also be overridden per person in the app's Settings panel
// (stored only in that person's browser).
window.REP_MAILER_CONFIG = {
  // Google OAuth "Web application" Client ID. Required for one-click sending
  // through each visitor's own Gmail. Leave empty to use "Open in Gmail" mode.
  // Looks like: 1234567890-abc123.apps.googleusercontent.com
  googleClientId: "",

  // Optional. Free key from https://open.pluralpolicy.com/accounts/profile/
  // Adds state legislators (with emails) and the U.S. House member for an address.
  // Note: anything in this file is public, so only put a free key here.
  openStatesKey: "",

  // Optional and paid. Cicero (cicerodata.com) adds city and county officials
  // in many places. Best left empty here; each person can enter their own key.
  ciceroKey: "",

  // Seconds to wait between individual emails so Gmail does not flag the account.
  sendDelaySeconds: 2,

  // Safety cap on how many emails one send can include.
  maxRecipientsPerSend: 150
};
