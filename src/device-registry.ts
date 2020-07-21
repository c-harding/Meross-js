import { BaseDevice } from './devices';
import { OnlineStatus } from './model';

export class DeviceRegistry {
  devicesByInternalID: { [id: string]: BaseDevice } = {};

  relinquishDevice(deviceID: string) {
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

  // TODO: any
  findAllBy({
    deviceUUIDs,
    internalIDs,
    deviceType,
    deviceClass,
    deviceName,
    onlineStatus,
  }: DeviceRegistry.DeviceFilters) {
    return Object.values(this.devicesByInternalID).filter((d) =>
      [
        internalIDs ? [internalIDs].flat().includes(d.internalID) : true,
        deviceUUIDs ? [deviceUUIDs].flat().includes(d.uuid) : true,
        deviceType ? d.type == deviceType : true,
        deviceClass ? d.type == deviceClass : true, // TODO needs work, as we don’t have multiple inheritance
        deviceName ? d.name == deviceName : true,
        onlineStatus ? d.onlineStatus == onlineStatus : true,
      ].every(Boolean)
    );
  }
}
namespace DeviceRegistry {
  export interface DeviceFilters {
    /**
     * List of Meross native device UUIDs. When specified, only devices that have a native UUID
     * contained in this list are returned.
     */
    deviceUUIDs?: string | string[];

    /**
     * Iterable List of MerossIot device ids. When specified, only devices that have a derived-ids
     * contained in this list are returned.
     */
    internalIDs?: string | string[];

    /**
     * Device type string as reported by meross app (e.g. "mss310" or "msl120"). Note that this
     * field is case sensitive.
     */
    deviceType?: string;

    /**
     * Filter based on the resulting device class. You can filter also for capability Mixins, such
     * as `meross_iot.controller.mixins.toggle.ToggleXMixin` (returns all the devices supporting
     * ToggleX capability) or `meross_iot.controller.mixins.light.LightMixin` (returns all the
     * device that supports light control). You can also identify all the HUB devices by specifying
     * `meross_iot.controller.device.HubDevice`, Sensors as
     * `meross_iot.controller.subdevice.Ms100Sensor` and Valves as Sensors as
     * `meross_iot.controller.subdevice.Mts100v3Valve`.
     */
    deviceClass?: string;

    /**
     * Filter the devices based on their assigned name (case sensitive)
     */
    deviceName?: string;

    /**
     * Filter the devices based on their `meross_iot.model.enums.OnlineStatus` as reported by the
     * HTTP api or byt the relative hub (when dealing with subdevices).
     */
    onlineStatus?: OnlineStatus;
  }
}
