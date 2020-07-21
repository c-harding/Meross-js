const md5 = require('md5');
const uuid4 = require('uuid4');
const { Namespace } = require('./model');

/** @typedef {import('./devices').Namespace} Namespace */
/** @typedef {import('./interfaces').PushNotification} PushNotification */
/** @typedef {import('./interfaces').HardwareInfo} HardwareInfo */
/** @typedef {import('./interfaces').TimeInfo} TimeInfo */

module.exports = {
  /**
   * Generates a new app-id.
   */
  generateClientAndAppID() {
    // TODO: Talk to the Meross engineer and check if the APPID should be the same or if we
    //  need to use a convention to discriminate MerossIot python clients. -@albertogeniola
    const appID = md5(`API${uuid4()}`);
    const clientID = `app:${appID}`;
    return [appID, clientID];
  },

  /** Generates the MQTT password that the APP uses to connect to the mqtt server. */
  generateMQTTPassword(user_id, key) {
    return md5(`${user_id}${key}`);
  },

  /** Builds the MQTT topic where the device sends back ACKs to commands
   * @param {string} userID
   * @param {string} appID
   */
  buildClientResponseTopic(userID, appID) {
    return `/app/${userID}-${appID}/subscribe`;
  },

  /**
   * Builds the topic name where user push notification are received
   * @param {string} userID
   */
  buildClientUserTopic(userID) {
    return '/app/${user_id}/subscribe';
  },
  /** Builds the MQTT topic where commands should be send to specific devices */
  buildDeviceRequestTopic(client_uuid) {
    return `/appliance/${client_uuid}/subscribe`;
  },
  /**
   * Extracts the device uuid from the "from" header of the received messages.
   * @param {string} fromTopic
   */
  deviceUUIDFromPushNotification(fromTopic) {
    return fromTopic.split('/')[2];
  },

  parseTimeInfo({ timezone, timestamp, time_rule: timeRule }) {
    return { timezone, timestamp, timeRule };
  },

  /**
   * @param {*} raw Raw server response
   * @returns {import('./interfaces').HardwareInfo}
   */
  parseHardwareInfo({
    wifi_mac: wifiMAC,
    version,
    user_id: userID,
    server,
    port,
    inner_ip: innerIP,
    compile_time: compileTime,
  }) {
    return {
      wifiMAC,
      version,
      userID,
      server,
      port,
      innerIP,
      compileTime,
    };
  },
  /**
   * @param {Namespace} namespace
   * @param {object} payload
   * @param {string} originatingDeviceUUID
   * @returns {PushNotification}
   */
  parsePushNotification(namespace, payload, originatingDeviceUUID) {
    const namespaceSpecificFields =
      namespace == payload.bind
        ? {
            time: this.parseTimeInfo(payload.bind.time),
            hardware: this.parseHardwareInfo(payload.bind.hardware),
            firmware: this.parseHardwareInfo(payload.bind.hardware),
          }
        : {};
    return {
      namespace: namespace,
      originatingDeviceUUID,
      rawData: payload,
      ...namespaceSpecificFields,
    };
  },

  /** Verifies if the given message header has a valid signature */
  verifyMessageSignature(header, key) {
    const hash = md5([header['messageId'], key, header['timestamp']].join(''));
    return hash == header['sign'];
  },
};
