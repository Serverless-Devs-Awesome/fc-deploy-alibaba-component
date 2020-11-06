const DEFAULT_VPC_CONFIG = {
  securityGroupId: '',
  vSwitchIds: [],
  vpcId: ''
}

const DEFAULT_NAS_CONFIG = {
  UserId: -1,
  GroupId: -1,
  MountPoints: []
}

const REQUESTOPTION = {
  method: 'POST'
}

const DEFAULTVPCNAME = 'fc-fun-vpc';
const DEFAULTVSWITCHNAME = 'fc-fun-vswitch-1';
const DEFAULTSECURITYGROUPNAME = 'fc-fun-sg-1';
const FUN_NAS_SERVICE_PREFIX = '_FUN_NAS_';
const FUN_AUTO_FC_MOUNT_DIR = '/mnt/auto'
const NAS_DEFAULT_DESCRIPTION = 'default_nas_created_by_fc_fun'

module.exports = {
  DEFAULT_VPC_CONFIG,
  DEFAULT_NAS_CONFIG,
  DEFAULTVPCNAME,
  DEFAULTVSWITCHNAME,
  REQUESTOPTION,
  DEFAULTSECURITYGROUPNAME,
  FUN_NAS_SERVICE_PREFIX,
  FUN_AUTO_FC_MOUNT_DIR,
  NAS_DEFAULT_DESCRIPTION
}