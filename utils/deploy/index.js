
const _ = require('lodash');
const yaml = require('js-yaml');
const fs = require('fs');

const Client = require('./client');
const Logger = require('../logger');
const ServerlessError = require('../error');
const Ram = require('./ram');
const utils = require('./utils');
const Vpc = require('./vpc');
const {
  DEFAULT_VPC_CONFIG,
  DEFAULT_NAS_CONFIG
} = require('../static')

class Deploy extends Client {
  constructor (credentials, region) {
    super(credentials, region);
    this.fcClient = this.buildFcClient();
    this.ram = new Ram(credentials);
    this.vpc = new Vpc(credentials, region);
    this.logger = new Logger();
  }

  setVariables(key, value) {
    this[key] = value;
  }

  // 处理角色
  async deployPolicies (resourceName, roleName, policies, product) {
    let nextCount = 1;

    if (Array.isArray(policies)) {
      for (const policy of policies) {
        nextCount = await this.deployPolicy(resourceName, roleName, policy, nextCount, product);
      }
    } else {
      nextCount = await this.deployPolicy(resourceName, roleName, policies, nextCount, product);
    }
  }
  async deployPolicy (resourceName, roleName, policy, curCount, product = 'Fc') {
    if (typeof policy === 'string') {
      await this.ram.attachPolicyToRole(policy, roleName);
      return curCount;
    }

    const policyName = utils.normalizeRoleOrPoliceName(`Aliyun${product}GeneratedServicePolicy-${this.region}-${resourceName}${curCount}`);
    await this.ram.makeAndAttachPolicy(policyName, policy, roleName);

    return curCount + 1;
  }
  async generateServiceRole ({
    serviceName, vpcConfig, nasConfig,
    logConfig, roleArn, policies, region,
    hasFunctionAsyncConfig,
    hasCustomContainerConfig
  }) {
    let role;
    let roleName;
    let createRoleIfNotExist = false;

    const attachedPolicies = [];

    if (_.isNil(roleArn)) {
      roleName = 'ServerlessToolDefaultRole';
      roleName = utils.normalizeRoleOrPoliceName(roleName);
      createRoleIfNotExist = true;
    } else {
      try {
        roleName = utils.extractFcRole(roleArn)
      } catch (ex) {
        new ServerlessError({
          name: 'ExtractFcRoleError',
          message: 'The role you provided is not correct. You must provide the correct role arn.'
        }, true);
      }
    }

    // createRole 条件
    // arn 不存在，并且存在 policies、vpcConfig、logConfig、nasConfig、函数 runtime 镜像配置、函数异步配置
    const preconditionsExist = policies || !_.isEmpty(vpcConfig) || !_.isEmpty(logConfig) || !_.isEmpty(nasConfig) || hasFunctionAsyncConfig || hasCustomContainerConfig;
    if (!roleArn && preconditionsExist) {
      // create role
      this.logger.info(`Using default role: '${roleName}'`);
      role = await this.ram.makeRole(roleName, createRoleIfNotExist);
    }

    // if roleArn exist, then ignore polices
    if (!roleArn && policies) {
      await this.deployPolicies(serviceName, roleName, policies)
      attachedPolicies.push(...(_.isString(policies) ? [policies] : policies))
    }

    if (!roleArn && (!_.isEmpty(vpcConfig) || !_.isEmpty(nasConfig))) {
      await this.ram.attachPolicyToRole('AliyunECSNetworkInterfaceManagementAccess', roleName)
      attachedPolicies.push('AliyunECSNetworkInterfaceManagementAccess')
    }

    if (utils.isLogConfigAuto(logConfig)) {
      if (!roleArn) {
        await this.ram.attachPolicyToRole('AliyunLogFullAccess', roleName)
        attachedPolicies.push('AliyunLogFullAccess')
      }
    } else if (logConfig.LogStore && logConfig.Project) {
      if (!roleArn) {
        const logPolicyName = utils.normalizeRoleOrPoliceName(`AliyunFcGeneratedLogPolicy-${region}-${serviceName}`)
        await this.ram.makeAndAttachPolicy(logPolicyName, {
          Version: '1',
          Statement: [{
            Action: [
              'log:PostLogStoreLogs'
            ],
            Resource: `acs:log:*:*:project/${logConfig.Project}/logstore/${logConfig.LogStore}`,
            Effect: 'Allow'
          }]
        }, roleName)
      }
    } else if (logConfig.LogStore || logConfig.Project) {
      new ServerlessError({
        name: 'ExtractFcRoleError',
        message: 'LogStore and Project must both exist.'
      }, true);
    } 

    if (!roleArn && hasCustomContainerConfig) {
      await this.ram.attachPolicyToRole('AliyunContainerRegistryReadOnlyAccess', roleName)
      attachedPolicies.push('AliyunContainerRegistryReadOnlyAccess')
    }

    if (!roleArn && hasFunctionAsyncConfig) {
      await this.ram.attachPolicyToRole('AliyunFCInvocationAccess', roleName)
      attachedPolicies.push('AliyunFCInvocationAccess')

      const mnsPolicyName = utils.normalizeRoleOrPoliceName(`AliyunFcGeneratedMNSPolicy-${this.region}-${serviceName}`)
      await this.ram.makeAndAttachPolicy(mnsPolicyName, {
        Version: '1',
        Statement: [{
          Action: [
            'mns:SendMessage',
            'mns:PublishMessage'
          ],
          Resource: '*',
          Effect: 'Allow'
        }]
      }, roleName)
    }

    if (!_.isEmpty(attachedPolicies)) {
      this.logger.info(`Attached police ${JSON.stringify(attachedPolicies)} to role: ` + roleName)
    }

    return ((role || {}).Role || {}).Arn || roleArn || ''
  }

  // 保存 Auto 的配置
  async saveConfigToTemplate(type, config) {
    if (this.parameters.skipSync) {
      return;
    }
    if (!this.inputs.Path || !this.inputs.Path.ConfigPath) {
      this.logger.warn('Unknown template file path, failed to save back config');
      return;
    }
    this.logger.warn(`Save '${type}' config back to the template file, use --skip-sync if you don't need this`);
    const tplFile = this.inputs.Path.ConfigPath;
    let doc = yaml.safeLoad(fs.readFileSync(tplFile, 'utf8'));
    const projectName = this.inputs.Project.ProjectName;
    const project = doc[projectName];
    if (!project || !project.Properties || !project.Properties.Service) {
      return;
    }
    project.Properties.Service[type] = config;
    fs.writeFileSync(tplFile, yaml.safeDump(doc));
    this.logger.success('Save successfully');
  }

  isSlsNotExistException (e) {
    return e.code === 'InvalidArgument' &&
      _.includes(e.message, 'not exist') &&
      (_.includes(e.message, 'logstore') || _.includes(e.message, 'project'))
  }

  // 重试创建服务
  async retryUntilSlsCreated (serviceName, options, create) {
    let slsRetry = 0;
    const retryTimes = 12;
    let service;
    do {
      try {
        if (create) {
          this.logger.log(`create service ${serviceName}, options is ${JSON.stringify(options)}`);
          service = await this.fcClient.createService(serviceName, options);
        } else {
          this.logger.log(`update service ${serviceName}, options is ${JSON.stringify(options)}`);
          service = await this.fcClient.updateService(serviceName, options);
        }
        return service;
      } catch (e) {
        slsRetry++;
        if (slsRetry >= retryTimes) {
          new ServerlessError(e, true);
        }
        if (this.isSlsNotExistException(e)) {
          await utils.sleep(3000)
        } else { new ServerlessError(e, true) }
      }
    } while (slsRetry < retryTimes)
  }

  async getService (serviceName) {
    let service;
    await utils.promiseRetry(async (retry, times) => {
      try {
        service = await this.fcClient.getService(serviceName);
      } catch (ex) {
        if (ex.code === 'AccessDenied' || !ex.code || ex.code === 'ENOTFOUND') {
          if (ex.message.indexOf('FC service is not enabled for current user') !== -1) {
            this.logger.error('\nFC service is not enabled for current user. Please enable FC service before using fun.\nYou can enable FC service on this page https://www.aliyun.com/product/fc .\n')
          } else {
            this.logger.error('\nThe accountId you entered is incorrect. You can only use the primary account id, whether or not you use a sub-account or a primary account ak. You can get primary account ID on this page https://account.console.aliyun.com/#/secure .\n')
          }
          new ServerlessError(ex, true);
        } else if (ex.code !== 'ServiceNotFound') {
          this.logger.info(`Retry ${times} times`)
          retry(ex);
        }
      }
    })
    return service;
  }

  async makeService ({
    serviceName,
    role,
    description,
    internetAccess = true,
    logConfig = {},
    vpcConfig,
    nasConfig
  }) {
    let service = await this.getService(serviceName);

    const options = {
      description,
      role
    };

    if (internetAccess !== null) {
      options.internetAccess = internetAccess;
    }

    const resolvedLogConfig = await this.logClient.transformLogConfig(this.inputs);
    if (utils.isLogConfigAuto(logConfig)) {
      await this.saveConfigToTemplate('Log', {
        Project: resolvedLogConfig.project,
        LogStore: resolvedLogConfig.logStore
      })
    }
    options.logConfig = resolvedLogConfig;

    const isNasAuto = utils.isNasAutoConfig(nasConfig);
    const isVpcAuto = utils.isVpcAutoConfig(vpcConfig);
    // 创建 vpc 的规则：vpc 为 Auto，或者 vpc 不存在 nas 为 Auto
    if (isVpcAuto || (_.isEmpty(vpcConfig) && isNasAuto)) {
      this.logger.info('Using \'Vpc: Auto\'')
    }

    /** 

    if (isVpcAuto || (_.isEmpty(vpcConfig) && isNasAuto)) {
      this.logger.info('Using \'Vpc: Auto\'')
      vpcConfig = await vpc.createDefaultVpcIfNotExist(this.credentials, this.region)
      this.logger.success('Default vpc config:' + JSON.stringify(vpcConfig))

      await this.saveConfigToTemplate('Vpc', vpcConfig)
    }

    Object.assign(options, {
      vpcConfig: vpcConfig || DEFAULT_VPC_CONFIG
    })
    if (isNasAuto) {
      const vpcId = vpcConfig.vpcId || vpcConfig.VpcId
      const vswitchIds = vpcConfig.vswitchIds || vpcConfig.VSwitchIds

      this.logger.info(`Using 'Nas: Auto'`)
      nasConfig = await nas.generateAutoNasConfig(this.credentials, this.region, serviceName, vpcId, vswitchIds, nasConfig.UserId, nasConfig.GroupId, nasConfig.FcDir, nasConfig.LocalDir)
      this.logger.success('Default nas config: ' + JSON.stringify(nas.transformClientConfigToToolConfig(nasConfig)))

      const saveConfig = nas.transformClientConfigToToolConfig(nasConfig)
      await this.saveConfigToTemplate('Nas', saveConfig)
    } else {
      // transform nas config from tool format to fc client format
      nasConfig = nas.transformToolConfigToFcClientConfig(nasConfig)
    }
    Object.assign(options, {
      nasConfig: nasConfig || DEFAULT_NAS_CONFIG
    })
    */

    // 创建函数
    await utils.promiseRetry(async (retry, times) => {
      try {
        service = await this.retryUntilSlsCreated(serviceName, options, !service)
      } catch (ex) {
        if (ex.code === 'AccessDenied' || ex.code === 'InvalidArgument' || this.isSlsNotExistException(ex)) {
          new ServerlessError(ex, true);
        }
        this.logger.log(`error when createService or updateService, serviceName is ${serviceName}, options is ${options}, error is: \n${ex}`);
        this.logger.info(`Retry ${times} times`);
        retry(ex);
      }
    })

    // 确保nas目录存在
    // if (serviceName !== FUN_GENERATED_SERVICE &&
    //   !_.isEmpty(nasConfig) &&
    //   !_.isEmpty(nasConfig.MountPoints)) {
    //   await this.ensureNasDirExist({
    //     role, vpcConfig, nasConfig
    //   })
    // }

    return service
  }

  async deploy (serviceName, serviceProp, hasFunctionAsyncConfig, hasCustomContainerConfig) {
    const internetAccess = 'InternetAccess' in serviceProp ? serviceProp.InternetAccess : null;
    const description = serviceProp.Description;

    const vpcConfig = serviceProp.Vpc;
    const nasConfig = serviceProp.Nas;
    const logConfig = serviceProp.Log || {};

    const { roleArn, policies } = utils.getRoleArnFromServiceProps(serviceProp, this.credentials.AccountID);

    const role = await this.generateServiceRole({
      hasFunctionAsyncConfig,
      hasCustomContainerConfig,
      serviceName,
      roleArn,
      policies,
      vpcConfig,
      nasConfig,
      logConfig
    });

    await this.makeService({
      logConfig,
      vpcConfig,
      nasConfig,
      serviceName,
      role,
      internetAccess,
      description
    })
    return serviceName;
  }
}

module.exports = Deploy;