const _ = require('lodash');
const Client = require('./client');
const Logger = require('../logger');
const ServerlessError = require('../error');
const { sleep } = require('./utils');
const {
  REQUESTOPTION
} = require('../static');


class Vswitch extends Client {
  constructor (credentials, region) {
    super(credentials, region);
    this.logger = new Logger();
    this.vpcClient = this.buildVpcClient();
    this.ecsClient = this.buildEcsClient();
    this.nasClient = this.buildNasClient();
    this.fcClient = this.buildFcClient();
  }
  
  async describeVSwitchAttributes (vswitchId) {
    const params = {
      RegionId: this.region,
      VSwitchId: vswitchId
    }
    return await this.vpcClient.request('DescribeVSwitchAttributes', params, REQUESTOPTION)
  }

  async findVswitchExistByName (vswitchIds, searchVSwtichName) {
    if (!_.isEmpty(vswitchIds)) {
      for (const vswitchId of vswitchIds) {
        const describeRs = await this.describeVSwitchAttributes(vswitchId);
        const vswitchName = (describeRs || {}).VSwitchName;

        if (_.isEqual(searchVSwtichName, vswitchName)) {
          this.logger.info(`found default vswitchId: ${vswitchId}.`);
          return vswitchId;
        }
      }
    }
    this.logger.info(`could not find ${searchVSwtichName} from ${vswitchIds} for region ${region}.`);
    return null;
  }

  // 查找可用区的交集
  async getFcAllowedZones () {
    const fcRs = await this.fcClient.getAccountSettings();
    const fcAllowedZones = fcRs.data.availableAZs;  
    this.logger.log(`fc allowed zones: ${fcAllowedZones}`);

    if (_.isEqual(fcAllowedZones, [''])) {
      new ServerlessError({
        message: `No fc vswitch zones allowed, you may need login to fc console to apply for VPC feature: https://fc.console.aliyun.com/overview/${this.region}`
      }, true);
    }
  
    return fcAllowedZones;
  }
  async describeVpcZones () {
    const zones = await this.vpcClient.request('DescribeZones', { RegionId: this.region }, REQUESTOPTION);
    return zones.Zones.Zone;
  }
  async describeNasZones () {
    const zones = await this.nasClient.request('DescribeZones', { RegionId: this.region }, REQUESTOPTION);
    return zones.Zones.Zone;
  }
  async selectVSwitchZoneId (fcAllowedZones, vpcZones, nasZones) {
    const allowedZones = _.filter(vpcZones, z => {
      return _.includes(fcAllowedZones, z.ZoneId) && _.includes(nasZones.map(zone => { return zone.ZoneId }), z.ZoneId)
    })
  
    const sortedZones = _.sortBy(allowedZones, ['ZoneId'])
  
    return (_.head(sortedZones) || {}).ZoneId
  }
  

  async selectAllowedVSwitchZone () {
    const fcAllowedZones = await getFcAllowedZones();
    const vpcZones = await describeVpcZones();
    const nasZones = await this.describeNasZones();
  
    const usedZoneId = await selectVSwitchZoneId(fcAllowedZones, vpcZones, nasZones)
    if (!usedZoneId) {
      new ServerlessError({
        message: 'no availiable zone for vswitch'
      }, true);
    }
    this.logger.log(`select allowed switch zone: ${usedZoneId}`);
    return usedZoneId
  }

  async createDefaultVSwitch (vpcId, vswitchName) {
    const vswitchZoneId = await selectAllowedVSwitchZone();
  
    let vswitchId;
    try {
      // 创建 vswitch
      vswitchId = await createVSwitch(this.vpcClient, {
        region: this.region,
        vpcId,
        zoneId: vswitchZoneId,
        vswitchName: vswitchName
      })
    } catch (ex) {
      new ServerlessError(ex, true);
    }
    return vswitchId;
  }
}

module.exports = Vswitch;
