const { BaseDevice } = require('./devices');

exports.DeviceRegistry = class {
  constructor() {
    /** @type {{[id:string]: BaseDevice}} */

    this.devicesByInternalID = {};
  }

  /**
   * @param {string} deviceID
   */
  relinquishDevice(deviceID) {
    const dev = this.devicesByInternalID[deviceID];
    if (!dev)
      throw new Error(
        `Cannot relinquish device ${deviceID} as it does not belong to this registry.`
      );

    // Dismiss the device
    // TODO: implement the dismiss() method to release device-held resources
    console.debug(`Disposing resources for ${dev.name} (${dev.uuid})`);
    // dev.dismiss();
    delete this.devicesByInternalID[deviceID];
    console.info(`Device ${dev.name} (${dev.uuid}) removed from registry`);
  }
  enrollDevice(device) {
    if (device.internalID in this.devicesByInternalID) {
      console.warn(
        `Device ${device.name} (${device.internalID}) has been already added to the registry.`
      );
      return;
    } else {
      console.debug(
        `Adding device ${device.name} (${device.internalID}) to registry.`
      );
      this.devicesByInternalID[device.internalID] = device;
    }
  }

  lookupByID(deviceID) {
    return this.devicesByInternalID[deviceID];
  }

  lookupByUUID(deviceUUID) {
    const res = Object.values(this.devicesByInternalID).filter(
      (d) => d.uuid == deviceUUID
    );
    if (res.length > 1)
      throw new Error(`Multiple devices found for device_uuid ${deviceUUID}`);
    else if (res.length == 1) return res[0];
    else return null;
  }
  findAllBy({
    deviceUUIDs = undefined,
    internalIDs = undefined,
    deviceType = undefined,
    deviceClass = undefined,
    deviceName = undefined,
    onlineStatus = undefined,
  }) {
    return Object.values(this.devicesByInternalID).filter((d) =>
      [
        internalIDs ? [internalIDs].flat().includes(d.internalID) : true,
        deviceUUIDs ? [deviceUUIDs].flat().includes(d.uuid) : true,
        deviceType ? d.type == deviceType : true,
        deviceClass ? d instanceof deviceClass : true,
        deviceName ? d.name == deviceName : true,
        onlineStatus ? d.onlineStatus == onlineStatus : true,
      ].every(Boolean)
    );
  }
};
