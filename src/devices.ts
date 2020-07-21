import { OnlineStatus, Namespace } from './model';
import { MerossManager } from './manager';
import { HTTPDeviceInfo, ChannelInfo, HTTPSubDeviceInfo } from './interfaces';

/**@typedef {import('./manager').MerossManager} MerossManager */
/**@typedef {import('./interfaces').HTTPDeviceInfo} HTTPDeviceInfo */
/**@typedef {import('./interfaces').ChannelInfo} ChannelInfo */

/**
 * A `BaseDevice` is a generic representation of a Meross device.
 * Any BaseDevice is characterized by some generic information, such as user's defined
 * name, type (i.e. device specific model), firmware/hardware version, a Meross internal
 * identifier, a library assigned internal identifier.
 */
export class BaseDevice {
  public readonly manager: MerossManager;
  public readonly uuid: string;
  public channels: ChannelInfo[];
  public name: string;
  public type: string;
  public firmwareVersion: string;
  public hardwareVersion: string;
  public online: OnlineStatus;
  public abilities: {};

  constructor(
    deviceUUID: string,
    manager: MerossManager,
    config: HTTPDeviceInfo
  ) {
    this.manager = manager;
    this.uuid = deviceUUID;
    this.channels = BaseDevice.parseChannels(config.channels);

    // Information about device
    this.name = config.dev_name || 'unknown';
    this.type = config.device_type || 'unknown';
    this.firmwareVersion = config.fmware_version || 'unknown';
    this.hardwareVersion = config.hdware_version || 'unknown';
    this.online = config.online_status || OnlineStatus.UNKNOWN;

    this.abilities = {};
  }
  /**
   * Internal ID used by this library to identify meross devices. It's basically composed by
   * the Meross ID plus some prefix/suffix.
   */
  get internalID() {
    return `//BASE:${this.uuid}`;
  }

  get onlineStatus() {
    return this.online;
  }

  async updateFromHTTPState(deviceInfo: HTTPDeviceInfo) {
    // Careful with online  status: not all the devices might expose an online mixin.
    if (deviceInfo.uuid != this.uuid)
      throw new Error(
        `Cannot update device (${this.uuid}) with HttpDeviceInfo for device id ${deviceInfo.uuid}`
      );
    this.name = deviceInfo.dev_name;
    this.channels = BaseDevice.parseChannels(deviceInfo.channels);
    this.type = deviceInfo.device_type;
    this.firmwareVersion = deviceInfo.fmware_version;
    this.hardwareVersion = deviceInfo.hdware_version;
    this.online = deviceInfo.online_status;

    // TODO: fire some sort of events to let users see changed data? -@albertogeniola
    return this;
  }

  async handlePushNotification(namespace: Namespace, _data?: unknown) {
    // By design, the base class does not implement any push notification.
    console.debug(
      `MerossBaseDevice ${this.name} handling notification ${namespace}`
    );
    return false;
  }

  handleUpdate(namespace: Namespace, _data?: void) {
    // By design, the base class does not implement any update logic
    // TODO: we might update name/uuid/other stuff in here...
    return false;
  }

  /**
   * Forces a full data update on the device. If your network bandwidth is limited or you are running
   * this program on an embedded device, try to invoke this method only when strictly needed.
   * Most of the parameters of a device are updated automatically upon push-notification received
   * by the meross MQTT cloud.
   */
  async update() {
    // This method should be overridden implemented by mixins and never called directly. Its main
    // objective is to call the corresponding GET ALL command, which varies in accordance with the
    // device type. For instance, wifi devices use GET System.Appliance.ALL while HUBs use a different one.
    // Implementing mixin should never call the super() implementation (as it happens
    // with _handle_update) as we want to use only an UPDATE_ALL method.
    // However, we want to keep it within the MerossBaseDevice so that we expose a consistent
    // interface.
    throw new Error(
      'This method should never be called on the BaseMerossDevice. If this happens,' +
        'it means there is a device which is not being attached any update mixin.' +
        `Contact the developer. Current object: ${this}`
    );
  }
  async executeCommand(
    method: string,
    namespace: Namespace,
    payload: object,
    timeout: number = 5
  ) {
    return await this.manager.executeCommand(
      this.uuid,
      method,
      namespace,
      payload,
      timeout
    );
  }

  toString() {
    return `${this.name} (${this.type}, HW ${this.hardwareVersion}, FW ${this.hardwareVersion})`;
  }

  static parseChannels(
    channelData: { name: string; type: string }[] = []
  ): ChannelInfo[] {
    return channelData.map(({ name, type }, index) => ({
      index,
      name,
      type,
      master: index == 0,
    }));
  }

  lookupChannel(name: string): ChannelInfo {
    const res = this.channels.filter((c) => c.name == name);
    if (res.length == 1) return res[0];
    throw new Error(`Could not find channel by name = ${name}`);
  }
}

export class HubDevice extends BaseDevice {
  subDevices: { [id: string]: GenericSubDevice };

  // TODO: provide meaningful comment here describing what this class does
  //  Discovery?? Bind/unbind?? Online?? -@albertogeniola
  constructor(
    deviceUUID: string,
    manager: MerossManager,
    config: HTTPDeviceInfo
  ) {
    super(deviceUUID, manager, config);

    this.subDevices = {};
  }

  getSubDevices() {
    return Object.values(this.subDevices);
  }

  registerSubDevice(
    /** @type {GenericSubDevice} */ subDevice: GenericSubDevice
  ) {
    // If the device is already registered, skip it
    if (subDevice.id in this.subDevices) {
      console.error(
        `SubDevice ${subDevice.id} has been already registered to this HUB (${this.name})`
      );
      return;
    }

    this.subDevices[subDevice.id] = subDevice;
  }
}

export class GenericSubDevice extends BaseDevice {
  subDeviceID: { [id: string]: GenericSubDevice };
  UPDATE_ALL_NAMESPACE: any;
  type: string;
  name: string;
  onoff;
  mode;
  temperature;
  hub: HubDevice;
  id: string;

  /**
   * @param {string} hubDeviceUUID
   * @param {string} subDeviceID
   * @param {MerossManager} manager
   * @param {object} config
   */
  constructor(
    hubDeviceUUID: string,
    id: string,
    manager: MerossManager,
    config: HTTPSubDeviceInfo
  ) {
    super(hubDeviceUUID, manager, config);

    this.UPDATE_ALL_NAMESPACE = null;

    this.id = id;
    this.type = config.sub_device_type;
    this.name = config.sub_device_name;
    this.onoff = null;
    this.mode = null;
    this.temperature = null;
    const hub = manager.findDevices({ deviceUUIDs: hubDeviceUUID });
    if (hub.length < 1) throw new Error('Specified hub device is not present');

    this.hub = hub[0] as HubDevice;
  }

  async executeCommand(
    _method: string,
    _namespace: Namespace,
    _payload: object,
    _timeout = 5
  ): Promise<unknown> {
    // Every command should be invoked via HUB?
    throw new Error('SubDevices should rely on Hub in order to send commands.');
  }

  async update() {
    if (!this.UPDATE_ALL_NAMESPACE) {
      console.error(
        "GenericSubDevice does not implement any GET_ALL namespace. Update won't be performed."
      );
      return;
    }
    // When dealing with hubs, we need to "intercept" the UPDATE()
    await super.update();

    // When issuing an update-all command to the hub,
    // we need to query all sub-devices.
    const result = await this.hub.executeCommand(
      'GET',
      this.UPDATE_ALL_NAMESPACE,
      { all: [{ id: this.subDeviceID }] }
    );
    const subDevicesStates = result.all;
    const subDevicesState = subDevicesStates.find(
      (state) => state.id == this.subDeviceID
    );
    if (subDevicesState)
      await this.handlePushNotification(
        this.UPDATE_ALL_NAMESPACE,
        subDevicesState
      );
  }

  /**
   * Polls the HUB/DEVICE to get its current battery status.
   * @returns {Promise<{ batteryCharge: number, sampleTimestamp: number }>}
   */
  async getBatteryLife(): Promise<{
    batteryCharge: number;
    sampleTimestamp: number;
  }> {
    const data = await this.hub.executeCommand('GET', Namespace.HUB_BATTERY, {
      battery: [{ id: this.subDeviceID }],
    });
    const batteryLifePercent = data.get('battery', {})[0].get('value');
    const timestamp = Date.now();
    return { batteryCharge: batteryLifePercent, sampleTimestamp: timestamp };
  }

  get internal_id() {
    return `//BASE:${this.uuid}//SUB:${this.subDeviceID}`;
  }

  get onlineStatus() {
    // If the HUB device is offline, return offline
    if (this.hub.onlineStatus != OnlineStatus.ONLINE)
      return this.hub.onlineStatus;

    return this.online;
  }
}
