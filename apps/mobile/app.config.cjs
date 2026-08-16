const base = require('./app.json');

// OTA updates are optional. A local/native development build must never depend
// on an Expo account or a project identifier.
module.exports = () => {
  const config = structuredClone(base);
  const projectId = process.env.KEYSTONE_EXPO_PROJECT_ID;

  if (projectId) {
    config.expo.updates = {
      url: `https://u.expo.dev/${projectId}`,
      checkAutomatically: 'ON_START',
      fallbackToCacheTimeout: 0,
      requestHeaders: { 'expo-channel-name': process.env.KEYSTONE_EXPO_CHANNEL || 'production' },
    };
    config.expo.extra = { ...(config.expo.extra || {}), eas: { projectId } };
  }

  return config;
};
