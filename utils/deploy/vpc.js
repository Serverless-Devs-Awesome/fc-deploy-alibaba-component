const _ = require('lodash');
const Client = require('./client');
const Logger = require('../logger');


class Vpc extends Client {
  constructor (credentials, region) {
    super(credentials, region);
    this.logger = new Logger();
  }

}

module.exports = Vpc;
