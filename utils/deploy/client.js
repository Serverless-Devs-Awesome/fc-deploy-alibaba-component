'use strict'

const FC = require('@alicloud/fc2');
const RAM = require('@alicloud/ram');
const Pop = require('@alicloud/pop-core');

FC.prototype.getAccountSettings = function (options = {}, headers = {}) {
  return this.get('/account-settings', options, headers)
}

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

  buildVpcClient () {
    return new Pop({
      endpoint: 'https://vpc.aliyuncs.com',
      apiVersion: '2016-04-28',
      accessKeyId: this.accessKeyID,
      accessKeySecret: this.accessKeySecret,
      opts: {
        timeout: 60 * 1000
      }
    })
  }

  buildEcsClient () {
    return new Pop({
      endpoint: 'https://ecs.aliyuncs.com',
      apiVersion: '2014-05-26',
      accessKeyId: this.accessKeyID,
      accessKeySecret: this.accessKeySecret,
      opts: {
        timeout: 60 * 1000
      }
    })
  }

  buildNasClient () {
    return new Pop({
      endpoint: `http://nas.${this.region}.aliyuncs.com`,
      apiVersion: '2017-06-26',
      accessKeyId: this.accessKeyID,
      accessKeySecret: this.accessKeySecret,
      opts: {
        timeout: 60 * 1000
      }
    })
  }
}

module.exports = Client
