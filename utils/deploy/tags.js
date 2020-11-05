'use strict'
const _ = require('lodash')
const Client = require('../client')
const Logger = require('../logger')
const ServerlessError = require('../error')

class TAG extends Client {
  constructor (credentials, region) {
    super(credentials, region)
    this.fcClient = this.buildFcClient()
    this.logger = new Logger()
  }

  async deploy (resourceArn, tagsInput, tagName) {
    if (_.isEmpty(tagsInput)) { return }
    let tags = {};
    // tags格式化
    tagsInput.forEach(({ Key, Value }) => {
      if (Key !== undefined) {
        tags[Key] = Value;
      }
    })
    if (tagName) {
      if (!_.has(tags, tagName)) {
        new ServerlessError({ message: `${tagName} not found.` })
      }
      tags = {
        [tagName]: tags[tagName]
      }
    }

    // 打标签
    this.logger.info('Tags: tagging resource ...')
    await this.fcClient.tagResource(resourceArn, tags)

    return tags
  }
}

module.exports = TAG
