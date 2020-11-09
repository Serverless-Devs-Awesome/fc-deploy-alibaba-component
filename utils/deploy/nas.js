'use strict'
const _ = require('lodash');

const Client = require('../client');
const ServerlessError = require('../error');
const Logger = require('../logger');
const utils = require('../utils');
const {
  NAS_DEFAULT_DESCRIPTION,
  REQUESTOPTION,
  FUN_AUTO_FC_MOUNT_DIR,
  FUN_NAS_SERVICE_PREFIX
} = require('../static');

class Nas extends Client {
  constructor (credentials, region) {
    super(credentials, region);
    this.vpcClient = this.buildVpcClient();
    this.nasClient = this.buildNasClient();
    this.fcClient = this.buildFcClient();
    this.logger = new Logger();
  }

  processDifferentZones (nasZones, FcAllowVswitchId) {
    const performance = _.find(nasZones, nasZone => !_.isEmpty(nasZone.Performance.Protocol))
  
    if (!_.isEmpty(performance)) {
      return {
        zoneId: performance.ZoneId,
        vswitchId: FcAllowVswitchId,
        storageType: 'Performance'
      }
    }
  
    const capacity = _.find(nasZones, nasZone => !_.isEmpty(nasZone.Capacity.Protocol))
  
    if (!_.isEmpty(capacity)) {
      return {
        zoneId: capacity.ZoneId,
        vswitchId: FcAllowVswitchId,
        storageType: 'Capacity'
      }
    }
  
    return null
  }

  async convertToFcAllowedZones (vswitchIds) {
    const fcAllowedZones = await utils.getFcAllowedZones(this.fcClient, this.region);
  
    const fcZones = [];
    for (const vswitchId of vswitchIds) {
      const describeRs = await utils.describeVSwitchAttributes(this.vpcClient, this.region, vswitchId);
      const zoneId = (describeRs || {}).ZoneId;

      if (_.includes(fcAllowedZones, zoneId)) {
        fcZones.push({ zoneId, vswitchId })
      }
    }
    if (_.isEmpty(fcZones)) {
      new ServerlessError({
        message: `
  Only zoneId ${fcAllowedZones} of vswitch is allowed by VpcConfig.
  Check your vswitch zoneId please.`
      });
    }
    return fcZones
  }

  async getAvailableVSwitchId (vswitchIds, nasZones) {
    const fcZones = await this.convertToFcAllowedZones(vswitchIds);
    const availableZones = fcZones.filter(fcZone => { return _.includes(nasZones.map(m => { return m.ZoneId }), fcZone.zoneId) });
  
    const performances = [];
    const capacities = [];
  
    _.forEach(nasZones, nasZone => {
      if (_.includes(availableZones.map(z => z.zoneId), nasZone.ZoneId)) {
        if (!_.isEmpty(nasZone.Performance.Protocol)) { performances.push(nasZone) }
        if (!_.isEmpty(nasZone.Capacity.Protocol)) { capacities.push(nasZone) }
      }
    });

    if (!_.isEmpty(performances)) {
      return utils.convertZones(_.head(performances), availableZones);
    }
  
    if (!_.isEmpty(capacities)) {
      // const msg = `Region ${region} only supports capacity NAS. Do you want to create it automatically?`;
      return utils.convertZones(_.head(capacities), availableZones, 'Capacity');
    }
  
    return this.processDifferentZones(nasZones, _.head(fcZones).vswitchId);
  }

  async findNasFileSystem (description) {
    const pageSize = 50;
    let requestPageNumber = 0;
    let totalCount;
    let pageNumber;
  
    let fileSystem;
    do {
      const params = {
        RegionId: this.region,
        PageSize: pageSize,
        PageNumber: ++requestPageNumber
      }
  
      let rs;
      try {
        rs = await this.nasClient.request('DescribeFileSystems', params, REQUESTOPTION)
      } catch (ex) {
        new ServerlessError(ex);
      }
      totalCount = rs.TotalCount;
      pageNumber = rs.PageNumber;
      const fileSystems = rs.FileSystems.FileSystem;
      fileSystem = _.find(fileSystems, { Description: description });
      this.logger.log(`find filesystem: ${JSON.stringify(fileSystem)}`);
    } while (!fileSystem && totalCount && pageNumber && pageNumber * pageSize < totalCount)
    return (fileSystem || {}).FileSystemId;
  }

  async findMountTarget (fileSystemId, vpcId, vswitchId) {
    var params = {
      RegionId: this.region,
      FileSystemId: fileSystemId
    };
    const rs = await this.nasClient.request('DescribeMountTargets', params, REQUESTOPTION);
    const mountTargets = rs.MountTargets.MountTarget;
  
    // todo: 检查 mountTargets 的 vswitch 是否与函数计算的一致？
    if (!_.isEmpty(mountTargets)) {
      const mountTarget = _.find(mountTargets, {
        VpcId: vpcId,
        VswId: vswitchId
      });
      if (mountTarget) {
        return mountTarget.MountTargetDomain;
      }
    }
    return null
  }

  async createNasFileSystem ({
    storageType,
    description = NAS_DEFAULT_DESCRIPTION,
    zoneId
  }) {
    const params = {
      RegionId: this.region,
      ProtocolType: 'NFS',
      StorageType: storageType,
      Description: description,
      ZoneId: zoneId
    }
  
    const rs = await this.nasClient.request('CreateFileSystem', params, REQUESTOPTION);
    return rs.FileSystemId;
  }

  async createNasFileSystemIfNotExist (zoneId, storageType) {
    let fileSystemId = await this.findNasFileSystem(NAS_DEFAULT_DESCRIPTION);
    if (!fileSystemId) {
      this.logger.info('Generating default nas file system');
      fileSystemId = await this.createNasFileSystem({ zoneId, storageType });
      this.logger.success('Default nas file system generated, fileSystemId is: ' + fileSystemId);
    } else {
      this.logger.success('Default nas file system already exists, fileSystemId is: ' + fileSystemId);
    }
    return fileSystemId;
  }

  async waitMountPointUntilAvaliable (fileSystemId, mountTargetDomain) {
    let count = 0;
    let status;
  
    do {
      count++;
      var params = {
        RegionId: this.region,
        FileSystemId: fileSystemId,
        MountTargetDomain: mountTargetDomain
      };
  
      await utils.sleep(1000);
      const rs = await this.nasClient.request('DescribeMountTargets', params, REQUESTOPTION);
      status = rs.MountTargets.MountTarget[0].Status;
      this.logger.log(`nas status is: ${status}`);
  
      this.logger.info(`Nas mount target domain already created, waiting for status to be 'Active', now is ${status}`);
    } while (count < 15 && status !== 'Active')
  
    if (status !== 'Active') {
      new ServerlessError({ message: `Timeout while waiting for MountPoint ${mountTargetDomain} status to be 'Active'` });
    }
  }

  async createMountTarget (fileSystemId, vpcId, vswitchId) {
    const params = {
      RegionId: this.region,
      NetworkType: 'Vpc',
      FileSystemId: fileSystemId,
      AccessGroupName: 'DEFAULT_VPC_GROUP_NAME',
      VpcId: vpcId,
      VSwitchId: vswitchId
    };
  
    const rs = await this.nasClient.request('CreateMountTarget', params, REQUESTOPTION);
    const mountTargetDomain = rs.MountTargetDomain;
    this.logger.log(`create mount target rs: ${mountTargetDomain}`);
    await this.waitMountPointUntilAvaliable(fileSystemId, mountTargetDomain);
    return mountTargetDomain;
  }

  async createMountTargetIfNotExist (fileSystemId, vpcId, vswitchId) {
    let mountTargetDomain = await this.findMountTarget(fileSystemId, vpcId, vswitchId);
  
    if (mountTargetDomain) {
      this.logger.info(`Nas file system mount target is already created, mountTargetDomain is: ${mountTargetDomain}`);
      return mountTargetDomain
    }
  
    // create mountTarget if not exist
    this.logger.info('Generating default nas file system mount target');
    mountTargetDomain = await this.createMountTarget(fileSystemId, vpcId, vswitchId);
    this.logger.info(`Default nas file system mount target generated, mount domain is: ${mountTargetDomain}`);
  
    return mountTargetDomain;
  }

  async createDefaultNasIfNotExist (vpcId, vswitchIds) {
    const nasZones = await utils.describeNasZones(this.nasClient, this.region);
    const { zoneId, vswitchId, storageType } = await this.getAvailableVSwitchId(vswitchIds, nasZones);
    const fileSystemId = await this.createNasFileSystemIfNotExist(zoneId, storageType);
    this.logger.log(`fileSystemId: ${fileSystemId}`);
  
    return await this.createMountTargetIfNotExist(fileSystemId, vpcId, vswitchId);
  }

  async generateAutoNasConfig (serviceName, vpcId, vswitchIds, userId, groupId, mountDir, localDir) {
    const mountPointDomain = await this.createDefaultNasIfNotExist(vpcId, vswitchIds);
  
    // fun nas 创建的服务名比其对应的服务多了 '_FUN_NAS_' 前缀
    // 对于 nas 的挂载目录，要去掉这个前缀，保证 fun nas 的服务与对应的服务使用的是同样的挂载目录
    if (serviceName.startsWith(FUN_NAS_SERVICE_PREFIX)) {
      serviceName = serviceName.substring(FUN_NAS_SERVICE_PREFIX.length)
    }
    const config = {
      UserId: userId || 10003,
      GroupId: groupId || 10003,
      MountPoints: [
        {
          ServerAddr: `${mountPointDomain}:/${serviceName}`,
          MountDir: mountDir || FUN_AUTO_FC_MOUNT_DIR
        }
      ]
    }
  
    if (localDir) {
      config.MountPoints[0].LocalDir = localDir
    }
  
    return config
  }

  transformClientConfigToToolConfig (nasConfig) {
    if (!nasConfig || nasConfig === 'Auto') {
      return nasConfig;
    }
  
    const toolMountPoints = [];
    if (!_.isEmpty(nasConfig.MountPoints)) {
      for (const mountPoint of nasConfig.MountPoints) {
        if (mountPoint.ServerAddr && mountPoint.MountDir) {
          const config = {
            NasAddr: mountPoint.ServerAddr.split(':')[0],
            NasDir: mountPoint.ServerAddr.split(':')[1],
            FcDir: mountPoint.MountDir
          }
          if (mountPoint.Alias) {
            config.Alias = mountPoint.Alias
          }
          if (mountPoint.LocalDir) {
            config.LocalDir = mountPoint.LocalDir
          }
          toolMountPoints.push(config)
        }
      }
    }
    return {
      GroupId: nasConfig.GroupId,
      UserId: nasConfig.UserId,
      MountPoints: toolMountPoints
    }
  }
}

module.exports = Nas;
