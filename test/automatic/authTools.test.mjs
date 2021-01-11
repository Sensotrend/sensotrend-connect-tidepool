import sinon from 'sinon';
//import axios from 'axios';
import 'chai/register-should.js';
import { v4 as uuidv4 } from 'uuid';

import authToolsModule from '../../lib/authTools.mjs';

const authTools = authToolsModule();

const uuid = uuidv4();

const result = {
  name: 'Testi',
  accessToken: 'fsdfsd',
  refreshToken: 'sfafasfa',
  email: 'foo@bar.com',
  expires: '2040-12-16T07:32:01.041+00:00',
  userid: 3,
  user: uuid,
  server: 'env.FHIRServer',
};

const req = { session: { serverUserInfo: '' } };

const userInfo = {
  expires: '2019-12-16T07:32:01.041+00:00',
};
const token = Buffer.from(`${'TestUser'}:${'TestPassword'}`, 'utf8').toString('base64');
const signature = `${token} ${uuid}`;

describe('AuthTools testing', function () {
  let sinonSandbox;
  beforeEach(() => {
    sinonSandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sinonSandbox.restore();
  });

  it('CreateSignature test', () => {
    sinonSandbox.stub(authTools, 'createSignature').callsFake(function () {
      return signature;
    });

    const signatureBytes = authTools.createSignature();

    signatureBytes.should.to.equal(signature);
  });

  it('ReturnRefreshUser test', () => {
    sinonSandbox.stub(authTools, 'returnRefreshUser').callsFake(function () {
      return {
        refreshToken: result.refreshToken,
        accessToken: result.accessToken,
        expires: result.expires,
      };
    });

    const getRefreshedUser = authTools.returnRefreshUser();

    getRefreshedUser.should.to.deep.equal({
      refreshToken: result.refreshToken,
      accessToken: result.accessToken,
      expires: result.expires,
    });
  });

  it('RefreshToken test', async () => {
    sinonSandbox.stub(authTools, 'returnRefreshUser').callsFake(function () {
      return {
        data: {
          refreshToken: result.refreshToken,
          accessToken: result.accessToken,
          expires: result.expires,
        },
      };
    });

    const refreshTokenTest = await authTools.refreshToken(req, userInfo, signature, uuid);

    refreshTokenTest.should.to.deep.equal({
      refreshToken: result.refreshToken,
      accessToken: result.accessToken,
      expires: result.expires,
    });
  });
});
