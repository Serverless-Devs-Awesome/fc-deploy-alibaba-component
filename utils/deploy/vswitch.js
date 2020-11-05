const _ = require('lodash');
const Client = require('../client');
const Logger = require('../logger');
const ServerlessError = require('../error');
const utils = require('./utils');
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

  async findVswitchExistByName (vswitchIds, searchVSwtichName) {
    if (!_.isEmpty(vswitchIds)) {
      for (const vswitchId of vswitchIds) {
        const describeRs = await utils.describeVSwitchAttributes(this.vpcClient, this.region, vswitchId);
        const vswitchName = (describeRs || {}).VSwitchName;

        if (_.isEqual(searchVSwtichName, vswitchName)) {
          this.logger.info(`found default vswitchId: ${vswitchId}.`);
          return vswitchId;
        }
      }
    }
    this.logger.info(`could not find ${searchVSwtichName} from ${vswitchIds} for region ${this.region}.`);
    return null;
  }

  async selectVSwitchZoneId (fcAllowedZones, vpcZones, nasZones) {
    const allowedZones = _.filter(vpcZones, z => {
      return _.includes(fcAllowedZones, z.ZoneId) && _.includes(nasZones.map(zone => { return zone.ZoneId }), z.ZoneId)
    })
  
    const sortedZones = _.sortBy(allowedZones, ['ZoneId'])
  
    return (_.head(sortedZones) || {}).ZoneId
  }
  

  async selectAllowedVSwitchZone () {
    const fcAllowedZones = await utils.getFcAllowedZones(this.fcClient, this.region);
    const vpcZones = await utils.describeVpcZones(this.vpcClient, this.region);
    const nasZones = await utils.describeNasZones(this.nasClient, this.region);
  
    const usedZoneId = await this.selectVSwitchZoneId(fcAllowedZones, vpcZones, nasZones)
    if (!usedZoneId) {
      new ServerlessError({
        message: 'no availiable zone for vswitch'
      });
    }
    this.logger.log(`select allowed switch zone: ${usedZoneId}`);
    return usedZoneId
  }

  async createVSwitch ({
    region,
    vpcId,
    zoneId,
    vswitchName
  }) {
    var params = {
      RegionId: region,
      VpcId: vpcId,
      ZoneId: zoneId,
      CidrBlock: '10.20.0.0/16',
      VSwitchName: vswitchName,
      Description: 'default vswitch created by fc fun'
    };

    this.logger.log(`createVSwitch params is ${JSON.stringify(params)}`);
  
    const createRs = await this.vpcClient.request('CreateVSwitch', params, REQUESTOPTION);
  
    return createRs.VSwitchId
  }
  

  async createDefaultVSwitch (vpcId, vswitchName) {
    const vswitchZoneId = await this.selectAllowedVSwitchZone();
  
    let vswitchId;
    try {
      // 创建 vswitch
      vswitchId = await this.createVSwitch({
        region: this.region,
        vpcId,
        zoneId: vswitchZoneId,
        vswitchName: vswitchName
      })
    } catch (ex) {
      new ServerlessError(ex);
    }
    return vswitchId;
  }
}

module.exports = Vswitch;
