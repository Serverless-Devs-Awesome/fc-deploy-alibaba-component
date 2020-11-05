const getMnsOrRdsTriggerPolicy = (principalService) => ({
  Statement: [
    {
      Action: 'sts:AssumeRole',
      Effect: 'Allow',
      Principal: {
        Service: [principalService]
      }
    }
  ],
  Version: '1'
});

const getProductStsAssumeRolePrincipalService = (product) => ({
  Statement: [
    {
      Action: 'sts:AssumeRole',
      Effect: 'Allow',
      Principal: {
        Service: [`${product}.aliyuncs.com`]
      }
    }
  ],
  Version: '1'
});

const assumeRolePolicyDefault = getProductStsAssumeRolePrincipalService('fc');

const logRolePolicy = getProductStsAssumeRolePrincipalService('log');

const cdnTriggerPolicy = getProductStsAssumeRolePrincipalService('cdn');

const ossTriggerPolicy = getProductStsAssumeRolePrincipalService('oss');

const tableStoreRolePolicy = {
  Statement: [
    {
      Action: 'sts:AssumeRole',
      Effect: 'Allow',
      Principal: {
        RAM: ['acs:ram::1604337383174619:root']
      }
    }
  ],
  Version: '1'
};

const otsReadPolicy = {
  Version: '1',
  Statement: [
    {
      Action: ['ots:BatchGet*', 'ots:Describe*', 'ots:Get*', 'ots:List*'],
      Resource: '*',
      Effect: 'Allow'
    }
  ]
};

const getLogTriggerPolicy = (serviceName) => ({
  Version: '1',
  Statement: [
    {
      Action: ['fc:InvokeFunction'],
      Resource: `acs:fc:*:*:services/${serviceName}/functions/*`,
      Effect: 'Allow'
    },
    {
      Action: [
        'log:Get*',
        'log:List*',
        'log:PostLogStoreLogs',
        'log:CreateConsumerGroup',
        'log:UpdateConsumerGroup',
        'log:DeleteConsumerGroup',
        'log:ListConsumerGroup',
        'log:ConsumerGroupUpdateCheckPoint',
        'log:ConsumerGroupHeartBeat',
        'log:GetConsumerGroupCheckPoint'
      ],
      Resource: '*',
      Effect: 'Allow'
    }
  ]
});


const getInvokeFunctionPolicy = (serviceName, qualifier) => ({
  Version: '1',
  Statement: [
    {
      Action: ['fc:InvokeFunction'],
      Resource: serviceName ? `acs:fc:*:*:services/${serviceName}${qualifier ? '.*' : ''}/functions/*` : '*',
      Effect: 'Allow'
    }
  ]
});

module.exports = {
  assumeRolePolicyDefault,
  logRolePolicy,
  tableStoreRolePolicy,
  otsReadPolicy,
  ossTriggerPolicy,
  cdnTriggerPolicy,
  getProductStsAssumeRolePrincipalService,
  getLogTriggerPolicy,
  getMnsOrRdsTriggerPolicy,
  getInvokeFunctionPolicy
}