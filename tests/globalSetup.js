const { MongoMemoryServer } = require("mongodb-memory-server");

module.exports = async () => {
  const mongod = await MongoMemoryServer.create();
  global.__MONGOD__ = mongod;
  process.env.MONGO_URI = mongod.getUri();
  // Write to a file since globalSetup runs in a separate process from test files
  require("fs").writeFileSync("./tests/.mongo-uri", mongod.getUri());
};
