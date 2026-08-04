// Used only to sanity-check the DB-free unit tests in this sandbox (no network
// access to download the mongodb-memory-server binary here). The real test
// suite (jest.config.js) includes globalSetup for the full integration tests
// and is what you should use normally: `npm test`.
module.exports = {
  testEnvironment: "node",
  testTimeout: 10000,
  setupFiles: ["./tests/setEnv.js"],
  testMatch: ["**/tests/unit/**/*.test.js"],
};
