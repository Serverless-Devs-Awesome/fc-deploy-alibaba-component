'use strict'

const _ = require('lodash');

const util = require('util');
const http = require('http');
const RAM = require('../ram');
const Client = require('./client');
const ServerlessError = require('../error');

// const { CustomDomain } = require('./customDomain')
const Logger = require('../logger');
const { sleep } = require('../utils');

const triggerTypeMapping = {
  Datahub: 'datahub',
  Timer: 'timer',
  HTTP: 'http',
  Log: 'log',
  OSS: 'oss',
  RDS: 'rds',
  MNSTopic: 'mns_topic',
  TableStore: 'tablestore',
  CDN: 'cdn_events'
};

class Trigger extends Client {
  constructor (credentials, region) {
    super(credentials, region);
    this.fcClient = this.buildFcClient();
    this.logger = new Logger();
  }

  displayDomainInfo (domainName, triggerName, triggerProperties, EndPoint, isDomain) {
    this.logger.info(`\tTriggerName: ${triggerName}`);
    this.logger.info(`\tMethods: ${triggerProperties.Methods || triggerProperties.methods}`);
    if (isDomain) {
      this.logger.info(`\tUrl: ${domainName}`);
    }
    this.logger.info(`\tEndPoint: ${EndPoint}`);
  }

  async getAutoDomainState (domain) {
    const options = {
      host: domain,
      port: '80',
      path: '/'
    }
    return new Promise(function (resolve, reject) {
      const req = http.get(options, function (res) {
        res.setEncoding('utf8')
        res.on('data', function (chunk) {
          try {
            resolve(String(chunk))
          } catch (e) {
            resolve(undefined)
          }
        })
      })
      req.on('error', function (e) {
        resolve(undefined)
      })
      req.end()
    })
  }

  async getSourceArn (triggerType, triggerParameters) {
    if (triggerType === 'Log') {
      return `acs:log:${this.region}:${this.accountId}:project/${triggerParameters.LogConfig.Project}`
    } else if (triggerType === 'RDS') {
      return `acs:rds:${this.region}:${this.accountId}:dbinstance/${triggerParameters.InstanceId}`
    } else if (triggerType === 'MNSTopic') {
      if (triggerParameters.Region !== undefined) {
        return `acs:mns:${triggerParameters.Region}:${this.accountId}:/topics/${triggerParameters.TopicName}`
      }
      return `acs:mns:${this.region}:${this.accountId}:/topics/${triggerParameters.TopicName}`
    } else if (triggerType === 'TableStore') {
      return `acs:ots:${this.region}:${this.accountId}:instance/${triggerParameters.InstanceName}/table/${triggerParameters.TableName}`
    } else if (triggerType === 'OSS') {
      return `acs:oss:${this.region}:${this.accountId}:${triggerParameters.Bucket}`
    } else if (triggerType === 'CDN') {
      return `acs:cdn:*:${this.accountId}`
    }
  }

  async makeInvocationRole (serviceName, functionName, triggerType, qualifier) {
    const ram = new RAM(this.credentials)
    if (triggerType === 'Log') {
      const invocationRoleName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      const invocationRole = await ram.makeRole(
        invocationRoleName,
        true,
        'Used for fc invocation',
        {
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: ['log.aliyuncs.com']
              }
            }
          ],
          Version: '1'
        }
      )
      const policyName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      await ram.makePolicy(policyName, {
        Version: '1',
        Statement: [
          {
            Action: ['fc:InvokeFunction'],
            Resource: `acs:fc:*:*:services/${serviceName}/functions/*`,
            Effect: 'Allow'
          },
          {
            Action: [
              'log:Get*',
              'log:List*',
              'log:PostLogStoreLogs',
              'log:CreateConsumerGroup',
              'log:UpdateConsumerGroup',
              'log:DeleteConsumerGroup',
              'log:ListConsumerGroup',
              'log:ConsumerGroupUpdateCheckPoint',
              'log:ConsumerGroupHeartBeat',
              'log:GetConsumerGroupCheckPoint'
            ],
            Resource: '*',
            Effect: 'Allow'
          }
        ]
      })
      await ram.attachPolicyToRole(policyName, invocationRoleName, 'Custom')
      return invocationRole.Role
    } else if (triggerType === 'RDS' || triggerType === 'MNSTopic') {
      const invocationRoleName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      var tMap = {
        RDS: 'rds',
        MNSTopic: 'mns'
      }
      var principalService = util.format('%s.aliyuncs.com', tMap[triggerType])
      const invocationRole = await ram.makeRole(
        invocationRoleName,
        true,
        'Used for fc invocation',
        {
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: [principalService]
              }
            }
          ],
          Version: '1'
        }
      )
      const policyName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      await ram.makePolicy(policyName, {
        Version: '1',
        Statement: [
          {
            Action: ['fc:InvokeFunction'],
            Resource: `acs:fc:*:*:services/${serviceName}/functions/*`,
            Effect: 'Allow'
          }
        ]
      })
      await ram.attachPolicyToRole(policyName, invocationRoleName, 'Custom')
      return invocationRole.Role
    } else if (triggerType === 'TableStore') {
      const invocationRoleName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      const invocationRole = await ram.makeRole(
        invocationRoleName,
        true,
        'Used for fc invocation',
        {
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                RAM: ['acs:ram::1604337383174619:root']
              }
            }
          ],
          Version: '1'
        }
      )
      const invkPolicyName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      await ram.makePolicy(invkPolicyName, {
        Version: '1',
        Statement: [
          {
            Action: ['fc:InvokeFunction'],
            Resource: '*',
            Effect: 'Allow'
          }
        ]
      })
      await ram.attachPolicyToRole(invkPolicyName, invocationRoleName, 'Custom')
      const otsReadPolicyName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      await ram.makePolicy(otsReadPolicyName, {
        Version: '1',
        Statement: [
          {
            Action: ['ots:BatchGet*', 'ots:Describe*', 'ots:Get*', 'ots:List*'],
            Resource: '*',
            Effect: 'Allow'
          }
        ]
      })
      await ram.attachPolicyToRole(otsReadPolicyName, invocationRoleName, 'Custom')
      return invocationRole.Role
    } else if (triggerType === 'OSS') {
      const invocationRoleName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      const invocationRole = await ram.makeRole(
        invocationRoleName,
        true,
        'Used for fc invocation',
        {
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: ['oss.aliyuncs.com']
              }
            }
          ],
          Version: '1'
        }
      )
      const policyName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      await ram.makePolicy(policyName, {
        Version: '1',
        Statement: [
          {
            Action: ['fc:InvokeFunction'],
            Resource: qualifier
              ? `acs:fc:*:*:services/${serviceName}.*/functions/*`
              : `acs:fc:*:*:services/${serviceName}/functions/*`,
            Effect: 'Allow'
          }
        ]
      })
      await ram.attachPolicyToRole(policyName, invocationRoleName, 'Custom')
      return invocationRole.Role
    } else if (triggerType === 'CDN') {
      const invocationRoleName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      const invocationRole = await ram.makeRole(
        invocationRoleName,
        true,
        'Used for fc invocation',
        {
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: ['cdn.aliyuncs.com']
              }
            }
          ],
          Version: '1'
        }
      )
      const policyName = ram.normalizeRoleOrPoliceName(
        `Fc-${serviceName}-${functionName}`
      )
      await ram.makePolicy(policyName, {
        Version: '1',
        Statement: [
          {
            Action: ['fc:InvokeFunction'],
            Resource: `acs:fc:*:*:services/${serviceName}/functions/*`,
            Effect: 'Allow'
          }
        ]
      })
      await ram.attachPolicyToRole(policyName, invocationRoleName, 'Custom')
      return invocationRole.Role
    }
    return false
  }

  async deployTrigger (serviceName, functionName, trigger, isOnlyDeployTrigger) {
    const triggerType = trigger.Type
    const triggerName = trigger.Name
    const output = {
      Name: triggerName,
      Type: triggerType
    }
    const triggerParameters = trigger.Parameters
    const parameters = {
      triggerType: triggerTypeMapping[trigger.Type]
    }
    if (triggerType === 'OSS') {
      parameters.triggerConfig = {
        events: triggerParameters.Events,
        filter: {
          key: {
            prefix: triggerParameters.Filter.Prefix,
            suffix: triggerParameters.Filter.Suffix
          }
        }
      }
    } else if (triggerType === 'Timer') {
      parameters.triggerConfig = {
        payload: triggerParameters.Payload,
        cronExpression: triggerParameters.CronExpression,
        enable: !!triggerParameters.Enable
      }
    } else if (triggerType === 'HTTP') {
      parameters.triggerConfig = {
        authType: triggerParameters.AuthType.toLowerCase(),
        methods: triggerParameters.Methods
      }
    } else if (triggerType === 'Log') {
      parameters.triggerConfig = {
        sourceConfig: {
          logstore: triggerParameters.SourceConfig.LogStore
        },
        jobConfig: {
          maxRetryTime: triggerParameters.JobConfig.MaxRetryTime,
          triggerInterval: triggerParameters.JobConfig.TriggerInterval
        },
        logConfig: {
          project: triggerParameters.LogConfig.Project,
          logstore: triggerParameters.LogConfig.LogStore
        },
        functionParameter: triggerParameters.FunctionParameter || {},
        Enable: !!triggerParameters.Enable
      }
    } else if (triggerType === 'RDS') {
      parameters.triggerConfig = {
        subscriptionObjects: triggerParameters.SubscriptionObjects,
        retry: triggerParameters.Retry,
        concurrency: triggerParameters.Concurrency,
        eventFormat: triggerParameters.EventFormat
      }
    } else if (triggerType === 'MNSTopic') {
      parameters.triggerConfig = {
        NotifyContentFormat: triggerParameters.NotifyContentFormat
          ? triggerParameters.NotifyContentFormat
          : 'STREAM',
        NotifyStrategy: triggerParameters.NotifyStrategy
          ? triggerParameters.NotifyStrategy
          : 'BACKOFF_RETRY'
      }
      if (triggerParameters.FilterTag) {
        parameters.triggerConfig.FilterTag = triggerParameters.FilterTag
      }
    } else if (triggerType === 'TableStore') {
      parameters.triggerConfig = {}
    } else if (triggerType === 'CDN') {
      parameters.triggerConfig = {
        eventName: triggerParameters.EventName,
        eventVersion: triggerParameters.EventVersion,
        notes: triggerParameters.Notes,
        filter: _.mapKeys(triggerParameters.Filter, (value, key) => {
          return _.lowerFirst(key)
        })
      }
    }

    let invocationRoleArn = triggerParameters.InvocationRole
    if (!invocationRoleArn) {
      const invocationRole = await this.makeInvocationRole(
        serviceName,
        functionName,
        triggerType,
        parameters.Qualifier
      )
      if (invocationRole) {
        invocationRoleArn = invocationRole.Arn
      }
    }
    if (invocationRoleArn) {
      Object.assign(parameters, {
        invocationRole: invocationRoleArn
      })
    }

    const sourceArn = await this.getSourceArn(triggerType, triggerParameters)
    if (sourceArn) {
      Object.assign(parameters, {
        sourceArn: sourceArn
      })
    }

    if (triggerParameters.Qualifier) {
      Object.assign(parameters, {
        qualifier: `${triggerParameters.Qualifier}`
      })
    }
    const endPoint = `https://${this.accountId}.${this.region}.fc.aliyuncs.com/2016-08-15/proxy/${serviceName}/${functionName}/`

    // 部署 http 域名
    const deployDomain = async (domains) => {
      if (!domains) {
        return this.displayDomainInfo(endPoint, triggerName, triggerParameters, endPoint)
      }
      try {
        let domainNames
        for (let i = 0; i <= 3; i++) {
          const customDomain = new CustomDomain(this.credentials, this.region)
          domainNames = await customDomain.deploy(domains, serviceName, functionName)

          output.Domains = domainNames || endPoint
          if (output.Domains && output.Domains.length > 0) {
            for (let j = 0; j < output.Domains.length; j++) {
              if (String(output.Domains[j]).endsWith('.test.functioncompute.com')) {
                const tempState = await this.getAutoDomainState(output.Domains[j])
                if (tempState !== undefined && !String(tempState).includes('DomainNameNotFound')) {
                  i = 5
                }
              } else {
                await sleep(2000)
              }
            }
          }
        }
        domainNames.forEach(domainName => this.displayDomainInfo(domainName, triggerName, triggerParameters, endPoint, true))
      } catch (e) {
        this.displayDomainInfo(endPoint, triggerName, triggerParameters, endPoint)
        output.Domains = endPoint
      }
    }

    try {
      await this.fcClient.getTrigger(serviceName, functionName, triggerName)
      if (triggerType === 'TableStore' || triggerType === 'MNSTopic') {
        this.logger.info('The trigger type: TableStore/MNSTopic does not support updates.')
        return output
      } else {
        // 更新触发器
        try {
          await this.fcClient.updateTrigger(serviceName, functionName, triggerName, parameters)
          if (triggerType === 'HTTP' && !isOnlyDeployTrigger) {
            await deployDomain(triggerParameters.Domains)
          }
          return output
        } catch (ex) {
          throw new Error(
            `${serviceName}:${functionName}@${triggerType}${triggerName} update failed: ${ex.message}`
          )
        }
      }
    } catch (e) {
      // 创建触发器
      try {
        parameters.triggerName = triggerName
        await this.fcClient.createTrigger(serviceName, functionName, parameters)
        if (triggerType === 'HTTP' && !isOnlyDeployTrigger) {
          await deployDomain(triggerParameters.Domains)
        }
        return output
      } catch (ex) {
        throw new Error(
          `${serviceName}:${functionName}@${triggerType}-${triggerName} create failed: ${ex.message}`
        )
      }
    }
  }

  /**
   * Remove trigger
   * @param {*} serviceName
   * @param {*} functionName
   * @param {*} triggerList : will delete all triggers if not specified
   */
  async remove (serviceName, functionName, parameters) {
    const onlyRemoveTriggerName = parameters ? (parameters.n || parameters.name) : false
    const triggerList = []

    if (onlyRemoveTriggerName) {
      triggerList.push(onlyRemoveTriggerName)
    } else {
      try {
        const listTriggers = await this.fcClient.listTriggers(serviceName, functionName)
        const curTriggerList = listTriggers.data
        for (let i = 0; i < curTriggerList.triggers.length; i++) {
          triggerList.push(curTriggerList.triggers[i].triggerName)
        }
      } catch (ex) {
        if (ex.code === 'ServiceNotFound') {
          this.logger.info('Service not exists, skip deleting trigger')
          return
        }
        if (ex.code === 'FunctionNotFound') {
          this.logger.info('Function not exists, skip deleting trigger')
          return
        }
        throw new Error(`Unable to get triggers: ${ex.message}`)
      }
    }

    // 删除触发器
    for (let i = 0; i < triggerList.length; i++) {
      this.logger.info(`Deleting trigger: ${triggerList[i]}`)
      try {
        await this.fcClient.deleteTrigger(serviceName, functionName, triggerList[i])
      } catch (ex) {
        throw new Error(`Unable to delete trigger: ${ex.message}`)
      }

      this.logger.success(`Delete trigger successfully: ${triggerList[i]}`)
    }
  }

  async deploy (properties, serviceName, functionName, triggerName, onlyDeployTrigger) {
    const triggerOutput = [];
    const releaseTriggerList = [];
    const thisTriggerList = [];

    try {
      const tempTriggerList = await this.fcClient.listTriggers(serviceName, functionName);
      const data = tempTriggerList.data.triggers;
      for (let i = 0; i < data.length; i++) {
        releaseTriggerList.push(data[i].triggerName);
      }
    } catch (ex) {
      this.logger.info(ex);
    }
    if (properties.Function.Triggers) {
      const handlerDeployTrigger = async (deployTriggerConfig, deployTriggerName) => {
        this.logger.info(`Trigger: ${serviceName}@${functionName}${deployTriggerName} deploying ...`);

        triggerOutput.push(
          await this.deployTrigger(serviceName, functionName, deployTriggerConfig, onlyDeployTrigger)
        );
        thisTriggerList.push(deployTriggerName);

        this.logger.info(`Trigger: ${serviceName}@${functionName}-${deployTriggerName} deploy successfully`);
      }

      if (triggerName) {
        const onlyDeployTriggerConfig = _.filter(properties.Function.Triggers, ({ Name }) => Name === triggerName)
        if (onlyDeployTriggerConfig.length < 1) {
          throw new Error(`${triggerName} not found.`)
        }
        if (onlyDeployTriggerConfig.length > 1) {
          throw new Error(`${triggerName} repeated statement.`)
        }
        await handlerDeployTrigger(onlyDeployTriggerConfig[0], triggerName)
      } else {
        for (let i = 0; i < properties.Function.Triggers.length; i++) {
          const deployTriggerName = properties.Function.Triggers[i].Name
          await handlerDeployTrigger(properties.Function.Triggers[i], deployTriggerName)
        }
      }
    }

    // 删除触发器
    for (let i = 0; i < releaseTriggerList.length; i++) {
      if (thisTriggerList.indexOf(releaseTriggerList[i]) === -1) {
        this.logger.info(`Deleting trigger: ${releaseTriggerList[i]}.`)
        await this.fcClient.deleteTrigger(serviceName, functionName, releaseTriggerList[i])
      }
    }

    return triggerOutput
  }
}

module.exports = Trigger
