import md5 from 'md5';
import { writeFile, readFile } from 'fs/promises';
import getRandomValues from 'get-random-values';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { serialize } from 'object-to-formdata';

/** @typedef {import('./interfaces').MerossCloudCreds} MerossCloudCreds */
/** @typedef {import('./interfaces').HTTPDeviceInfo} HTTPDeviceInfo */
/** @typedef {import('./interfaces').HttpSubDeviceInfo} HttpSubDeviceInfo */

import {
  AuthenticatedPostException,
  ErrorCodes,
  TokenExpiredException,
  TooManyRequestsException,
  TooManyTokensException,
} from './model';

export class MerossHTTPClient {
  static SECRET = '23x17ahWarFH6w29';
  static MEROSS_URL = 'https://iot.meross.com';
  static LOGIN_URL = `${MerossHTTPClient.MEROSS_URL}/v1/Auth/Login`;
  static LOG_URL = `${MerossHTTPClient.MEROSS_URL}/v1/log/user`;
  static DEV_LIST = `${MerossHTTPClient.MEROSS_URL}/v1/Device/devList`;
  static HUB_DUBDEV_LIST = `${MerossHTTPClient.MEROSS_URL}/v1/Hub/getSubDevices`;
  static LOGOUT_URL = `${MerossHTTPClient.MEROSS_URL}/v1/Profile/logout`;

  static CRED_CACHE = './.cloud-creds.json';

  constructor(/** @type {MerossCloudCreds} */ cloudCreds) {
    this.cloudCreds = cloudCreds;
  }

  /**
   * Builds a MerossHTTPClient using username/password combination.
   *
   * In any case, the login will generate a token, which might expire at any time.
   * @param {string} email Meross account email
   * @param {string} password Meross account password
   * @returns {Promise<MerossHTTPClient>}
   */
  static async fromUserPassword(email, password) {
    console.debug(`Logging in with email: ${email}, password: XXXXX`);
    const cloudCreds = await this.login(email, password);
    console.debug('Login successful!');
    await writeFile(this.CRED_CACHE, JSON.stringify(cloudCreds), {
      encoding: 'utf8',
    });
    return new MerossHTTPClient(cloudCreds);
  }

  /**
   * Builds a MerossHTTPClient using the cached details.
   *
   * This may fail if the token has expired.
   * @returns {Promise<MerossHTTPClient>}
   */
  static async fromCache() {
    const cloudCreds = JSON.parse(
      await readFile(this.CRED_CACHE, { encoding: 'utf8' })
    );
    console.debug('Restored session!');
    return new MerossHTTPClient(cloudCreds);
  }

  /**
   * Performs the login against the Meross HTTP endpoint.
   *
   * This api returns a MerossCloudCreds object, which contains a token.
   * Be cautious when invoking this API: asking for too many tokens as the Meross HTTP API might refuse
   * to issue more tokens. Instead, you should keep using the same issued token when possible, possibly
   * storing it across sessions. When you are done using a specific token, be sure to invoke logout
   * to invalidate it.
   *
   * @param {string} email Meross account email
   * @param {string} password Meross account password
   * @returns {Promise<MerossCloudCreds>}
   */
  static async login(email, password) {
    const response_data = await MerossHTTPClient.authenticatedPost(
      this.LOGIN_URL,
      { email, password }
    );
    /** @type {MerossCloudCreds} */
    const creds = {
      token: response_data['token'],
      key: response_data['key'],
      userID: response_data['userid'],
      userEmail: response_data['email'],
      issuedOn: Date.now(),
    };
    return creds;
  }

  static generateNonce(len = 16) {
    const arr = new Uint8Array(len);
    getRandomValues(arr);
    return Array.from(arr, (dec) => (dec % 36).toString(36))
      .join('')
      .toUpperCase();
  }

  static encodeParams(parameters) {
    return Buffer.from(
      JSON.stringify(parameters).replace(/([:,])/g, '$1 '),
      'utf8'
    ).toString('base64');
  }

  /**
   *
   * @param {string} url
   * @param {object} data
   * @param {MerossCloudCreds} cloudCreds
   */
  static async authenticatedPost(url, data, cloudCreds = null) {
    const nonce = MerossHTTPClient.generateNonce(16);
    const timestamp = Date.now();
    const loginParams = MerossHTTPClient.encodeParams(data);

    // Generate the md5-hash (called signature)
    const md5hash = md5(
      [MerossHTTPClient.SECRET, timestamp, nonce, loginParams].join('')
    );

    const headers = {
      Authorization: 'Basic' + (cloudCreds?.token || ''),
      vender: 'Meross',
      AppVersion: '1.3.0',
      AppLanguage: 'EN',
      'User-Agent': 'okhttp/3.6.0',
    };

    const payload = {
      params: loginParams,
      sign: md5hash,
      timestamp,
      nonce,
    };

    // Perform the request.
    console.debug(
      `Performing HTTP request against ${url}, headers: ${JSON.stringify(
        headers
      )}, post data: ${JSON.stringify(payload)}`
    );
    const response = await fetch(url, {
      method: 'POST',
      body: serialize(payload, {}, /** @type {any} */ (new FormData())),
      headers,
    });
    console.debug(`Response Status Code: ${response.status}`);
    // Check if that is ok.
    if (response.status != 200)
      throw new AuthenticatedPostException(
        `Failed request to API. Response code: ${response.status}`
      );

    // Save returned value
    const json = await response.json();
    console.log(json);
    const code = json.apiStatus;

    if (code == ErrorCodes.CODE_NO_ERROR) return json.data;
    else if (code == ErrorCodes.CODE_TOKEN_EXPIRED)
      throw new TokenExpiredException('The provided token has expired');
    else if (code == ErrorCodes.CODE_TOO_MANY_REQUESTS)
      throw new TooManyRequestsException(
        'You have been rate-limited, please try again later.'
      );
    else if (code == ErrorCodes.CODE_TOO_MANY_TOKENS)
      throw new TooManyTokensException(
        'You have issued too many tokens without logging out.'
      );
    else
      throw new AuthenticatedPostException(
        `Failed request to API. Response was: ${JSON.stringify(json, null, 2)}`
      );
  }

  /**
   * Invalidates the credentials stored in this object.
   */
  async logout() {
    console.debug(
      `Logging out. Invalidating cached credentials ${this.cloudCreds}`
    );
    const result = await MerossHTTPClient.authenticatedPost(
      MerossHTTPClient.LOGOUT_URL,
      {},
      this.cloudCreds
    );
    this._cloudCreds = null;
    console.info('Logout succeeded.');
    return result;
  }

  /**
   * Class method used to invalidate credentials without logging in with a full MerossHTTPClient.
   *
   * @param {MerossCloudCreds} cloudCreds `MerossCloudCredentials` as returned by `login()` or `from_user_password()`
   */
  static invalidateCredentials(cloudCreds) {
    console.debug(`Logging out. Invalidating cached credentials ${cloudCreds}`);
    return MerossHTTPClient.authenticatedPost(
      MerossHTTPClient.LOGOUT_URL,
      {},
      cloudCreds
    );
  }

  /**
   * Executes the LOG HTTP api. So far, it's still unknown whether this is needed and what it does.
   * Most probably it logs the device specification to the remote endpoint for stats.
   */
  static async log() {
    // TODO: talk to the Meross engineer and negotiate a custom system for identifying the API rather than
    //  emulating an Android 6 device. - @albertogeniola
    const data = {
      extra: {},
      model: 'Android,Android SDK built for x86_64',
      system: 'Android',
      uuid: '493dd9174941ed58waitForOpenWifi',
      vendor: 'Meross',
      version: '6.0',
    };
    return await MerossHTTPClient.authenticatedPost(
      MerossHTTPClient.LOG_URL,
      data
    );
  }
  /**
   * Asks to the HTTP api to list the Meross device belonging to the given user account.
   *
   * @returns {Promise<HTTPDeviceInfo[]>}
   */
  listDevices() {
    return MerossHTTPClient.authenticatedPost(
      MerossHTTPClient.DEV_LIST,
      {},
      this.cloudCreds
    );
  }

  /**
   *Returns the sub-devices associated to the given hub.
   *
   * @param {string} hubID Meross native UUID of the HUB
   * @returns {Promise<HttpSubDeviceInfo[]>}
   */
  listHubSubdevices(hubID) {
    return MerossHTTPClient.authenticatedPost(
      MerossHTTPClient.HUB_DUBDEV_LIST,
      { uuid: hubID },
      this.cloudCreds
    );
  }
}
