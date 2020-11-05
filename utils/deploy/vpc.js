const _ = require('lodash');
const Client = require('../client');
const Logger = require('../logger');
const ServerlessError = require('../error');
const { sleep } = require('../utils');
const Vswitch = require('./vswitch');
const SecurityGroups = require('./security-groups');
const {
  REQUESTOPTION,
  DEFAULTVPCNAME,
  DEFAULTVSWITCHNAME,
  DEFAULTSECURITYGROUPNAME
} = require('../static');

class Vpc extends Client {
  constructor (credentials, region) {
    super(credentials, region);
    this.logger = new Logger();
    this.vpcClient = this.buildVpcClient();
    this.ecsClient = this.buildEcsClient();
  }

  async waitVpcUntilAvaliable (vpcId) {
    let count = 0;
    let status;
  
    do {
      count++;
  
      const params = {
        RegionId: this.region,
        VpcId: vpcId
      };
  
      await sleep(1000);
  
      const rs = await this.vpcClient.request('DescribeVpcs', params, REQUESTOPTION);
      const vpcs = rs.Vpcs.Vpc;
      if (vpcs && vpcs.length) {
        status = vpcs[0].Status;
        this.logger.log(`vpc status is: ${status}`);
        this.logger.info(`VPC already created, waiting for status to be 'Available', the status is ${status} currently`)
      }
    } while (count < 15 && status !== 'Available')
  
    if (status !== 'Available') {
      new ServerlessError({ message: `Timeout while waiting for vpc ${vpcId} status to be 'Available'`});
    }
  }

  async findVpc (vpcName) {
    const pageSize = 50; // max value is 50. see https://help.aliyun.com/document_detail/104577.html
    let requestPageNumber = 0;
    let totalCount;
    let pageNumber;
  
    let vpc;
  
    do {
      const params = {
        RegionId: this.region,
        PageSize: pageSize,
        PageNumber: ++requestPageNumber
      };
  
      const rs = await this.vpcClient.request('DescribeVpcs', params, REQUESTOPTION);
  
      totalCount = rs.TotalCount;
      pageNumber = rs.PageNumber;
      const vpcs = rs.Vpcs.Vpc;
  
      this.logger.log(`find vpc rs: ${JSON.stringify(rs)}`);
  
      vpc = _.find(vpcs, { VpcName: vpcName });
  
      this.logger.log(`find default vpc: ${JSON.stringify(vpc)}`);
    } while (!vpc && totalCount && pageNumber && pageNumber * pageSize < totalCount);
  
    return vpc;
  }

  async createVpc (vpcName) {
    const createParams = {
      RegionId: this.region,
      CidrBlock: '10.0.0.0/8',
      EnableIpv6: false,
      VpcName: vpcName,
      Description: 'default vpc created by fc fun'
    };
  
    let createRs;
  
    try {
      createRs = await this.vpcClient.request('CreateVpc', createParams, REQUESTOPTION)
    } catch (ex) {
      new ServerlessError(ex);
    }
  
    const vpcId = createRs.VpcId;
  
    this.logger.log(`create vpc rs is: ${JSON.stringify(createRs)}`);
  
    await this.waitVpcUntilAvaliable(vpcId);
  
    return vpcId
  }

  async createDefaultVSwitchIfNotExist (vpcId, vswitchIds) {
    const vswitch = new Vswitch(this.credentials, this.region);
    let vswitchId = await vswitch.findVswitchExistByName(vswitchIds, DEFAULTVSWITCHNAME);
  
    if (!vswitchId) { // create vswitch
      this.logger.info('Generating default vswitch');
      vswitchId = await vswitch.createDefaultVSwitch(vpcId, DEFAULTVSWITCHNAME);
      this.logger.success('Default vswitch has been generated, vswitchId is: ' + vswitchId)
    } else {
      this.logger.info('Vswitch already exists, vswitchId is: ' + vswitchId)
    }
    return vswitchId;
  }

  async createDefaultSecurityGroupIfNotExist (vpcId) {
    // check fun default security group exist?
    const securityGroup = new SecurityGroups(this.credentials, this.region);
    const defaultSecurityGroup = await securityGroup.describeSecurityGroups(vpcId, DEFAULTSECURITYGROUPNAME);
    this.logger.log(`default security grpup: ${JSON.stringify(defaultSecurityGroup)}`);
  
    // create security group
    if (_.isEmpty(defaultSecurityGroup)) {
      this.logger.info('Generating default security group');
      const securityGroupId = await securityGroup.createSecurityGroup(vpcId, DEFAULTSECURITYGROUPNAME);
  
      this.logger.success(`Default security group generated, securityGroupId is: ${securityGroupId}`);
      this.logger.info('Generating default security group rules');
      await securityGroup.authDefaultSecurityGroupRules(securityGroupId);
      this.logger.info('Security group rules generated');
      return securityGroupId;
    }
  
    const securityGroupId = defaultSecurityGroup[0].SecurityGroupId
    this.logger.info('Security group already exists, security group is: ' + securityGroupId)
    return securityGroupId
  }

  async createDefaultVpcIfNotExist() {
    let vswitchIds;
    let vpcId;

    const funDefaultVpc = await this.findVpc(DEFAULTVPCNAME);

    if (funDefaultVpc) { // update
      vswitchIds = funDefaultVpc.VSwitchIds.VSwitchId;
      vpcId = funDefaultVpc.VpcId;

      this.logger.info('Vpc already exists, vpcId is: ' + vpcId);
    } else { // create
      this.logger.info('Generating default vpc');
      vpcId = await this.createVpc(DEFAULTVPCNAME);
      this.logger.success('Default vpc has been generated, vpcId is: ' + vpcId);
    }
    this.logger.log(`vpcId is ${vpcId}`);

    const vswitchId = await this.createDefaultVSwitchIfNotExist(vpcId, vswitchIds);
    vswitchIds = [vswitchId];

    // create security
    const securityGroupId = await this.createDefaultSecurityGroupIfNotExist(vpcId)
    return {
      vpcId,
      vswitchIds,
      securityGroupId
    }
  }
}

module.exports = Vpc;
