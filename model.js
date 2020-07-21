exports.AuthenticatedPostException = class extends Error {};
exports.TokenExpiredException = class extends Error {};
exports.TooManyRequestsException = class extends Error {};
exports.TooManyTokensException = class extends Error {};
exports.CommandTimeout = class extends Error {};

exports.ErrorCodes = {
  CODE_NO_ERROR: 0,
  CODE_TOKEN_EXPIRED: 1019,
  CODE_TOO_MANY_REQUESTS: 1300,
  CODE_TOO_MANY_TOKENS: 1301,
};

exports.OnlineStatus = {
  ONLINE: 1,
  OFFLINE: 2,
  UNKNOWN: -1,
};

/** @enum {string} */
exports.Namespace = {
  // Common abilities
  SYSTEM_ALL: 'Appliance.System.All',
  SYSTEM_ABILITY: 'Appliance.System.Ability',
  SYSTEM_ONLINE: 'Appliance.System.Online',
  SYSTEM_REPORT: 'Appliance.System.Report',
  SYSTEM_DEBUG: 'Appliance.System.Debug',

  CONTROL_BIND: 'Appliance.Control.Bind',
  CONTROL_UNBIND: 'Appliance.Control.Unbind',
  CONTROL_TRIGGER: 'Appliance.Control.Trigger',
  CONTROL_TRIGGERX: 'Appliance.Control.TriggerX',

  CONFIG_WIFI_LIST: 'Appliance.Config.WifiList',
  CONFIG_TRACE: 'Appliance.Config.Trace',

  // Power plug/bulbs abilities
  CONTROL_TOGGLE: 'Appliance.Control.Toggle',
  CONTROL_TOGGLEX: 'Appliance.Control.ToggleX',
  CONTROL_ELECTRICITY: 'Appliance.Control.Electricity',
  CONTROL_CONSUMPTIONX: 'Appliance.Control.ConsumptionX',

  // Bulbs-only abilities
  CONTROL_LIGHT: 'Appliance.Control.Light',

  // Garage opener abilities
  GARAGE_DOOR_STATE: 'Appliance.GarageDoor.State',

  // Humidifier
  CONTROL_SPRAY: 'Appliance.Control.Spray',

  SYSTEM_DIGEST_HUB: 'Appliance.Digest.Hub',

  // HUB
  HUB_EXCEPTION: 'Appliance.Hub.Exception',
  HUB_BATTERY: 'Appliance.Hub.Battery',
  HUB_TOGGLEX: 'Appliance.Hub.ToggleX',
  HUB_ONLINE: 'Appliance.Hub.Online',

  // SENSORS
  HUB_SENSOR_ALL: 'Appliance.Hub.Sensor.All',
  HUB_SENSOR_TEMPHUM: 'Appliance.Hub.Sensor.TempHum',
  HUB_SENSOR_ALERT: 'Appliance.Hub.Sensor.Alert',

  // MTS100
  HUB_MTS100_ALL: 'Appliance.Hub.Mts100.All',
  HUB_MTS100_TEMPERATURE: 'Appliance.Hub.Mts100.Temperature',
  HUB_MTS100_MODE: 'Appliance.Hub.Mts100.Mode',
};
