'use strict'

const FC = require('@alicloud/fc2');
const RAM = require('@alicloud/ram');

class Client {
  constructor (credentials, region) {
    this.region = region
    this.credentials = credentials

    this.accountId = credentials.AccountID
    this.accessKeyID = credentials.AccessKeyID
    this.accessKeySecret = credentials.AccessKeySecret
    this.stsToken = credentials.SecurityToken
  }

  buildFcClient () {
    return new FC(this.accountId, {
      accessKeyID: this.accessKeyID,
      accessKeySecret: this.accessKeySecret,
      securityToken: this.stsToken,
      region: this.region,
      timeout: 6000000
    })
  }
  
  buildRamClient () {
    return new RAM({
      accessKeyId: this.accessKeyID,
      accessKeySecret: this.accessKeySecret,
      securityToken: this.stsToken,
      endpoint: 'https://ram.aliyuncs.com',
      opts: {
        timeout: 60000
      }
    })
  }
}

module.exports = Client
