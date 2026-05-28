module.exports = {
  platform: 'github',
  repositories: [process.env.GITHUB_REPOSITORY],
  onboarding: false,
  requireConfig: 'optional',
  allowedPostUpgradeCommands: ['^npx -y @endevco/aube@1\\.16\\.0 install$']
};
