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

module.exports = {
  DEFAULT_VPC_CONFIG,
  DEFAULT_NAS_CONFIG
}