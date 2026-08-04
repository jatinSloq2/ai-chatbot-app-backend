module.exports = {
  testEnvironment: "node",
  testTimeout: 30000,
  globalSetup: "./tests/globalSetup.js",
  globalTeardown: "./tests/globalTeardown.js",
  setupFiles: ["./tests/setEnv.js"],
};
