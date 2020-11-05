const _ = require('lodash');
const path = require('path');
const fse = require('fs-extra');
const fs = require('fs');
const { execSync } = require('child_process');
const { packTo } = require('@serverless-devs/s-zip');
const util = require('util');
const moment = require('moment');

const Client = require('../client');
const Logger = require('../logger');
const ServerlessError = require('../error');
const utils = require('../utils');
const AliyunContainerRepository = require('./cr.js');
const ncp = require('../ncp');
const ncpAsync = util.promisify(ncp);

class FcFunction extends Client {
  constructor (credentials, region) {
    super(credentials, region);
    this.fcClient = this.buildFcClient();
    this.logger = new Logger();
  }

  handlerConfig (functionInput) {
    if (!functionInput.Name) {
      new ServerlessError({ message: 'Function Name is empty.' });
    }
    if (!functionInput.Runtime) {
      new ServerlessError({ message: 'Function Runtime is empty.' });
    }
    if (!functionInput.Handler) {
      new ServerlessError({ message: 'Function Handler is empty.' });
    }

    const functionProperties = {
      functionName: functionInput.Name,
      description: functionInput.Description,
      runtime: functionInput.Runtime,
      handler: functionInput.Handler
    }

    const isCustomOrContainer = _.includes(['custom-container', 'custom'], functionProperties.runtime);
    if (isCustomOrContainer && functionInput.CAPort) {
      functionProperties.CAPort = functionInput.CAPort;
    }
    if (functionInput.MemorySize) {
      functionProperties.memorySize = functionInput.MemorySize;
    }
    if (functionInput.Timeout) {
      functionProperties.timeout = functionInput.Timeout;
    }
    if (functionInput.Initializer && functionInput.Initializer.Handler) {
      functionProperties.initializer = functionInput.Initializer.Handler;
    }
    if (functionInput.Initializer && functionInput.Initializer.Timeout) {
      functionProperties.initializationTimeout = functionInput.Initializer.Timeout;
    }
    if (functionInput.InstanceConcurrency) {
      functionProperties.instanceConcurrency = functionInput.InstanceConcurrency;
    }
    if (functionInput.Environment) {
      const EnvironmentAttr = {};
      for (let i = 0; i < functionInput.Environment.length; i++) {
        EnvironmentAttr[functionInput.Environment[i].Key] = functionInput.Environment[i].Value;
      }
      functionProperties.environmentVariables = EnvironmentAttr;
    }

    // Add env
    // functionProperties.environmentVariables = addEnv(functionProperties.environmentVariables, undefined);

    return functionProperties;
  }

  async handlerCode (serviceInput, functionInput, serviceName, projectName) {
    const functionProperties = {}

    const deployContainerFunction = functionInput.Runtime === 'custom-container';
    if (deployContainerFunction) {
      if (!functionInput.CustomContainer) {
        new ServerlessError({ message: 'No CustomContainer found for container runtime.' });
      }
      const customContainer = functionInput.CustomContainer;
      let imageName = customContainer.Image;
      const crAccount = customContainer.CrAccount || {};
      imageName = await this.pushImage(serviceName, functionInput.Name, crAccount.User, crAccount.Password, customContainer.Image);

      // code和customContainerConfig不能同时存在
      functionProperties.code = undefined;
      functionProperties.customContainerConfig = {
        image: imageName
      };
      if (functionInput.CustomContainer.Command) {
        functionProperties.customContainerConfig.command = functionInput.CustomContainer.Command;
      }
      if (functionInput.CustomContainer.Args) {
        functionProperties.customContainerConfig.args = functionInput.CustomContainer.Args;
      }
    } else {
      const baseDir = process.cwd();
      const functionName = functionInput.Name;
      const runtime = functionInput.Runtime;
      const codeUri = functionInput.CodeUri;
      functionProperties.code = await this.getFunctionCode(baseDir, serviceName, functionName, runtime, codeUri, projectName, serviceInput);
    }
    return functionProperties;
  }

  getNasLocalConfig ({ Nas: nas }) {
    if (!nas || typeof nas === 'string' ) {
      return []
    }

    if (nas.Type) {
      return nas.LocalDir ? [nas.LocalDir] : [];
    }

    let localDirs = [];
    if (nas.MountPoints) {
      nas.MountPoints.forEach(({ LocalDir: localDir }) => {
        localDirs = localDirs.concat(localDir)
      });
    }
    return localDirs;
  }

  async getFunctionCode (baseDir, serviceName, functionName, runtime, code, projectName, serviceInput) {
    const cachePath = path.join(process.cwd(), '.s', 'cache');
    const zipPath = path.join(cachePath, `${projectName}.zip`);
    const singlePathConfigued = typeof code === 'string';
    const codeUri = singlePathConfigued ? code : code.Src;
    const artifactConfigured = codeUri && (codeUri.endsWith('.zip') || codeUri.endsWith('.s-zip') || codeUri.endsWith('.jar') || codeUri.endsWith('.war'));

    if (!singlePathConfigued && !code.Src) {
      if (code.Bucket && code.Object) {
        return {
          ossBucketName: code.Bucket,
          ossObjectName: code.Object
        };
      } else {
        new ServerlessError({ message: 'CodeUri configuration does not meet expectations.' });
      }
    }

    // generate the target artifact
    if (artifactConfigured) {
      const srcPath = path.resolve(code);
      const destPath = path.resolve(zipPath);
      if (srcPath !== destPath) {
        await fse.copy(srcPath, destPath);
      }
    } else {
      const nasLocalConfig = this.getNasLocalConfig(serviceInput);
      if (!_.isEmpty(nasLocalConfig)) {
        this.logger.warn(`Nas local dir(s) is configured, this will be ignored in deploy code to function`);
      }
      const packToParame = {
        outputFilePath: cachePath,
        outputFileName: `${projectName}.zip`,
        exclude: ['.s'].concat(nasLocalConfig),
        include: []
      };
      if (singlePathConfigued) {
        packToParame.codeUri = code;
      } else {
        packToParame.codeUri = code.Src;
        packToParame.exclude = packToParame.exclude.concat(code.Exclude || []);
        packToParame.include = packToParame.include.concat(code.Include || []);
      }

      const buildArtifactPath = this.getArtifactPath(baseDir, serviceName, functionName);
      if (packToParame.codeUri && this.runtimeMustBuild(runtime)) {
        if (!this.hasBuild(baseDir, serviceName, functionName)) {
          new ServerlessError({ message: `You need to build artifact with 's build' before you deploy.` });
        }
        packToParame.codeUri = buildArtifactPath
      } else if (packToParame.codeUri && fs.existsSync(buildArtifactPath)) {
        // has execute build before, copy code to build artifact path and zip
        this.logger.info(`Found build artifact directory: ${buildArtifactPath}, now composing your code and dependencies with those built before.`)
        await ncpAsync(packToParame.codeUri, buildArtifactPath, {
          filter: (source) => {
            if (source.endsWith('.s') || source.endsWith('.fc') || source.endsWith('.git')) {
              return false
            }
            return true
          }
        })
        packToParame.codeUri = buildArtifactPath
      }

      if (packToParame.codeUri) {
        const test = await packTo(packToParame);
        if (!test.count) {
          new ServerlessError({ message: 'Zip file error' });
        }
      }
    }

    if (singlePathConfigued || (!singlePathConfigued && !code.Bucket)) {
      // artifact configured
      const data = await fs.readFileSync(zipPath);
      return {
        zipFile: Buffer.from(data).toString('base64')
      };
    } else {
      const oss = new OSS(this.credentials, `oss-${this.region}`, code.Bucket)
      const object = `${projectName}-${moment().format('YYYY-MM-DD')}.zip`
      await oss.uploadFile(zipPath, object)
      return {
        ossBucketName: code.Bucket,
        ossObjectName: object
      }
    }
  }

  async deploy ({
    projectName,
    serviceName, serviceProp,
    functionName, functionProp,
    onlyDelpoyConfig, onlyDelpoyCode
  }) {
    let functionProperties;
    if (onlyDelpoyConfig) {
      this.logger.info('Only deploy function config.');
      functionProperties = this.handlerConfig(functionProp);
    } else if (onlyDelpoyCode) {
      this.logger.info('Only deploy function code.');
      functionProperties = await this.handlerCode(serviceProp, functionProp, serviceName, projectName);
    } else {
      functionProperties = {
        ...this.handlerConfig(functionProp, serviceProp.Nas),
        ...await this.handlerCode(serviceProp, functionProp, serviceName, projectName)
      };
    }

    try {
      await this.fcClient.getFunction(serviceName, functionName);
      try {
        this.logger.info(`Function: ${serviceName}@${functionName} updating ...`);
        await this.fcClient.updateFunction(
          serviceName,
          functionName,
          functionProperties
        );
      } catch (ex) {
        new ServerlessError({ message: `${serviceName}:${functionName} update failed: ${ex.message}` });
      }
    } catch (e) {
      if (e.code !== 'FunctionNotFound') {
        new ServerlessError(e);
      }
      try {
        this.logger.info(`Function: ${serviceName}@${functionName} creating ...`);
        await this.fcClient.createFunction(serviceName, functionProperties);
      } catch (ex) {
        new ServerlessError({ message: `${serviceName}:${functionName} create failed: ${ex.message}` });
      }
    }
    this.logger.success(`Deploy function ${functionName} successfully`);
    return functionName;
  }

  async pushImage (serviceName, functionName, userName, password, imageName) {
    const cr = new AliyunContainerRepository(this.credentials, this.region);
    const registry = imageName ? imageName.split('/')[0] : this.getDefaultRegistry(this.region);

    if (userName && password) {
      this.logger.info('Login to the registry...');
      try {
        execSync(`docker login --username=${userName} ${registry} --password-stdin`, {
          input: password
        });
        this.logger.success(`Login to registry with user: ${userName}`);
      } catch (e) {
        this.logger.error('Login to registry failed.');
        new ServerlessError(e);
      }
    } else {
      this.logger.info('Try to use a temporary token for login');
      const { User: tmpUser, Password: tmpPassword } = await cr.getAuthorizationToken()
      try {
        execSync(`docker login --username=${tmpUser} ${registry} --password-stdin`, {
          input: tmpPassword
        });
        this.logger.success(`Login to registry with user: ${tmpUser}`);
      } catch (e) {
        this.logger.warn('Login to registry failed with temporary token, now fallback to your current context.');
      }
    }

    if (!imageName) {
      this.logger.info('Use default namespace and repository');
      const defaultNamespace = this.getDefaultNamespace();
      this.logger.info(`Ensure default namespace exists: ${defaultNamespace}`);
      await cr.ensureNamespace(defaultNamespace);
      imageName = this.getDefaultImageName(this.region, serviceName, functionName);
    }

    this.logger.info('Pushing image to registry');
    execSync(`docker push ${imageName}`, {
      stdio: 'inherit'
    });
    this.logger.success(`Push image to registry successfully: ${imageName}`);

    return imageName;
  }


  // 以下方法后期可能需要 build 组件
  getArtifactPath (baseDir, serviceName, functionName) {
    const rootArtifact = path.join(baseDir, '.fc', 'build', 'artifacts')
    return path.join(rootArtifact, serviceName, functionName)
  }

  hasBuild (baseDir, serviceName, functionName) {
    const artifactPath = this.getArtifactPath(baseDir, serviceName, functionName)
    return fs.pathExistsSync(artifactPath)
  }

  runtimeMustBuild (runtime) {
    if (!runtime || typeof runtime !== 'string') {
      return false
    }
    return runtime.includes('java') || runtime.includes('dotnetcore')
  }

  getDefaultImageName (regionId, serviceName, functionName) {
    const defaultNamespace = this.getDefaultNamespace();
    const defaultRepo = this.getDefaultRepo(serviceName, functionName);
    const defaultRegistry = this.getDefaultRegistry(regionId);
    return `${defaultRegistry}/${defaultNamespace}/${defaultRepo}:latest`;
  }

  getDefaultNamespace () {
    return `fc-${this.accountId}`;
  }

  getDefaultRepo (serviceName, functionName) {
    return `${serviceName}-${functionName}`.toLocaleLowerCase();
  }

  getDefaultRegistry (regionId) {
    return `registry.${regionId}.aliyuncs.com`;
  }
}

module.exports = FcFunction;