import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';

import { makeLogger } from '../envTest.mjs';

const logger = makeLogger();

const axiosInstance = axios.create({
  withCredentials: true,
  timeout: 10000,
});

axiosInstance.interceptors.response.use(function (response) {
  const cType = response.headers['content-type'];
  if (cType.includes('charset=ISO-8859-1')) {
    const jsonData = JSON.parse(Buffer.from(response.data).toString('latin1'));
    response.data = jsonData;
  }
  return response;
});

export default function authTools() {
  authTools.createSignature = function (payload) {
    if (!process.env.PRIVATE_KEY_ADDRESS) {
      throw Error('Private address is not set');
    }
    const private_key = fs.readFileSync(process.env.PRIVATE_KEY_ADDRESS, 'utf8');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(payload);
    signer.end();

    return signer.sign(private_key);
  };

  authTools.refreshToken = async function (req, userInfo, signature, uuid) {
    const expiredDate = new Date(userInfo.expires);
    expiredDate.setMinutes(expiredDate.getMinutes() - 10);
    const thisDate = new Date();
    if (thisDate >= expiredDate) {
      // logger.info(`Token expired ${expiredDate}. Refreshing and storing to session...`);
      try {
        const userData = await this.returnRefreshUser(signature, uuid, userInfo);

        // logger.info('Refreshed token. Cacing to session.');

        req.session.serverUserInfo = userData.data;

        return userData.data;
      } catch (err) {
        const msg = `Failed to refresh token: ${err.message}`;
        // logger.error(msg);
        throw new Error(msg);
      }
    }
    // logger.info('Token is not refreshed');
    return userInfo;
  };

  authTools.refreshNotCacheToken = async function (userInfo, signature, uuid) {
    const expiredDate = new Date(userInfo.expires);
    expiredDate.setMinutes(expiredDate.getMinutes() - 10);
    const thisDate = new Date();
    if (thisDate >= expiredDate) {
      logger.info(`Userdata token expired ${expiredDate}. Refreshing...`);
      try {
        const userData = await this.returnRefreshUser(signature, uuid, userInfo);

        // logger.info('Refreshed token. NOT caching to session.');

        return { tokenData: userData.data, ...{ refresh: true } };
      } catch (err) {
        const msg = `Failed to refresh token: ${err.message}`;
        // logger.error(msg);
        throw new Error(msg);
      }
    }
    // logger.info('Token is not refreshed');
    return { tokenData: userInfo, ...{ refresh: false } };
  };

  authTools.returnUser = async function (signature, uuid, token) {
    const user = await axiosInstance.post(
      `${process.env.TOKEN_API_SERVER_ADDRESS}`,
      {
        signature: signature,
        nonce: uuid,
      },
      {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Basic ${token}`,
        },
      }
    );

    return user;
  };

  authTools.returnRefreshUser = async function (signature, uuid, userInfo) {
    const refreshUser = await axiosInstance.post(
      `${process.env.TOKEN_API_SERVER_ADDRESS}`,
      {
        signature: signature,
        nonce: uuid,
        refresh: userInfo.refreshToken,
      },
      {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${userInfo.refreshToken}`,
        },
      }
    );
    return refreshUser;
  };

  return authTools;
}
