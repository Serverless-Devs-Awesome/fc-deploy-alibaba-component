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

const DEFAULTVPCNAME = 'fc-fun-vpc';
const DEFAULTVSWITCHNAME = 'fc-fun-vswitch-1';
const DEFAULTSECURITYGROUPNAME = 'fc-fun-sg-1';

module.exports = {
  DEFAULT_VPC_CONFIG,
  DEFAULT_NAS_CONFIG,
  DEFAULTVPCNAME,
  DEFAULTVSWITCHNAME,
  DEFAULTSECURITYGROUPNAME,
}