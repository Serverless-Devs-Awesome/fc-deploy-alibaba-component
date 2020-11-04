const retry = require('promise-retry');
const _ = require('lodash');
const ServlessError = require('../error');

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

module.exports = {
  getRoleArnFromServiceProps,
  normalizeRoleOrPoliceName,
  extractFcRole,
  isLogConfigAuto,
  isNasAutoConfig,
  isVpcAutoConfig,
  sleep,
  promiseRetry
}