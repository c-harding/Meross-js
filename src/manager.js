const mqtt = require('mqtt');
const md5 = require('md5');

const { MerossHTTPClient } = require('./api');

const {
  generateMQTTPassword,
  generateClientAndAppID,
  buildClientResponseTopic,
  buildClientUserTopic,
  buildDeviceRequestTopic,
  deviceUUIDFromPushNotification,
  parsePushNotification,
  verifyMessageSignature,
} = require('./mqtt.js');
const { DeviceRegistry } = require('./device-registry');
const { Namespace, CommandTimeout, OnlineStatus } = require('./model.js');
const { BaseDevice } = require('./devices');
const { buildMerossDevice } = require('./device-factory');

/** @typedef {import('./api').MerossHTTPClient} MerossHTTPClient */
/** @typedef {import('./interfaces').HTTPDeviceInfo} HTTPDeviceInfo */
/** @typedef {import('./mqtt').PushNotification} PushNotification */

/**
 * This class implements a full-features Meross Client, which provides device discovery and registry.
 */
exports.MerossManager = class {
  /**
   *
   * @param {MerossHTTPClient} httpClient
   * @param {boolean} autoReconnect
   * @param {string} domain
   * @param {number} port
   * @param {string} caCert
   */
  constructor(
    httpClient,
    autoReconnect = true,
    domain = 'iot.meross.com',
    port = 2001,
    caCert = null
  ) {
    this.httpClient = httpClient;
    this.autoReconnect = autoReconnect;
    this.domain = domain;
    this.port = port;
    this.caCert = caCert;
    this.initialized = false;
    [this.appID = '', this.clientID = ''] = generateClientAndAppID();

    // TODO: type this
    /** @type {{ [id: string]: { resolve(message: any): void; reject(error: any): void } }} */
    this.pendingMessages = {};
    this.deviceRegistry = new DeviceRegistry();
    this.pushCallbacks = [];

    // Prepare MQTT topic names
    this.clientResponseTopic = buildClientResponseTopic(
      this.cloudCreds.userID,
      this.appID
    );
    this.userTopic = buildClientUserTopic(this.cloudCreds.userID);

    const mqttPassword = generateMQTTPassword(
      this.cloudCreds.userID,
      this.cloudCreds.key
    );
    this.mqttClient = mqtt.connect({
      host: this.domain,
      port: this.port,
      username: this.cloudCreds.userID,
      password: mqttPassword,
      ca: this.caCert,
    });
    this.mqttClient.addListener('connect', ({ rc }) => {
      console.debug(`Connected with result code ${rc}`);
      // Subscribe to the relevant topics
      console.debug('Subscribing to topics...');
      this.mqttClient.subscribe(
        [this.userTopic, this.clientResponseTopic],
        () => this.onSubscribe()
      );
    });
    this.mqttClient.addListener('message', (topic, rawMessage, packet) =>
      this.onMessage(topic, rawMessage, packet)
    );
    this.mqttClient.addListener('disconnect', (packet) =>
      this.onDisconnect(packet)
    );
  }

  get cloudCreds() {
    return this.httpClient.cloudCreds;
  }

  async onSubscribe() {
    // NOTE! This method is called by the paho-mqtt thread, thus any invocation to the
    // asyncio platform must be scheduled via `this.loop.call_soon_threadsafe()` method.
    console.debug('Successfully subscribed to topics.');

    this.mqttConnectedAndSubscribed = true;

    // When subscribing again on the mqtt, trigger an update for all the devices that are currently registered

    console.warn(
      'Subscribed to topics, updating state for already known devices...'
    );
    const results = await Promise.all(
      this.findDevices().map((d) => d.update())
    );
    console.info(`Updated ${results.length} devices.`);
  }

  async onDisconnect(packet) {
    console.log('TODO: where is `rc`?', packet);
    // NOTE! This method is called by the paho-mqtt thread, thus any invocation to the
    // asyncio platform must be scheduled via `this.loop.call_soon_threadsafe()` method.

    console.info(`Disconnection detected. Reason: ${rc}`);

    // If the client disconnected explicitly, the mqtt library handles thred stop autonomously
    if (rc != mqtt.MQTT_ERR_SUCCESS) {
      // Otherwise, if the disconnection was not intentional, we probably had a connection drop.
      // In this case, we only stop the loop thread if auto_reconnect is not set. In fact, the loop will
      // handle reconnection autonomously on connection drops.
      if (!this.autoReconnect) {
        console.info('Stopping mqtt loop on connection drop');
        // TODO: convert this
        client.loop_stop(true);
      } else
        console.warn(
          'Client has been disconnected, however auto_reconnect flag is set. ' +
            "Won't stop the looping thread, as it will retry to connect."
        );
    }

    // When a disconnection occurs, we need to set "unavailable" status.
    this.notifyConnectionDrop();
  }

  async onMessage(topic, rawMessage, packet) {
    console.log(topic, rawMessage, packet);
    // NOTE! This method is called by the paho-mqtt thread, thus any invocation to the
    // asyncio platform must be scheduled via `this.loop.call_soon_threadsafe()` method.
    console.debug(`Received message from topic ${topic}: ${rawMessage}`);

    // In order to correctly dispatch a message, we should look at:
    // - message destination topic
    // - message methods
    // - source device (from value in header)
    // Based on the network capture of Meross Devices, we know that there are 4 kinds of messages:
    // 1. COMMANDS sent from the app to the device (/appliance/<uuid>/subscribe) topic.
    //    Such commands have "from" header populated with "/app/<userid>-<appuuid>/subscribe" as that tells the
    //    device where to send its command ACK. Valid methods are GET/SET
    // 2. COMMAND-ACKS, which are sent back from the device to the app requesting the command execution on the
    //    "/app/<userid>-<appuuid>/subscribe" topic. Valid methods are GETACK/SETACK/ERROR
    // 3. PUSH notifications, which are sent to the "/app/46884/subscribe" topic from the device (which populates
    //    the from header with its topic /appliance/<uuid>/subscribe). In this case, only the PUSH
    //    method is allowed.
    // Case 1 is not of our interest, as we don't want to get notified when the device receives the command.
    // Instead we care about case 2 to acknowledge commands from devices and case 3, triggered when another app
    // has successfully changed the state of some device on the network.

    // Let's parse the message
    const message = JSON.parse(rawMessage);
    const header = packet.header;
    if (!verifyMessageSignature(header, this.cloudCreds.key)) {
      console.error(
        `Invalid signature received. Message will be discarded. Message: {msg.payload}`
      );
      return;
    }

    console.debug('Message signature OK');

    // Let's retrieve the destination topic, message method and source party:
    const messageMethod = header.method;
    const sourceTopic = header.from;

    // Dispatch the message.
    // Check case 2: COMMAND_ACKS. In this case, we don't check the source topic address, as we trust it's
    // originated by a device on this network that we contacted previously.
    if (
      topic == this.clientResponseTopic &&
      ['SETACK', 'GETACK', 'ERROR'].includes(messageMethod)
    ) {
      console.debug(
        'This message is an ACK to a command this client has send.'
      );

      // If the message is a PUSHACK/GETACK/ERROR, check if there is any pending command waiting for it and, if so,
      // resolve its future
      const messageID = header.messageId;
      //TODO: update this to promises
      const future = this.pendingMessages[messageID];
      if (future) {
        delete this.pendingMessages[messageID];
        console.debug('Found a pending command waiting for response message');

        if (messageMethod == 'ERROR')
          setTimeout(() => future.reject(message.payload));
        else if (['SETACK', 'GETACK'].includes(messageMethod))
          setTimeout(() => future.resolve(message));
        else
          console.error(
            `Unhandled message method ${messageMethod}. Please report it to the developer.` +
              `raw_msg: ${packet}`
          );
      }
    }
    // Check case 3: PUSH notification.
    // Again, here we don't check the source topic, we trust that's legitimate.
    else if (topic == this.userTopic && messageMethod == 'PUSH') {
      const namespace = header.namespace;
      const deviceUUID = deviceUUIDFromPushNotification(sourceTopic);

      const parsedPushNotification = parsePushNotification(
        namespace,
        message,
        deviceUUID
      );
      setTimeout(() =>
        this.handleAndDispatchPushNotification(parsedPushNotification)
      );
    } else
      console.warn(
        `The current implementation of this library does not handle messages received on topic ` +
          `({destination_topic}) and when the message method is {message_method}. ` +
          'If you see this message many times, it means Meross has changed the way its protocol ' +
          'works. Contact the developer if that happens!'
      );
  }

  /**
   * Lists devices that have been discovered via this manager. When invoked with no arguments,
   * it returns the whole list of registered devices. When one or more filter arguments are specified,
   * it returns the list of devices that satisfy all the filters (consider multiple filters as in logical AND).
   *
   * @param {object} filters
   * @param {string|string[]=} filters.deviceUUIDs List of Meross native device UUIDs. When specified, only devices that have a native UUID
   *   contained in this list are returned.
   * @param {string|string[]=} filters.internalIDs Iterable List of MerossIot device ids. When specified, only devices that have a
   *   derived-ids contained in this list are returned.
   * @param {string=} filters.deviceType Device type string as reported by meross app (e.g. "mss310" or "msl120"). Note that this
   *   field is case sensitive.
   * @param {string=} filters.deviceClass Filter based on the resulting device class. You can filter also for capability Mixins,
   *   such as `meross_iot.controller.mixins.toggle.ToggleXMixin` (returns all the devices supporting
   *   ToggleX capability) or `meross_iot.controller.mixins.light.LightMixin`
   *   (returns all the device that supports light control).
   *   You can also identify all the HUB devices by specifying `meross_iot.controller.device.HubDevice`,
   *   Sensors as `meross_iot.controller.subdevice.Ms100Sensor` and Valves as
   *   Sensors as `meross_iot.controller.subdevice.Mts100v3Valve`.
   * @param {string=} filters.deviceName Filter the devices based on their assigned name (case sensitive)
   * @param {string=} filters.onlineStatus Filter the devices based on their `meross_iot.model.enums.OnlineStatus`
   *   as reported by the HTTP api or byt the relative hub (when dealing with subdevices).
   * @returns {BaseDevice[]} The list of devices that match the provided filters, if any.
   */
  findDevices(filters = {}) {
    return this.deviceRegistry.findAllBy(filters);
  }

  /**
   * This method runs within the event loop and is responsible for handling and dispatching push notifications
   * to the relative meross device within the registry.
   *
   * @param {PushNotification} pushNotification
   */
  async handleAndDispatchPushNotification(pushNotification) {
    // Dispatching
    const handledDevice = this.dispatchPushNotification(pushNotification);

    // Notify any listener that registered explicitly to pushNotification
    const targetDevs = this.deviceRegistry.findAllBy({
      deviceUUIDs: pushNotification.originatingDeviceUUID,
    });

    try {
      for (const handler of this.pushCallbacks)
        await handler(pushNotification, targetDevs);
    } catch (e) {
      console.error(
        `An error occurred while executing push notification handling for ${pushNotification}`
      );
    }

    // Handling post-dispatching
    const handledPost = await this.handlePushNotificationPostDispatching(
      pushNotification
    );

    if (!handledDevice && !handledPost)
      console.warn(
        `Uncaught push notification ${pushNotification.namespace}. ` +
          `Raw data: ${JSON.stringify(pushNotification.rawData)}`
      );
  }

  /**
   * @param {PushNotification} pushNotification
   * @returns {Promise<boolean>}
   */
  async dispatchPushNotification(pushNotification) {
    // Lookup the originating device and deliver the push notification to that one.
    const target_devs = this.deviceRegistry.findAllBy({
      deviceUUIDs: pushNotification.originatingDeviceUUID,
    });

    if (target_devs.length < 1)
      console.warn(
        `Received a push notification (${pushNotification.namespace}, ` +
          `rawData: ${JSON.stringify(pushNotification.rawData)}) ` +
          `for device(s) (${pushNotification.originatingDeviceUUID}) that are not ` +
          `available in the local registry. Trigger a discovery to intercept those events.`
      );
    else {
      // Pass the control to the specific device implementation
      for (const dev of target_devs) {
        try {
          const success = await dev.handlePushNotification(
            pushNotification.namespace,
            pushNotification.rawData
          );
          if (success) return true;
        } catch (e) {
          console.error(
            'An unhandled exception occurred while handling push notification'
          );
        }
      }
    }

    return false;
  }

  /**
   * @param {PushNotification} pushNotification
   * @returns {Promise<boolean>}
   */
  async handlePushNotificationPostDispatching(pushNotification) {
    if (pushNotification.namespace == Namespace.CONTROL_UNBIND) {
      console.info(
        'Received an Unbind PushNotification. Releasing device resources...'
      );
      const devs = this.deviceRegistry.findAllBy({
        deviceUUIDs: pushNotification.originatingDeviceUUID,
      });
      for (const d of devs) {
        console.info(`Releasing resources for device ${d.internalID}`);
        this.deviceRegistry.relinquishDevice(d.internalID);
      }
      return true;
    }
    return false;
  }

  /**
   * This method sends a command to the MQTT Meross broker.
   *
   * @param {string} destinationDeviceUUID
   * @param {string} method Can be GET/SET
   * @param {Namespace} namespace
   * @param {object} payload A dict containing the payload to be sent
   * @param {number} [timeout=5.0]
   * @returns
   */
  async executeCommand(
    destinationDeviceUUID,
    method,
    namespace,
    payload = {},
    timeout = 5.0
  ) {
    // Only proceed if we are connected to the remote endpoint
    if (!this.mqttClient.connected)
      throw new Error('The MQTT client is not connected to the remote broker.');

    // Build the mqtt message we will send to the broker
    const [message, messageID] = this.buildMQTTMessage(
      method,
      namespace,
      payload
    );

    const response = await this.asyncSendAndWaitAck(
      messageID,
      message,
      destinationDeviceUUID
    );
    return response.payload;
  }

  async asyncSendAndWaitAck(messageID, message, targetDeviceUUID, timeout) {
    // Create a future and perform the send/waiting to a task
    const promise = new Promise((resolve, reject) => {
      this.pendingMessages[messageID] = { resolve, reject };
    });
    this.mqttClient.publish(buildDeviceRequestTopic(targetDeviceUUID), message);

    return await Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => {
          reject(
            new CommandTimeout(
              `Timeout occurred while waiting a response for message ${message} sent to device uuid ` +
                `${targetDeviceUUID}. Timeout was: ${timeout} seconds`
            )
          );
        }, timeout * 1000)
      ),
    ]);
  }
  /**
   *Sends a message to the Meross MQTT broker, respecting the protocol payload.
   *
   * @param {string} method
   * @param {Namespace} namespace
   * @param {object} payload
   * @returns {TODO:}
   */
  buildMQTTMessage(method, namespace, payload) {
    // Generate a random 16 byte string
    const nonce = MerossHTTPClient.generateNonce(16);

    // Hash it as md5
    const messageId = md5(nonce);
    const timestamp = Math.floor(Date.now() / 100);

    // Hash the messageId, the key and the timestamp
    const signature = md5([messageId, this.cloudCreds.key, timestamp].join(''));

    const data = {
      header: {
        from: this.clientResponseTopic,
        messageId: messageId, // Example: "122e3e47835fefcd8aaf22d13ce21859"
        method: method, // Example: "GET",
        namespace: namespace.value, // Example: "Appliance.System.All",
        payloadVersion: 1,
        sign: signature, // Example: "b4236ac6fb399e70c3d61e98fcb68b74",
        timestamp: timestamp,
      },
      payload: payload,
    };
    const json = JSON.stringify(data);
    return [json, messageId];
  }

  /**
   * Fetch devices and online status from HTTP API. This method also notifies/updates local device online/offline
   * status.
   *
   * @param {boolean} [updateSubdeviceStatus=true] When True, tells the manager to retrieve the HUB status in order to update
   * @param {*} [merossDeviceUUID=null]
   *  Meross UUID of the device that the user wants to discover (is already known). This parameter
   *  restricts the discovery only to that particular device. When None, all the devices
   *  reported by the HTTP api will be discovered.
   * @returns
   */
  async deviceDiscovery(updateSubdeviceStatus = true, merossDeviceUUID = null) {
    console.info(
      `\n\n------- Triggering HTTP discovery, filter_device: ${merossDeviceUUID} -------`
    );
    // List http devices
    let httpDevices = await this.httpClient.listDevices();

    if (merossDeviceUUID)
      httpDevices = httpDevices.filter((d) => d.uuid == merossDeviceUUID);

    // Update state of local devices
    /** @type {HTTPDeviceInfo[]} */ const newDevices = [];
    /** @type {Map<HTTPDeviceInfo, BaseDevice>} */ const knownDevices = new Map();
    for (const device of httpDevices) {
      // Check if the device is already present into the registry
      const foundDevice = this.deviceRegistry.lookupByUUID(device.uuid);
      if (foundDevice) knownDevices.set(device, foundDevice);
      // If the http_device was not locally registered, keep track of it as we will add it later.
      else newDevices.push(device);
    }

    // Give some info
    console.info(
      `The following devices were already known to me: ${knownDevices}`
    );
    console.info(`The following devices are new to me: ${newDevices}`);

    console.info(
      `Updating ${knownDevices.size} known devices form HTTPINFO and fetching ` +
        `data from ${newDevices.length} newly discovered devices...`
    );

    // For every newly discovered device, retrieve its abilities and then build a corresponding wrapper.
    // In the meantime, update state of the already known devices
    // Do this in "parallel" with multiple tasks rather than executing every task singularly
    const enrolledDevices = await Promise.all([
      ...newDevices.map((d) => this.enrollNewDevice(d)),
      ...Array.from(knownDevices.entries(), ([device, foundDevice]) =>
        foundDevice.updateFromHTTPState(device)
      ),
    ]);

    console.info(`Fetch and update done`);

    // Let's now handle HubDevices. For every HubDevice we have, we need to fetch new possible subdevices
    // from the HTTP API
    // TODO: handle hub-sub
    // subdevtasks = []
    // hubs = []
    // for d in enrolledDevices:
    //     if (isinstance(d, HubDevice))
    //         hubs.append(d)
    //         subdevs = await this._http_client.listHubSubdevices(hub_id=d.uuid)
    //         for sd in subdevs:
    //             subdevtasks.append(this._loop.create_task(
    //                 this.enrollNewSubdevice(subdevice_info=sd,
    //                                                    hub=d,
    //                                                    hub_reported_abilities=d._abilities)))
    // // Wait for factory to build all devices
    // enrolled_subdevices = await asyncio.gather(*subdevtasks, loop=this._loop)

    // // We need to update the state of hubs in order to refresh subdevices online status
    // if (updateSubdeviceStatus)
    //     for h in hubs:
    //         await h.async_update()
    console.info(`\n------- HTTP discovery ended -------\n`);
  }

  /**
   * @param {HTTPDeviceInfo} deviceInfo
   * @returns {Promise<BaseDevice?>}
   */
  async enrollNewDevice(deviceInfo) {
    let abilities;
    try {
      // Only get abilities if the device is online.
      if (deviceInfo.online_status != OnlineStatus.ONLINE) {
        console.info(
          `Could not retrieve abilities for device ${deviceInfo.dev_name} (${deviceInfo.uuid}). ` +
            `This device won't be enrolled.`
        );
        return null;
      }
      const resAbilities = await this.executeCommand(
        deviceInfo.uuid,
        `GET`,
        Namespace.SYSTEM_ABILITY
      );
      abilities = resAbilities.ability;
    } catch (e) {
      if (e instanceof CommandTimeout) {
        console.error(
          `Failed to retrieve abilities for device ${deviceInfo.dev_name} (${deviceInfo.uuid}). This device won't be enrolled.`
        );
        return null;
      } else throw e;
    }

    // Build a full-featured device using the given ability set
    const device = buildMerossDevice(deviceInfo, abilities, this);

    // Enroll the device
    this.deviceRegistry.enrollDevice(device);
    return device;
  }
};
