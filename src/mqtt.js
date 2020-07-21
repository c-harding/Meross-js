import md5 from 'md5';
import { v4 as uuid4 } from 'uuid';

/** @typedef {import('./interfaces').PushNotification} PushNotification */
/** @typedef {import('./interfaces').HardwareInfo} HardwareInfo */
/** @typedef {import('./interfaces').TimeInfo} TimeInfo */

export function generateClientAndAppID() {
  // TODO: Talk to the Meross engineer and check if the APPID should be the same or if we
  //  need to use a convention to discriminate MerossIot python clients. -@albertogeniola
  const appID = md5(`API${uuid4()}`);
  const clientID = `app:${appID}`;
  return [appID, clientID];
}
export function generateMQTTPassword(user_id, key) {
  return md5(`${user_id}${key}`);
}
export function buildClientResponseTopic(userID, appID) {
  return `/app/${userID}-${appID}/subscribe`;
}
export function buildClientUserTopic(userID) {
  return '/app/${user_id}/subscribe';
}
export function buildDeviceRequestTopic(client_uuid) {
  return `/appliance/${client_uuid}/subscribe`;
}
export function deviceUUIDFromPushNotification(fromTopic) {
  return fromTopic.split('/')[2];
}
export function parseTimeInfo({ timezone, timestamp, time_rule: timeRule }) {
  return { timezone, timestamp, timeRule };
}
export function parseHardwareInfo({
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
}
export function parsePushNotification(
  namespace,
  payload,
  originatingDeviceUUID
) {
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
}
export function verifyMessageSignature(header, key) {
  const hash = md5([header['messageId'], key, header['timestamp']].join(''));
  return hash == header['sign'];
}
