
module.exports = (inputs) => ({
  description: `Usage: s ${inputs.Project.ProjectName} deploy [command]

    Deploy a serverless application`,
  commands: [{
    name: 'service',
    desc: 'only deploy service.'
  }, {
    name: 'function',
    desc: 'only deploy function.'
  }, {
    name: 'function --config',
    desc: 'only deploy function config.'
  }, {
    name: 'function --code',
    desc: 'only deploy function code.'
  }, {
    name: 'tags',
    desc: 'only deploy service tags.'
  }, {
    name: 'tags -k/--key <name>',
    desc: 'only the specified service tag are deploy.'
  }, {
    name: 'domain',
    desc: 'only deploy domain.'
  }, {
    name: 'domain -d/--domain <name>',
    desc: 'only deploy the specified domain name.'
  }, {
    name: 'trigger',
    desc: 'only deploy trigger.'
  }, {
    name: 'trigger -n/--name <name>',
    desc: 'only deploy the specified trigger name.'
  }],
  args: [{
    name: '--config',
    desc: 'only deploy config.'
  },{
    name: '--skip-sync',
    desc: 'skip sync auto generated configuration back to template file.'
  }]
})