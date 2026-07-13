module.exports = {
  platform: 'github',
  repositories: (process.env.RENOVATE_REPOSITORIES ?? '')
    .split(',')
    .map((repository) => repository.trim())
    .filter(Boolean),
  onboarding: false,
  requireConfig: 'optional',
  allowedCommands: ['^npx -y @endevco/aube@1\\.16\\.0 install$']
};
