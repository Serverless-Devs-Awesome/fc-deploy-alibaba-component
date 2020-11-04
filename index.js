const { Component } = require('@serverless-devs/s-core');
const getHelp = require('./utils/help');
const ServerlessError = require('./utils/error')

class FcComponent extends Component {
  constructor() {
    super();
  }

  async deploy (inputs) {
    this.help(inputs, getHelp(inputs));
  }
}

module.exports = FcComponent;