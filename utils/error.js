
class ServerlessError {
  constructor(e) {
    if (e instanceof Error) {
      throw e;
    } else {
      const { name, message } = e;
      const err = new Error(message);
      err.name = name;
      throw err;
    }
  }
}

module.exports = ServerlessError;