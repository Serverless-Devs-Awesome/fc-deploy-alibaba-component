const Logger = require('./logger');
const ServerlessError = require('./error');

class ErrorMessage {
  constructor() {
    this.logger = new Logger();
  }
  
  throwProcessedException (ex, policyName) {
    if (ex.code === 'Forbidden.RAM') {
      this.logger.error(`\n${ex.message}`);
      new ServerlessError({
        message: `\nMaybe you need grant ${policyName} policy to the sub-account or use the primary account.\nIf you don’t want use the ${policyName} policy or primary account, you can also specify the Role property for Service.`
      });
    }
    new ServerlessError(ex);
  }
}