const retry = require('promise-retry');
const _ = require('lodash');
const ServlessError = require('./error');
const Logger = require('./logger');
const {
  REQUESTOPTION
} = require('./static');

const logger = new Logger();

function promiseRetry (fn) {
  const retryOptions = {
    retries: 3,
    factor: 2,
    minTimeout: 1 * 1000,
    randomize: true
  }
  return retry(fn, retryOptions)
}

function getRoleArnFromServiceProps (serviceProp, accountID) {
  let roleArn, policies;
  if (serviceProp.Role) {
    if (typeof serviceProp.Role === 'string') {
      roleArn = serviceProp.Role;
    } else {
      roleArn = serviceProp.Role.Name;
    }
    policies = serviceProp.Role.Policies;
  }
  // name to arn
  if (roleArn && !roleArn.includes('acs:')) {
    roleArn = `acs:ram::${accountID}:role/${roleArn}`.toLocaleLowerCase();
  }
  return {
    roleArn,
    policies
  }
}

function extractFcRole (role) {
  const [, , , , path] = role.split(':')
  const [, roleName] = path.split('/')
  return roleName
}

function normalizeRoleOrPoliceName (roleName) {
  return roleName.replace(/_/g, '-')
}

function ensureNasTypeAutoParams (nasConfig) {
  const propsRequired = ['FcDir', 'LocalDir']

  const notExistParams = propsRequired.filter(paramter => {
    return !Object.prototype.hasOwnProperty.call(nasConfig, paramter)
  })

  if (!_.isEmpty(notExistParams)) {
    new ServlessError({
      name: 'NasAutoParamsError',
      message: `Missing '${notExistParams.join(', ')}' in Nas config.`
    }, true);
  }
  if (!_.isEmpty(nasConfig.MountPoints)) {
    new ServlessError({
      name: 'NasAutoParamsError',
      message: `Additional properties: \'MountPoints\' in NasConfig.`
    }, true);
  }
}

function isLogConfigAuto (logConfig) {
  return logConfig === 'Auto';
}

function isNasAutoConfig (nasConfig) {
  if (nasConfig === 'Auto') { return true }

  if ((nasConfig || {}).Type === 'Auto') {
    ensureNasTypeAutoParams(nasConfig)
    return true
  }
  return false
}

function isVpcAutoConfig (vpcConfig) {
  return vpcConfig === 'Auto'
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getFcAllowedZones (fcClient, region) {
  const fcRs = await fcClient.getAccountSettings();
  const fcAllowedZones = fcRs.data.availableAZs;  
  logger.log(`fc allowed zones: ${fcAllowedZones}`);

  if (_.isEqual(fcAllowedZones, [''])) {
    new ServerlessError({
      message: `No fc vswitch zones allowed, you may need login to fc console to apply for VPC feature: https://fc.console.aliyun.com/overview/${region}`
    });
  }

  return fcAllowedZones;
}
async function describeVpcZones (vpcClient, region) {
  const zones = await vpcClient.request('DescribeZones', { RegionId: region }, REQUESTOPTION);
  return zones.Zones.Zone;
}
async function describeNasZones (nasClient, region) {
  const zones = await nasClient.request('DescribeZones', { RegionId: region }, REQUESTOPTION);
  return zones.Zones.Zone;
}
async function describeVSwitchAttributes (vpcClient, region, vswitchId) {
  const params = {
    RegionId: region,
    VSwitchId: vswitchId
  }
  return await vpcClient.request('DescribeVSwitchAttributes', params, requestOption)
}

function transformToolConfigToFcClientConfig (nasConfig) {
  if (!nasConfig || nasConfig === 'Auto') {
    return nasConfig
  }

  const fcClientMountPoints = []
  if (!_.isEmpty(nasConfig.MountPoints)) {
    for (const mountPoint of nasConfig.MountPoints) {
      if (mountPoint.NasAddr && mountPoint.NasDir) {
        fcClientMountPoints.push({
          ServerAddr: `${mountPoint.NasAddr}:${mountPoint.NasDir}`,
          MountDir: mountPoint.FcDir
        })
      } else if (mountPoint.ServerAddr && mountPoint.MountDir) {
        // support old format
        fcClientMountPoints.push({
          ServerAddr: mountPoint.ServerAddr,
          MountDir: mountPoint.MountDir
        })
      }
    }
  }
  return {
    GroupId: nasConfig.GroupId,
    UserId: nasConfig.UserId,
    MountPoints: fcClientMountPoints
  }
}

module.exports = {
  getRoleArnFromServiceProps,
  normalizeRoleOrPoliceName,
  extractFcRole,
  isLogConfigAuto,
  isNasAutoConfig,
  isVpcAutoConfig,
  getFcAllowedZones,
  describeVpcZones,
  describeNasZones,
  describeVSwitchAttributes,
  transformToolConfigToFcClientConfig,
  sleep,
  promiseRetry
}