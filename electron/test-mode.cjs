// Test-only switches must not be armed by a launch-time environment variable
// in an installed build. Electron sets process.defaultApp only when launched
// from a source path (`electron .`), which is how the test suite runs; an
// installed .app leaves it unset and ignores these switches entirely.
function networkBypassEnabled(env, defaultApp) {
  return !!(env && env.ASSET_TEST_MODE) && !!defaultApp;
}

function signedUpdatesRequired(env, defaultApp) {
  // Installed builds always verify the Ed25519 signature over the checksum
  // manifest. Source-run development keeps the opt-in behavior for local,
  // unsigned test releases.
  return defaultApp ? !!(env && env.CANVAS_REQUIRE_SIGNED_UPDATES) : true;
}

module.exports = { networkBypassEnabled, signedUpdatesRequired };
