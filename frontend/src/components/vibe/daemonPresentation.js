function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function filterOnlineClientDevices(items = []) {
  return (Array.isArray(items) ? items : []).filter(
    (item) => cleanString(item?.status).toUpperCase() === 'ONLINE'
  );
}

function buildClientDeviceOption(device = {}) {
  const id = cleanString(device?.id);
  const hostname = cleanString(device?.hostname) || id;
  const status = cleanString(device?.status).toUpperCase() || 'UNKNOWN';
  const location = cleanString(device?.execution?.location).toLowerCase();
  const bridgeReady = device?.capabilities?.supportsLocalBridgeWorkflow === true;
  const parts = [status];
  if (location) parts.push(location);
  if (bridgeReady) parts.push('bridge ready');
  return {
    value: id,
    label: `${hostname} (${parts.join(' · ')})`,
  };
}

export {
  buildClientDeviceOption,
  filterOnlineClientDevices,
};
