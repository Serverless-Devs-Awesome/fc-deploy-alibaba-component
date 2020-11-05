const _ = require('lodash');
const Client = require('./client');
const Logger = require('../logger');
const ServerlessError = require('../error');
const { sleep } = require('./utils');
const {
  REQUESTOPTION
} = require('../static');


class SecurityGroups extends Client {
  constructor (credentials, region) {
    super(credentials, region);
    this.logger = new Logger();
    this.vpcClient = this.buildVpcClient();
    this.ecsClient = this.buildEcsClient();
    this.nasClient = this.buildNasClient();
    this.fcClient = this.buildFcClient();
  }

  async describeSecurityGroups (vpcId, securityGroupName) {
    const params = {
      RegionId: this.region,
      VpcId: vpcId
    }
  
    if (securityGroupName) {
      Object.assign(params, {
        SecurityGroupName: securityGroupName
      })
    }
    const describeRs = await this.ecsClient.request('DescribeSecurityGroups', params, REQUESTOPTION);
    const securityGroup = describeRs.SecurityGroups.SecurityGroup;
    return securityGroup;
  }

  async createSecurityGroup (vpcId, securityGroupName) {
    const params = {
      RegionId: this.region,
      SecurityGroupName: securityGroupName,
      Description: 'default security group created by fc fun',
      VpcId: vpcId,
      SecurityGroupType: 'normal'
    };
  
    let createRs;
  
    try {
      createRs = await this.ecsClient.request('CreateSecurityGroup', params, REQUESTOPTION)
    } catch (ex) {
      new ServerlessError(ex, true);
    }
  
    return createRs.SecurityGroupId;
  }

  async authDefaultSecurityGroupRules (securityGroupId) {
    const sgRules = [
      { protocol: 'TCP', port: '80/80' },
      { protocol: 'TCP', port: '443/443' },
      { protocol: 'ICMP', port: '-1/-1' },
      { protocol: 'TCP', port: '22/22' }
    ]
  
    for (const rule of sgRules) {
      await this.authSecurityGroupRule(securityGroupId, rule.protocol, rule.port);
    }
  }

  async authSecurityGroupRule (securityGroupId, protocol, port) {
    const params = {
      RegionId: this.region,
      SecurityGroupId: securityGroupId,
      IpProtocol: protocol,
      PortRange: port,
      Policy: 'Accept',
      SourceCidrIp: '0.0.0.0/0',
      NicType: 'intranet'
    }

    return await this.ecsClient.request('AuthorizeSecurityGroup', params, REQUESTOPTION);
  }
}

module.exports = SecurityGroups;
