import { Namespace } from './devices';

export interface MerossCloudCreds {
  token: string;
  key: string;
  userID: string;
  userEmail: string;
  issuedOn: number;
}

export interface HTTPDeviceInfo {
  uuid: string;
  online_status: number;
  dev_name: string;
  dev_icon_id: string;
  bind_time: number;
  device_type: string;
  sub_type: string;
  channels: { name: string; type: string }[];
  region: string;
  fmware_version: string;
  hdware_version: string;
  user_dev_icon: string;
  icon_type: number;
  skill_number: string;
  domain: string;
  reserved_domain: string;
}

export interface HttpSubdeviceInfo {
  sub_device_id: string;
  true_id: string;
  sub_device_type: string;
  sub_device_vendor: string;
  sub_device_name: string;
  sub_device_icon_id: string;
}

export interface ChannelInfo {
  index: number;
  name: string;
  type: string;
  master: boolean;
}

export interface TimeInfo {
  timezone: string;
  timestamp: string;
  timeRule: string;
}

export interface HardwareInfo {
  wifiMAC;
  version;
  userID;
  server;
  port;
  innerIP;
  compileTime;
}

export interface PushNotification {
  time?: TimeInfo;
  hardware?: HardwareInfo;
  firmware?: HardwareInfo;
  namespace: Namespace;
  originatingDeviceUUID: string;
  rawData: object;
}
