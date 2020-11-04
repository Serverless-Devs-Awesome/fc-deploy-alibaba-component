const _ = require('lodash');
const { Component } = require('@serverless-devs/s-core');

const getHelp = require('./utils/help');
const ServerlessError = require('./utils/error');
const Deploy = require('./utils/deploy');
const Logger = require('./utils/logger');
const { isLogConfigAuto } = require('./utils/deploy/utils');

class FcComponent extends Component {
  constructor() {
    super();
    this.logger = new Logger();
  }

  async deploy (inputs) {
    this.help(inputs, getHelp(inputs));

    // 处理参数
    const {
      Properties: properties = {},
      Credentials: credentials = {}
    } = inputs;
    const {
      Region: region,
      Service: serviceProp = {},
      Function: functionProp = {}
    } = properties;
    const serviceName = serviceProp.Name;
    const functionName = functionProp.Name;
    const projectName = inputs.Project.ProjectName;

    const args = this.args(inputs.Args);
    const { Commands: commands, Parameters: parameters } = args;

    const deployAll = _.isEmpty(commands);
    const deployAllConfig = _.isEmpty(commands) && parameters.config;
    // check 指令
    if (commands[0] && !['service', 'function', 'trigger', 'tags', 'domain'.includes(commands[0])]) {
      new ServerlessError({
        name: 'CommandsError',
        message: 'Commands error,please execute the \'s deploy --help\' command.'
      }, true)
    }

    const deployService = commands[0] === 'service' || deployAllConfig || deployAll;
    const deployFunction = commands[0] === 'function' || deployAllConfig || deployAll;
    const deployTriggers = commands[0] === 'trigger' || deployAll;
    const deployTags = commands[0] === 'tags' || deployAll;
    const deployDomain = commands[0] === 'domain' || deployAll;

    const output = {};
    const deployComponent = new Deploy(credentials, region);
    
    if (deployService) {      
      const hasFunctionAsyncConfig = _.has(functionProp, 'AsyncConfiguration');
      const hasCustomContainerConfig = _.has(functionProp, 'CustomContainerConfig');

      if (serviceProp.Log) {
        const logClient = await this.load('fc-logs-alibaba-component', 'Component');
        deployComponent.setVariables('logClient', logClient);
        deployComponent.setVariables('inputs', inputs);
        deployComponent.setVariables('parameters', parameters);
      }

      this.logger.info(`Waiting for service ${serviceName} ${deployAllConfig ? 'config to be updated' : 'to be deployed'}...`);
      output.Service = await deployComponent.deploy(serviceName, serviceProp, hasFunctionAsyncConfig, hasCustomContainerConfig);
      this.logger.success(`service ${serviceName} ${deployAllConfig ? 'config update success' : 'deploy success'}\n`);
    }

  }
}

module.exports = FcComponent;