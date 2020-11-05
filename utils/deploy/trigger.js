'use strict'

const _ = require('lodash');

const util = require('util');
const http = require('http');
const RAM = require('./ram');
const Client = require('../client');
const ServerlessError = require('../error');

const { CustomDomain } = require('./custom-domain');
const Logger = require('../logger');
const defaultPolice = require('../defaultPolice');
const { sleep, normalizeRoleOrPoliceName } = require('../utils');

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
    const mnsTopic = () => {
      if (triggerParameters.Region !== undefined) {
        return `acs:mns:${triggerParameters.Region}:${this.accountId}:/topics/${triggerParameters.TopicName}`;
      }
      return `acs:mns:${this.region}:${this.accountId}:/topics/${triggerParameters.TopicName}`;
    }

    const sourceArnMap = {
      Log: () => `acs:log:${this.region}:${this.accountId}:project/${triggerParameters.LogConfig.Project}`,
      RDS: () => `acs:rds:${this.region}:${this.accountId}:dbinstance/${triggerParameters.InstanceId}`,
      MNSTopic: mnsTopic,
      TableStore: () => `acs:ots:${this.region}:${this.accountId}:instance/${triggerParameters.InstanceName}/table/${triggerParameters.TableName}`,
      OSS: () => `acs:oss:${this.region}:${this.accountId}:${triggerParameters.Bucket}`,
      CDN: () => `acs:cdn:*:${this.accountId}`
    }

    if (sourceArnMap[triggerType]) {
      return sourceArnMap[triggerType]();
    }
  }

  async makeInvocationRole (serviceName, functionName, triggerType, qualifier) {
    const ram = new RAM(this.credentials);

    const invocationRoleName = normalizeRoleOrPoliceName(`Fc-${serviceName}-${functionName}`);
    const policyName = normalizeRoleOrPoliceName(`Fc-${serviceName}-${functionName}`);
    const description = 'Used for fc invocation';

    let invocationRole;
    switch (triggerType) {
      case 'log':
        invocationRole = await ram.makeRole(invocationRoleName, true, description, defaultPolice.logRolePolicy);
        await ram.makePolicy(policyName, defaultPolice.getLogTriggerPolicy(serviceName));
        await ram.attachPolicyToRole(policyName, invocationRoleName, 'Custom');
        break;
      case 'RDS':
      case 'MNSTopic':
        const tMap = { RDS: 'rds', MNSTopic: 'mns' };
        const principalService = util.format('%s.aliyuncs.com', tMap[triggerType]);
        const mnsOrRdsTriggerPolicy = defaultPolice.getMnsOrRdsTriggerPolicy(principalService);
        invocationRole = await ram.makeRole(invocationRoleName, true, description, mnsOrRdsTriggerPolicy);

        await ram.makePolicy(policyName, defaultPolice.getInvokeFunctionPolicy(serviceName));
        await ram.attachPolicyToRole(policyName, invocationRoleName, 'Custom');
  
        break;
      case 'TableStore':
        const invkPolicyName = normalizeRoleOrPoliceName(`Fc-${serviceName}-${functionName}`);
        const otsReadPolicyName = normalizeRoleOrPoliceName(`Fc-${serviceName}-${functionName}`);

        invocationRole = await ram.makeRole(invocationRoleName, true, description, defaultPolice.tableStoreRolePolicy);
        await ram.makePolicy(invkPolicyName, defaultPolice.getInvokeFunctionPolicy());
        await ram.attachPolicyToRole(invkPolicyName, invocationRoleName, 'Custom');
        await ram.makePolicy(otsReadPolicyName, defaultPolice.otsReadPolicy);
        await ram.attachPolicyToRole(otsReadPolicyName, invocationRoleName, 'Custom');
        break;
      case 'OSS':
        invocationRole = await ram.makeRole(invocationRoleName, true, description, defaultPolice.ossTriggerPolicy);
        await ram.makePolicy(policyName, defaultPolice.getInvokeFunctionPolicy(serviceName, qualifier));
        await ram.attachPolicyToRole(policyName, invocationRoleName, 'Custom');
        break;
      case 'CDN':
        invocationRole = await ram.makeRole(invocationRoleName, true, description, defaultPolice.cdnTriggerPolicy);
        await ram.makePolicy(policyName, defaultPolice.getInvokeFunctionPolicy(serviceName));
        await ram.attachPolicyToRole(policyName, invocationRoleName, 'Custom');
        break;
    }

    if (invocationRole) {
      return invocationRole.Role;
    }
    return false;
  }

  async deployTrigger (serviceName, functionName, trigger, isOnlyDeployTrigger) {
    const triggerType = trigger.Type;
    const triggerName = trigger.Name;
    const output = {
      Name: triggerName,
      Type: triggerType
    };
    const triggerParameters = trigger.Parameters;
    const parameters = {
      triggerType: triggerTypeMapping[trigger.Type]
    };

    const triggerConfigMap = {
      OSS: () => ({
        events: triggerParameters.Events,
        filter: {
          key: {
            prefix: triggerParameters.Filter.Prefix,
            suffix: triggerParameters.Filter.Suffix
          }
        }
      }),
      Timer: () => ({
        payload: triggerParameters.Payload,
        cronExpression: triggerParameters.CronExpression,
        enable: !!triggerParameters.Enable
      }),
      HTTP: () => ({
        authType: triggerParameters.AuthType.toLowerCase(),
        methods: triggerParameters.Methods
      }),
      Log: () => ({
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
      }),
      RDS: () => ({
        subscriptionObjects: triggerParameters.SubscriptionObjects,
        retry: triggerParameters.Retry,
        concurrency: triggerParameters.Concurrency,
        eventFormat: triggerParameters.EventFormat
      }),
      MNSTopic: () => ({
        NotifyContentFormat: triggerParameters.NotifyContentFormat
          ? triggerParameters.NotifyContentFormat
          : 'STREAM',
        NotifyStrategy: triggerParameters.NotifyStrategy
          ? triggerParameters.NotifyStrategy
          : 'BACKOFF_RETRY',
        FilterTag: triggerParameters.FilterTag ? triggerParameters.FilterTag : undefined
      }),
      TableStore: () => ({}),
      CDN: () => ({
        eventName: triggerParameters.EventName,
        eventVersion: triggerParameters.EventVersion,
        notes: triggerParameters.Notes,
        filter: _.mapKeys(triggerParameters.Filter, (value, key) => {
          return _.lowerFirst(key)
        })
      })
    };
    if (triggerConfigMap[triggerType]) {
      parameters.triggerConfig = triggerConfigMap[triggerType]();
    }

    let invocationRoleArn = triggerParameters.InvocationRole;
    if (!invocationRoleArn) {
      const invocationRole = await this.makeInvocationRole(serviceName, functionName, triggerType, parameters.Qualifier);
      if (invocationRole) {
        invocationRoleArn = invocationRole.Arn;
      }
    }
    if (invocationRoleArn) {
      parameters.invocationRole = invocationRoleArn;
    }

    const sourceArn = await this.getSourceArn(triggerType, triggerParameters);
    if (sourceArn) {
      parameters.sourceArn = sourceArn;
    }

    if (triggerParameters.Qualifier) {
      parameters.qualifier = `${triggerParameters.Qualifier}`;
    }
    const endPoint = `https://${this.accountId}.${this.region}.fc.aliyuncs.com/2016-08-15/proxy/${serviceName}/${functionName}/`;

    // 部署 http 域名
    const deployDomain = async (domains) => {
      if (!domains) {
        return this.displayDomainInfo(endPoint, triggerName, triggerParameters, endPoint)
      }
      try {
        let domainNames;
        for (let i = 0; i <= 3; i++) {
          const customDomain = new CustomDomain(this.credentials, this.region);
          domainNames = await customDomain.deploy(domains, serviceName, functionName);

          output.Domains = domainNames || endPoint;
          if (output.Domains && output.Domains.length > 0) {
            for (let j = 0; j < output.Domains.length; j++) {
              if (String(output.Domains[j]).endsWith('.test.functioncompute.com')) {
                const tempState = await this.getAutoDomainState(output.Domains[j]);
                if (tempState !== undefined && !String(tempState).includes('DomainNameNotFound')) {
                  i = 5;
                }
              } else {
                await sleep(2000);
              }
            }
          }
        }
        domainNames.forEach(domainName => this.displayDomainInfo(domainName, triggerName, triggerParameters, endPoint, true));
      } catch (e) {
        this.logger.log(e);
        this.displayDomainInfo(endPoint, triggerName, triggerParameters, endPoint);
        output.Domains = endPoint;
      }
    }

    try {
      await this.fcClient.getTrigger(serviceName, functionName, triggerName)
      if (triggerType === 'TableStore' || triggerType === 'MNSTopic') {
        this.logger.info('The trigger type: TableStore/MNSTopic does not support updates.')
        return output;
      } else {
        // 更新触发器
        try {
          await this.fcClient.updateTrigger(serviceName, functionName, triggerName, parameters);
          if (triggerType === 'HTTP' && !isOnlyDeployTrigger) {
            await deployDomain(triggerParameters.Domains);
          }
          return output;
        } catch (ex) {
          new ServerlessError({ message: `${serviceName}:${functionName}@${triggerType}${triggerName} update failed: ${ex.message}` });
        }
      }
    } catch (e) {
      // 创建触发器
      try {
        parameters.triggerName = triggerName;
        await this.fcClient.createTrigger(serviceName, functionName, parameters);
        if (triggerType === 'HTTP' && !isOnlyDeployTrigger) {
          await deployDomain(triggerParameters.Domains);
        }
        return output;
      } catch (ex) {
        new ServerlessError({ message: `${serviceName}:${functionName}@${triggerType}-${triggerName} create failed: ${ex.message}` });
      }
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
        const onlyDeployTriggerConfig = _.filter(properties.Function.Triggers, ({ Name }) => Name === triggerName);
        if (onlyDeployTriggerConfig.length < 1) {
          new ServerlessError({ message: `${triggerName} not found.` });
        }
        if (onlyDeployTriggerConfig.length > 1) {
          new ServerlessError({ message: `${triggerName} repeated statement.` });
        }
        await handlerDeployTrigger(onlyDeployTriggerConfig[0], triggerName)
      } else {
        for (let i = 0; i < properties.Function.Triggers.length; i++) {
          const deployTriggerName = properties.Function.Triggers[i].Name;
          await handlerDeployTrigger(properties.Function.Triggers[i], deployTriggerName);
        }
      }
    }

    // 删除触发器
    for (let i = 0; i < releaseTriggerList.length; i++) {
      if (!thisTriggerList.includes(releaseTriggerList[i])) {
        this.logger.info(`Deleting trigger: ${releaseTriggerList[i]}.`);
        await this.fcClient.deleteTrigger(serviceName, functionName, releaseTriggerList[i]);
      }
    }

    return triggerOutput
  }
}

module.exports = Trigger
