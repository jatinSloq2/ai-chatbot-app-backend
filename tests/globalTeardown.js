const fs = require("fs");

module.exports = async () => {
  if (global.__MONGOD__) await global.__MONGOD__.stop();
  if (fs.existsSync("./tests/.mongo-uri")) fs.unlinkSync("./tests/.mongo-uri");
};
