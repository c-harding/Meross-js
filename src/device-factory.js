/** @typedef {import("./interfaces").HTTPDeviceInfo} HTTPDeviceInfo */
/** @typedef {import("./manager").MerossManager} MerossManager */
/** @typedef {(...args: any[]) => BaseDevice} DeviceFactory */

const { HubDevice, BaseDevice } = require('./devices');
const { Namespace } = require('./model');

/** Calculates the name of the dynamic-type for a specific class of devices */
function calculateDeviceTypeName(deviceType, hardwareVersion, firmwareVersion) {
  return `${deviceType}:${hardwareVersion}:${firmwareVersion}`;
}

/**
 * Returns the cached dynamic type for the specific device, if any was already built for that one.
 */
const lookupCachedType = (() => {
  /** @type {{[deviceTypeName: string]: DeviceFactory}} */
  const deviceFactories = {};

  /**
   * @param {string} key
   * @param {() => DeviceFactory} calculate
   * @returns {DeviceFactory}
   */
  const factory = (key, calculate) =>
    deviceFactories[key] || (deviceFactories[key] = calculate());
  return factory;
})();

/**
 * @param {HTTPDeviceInfo} HTTPDeviceInfo
 * @param {object} device_abilities
 * @param {MerossManager} manager
 * @returns {BaseDevice}
 */
exports.buildMerossDevice = function (
  HTTPDeviceInfo,
  device_abilities,
  manager
) {
  // The current implementation of this library is based on the usage of pluggable Mixin classes
  // on top of a couple of base implementations.
  console.debug(
    `Building managed device for ${HTTPDeviceInfo.dev_name} (${HTTPDeviceInfo.uuid}). ` +
      `Reported abilities: ${device_abilities}`
  );

  const deviceTypeName = calculateDeviceTypeName(
    HTTPDeviceInfo.device_type,
    HTTPDeviceInfo.hdware_version,
    HTTPDeviceInfo.fmware_version
  );

  // Check if we already have cached type for that device kind.
  const cachedType = lookupCachedType(deviceTypeName, () => {
    console.debug(
      `Could not find any cached type for {HTTPDeviceInfo.device_type},` +
        `${HTTPDeviceInfo.hdware_version},` +
        `${HTTPDeviceInfo.fmware_version}. It will be generated.`
    );

    // Let's now pick the base class where to attach all the mixin.
    // We basically offer two possible base implementations:
    // - BaseMerossDevice: suitable for all non-hub devices
    // - HubMerossDevice: to be used when dealing with Hubs.
    // Unfortunately, it's not clear how we should discriminate an hub from a non-hub.
    // The current implementation decides which base class to use by looking at the presence
    // of 'Appliance.Digest.Hub' namespace within the exposed abilities.
    const isHub = Namespace.SYSTEM_DIGEST_HUB;
    let baseClass = BaseDevice;
    if (device_abilities.includes(isHub)) {
      console.warn(
        `Device ${HTTPDeviceInfo.dev_name} (${HTTPDeviceInfo.device_type}, ` +
          `uuid ${HTTPDeviceInfo.uuid}) reported ability ${isHub}. ` +
          `Assuming this is a full-featured HUB.`
      );
      baseClass = HubDevice;
    }

    return exports.buildCachedType(device_abilities, baseClass);
  });

  const component = cachedType(HTTPDeviceInfo.uuid, manager, HTTPDeviceInfo);
  return component;
};

/** @returns {DeviceFactory} */
exports.buildCachedType = function (device_abilities, baseClass) {
  // Build a specific type at runtime by mixing plugins on-demand
  const mixinClassSet = new Set();

  // Add plugins by abilities
  for (const [key, val] of Object.entries(device_abilities)) {
    // When a device exposes the same ability like Toggle and ToggleX, prefer the X version by filtering
    // out the non-X version.
    let clsx = null;
    let cls = _ABILITY_MATRIX.get(key);

    // Check if for this ability the device exposes the X version
    const xVersionAbilityKey = device_abilities[`${key}X`];
    if (xVersionAbilityKey) clsx = _ABILITY_MATRIX[xVersionAbilityKey];

    // Now, if we have both the clsx and the cls, prefer the clsx, otherwise go for the cls
    if (clsx) mixinClassSet.add(clsx);
    else if (cls) mixinClassSet.add(cls);
  }

  // We must be careful when ordering the mixin and leaving the BaseMerossDevice as last class.
  // Messing up with that will cause MRO to not resolve inheritance correctly.
  const mixinClasses = [...mixinClassSet, baseClass];
  const factory = function (...args) {
    return Object.assign(new baseClass(...args), {
      abilitiesSpec: device_abilities,
    });
  };
  Object.setPrototypeOf(factory, Object.assign({}, ...mixinClasses));
  return factory;
};

const _ABILITY_MATRIX = {
  // // Power plugs abilities
  // [Namespace.CONTROL_TOGGLEX]: ToggleXMixin,
  // [Namespace.CONTROL_TOGGLE]: ToggleMixin,
  // [Namespace.CONTROL_CONSUMPTIONX]: ConsumptionXMixin,
  // [Namespace.CONTROL_ELECTRICITY]: ElectricityMixin,
  //
  // // Light abilities
  // [Namespace.CONTROL_LIGHT]: LightMixin,
  //
  // // Garage opener
  // [Namespace.GARAGE_DOOR_STATE]: GarageOpenerMixin,
  //
  // // Spray opener
  // [Namespace.CONTROL_SPRAY]: SprayMixin,
  //
  // // System
  // [Namespace.SYSTEM_ALL]: SystemAllMixin,
  // [Namespace.SYSTEM_ONLINE]: SystemOnlineMixin,
  //
  // // Hub
  // [Namespace.HUB_ONLINE]: HubMixn,
  // [Namespace.HUB_TOGGLEX]: HubMixn,
  //
  // [Namespace.HUB_SENSOR_ALL]: HubMs100Mixin,
  // [Namespace.HUB_SENSOR_ALERT]: HubMs100Mixin,
  // [Namespace.HUB_SENSOR_TEMPHUM]: HubMs100Mixin,
  //
  // [Namespace.HUB_MTS100_ALL]: HubMts100Mixin,
  // [Namespace.HUB_MTS100_MODE]: HubMts100Mixin,
  // [Namespace.HUB_MTS100_TEMPERATURE]: HubMts100Mixin,
  //
  // // TODO: BIND, UNBIND, ONLINE, WIFI, ETC! -@albertogeniola
};
