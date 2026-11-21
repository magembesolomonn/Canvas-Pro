function networkBypassEnabled(env, defaultApp) {
  return !!(env && env.ASSET_TEST_MODE) && !!defaultApp;
}

function signedUpdatesRequired(env, defaultApp) {
  return defaultApp ? !!(env && env.CANVAS_REQUIRE_SIGNED_UPDATES) : true;
}

module.exports = { networkBypassEnabled, signedUpdatesRequired };
