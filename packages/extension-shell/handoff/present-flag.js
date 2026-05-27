// Runs in the page's MAIN world (NOT the isolated content-script
// world) so the flag is visible to the web-shell's own React code.
// Used by ChallengeModal.hasExtensionPresent() to switch between the
// "click Send to Uncraft" copy (extension installed) and the
// "install the extension" copy (not installed).
//
// IMPORTANT: this file runs in MAIN world — `chrome.runtime` is NOT
// available here. Keep it to plain window globals.
window.__uncraftExtensionPresent = true;
