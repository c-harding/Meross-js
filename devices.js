const { OnlineStatus, Namespace } = require('./model');

/**@typedef {import('./manager').MerossManager} MerossManager */
/**@typedef {import('./interfaces').HTTPDeviceInfo} HTTPDeviceInfo */
/**@typedef {import('./interfaces').ChannelInfo} ChannelInfo */
/**@typedef {import('./model').Namespace} Namespace */

/**
 * A `BaseDevice` is a generic representation of a Meross device.
 * Any BaseDevice is characterized by some generic information, such as user's defined
 * name, type (i.e. device specific model), firmware/hardware version, a Meross internal
 * identifier, a library assigned internal identifier.
 */
exports.BaseDevice = class BaseDevice {
  /**
   * @param {string} deviceUUID
   * @param {MerossManager} manager
   * @param {HTTPDeviceInfo} config
   */
  constructor(
    deviceUUID,
    /** @type {MerossManager} */ manager,
    {
      dev_name = 'unknown',
      device_type = 'unknown',
      fmware_version = 'unknown',
      hdware_version = 'unknown',
      online_status = OnlineStatus.UNKNOWN,
      channels = [],
    }
  ) {
    this.manager = manager;
    this.uuid = deviceUUID;
    this.channels = BaseDevice.parseChannels(channels);

    // Information about device
    this.name = dev_name;
    this.type = device_type;
    this.firmwareVersion = fmware_version;
    this.hardwareVersion = hdware_version;
    this.online = online_status;

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

  async updateFromHTTPState(/** @type {HTTPDeviceInfo} */ deviceInfo) {
    // Careful with online  status: not all the devices might expose an online mixin.
    if (deviceInfo.uuid != this.uuid)
      throw new Error(
        `Cannot update device (${this.uuid}) with HttpDeviceInfo for device id ${deviceInfo.uuid}`
      );
    this.name = deviceInfo.dev_name;
    this.channels = BaseDevice.parseChannels(deviceInfo.channels);
    this.type = deviceInfo.device_type;
    this.fwversion = deviceInfo.fmware_version;
    this.hwversion = deviceInfo.hdware_version;
    this.online = deviceInfo.online_status;

    // TODO: fire some sort of events to let users see changed data? -@albertogeniola
    return this;
  }

  async handlePushNotification(/** @type {Namespace} */ namespace, _data) {
    // By design, the base class does not implement any push notification.
    console.debug(
      `MerossBaseDevice ${this.name} handling notification ${namespace}`
    );
    return false;
  }

  handleUpdate(/** @type {Namespace} */ namespace, _data) {
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

  /**
   * @param {string} method
   * @param {Namespace} namespace
   * @param {object} payload
   * @param {number} [timeout=5]
   */
  async executeCommand(method, namespace, payload, timeout = 5) {
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

  /**
   *
   * @static
   * @param {{name:string,type:string}[]} channelData
   * @returns {ChannelInfo[]}
   */
  static parseChannels(channelData = []) {
    return channelData.map(({ name, type }, index) => ({
      index,
      name,
      type,
      master: index == 0,
    }));
  }

  /**
   * Looks up a channel by channel id or channel name
   *
   * @param {string} name
   */
  lookupChannel(name) {
    const res = this.channels.filter((c) => c.name == name);
    if (res.length == 1) return res[0];
    throw new Error(`Could not find channel by name = ${name}`);
  }
};

exports.HubDevice = class extends exports.BaseDevice {
  // TODO: provide meaningful comment here describing what this class does
  //  Discovery?? Bind/unbind?? Online?? -@albertogeniola
  constructor(deviceUUID, manager, config) {
    super(deviceUUID, manager, config);

    /** @type {{ [id: string]: exports.GenericSubDevice }} */
    this.subDevices = {};
  }

  getSubDevices() {
    return Object.values(this.subDevices);
  }

  registerSubDevice(/** @type {exports.GenericSubDevice} */ subDevice) {
    // If the device is already registered, skip it
    if (subDevice.subDeviceID in this.subDevices) {
      console.error(
        `SubDevice ${subDevice.subDeviceID} has been already registered to this HUB (${this.name})`
      );
      return;
    }

    this.subDevices[subDevice.subDeviceID] = subDevice;
  }
};

exports.GenericSubDevice = class extends exports.BaseDevice {
  /**
   * @param {string} hubDeviceUUID
   * @param {string} subDeviceID
   * @param {MerossManager} manager
   * @param {object} config
   */
  constructor(hubDeviceUUID, subDeviceID, manager, config) {
    super(hubDeviceUUID, manager, config);

    this._UPDATE_ALL_NAMESPACE = null;

    this.subDeviceID = subDeviceID;
    this._type = config.subDeviceType;
    this._name = config.subDeviceName;
    this._onoff = null;
    this._mode = null;
    this._temperature = null;
    const hub = manager.findDevices({ deviceUUIDs: hubDeviceUUID });
    if (hub.length < 1) throw new Error('Specified hub device is not present');

    /** @type {exports.HubDevice} */
    this.hub = /** @type {exports.HubDevice} */ (hub[0]);
  }

  async executeCommand(_method, _namespace, _payload, _timeout = 5) {
    // Every command should be invoked via HUB?
    throw new Error('SubDevices should rely on Hub in order to send commands.');
  }

  async update() {
    if (!this._UPDATE_ALL_NAMESPACE) {
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
      this._UPDATE_ALL_NAMESPACE,
      { all: [{ id: this.subDeviceID }] }
    );
    const subDevicesStates = result.all;
    const subDevicesState = subDevicesStates.find(
      (state) => state.id == this.subDeviceID
    );
    if (subDevicesState)
      await this.handlePushNotification(
        this._UPDATE_ALL_NAMESPACE,
        subDevicesState
      );
  }

  /**
   * Polls the HUB/DEVICE to get its current battery status.
   * @returns {Promise<{ batteryCharge: number, sampleTimestamp: number }>}
   */
  async getBatteryLife() {
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
};
