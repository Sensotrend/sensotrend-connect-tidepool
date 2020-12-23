import fs from 'fs';
import crypto from 'crypto';
import axios from 'axios';

import { makeLogger } from '../envTest.mjs';

const logger = makeLogger();

const axiosIntance = axios.create({
  withCredentials: true,
  timeout: 1000,
});

axiosIntance.interceptors.response.use(function (response) {
  const ctype = response.headers['content-type'];
  if (ctype.includes('charset=ISO-8859-1')) {
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
    signer.end;

    return signer.sign(private_key);
  };

  authTools.refreshToken = async function (req, userInfo, signature, uuid) {
    //Muistiin, että tähän tulee vielä serverien varmentaminen
    const expiredDate = new Date(userInfo.expires);
    expiredDate.setMinutes(expiredDate.getMinutes() - 10);
    const thisDate = new Date();
    if (thisDate >= expiredDate) {
      logger.info('Token is refreshed');
      try {
        const userData = await this.returnResreshUser(signature, uuid, userInfo);

        logger.info('Token is refreshed');

        req.session.serverUserInfo = userData.data;

        return userData.data;
      } catch (err) {
        logger.error(`Cant't refresh token!`);
        throw new Error(`Cant't refresh token: ${err.message}`);
      }
    }
    logger.info('Token is not refreshed');
    return userInfo;
  };

  authTools.returnUser = async function (signature, uuid, token) {
    const user = await axiosIntance.post(
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

  authTools.returnResreshUser = async function (signature, uuid, userInfo) {
    const refreshUser = await axiosIntance.post(
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
