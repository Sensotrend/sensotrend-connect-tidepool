import fs from 'fs';
import express from 'express';
import decorateModule from '@awaitjs/express';
import basicAuthParser from 'basic-auth';
import bsonModule from 'bson';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import parseJwk from 'jose/jwk/parse';
import SignJWT from 'jose/jwt/sign';
import EncryptJWT from 'jose/jwt/encrypt';
import jwtVerify from 'jose/jwt/verify';

import authToolsModule from './authTools.mjs';
import uploadToModule from './uploadToServices.mjs';

export const authTools = authToolsModule();
export const uploadToService = uploadToModule();

const { serialize } = bsonModule;
const { decorateApp } = decorateModule;

const fsp = fs.promises;

export const batchSupported =
  process.env.BATCHSUPPORTED && process.env.BATCHSUPPORTED.toLowerCase() === 'true'; // TODO: check from capability statement! Or at least from ENV.

const SESSION_TOKEN_HEADER = 'x-tidepool-session-token';

const DEBUG_SAVE_FILE = process.env.DEBUG_SAVE_FILE ? process.env.DEBUG_SAVE_FILE : false;

function logEnabled() {
  return process.env.SERVER === 'localhost:1300';
}

function TidepoolRESTPlugin(models, env) {
  const logger = env.logger;
  const TidepoolRESTPlugin = decorateApp(express());

  async function aSaveFile(idString, contents) {
    const d = new Date();
    const n = d.getTime();

    const filePath = env.uploadPath + idString + '-' + n + '.json';

    try {
      await fsp.writeFile(filePath, JSON.stringify(contents));
      logger.info('File saved: ' + filePath);
    } catch (error) {
      logger.error(error);
    }
  }

  // JWT session validation
  async function sessionValidationRoute(req, res, next) {
    logger.info('Validating Uploader session');

    let userInfo;

    if (req.session.serverUserInfo) {
      userInfo = req.session.serverUserInfo;
    } else {
      userInfo = await models.TidepoolTokenHandler.findOne({
        userId: req.params.userId,
      }).then((data) => {
        return {
          refreshToken: data.refresh_token,
          accessToken: data.access_token,
          expires: data.token_expiry_date,
        };
      });
    }

    // check header or url parameters or post parameters for token

    // decode token
    if (userInfo) {
      //Update session express
      req.session.touch();

      try {
        const uuid = uuidv4();
        const signature = authTools
          .createSignature(`Bearer ${userInfo.refreshToken} || ${uuid}`)
          .toString('base64');
        const user = await authTools.refreshToken(req, userInfo, signature, uuid);

        if (req.headers[SESSION_TOKEN_HEADER] === userInfo.accessToken) {
          res.set(SESSION_TOKEN_HEADER, user.accessToken);
        }

        //findOne and delete old one and create new with new create_date
        const tokenData = await models.TidepoolTokenHandler.findOneAndRemove({
          $or: [
            { userId: req.params.userId ? req.params.userId : null },
            { user_id: userInfo.user },
          ],
        });

        await models.TidepoolTokenHandler.create({
          userId: tokenData ? tokenData.userId : null,
          user_id: user.user ? user.user : tokenData.user_id,
          email: user.email ? user.email : tokenData.email,
          access_token: user.accessToken ? user.accessToken : tokenData.access_token,
          refresh_token: user.refreshToken ? user.refreshToken : tokenData.refresh_token,
          token_expiry_date: user.expires ? user.expires : tokenData.token_expiry_date,
        });

        if (user) {
          const decoded = jwt.decode(user.accessToken);
          req.userInfo = decoded;

          logger.info(`Confirmed user ${decoded.sub}`);
          logger.debug(`decoded session ${JSON.stringify(decoded)}`);
          next();
        }
      } catch (e) {
        logger.error(`Uploader user is not validated ${e}`);
        return res.json({
          success: false,
          message: 'Failed to authenticate token.',
        });
      }
    } else {
      logger.error(`JWT validation error: ${JSON.stringify(req.headers)}`);

      // if there is no token
      // return an error
      return res.status(403).send({
        success: false,
        message: 'Problem validating session',
      });
    }
  }

  // REST SERVICES

  const uploadApp = decorateApp(express());
  // const uploadPort = 9122;

  // API call for info object to find out minimum uploader client version
  // This call is made as the first thing on client start and error is reported to user if missing
  //
  uploadApp.get('/info', (req, res) => {
    logger.info('/info requested');
    res.send({
      versions: {
        schema: 3,
        uploaderMinimum: '0.333.0',
      },
    });
  }); // information about what uploader version is required

  uploadApp.use(
    bodyParser.urlencoded({
      limit: '50mb',
      extended: true,
    })
  );

  uploadApp.use(
    bodyParser.json({
      limit: '50mb',
      extended: true,
    })
  );

  // POST to /data is used for data uploads from CGM and Glucometers
  // Note Libre does the batched dataset uploads
  uploadApp.use('/data', sessionValidationRoute);

  uploadApp.postAsync('/data/:userId', async function (req, res) {
    logger.info('Data upload to /data/:userId ' + req.params.userId);
    if (logEnabled()) {
      logger.info(JSON.stringify(req.body));
    }

    if (DEBUG_SAVE_FILE) {
      const fileName = req.userInfo.sessionToken + '-data-' + req.params.userId;
      logger.info('Saving data to ' + fileName);
      await aSaveFile(fileName, req.body);
    }

    const serverUserInfo = req.session.serverUserInfo;

    if (serverUserInfo) {
      await uploadToService.uploadRecordsAndUpdateResponse(serverUserInfo, req.body, res, env);
    } else {
      logger.error('User information missing');

      res.status(401).send('User information missing');
      return;
    }
  });

  TidepoolRESTPlugin.uploadApp = uploadApp;

  //
  // Data Server
  //
  // Data server, used for data uploads
  // Client creates a dataset and then sends blobs related to the dataset
  // This server is not sent any authentication tokens, it just acts as a data receiver
  // Any uploads thus need to be validated separately based on the created dataset
  //
  // Missing / TODO: the client seems to have detection for already uploaded datasets, need to check how that works
  //

  const dataApp = decorateApp(express());
  //dataApp.use(morgan('combined'));
  // const dataPort = 9220;

  dataApp.use(
    bodyParser.urlencoded({
      limit: '50mb',
      extended: true,
    })
  );

  dataApp.use(
    bodyParser.json({
      limit: '50mb',
      extended: true,
    })
  );

  // createDataset
  // This call is made to create a new dataset ID for the client. The uploads then happen using this uploadId
  dataApp.postAsync('/v1/users/:userId/datasets', async function (req, res) {
    logger.info('API CALL: createDataset, user: ' + req.params.userId);

    if (logEnabled()) {
      logger.info(JSON.stringify(req.body));
    }

    if (DEBUG_SAVE_FILE) {
      const d = new Date();
      const fileName = 'dataset-user-' + req.params.userId + '-createdataset-' + d.getTime();
      await aSaveFile(fileName, req.body);
    }

    const datasetID = env.randomString();

    const dataSet = new models.UploaderDataset({
      dataset_id: datasetID,
      user_id: req.params.userId,
      date: new Date(),
    });

    try {
      await dataSet.save();
      res.status(201).send({
        data: {
          uploadId: datasetID,
        },
      });
    } catch (error) {
      logger.error('Error creating dataset ' + error);
      res.status(500).send(error);
    }
  });

  async function saveSetTempStorage(serverUserInfo, dataset, reqBody) {
    const dataSetTempStorage = new models.DataSetTempStorage({
      access_token: serverUserInfo.accessToken,
      refresh_token: serverUserInfo.refreshToken,
      token_expiry_date: serverUserInfo.expires,
      dataset_id: dataset.dataset_id,
      deviceInformation: serialize(reqBody),
    });

    try {
      dataSetTempStorage.save();
    } catch (error) {
      logger.error(error);
    }
  }

  // uploads a dataset
  dataApp.postAsync('/v1/datasets/:datasetId/data', async function (req, res) {
    logger.info('Dataset upload: ' + req.params.datasetId);

    if (logEnabled()) {
      logger.info(JSON.stringify(req.body));
    }
    if (DEBUG_SAVE_FILE) {
      const fileName = 'dataset-' + req.params.datasetId + '-data';
      await aSaveFile(fileName, req.body);
    }

    const dataSet = await models.UploaderDataset.findOne({
      dataset_id: req.params.datasetId,
    });

    const serverUserInfo = req.session.serverUserInfo;

    if (dataSet && serverUserInfo) {
      if (
        process.env.USE_DATASET_TEMP_STORAGE !== undefined &&
        process.env.USE_DATASET_TEMP_STORAGE.toLowerCase() === 'true'
      ) {
        await saveSetTempStorage(serverUserInfo, dataSet, req.body);

        res.status(200).send({
          success: 1,
        });
      } else {
        await uploadToService.uploadRecordsAndUpdateResponse(
          serverUserInfo,
          req.body,
          res,
          env
        );
      }
    } else {
      res.status(404).send('Dataset not found');
    }
  });

  /// FINALIZE dataset
  dataApp.put('/v1/datasets/:datasetId', async function (req, res) {
    logger.info('API CALL: finalize dataset ' + req.params.datasetId);

    if (logEnabled()) {
      logger.info(JSON.stringify(req.body));
    }

    // TODO: DELETE DATASET
    if (DEBUG_SAVE_FILE) {
      const fileName = 'dataset-final-' + req.params.datasetId + '-finalize';
      await aSaveFile(fileName, req.body);
    }

    res.status(200).send({
      success: 1,
    });
  });

  //  Client loads the Server time from this URL
  dataApp.get('/v1/time', (req, res) => {
    logger.info('/time REQUEST');
    res.send({
      data: {
        time: new Date(),
      },
    });
  });

  // This presumaly should return the list of existing datasets about the user
  // TODO read client code to find out what's expected
  dataApp.get('/v1/users/:userId/data_sets', (req, res) => {
    logger.info('CLIENT REQUESTING DATASET LIST');

    if (logEnabled()) {
      logger.info('BODY: ' + JSON.stringify(req.body));
      logger.info('PARAMS: ' + JSON.stringify(req.params));
      logger.info('HEADERS: ' + JSON.stringify(req.headers));
    }

    res.send({
      success: 1,
    });
  });

  TidepoolRESTPlugin.dataApp = dataApp;

  //
  //// AUTHENTICATION SERVER
  //
  const app = decorateApp(express());

  app.use(
    bodyParser.urlencoded({
      limit: '50mb',
      extended: true,
    })
  );

  app.use(
    bodyParser.json({
      limit: '50mb',
      extended: true,
    })
  );

  // 2nd request
  // LOGIN using HTTP Basic Auth
  app.postAsync('/auth/login', async function (req, res) {
    logger.info('AUTHENTICATION');

    if (logEnabled()) {
      logger.info('BODY: ' + JSON.stringify(req.body));
      logger.info('PARAMS: ' + JSON.stringify(req.params));
      logger.info('HEADERS: ' + JSON.stringify(req.headers));
    }

    /*
      Tokenin hallinta tehdään erilaiseksi, kuin tässä tapauksessa.
      */

    const credentials = basicAuthParser(req);
    let response = {
      authentication: 'failed',
    };

    if (credentials.name === '') {
      logger.error('Email is not setted');
      res.status(400).send({
        message: 'Email is not setted!',
      });
      return;
    }

    if (credentials.pass === '') {
      logger.error('Password is missing');
      res.status(401).send({
        message: 'Password is missing!',
      });
      return;
    }

    const token = Buffer.from(`${credentials.name}:${credentials.pass}`, 'utf8').toString(
      'base64'
    );

    try {
      const uuid = uuidv4();
      const signatureBytes = authTools.createSignature(`Basic ${token} || ${uuid}`);
      const signature = signatureBytes.toString('base64');
      logger.info(`Signature length: ${signatureBytes.length}`);

      const user = await authTools.returnUser(signature, uuid, token);

      let tidepoolTokenHandler;
      const foundTokenHandler = await models.TidepoolTokenHandler.findOne({
        access_token: user.data.accessToken,
      });
      if (user.data) {
        if (!foundTokenHandler) {
          tidepoolTokenHandler = await models.TidepoolTokenHandler.create({
            access_token: user.data.accessToken,
            refresh_token: user.data.refreshToken,
            token_expiry_date: user.data.expires,
            email: user.data.email,
            user_id: user.data.user,
          });
        }

        response = {
          data: {
            name: user.data.name,
            accessToken: user.data.accessToken,
            expires: user.data.expires,
            userid: tidepoolTokenHandler.userId,
            server: env.FHIRServer, // TODO REMOVE
          },
          authentication: 'success',
        };
      }

      if (response.authentication == 'success') {
        logger.info('Auth response ' + JSON.stringify(response.data));

        if (!tidepoolTokenHandler) {
          tidepoolTokenHandler = await models.TidepoolTokenHandler.create({
            access_token: user.data.accessToken,
            refresh_token: user.data.refreshToken,
            token_expiry_date: user.data.expires,
            email: user.data.email,
            user_id: user.data.user,
          });
        }

        const sessionToken = env.randomString();
        response.data.sessionToken = sessionToken;

        res.set(SESSION_TOKEN_HEADER, user.data.accessToken);
        req.session.serverUserInfo = Object.assign({ email: user.data.email }, user.data);
        const r = {
          emailVerified: true,
          emails: [user.data.email],
          termsAccepted: '2019-03-07T15:40:09+02:00',
          userid: tidepoolTokenHandler.userId,
          username: user.data.name,
        };

        res.send(r);
      } else {
        logger.error('Authentication failed!\n' + JSON.stringify(response));
        res.status(401).json({
          message: 'Invalid Authentication Credentials',
        });
      }
    } catch (e) {
      logger.error('Authentication failed!\n' + JSON.stringify(e));
      res.status(401).json({
        message: 'Authentication failed',
      });
    }
  });

  // LOGIN with persisted token from Remember Me
  app.getAsync('/auth/user', sessionValidationRoute, async function (req, res) {
    logger.info('REMEMBER ME REQUEST');

    const token = req.headers[SESSION_TOKEN_HEADER]
      ? req.headers[SESSION_TOKEN_HEADER]
      : 'token';

    if (logEnabled()) {
      logger.info('BODY: ' + JSON.stringify(req.body));
      logger.info('PARAMS: ' + JSON.stringify(req.params));
      logger.info('HEADERS: ' + JSON.stringify(req.headers));
    }
    res.set(SESSION_TOKEN_HEADER, token);
    res.send({
      userid: req.userInfo.userid,
    });
  });

  // Remember Me login with token
  // Client also makes GET requests to /auth/login for some reason
  app.getAsync('/auth/login', sessionValidationRoute, async function (req, res) {
    logger.info('GET /auth/login');

    if (logEnabled()) {
      logger.info('BODY: ' + JSON.stringify(req.body));
      logger.info('PARAMS: ' + JSON.stringify(req.params));
      logger.info('HEADERS: ' + JSON.stringify(req.headers));
    }

    const userData = req.session.serverUserInfo;

    if (userData) {
      const user = jwt.decode(userData.accessToken);

      const response = {
        data: {
          name: userData.name,
          userid: user.sub,
        },
        authentication: 'success',
      };

      logger.info(JSON.stringify(response.data));

      const sessionToken = env.randomString();
      response.data.sessionToken = sessionToken;

      const token = userData.accessToken;
      const userId = response.data.userid;

      logger.info('Authenticating user ' + userId);

      res.set(SESSION_TOKEN_HEADER, token);

      const r = {
        emailVerified: true,
        emails: [userData.email],
        termsAccepted: '2019-03-07T15:40:09+02:00',
        userid: userId,
        username: userData.name,
      };

      res.send(r);
    } else {
      logger.error('Authentication failed!\n' + JSON.stringify(userData));
      res.status(401).json({
        message: 'Invalid Authentication Token',
      });
    }
  });

  /*
   {"emails":["foo@bar.com"],"fullName":"PatientName1","patient":{"targetTimezone":"Europe/Helsinki","targetDevices":["dexcom","omnipod","medtronic600","medtronic","tandem","abbottfreestylelibre","bayercontournext","animas","onetouchverio","truemetrix","onetouchultra2","onetouchultramini","onetouchverioiq"]}}

   const p = {
      emails: ['foo@bar.com'],
      fullName: 'Patient1',
      patient: {
         'about': 'This is the about text for the PWD.',
         'birthday': '1997-01-01',
         'diagnosisDate': '1999-01-01',
         targetTimezone: 'Europe/Helsinki',
         targetDevices: ['dexcom', 'medtronic', 'bayercontournext']
      }
   };
   */

  function profileCreateMiddleware(req, res, next) {
    const profile = {
      fullName: req.session.serverUserInfo.name,
      name: req.session.serverUserInfo.name,
      email: req.session.serverUserInfo.email,
      patient: {
        birthday: '1900-01-01',
        diagnosisDate: '1900-01-01',
        diagnosisType: 'type1',
        targetDevices: [],
        targetTimezone: 'Europe/Helsinki',
      },
    };
    req.profile = profile;

    next();
  }

  //   {userid: 'jkl012', profile: {fullName: 'Jane Doe', patient: { birthday: '2010-01-01' }}}
  //  {"emails":["foo@bar.com"],"fullName":"PatientName1","patient":{"targetTimezone":"Europe/Helsinki","targetDevices":["dexcom","omnipod","medtronic600","medtronic","tandem","abbottfreestylelibre","bayercontournext","animas","onetouchverio","truemetrix","onetouchultra2","onetouchultramini","onetouchverioiq"]}}

  // 3rd request
  // this gets sent the token back
  app.getAsync(
    '/metadata/:userId/profile',
    profileCreateMiddleware,
    async function (req, res) {
      logger.info(
        'Profile data request: /metadata/:userId/profile for id ' + req.params.userId
      );
      const profile = req.profile;
      if (logEnabled()) {
        logger.info(JSON.stringify(profile));
      }

      const systemUserId = req.session.serverUserInfo.user;

      logger.info(`System userid: ${systemUserId}`);

      const _tokenHandler = await models.TidepoolTokenHandler.findOne({
        userId: req.params.userId,
      });

      const user = systemUserId ? systemUserId : _tokenHandler.user_id;

      const _profile = await models.ProfileModel.findOne({
        user_id: user,
      });

      let p = profile;

      if (_profile) {
        p = {
          fullName: req.session.serverUserInfo.name,
          patient: _profile,
        };
        logger.info('Profile found, returning ', JSON.stringify(p));
      } else {
        logger.info('Returning default profile', JSON.stringify(p));
      }

      res.send(p);
    }
  );

  // group id == PWD id
  // TODO: find out what the format really is
  /*
   const g = [
      {
         upload: true,
         root: false,
         id: 0,
         groupid: 0
      }, {
         upload: true,
         root: false,
         id: 1,
         groupid: 1
      }
   ];
   */

  // 4th request
  // Return a list of patients the user is allowed to upload to
  app.get('/access/groups/:userid', (req, res) => {
    logger.info(
      'Giving list of PWDs this account manages: /access/groups/:userid ' + req.params.userid
    );

    // Default to single patient profiles for now
    const r = {};
    r[req.params.userid] = { root: {} };

    res.send(r);
  });

  // Return a profile for the ID
  app.get('/metadata/:userId/profile', profileCreateMiddleware, (req, res) => {
    logger.info('/metadata/:userId/profile request for ID NONDYNAMIC' + req.params.userId);
    res.send(req.profile);
  });

  // Client sends updated profile with selected devices, as chosen in the UI
  app.putAsync(
    '/metadata/:userId/profile',
    profileCreateMiddleware,
    async function (req, res) {
      // send back the edited profile, client loads this
      logger.info('Client PUT for /metadata/:userId/profile ' + req.params.userId);

      const profile = req.profile;

      if (logEnabled()) {
        logger.info('BODY: ' + JSON.stringify(req.body));
        logger.info('PARAMS: ' + JSON.stringify(req.params));
        logger.info('HEADERS: ' + JSON.stringify(req.headers));
      }

      const systemUserId = req.session.serverUserInfo.user;

      logger.info(`System userid: ${systemUserId}`);

      const _tokenHandler = await models.TidepoolTokenHandler.findOne({
        userId: req.params.userId,
      });

      const user = systemUserId ? systemUserId : _tokenHandler.user_id;

      // Update model here
      const _profile = await models.ProfileModel.findOne({
        user_id: user,
      });

      if (_profile) {
        _profile.targetDevices = req.body.patient.targetDevices;
        await _profile.save();
      } else {
        let p = new models.ProfileModel({
          user_id: user,
          birthday: '1900-01-01',
          diagnosisDate: '1900-01-01',
          diagnosisType: 'type1',
          targetDevices: req.body.patient.targetDevices,
          targetTimezone: req.body.patient.targetTimezone,
        });

        try {
          await p.save();
        } catch (error) {
          logger.error('Error persisting profile ' + JSON.stringify(error));
        }
      }

      res.send(profile);
    }
  );

  // Just ignore metrics calls for now; don't know why some are sent with GET and some as POST
  app.post('/metrics/', (req, res) => {
    logger.info('/metrics');
    if (logEnabled()) {
      logger.info('BODY: ' + JSON.stringify(req.body));
      logger.info('PARAMS: ' + JSON.stringify(req.params));
      logger.info('HEADERS: ' + JSON.stringify(req.headers));
    }
    res.send({
      success: 1,
    });
  });

  // Just ignore metrics calls for now;  don't know why some are sent with GET and some as POST
  app.get('/metrics/', (req, res) => {
    logger.info('/metrics');

    if (logEnabled()) {
      logger.info('BODY: ' + JSON.stringify(req.body));
      logger.info('PARAMS: ' + JSON.stringify(req.params));
      logger.info('HEADERS: ' + JSON.stringify(req.headers));
    }

    res.send({
      success: 1,
    });
  });

  app.get('/metrics/thisuser/uploader*', (req, res) => {
    logger.info('/metrics/thisuser');

    if (logEnabled()) {
      logger.info('BODY: ' + JSON.stringify(req.body));
      logger.info('PARAMS: ' + JSON.stringify(req.params));
      logger.info('HEADERS: ' + JSON.stringify(req.headers));
    }

    res.send({
      success: 1,
    });
  });

  // logout is also sent here with POST
  app.post('/auth/logout', async (req, res) => {
    try {
      logger.info(
        '/auth/logout: session ' + req.headers[SESSION_TOKEN_HEADER] + ' logged out'
      );

      if (req.headers[SESSION_TOKEN_HEADER]) {
        const deleteTidepoolHandler = await models.TidepoolTokenHandler.findOneAndRemove({
          access_token: req.headers[SESSION_TOKEN_HEADER],
        });

        const { iat, exp } = jwt.decode(deleteTidepoolHandler.access_token);

        logger.info(`Deleted tidepoolTokenHandler row: iat: ${iat} exp: ${exp} `);
      }
    } catch (err) {
      logger.error(`Error when logout: ${err.message}`);
    }

    res.send({
      success: 1,
    });
  });

  // for some reason the pump upload blobs come here
  app.post('/v1/users/:userId/blobs', async function (req, res) {
    logger.info('DATA BLOB upload');

    if (logEnabled()) {
      logger.info('BODY: ' + JSON.stringify(req.body));
      logger.info('PARAMS: ' + JSON.stringify(req.params));
      logger.info('HEADERS: ' + JSON.stringify(req.headers));
    }

    if (DEBUG_SAVE_FILE) {
      const d = new Date();
      const fileName = 'blob-userid-' + req.params.userId + '-' + d.getTime();
      await aSaveFile(fileName, req.body);
    }

    res.status(200).send({
      success: 1,
    });
  });

  app.get('/metadata/users/:userId/users', (req, res) => {
    logger.info('CLIENT REQUESTING METADA FROM USER');

    if (logEnabled()) {
      logger.info('BODY: ' + JSON.stringify(req.body));
      logger.info('PARAMS: ' + JSON.stringify(req.params));
      logger.info('HEADERS: ' + JSON.stringify(req.headers));
    }

    res.send({
      success: 1,
    });
  });

  // apply the routes to our application with the prefix /api
  app.use('/metadata/*', sessionValidationRoute);

  TidepoolRESTPlugin.APIapp = app;

  //
  //// AUTHENTICATION SERVER
  //
  const root = decorateApp(express());

  root.use(
    bodyParser.urlencoded({
      limit: '50mb',
      extended: true,
    })
  );

  root.use(
    bodyParser.json({
      limit: '50mb',
      extended: true,
    })
  );

  function getTransferKey(fileAddress) {
    try {
      return fs.readFileSync(fileAddress, 'utf8');
    } catch (error) {
      throw new Error(error.message);
    }
  }

  async function verifySignature(jwt) {
    try {
      const publicKey = await parseJwk(
        getTransferKey(process.env.TRANSFER_PUBLIC_KEY),
        'ECDH-ES+A128KW'
      );

      const { payload, protectedHeader } = await jwtVerify(jwt, publicKey);

      logger.info(
        `Payload: ${JSON.stringify(payload)} and procetectedHeader: ${JSON.stringify(
          protectedHeader
        )}`
      );
    } catch {
      logger.error('Verification failed');
      return false;
    }

    return true;
  }

  async function transferApi(userData, res) {
    logger.info('Creating a session transfer token and redirect to api');

    try {
      const privateKey = await parseJwk(
        getTransferKey(process.env.TRANSFER_PRIVATE_KEY),
        'ECDH-ES+A128KW'
      );
      const jwt = new SignJWT({
        sub: userData.fullName,
        name: userData.name,
        email: userData.email,
      });
      jwt.setProtectedHeader({ alg: 'ES256' });
      jwt.setIssuedAt();
      jwt.setIssuer('sensotrend-connect');
      jwt.setAudience('sensotrend-api');
      jwt.setExpirationTime('1m');
      const jwtAnswer = await jwt.sign(privateKey);

      const publicKey = parseJwk(
        getTransferKey(process.env.TRANSFER_PUBLIC_KEY),
        'ECDH-ES+A128KW'
      );
      const encryptJWT = new EncryptJWT(jwtAnswer);
      encryptJWT.setProtectedHeader({
        alg: 'ECDH-ES+A128KW',
        enc: 'A128CBC-HS256',
        cty: 'jwt',
      });
      const encrypt = await encryptJWT.encrypt(publicKey);

      logger.info('Encypted', encrypt);
      res.status(303);
      res.setHeader(
        'Location',
        `https://localhost:8443/api/session?redirect=${encodeURIComponent(
          'https://localhost:8443/dashboard/agp/'
        )}&token=${encrypt}`
      );
      res.end();
    } catch (error) {
      throw new Error(JSON.stringify(error));
    }
  }

  root.postAsync('/user/information/verify', async (req, res) => {
    const { jwt, userId } = req.data;

    if (verifySignature(jwt)) {
      try {
        const tokenData = await models.TidepoolTokenHandler.findOne({ userId: userId });

        return res.status(200).send({
          userId: tokenData.user_id,
        });
      } catch (error) {
        logger.error('Failed to take data from collection');

        return res.status(403).send({
          message: 'Problem when find data in collection',
        });
      }
    } else {
      logger.error('Verification failed ');

      return res.status(403).send({
        message: 'Problem validating session',
      });
    }
  });

  root.getAsync('/patients/:userId/data', sessionValidationRoute, async (req, res) => {
    logger.info('GET /patients/:userId/data');

    if (logEnabled()) {
      logger.info('BODY: ' + JSON.stringify(req.body));
      logger.info('PARAMS: ' + JSON.stringify(req.params));
      logger.info('HEADERS: ' + JSON.stringify(req.headers));
    }

    const userData = req.session.serverUserInfo;

    try {
      return transferApi(userData, res);
    } catch (error) {
      logger.error(`transfer api error: ${error}`);
      res.status(403).send({ error: 'Error when try to move user to dashboard' });
    }
  });

  //apiRoot is using sensotrend-connect. This is for uploader when user press button and  move to own the dashboard.
  TidepoolRESTPlugin.apiRoot = root;

  return TidepoolRESTPlugin;
}

export default TidepoolRESTPlugin;
