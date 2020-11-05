const _ = require('lodash');
const { Component } = require('@serverless-devs/s-core');

const getHelp = require('./utils/help');
const ServerlessError = require('./utils/error');
const Logger = require('./utils/logger');

const Service = require('./utils/deploy/service');
const FcFunction = require('./utils/deploy/function');
const Trigger = require('./utils/deploy/trigger');
const TAG = require('./utils/deploy/tags');

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
      });
    }

    const deployService = commands[0] === 'service' || deployAllConfig || deployAll;
    const deployFunction = commands[0] === 'function' || deployAllConfig || deployAll;
    const deployTriggers = commands[0] === 'trigger' || deployAll;
    const deployTags = commands[0] === 'tags' || deployAll;
    const deployDomain = commands[0] === 'domain' || deployAll;

    const output = {};
    
    if (deployService) {      
      const hasFunctionAsyncConfig = _.has(functionProp, 'AsyncConfiguration');
      const hasCustomContainerConfig = _.has(functionProp, 'CustomContainerConfig');
      const serviceComponent = new Service(credentials, region);

      if (serviceProp.Log) {
        const logClient = await this.load('fc-logs-alibaba-component', 'Component');
        serviceComponent.setVariables('logClient', logClient);
        serviceComponent.setVariables('inputs', inputs);
        serviceComponent.setVariables('parameters', parameters);
      }

      this.logger.info(`Waiting for service ${serviceName} ${deployAllConfig ? 'config to be updated' : 'to be deployed'}...`);
      output.Service = await serviceComponent.deploy(serviceName, serviceProp, hasFunctionAsyncConfig, hasCustomContainerConfig);
      this.logger.success(`service ${serviceName} ${deployAllConfig ? 'config update success' : 'deploy success'}\n`);
    }

    if (deployFunction) {
      const fcFunction = new FcFunction(credentials, region);

      const onlyDelpoyCode = (parameters.code && !deployAll);
      const onlyDelpoyConfig = (parameters.config || deployAllConfig);

      this.logger.info(`Waiting for function ${functionName} ${onlyDelpoyConfig ? 'config to be updated' : 'to be deployed'}...`);
      output.Function = await fcFunction.deploy({
        projectName,
        serviceName,
        serviceProp,
        functionName,
        functionProp,
        onlyDelpoyCode,
        onlyDelpoyConfig
      })
      this.logger.success(`function ${functionName} ${onlyDelpoyConfig || deployAllConfig ? 'config update success' : 'deploy success'}\n`);
    }

    if (deployTriggers) {
      const fcTrigger = new Trigger(credentials, region);
      const triggerName = parameters.n || parameters.name;
      output.Triggers = await fcTrigger.deploy(properties, serviceName, functionName, triggerName, commands[0] === 'trigger');
    }

    if (deployTags) {
      const tag = new TAG(credentials, region);
      const tagName = parameters.n || parameters.name;
      output.Tags = await tag.deploy(`services/${serviceName}`, properties.Service.Tags, tagName);
    }

    return output;
  }
}

module.exports = FcComponent;