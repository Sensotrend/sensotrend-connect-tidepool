import crypto from 'crypto';
import sinon from 'sinon';
import 'chai/register-should.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

import envModule from '../../envTest.mjs';
import _FHIRClient from '../../lib/FHIRClient.mjs';
import ProfileModel from './../models/tidepoolUserProfile.model.mjs';
import UploaderDataset from './../models/tidepoolUploaderDataset.model.mjs';
import TidepoolTokenHandler from './../models/tidepoolTokenHandler.model.mjs';
import DataSetTempStorage from './../models/dataSetTempStorage.model.mjs';
import TidepoolUploaderDataset from './../models/tidepoolUploaderDataset.model.mjs';
import User from './../models/user.model.mjs';

import TidepoolPluginService, { authTools } from '../../lib/TidepoolRESTPlugin.mjs';
import uploadToService from '../../lib/uploadToServices.mjs';

const env = envModule();
const Auth = env.userProvider;
const siteId = 'foo';
const pw = 'bar';

const fhirserver = 'http://hapi.fhir.org/baseDstu3';
const FHIRClient = _FHIRClient(fhirserver, { env });

const UUID = uuidv4();

function generateToken({ stringBase = 'base64', byteLength = 48 } = {}) {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(byteLength, (err, buffer) => {
      if (err) {
        reject(err);
      } else {
        resolve(buffer.toString(stringBase));
      }
    });
  });
}

const d = new Date();
const tokenExpiryTimeInFuture = new Date(d.getTime() + 100000);

const testPatient = {
  resourceType: 'Patient',
  text: {
    status: 'generated',
    div:
      '<div xmlns="http://www.w3.org/1999/xhtml"><table class="hapiPropertyTable"><tbody><tr><td>Identifier</td><td>urn:uuid:' +
      UUID +
      '</td></tr></tbody></table></div>',
  },
  identifier: [
    {
      system: 'urn:ietf:rfc:3986',
      value: 'urn:uuid:' + UUID,
    },
  ],
};

let patient;

describe('Tidepool API testing', function () {
  let tidepoolPluginService;

  before(async function () {
    console.log('Cleaning tidepoolToken handler');
    await ProfileModel.deleteMany();
    await TidepoolTokenHandler.deleteMany();
    await DataSetTempStorage.deleteMany();
    await TidepoolUploaderDataset.deleteMany();
    await User.deleteMany();
  });

  after(function () {
    console.log('The mongoDatabase cleaning');
  });

  it('should create a sample patient and data to FHIR sandbox', async function () {
    try {
      console.log('CREATING PATIENT');
      const results = await FHIRClient.createRecords(testPatient);
      patient = results.records[0];
    } catch (error) {
      console.error(error);
      false.should.equal(true);
    }
  });

  describe('CGM record', () => {
    let results;
    let body;
    const result = {
      name: 'Testi',
      accessToken: 'fsdfsd',
      refreshToken: 'sfafasfa',
      email: 'foo@bar.com',
      expires: '2040-12-16T07:32:01.041+00:00',
      userid: 3,
      user: UUID,
      server: 'env.FHIRServer',
    };

    describe('Get result from Tidepool API', () => {
      let tidepoolServer;
      let responseObject;

      before(function () {
        const api = express();

        tidepoolPluginService = TidepoolPluginService(
          {
            ProfileModel,
            UploaderDataset,
            DataSetTempStorage: DataSetTempStorage,
            TidepoolTokenHandler,
          },
          env
        );

        api.use(function (req, res, next) {
          req.session = {};
          next();
        });
        api.use('/tpupload', tidepoolPluginService.uploadApp);
        api.use('/tpapi', tidepoolPluginService.APIapp);
        api.use('/tpdata', tidepoolPluginService.dataApp);

        tidepoolServer = api.listen(1300);

        responseObject = {
          statusCode: 200,
          headers: {
            'content-type': 'application/json',
          },
        };
        console.log('CREATING Tidepool API');
      });

      after(function () {
        tidepoolServer.close(() => {
          console.log('Tidepool API testing and close server');
        });
      });

      it('should authenticate over Tidepool API and upload a CGM record', function (done) {
        Auth.createUser(patient.id, siteId, pw, tokenExpiryTimeInFuture)
          .then((data) => {
            const u = data;
            u.email = 'foo@bar.com';

            u.save().catch((e) => {
              console.log(`Error is ${e}`);
              done(e);
            });

            console.log('User for Tidepool API TEST', u);

            sinon.stub(authTools, 'createSignature').returns('test');

            sinon.stub(authTools, 'returnUser').callsFake(async () => {
              generateToken({ stringBase: 'hex', byteLength: 12 })
                .then((data) => {
                  result.accessToken = data;
                })
                .catch((e) => {
                  console.log(`Error is ${e}`);
                });
              return { data: result };
            });

            request(tidepoolServer)
              .post('/tpapi/auth/login')
              .auth(u.email, u.site_secret)
              .set(responseObject)
              .expect(200)
              .end(function (err, res) {
                if (err) {
                  done(err);
                }

                authTools.returnUser.restore();
                authTools.createSignature.restore();
                body = res.body;
                results = res;
                res.status.should.equal(200);
                res.headers.should.to.have.property('content-type');
                done();
              });
          })
          .catch((e) => {
            console.log(`Error is ${e}`);
            done(e);
          }); // sub, access_token, refresh_token,token_expiry_date
      });
    });

    describe('Use records in CGM', () => {
      let cgmServer;
      let responseObject;

      before(function () {
        const api = express();

        tidepoolPluginService = TidepoolPluginService(
          {
            ProfileModel,
            UploaderDataset,
            DataSetTempStorage: DataSetTempStorage,
            TidepoolTokenHandler,
          },
          env
        );

        api.use(function (req, res, next) {
          Object.assign(body, {
            expires: result.expires,
            accessToken: uuidv4(),
          });

          req.session = {
            serverUserInfo: body,
            touch: () => {
              console.log('Touched');
            },
          };
          next();
        });
        api.use('/tpupload', tidepoolPluginService.uploadApp);
        api.use('/tpapi', tidepoolPluginService.APIapp);
        api.use('/tpdata', tidepoolPluginService.dataApp);

        cgmServer = api.listen(1300);

        responseObject = {
          statusCode: 200,
          headers: {
            'content-type': 'application/json',
          },
        };
        console.log('CREATING CGM Server');
      });

      after(function () {
        cgmServer.close(() => {
          console.log('Tidepool API testin and close server');
        });
      });

      it('should authenticate over Tidepool API and upload a CGM record', function (done) {
        const HEADER = 'x-tidepool-session-token';

        const authHeader = results.headers[HEADER];
        const userID = results.body.userid;

        let tide_sample = [
          {
            time: '2018-10-22T06:32:42.000Z',
            timezoneOffset: 120,
            clockDriftOffset: 0,
            conversionOffset: 0,
            deviceTime: '2018-10-22T08:32:42',
            deviceId: 'DexG5MobRec_SM74021055',
            type: 'cbg',
            value: 127,
            units: 'mg/dL',
            payload: {
              trend: 'Flat',
              internalTime: '2018-10-22T15:32:43',
              transmitterTimeSeconds: 887679,
              noiseMode: 'Clean',
              logIndices: [309454363],
            },
            uploadId: 'upid_5bd26e3593d8',
            guid: 'bb53c910-d03a-4fd6-b589-44260bd7c0d1',
          },
        ];

        sinon.stub(authTools, 'createSignature').returns('test');

        sinon.stub(authTools, 'returnUser').callsFake(async () => {
          generateToken({ stringBase: 'hex', byteLength: 12 })
            .then((data) => {
              result.accessToken = data;
            })
            .catch((e) => {
              console.log(`Error is ${e}`);
            });
          return { data: result };
        });

        sinon.stub(TidepoolTokenHandler, 'findOneAndRemove').callsFake(() => {
          return {
            access_token: 'bad61fc5cac60b44c7fe3acf',
            refresh_token: 'sfafasfa',
            token_expiry_date: '2021-12-16T07:32:01.041+00:00',
            email: 'foo@bar.com',
            user_id: 'daf864c0-3b4f-4338-8f59-d71401c7a261',
            userId: '8341f68c-a023-4253-ae61-68a2a69612e7',
            create_date: '2020-12-20T07:40:57.088+00:00',
          };
        });

        sinon.stub(TidepoolTokenHandler, 'create').callsFake(() => {});

        sinon.stub(jwt, 'decode').callsFake((token) => {
          return { sub: token };
        });

        const singleUploadResults = {
          created: 0,
          skipped: 0,
          errors: 0,
          records: [],
          latestDates: {},
        };

        sinon.stub(uploadToService, 'fhirUpload').callsFake(async (record, uploadResults) => {
          console.log('Capture upload');
          // eslint-disable-next-line no-unused-vars
          uploadResults = singleUploadResults;
        });

        Object.assign(responseObject.headers, {
          'x-tidepool-session-token': authHeader,
        });

        request(cgmServer)
          .post('/tpupload/data/' + userID)
          .set(responseObject)
          .send(tide_sample)
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function (err, res) {
            if (err) {
              done(err);
            }

            authTools.returnUser.restore();
            authTools.createSignature.restore();
            TidepoolTokenHandler.findOneAndRemove.restore();
            TidepoolTokenHandler.create.restore();
            jwt.decode.restore();
            uploadToService.fhirUpload.restore();

            console.log('GOT VALID DATA', res.body);
            res.body.success.should.equal(1);
            done();
          });
      });
    });
  });

  describe('pump data', () => {
    let pumpServer;
    let responseObject;
    let pumpBody;
    let pumpResult;
    let uploadId;
    const pumpResultData = {
      name: 'Testi',
      accessToken: 'fsdfsdffdde3444',
      refreshToken: 'sfafasfa',
      email: 'foo@bar.com',
      expires: '2040-12-16T07:32:01.041+00:00',
      userid: 3,
      user: UUID,
      server: 'env.FHIRServer',
    };

    before(function () {
      const api = express();

      tidepoolPluginService = TidepoolPluginService(
        {
          ProfileModel,
          UploaderDataset,
          DataSetTempStorage: DataSetTempStorage,
          TidepoolTokenHandler,
        },
        env
      );

      api.use(function (req, res, next) {
        pumpBody = {};
        Object.assign(pumpBody, {
          expires: pumpResultData.expires,
          accessToken: uuidv4(),
        });
        req.session = {
          serverUserInfo: pumpBody,
          touch: () => {
            console.log('Touched');
          },
        };
        next();
      });
      api.use('/tpupload', tidepoolPluginService.uploadApp);
      api.use('/tpapi', tidepoolPluginService.APIapp);
      api.use('/tpdata', tidepoolPluginService.dataApp);

      pumpServer = api.listen(1300);

      responseObject = {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
        },
      };
      console.log('CREATING CGM Server');
    });

    after(function () {
      pumpServer.close(() => {
        console.log('Tidepool API testing and close server');
      });
    });

    it('should authenticate over Tidepool API and upload pump data as a dataset', function (done) {
      let u;

      Auth.createUser(patient.id, siteId, pw, tokenExpiryTimeInFuture)
        .then((user) => {
          u = user;
          u.email = 'foo@bar.com';

          u.save().catch((e) => {
            console.log(`Error is ${e}`);
            done(e);
          });

          console.log('User for Tidepool API TEST', u);

          sinon.stub(authTools, 'createSignature').returns('test');

          sinon.stub(authTools, 'returnUser').callsFake(async () => {
            generateToken({ stringBase: 'hex', byteLength: 12 })
              .then((data) => {
                pumpResultData.accessToken = data;
              })
              .catch((e) => {
                console.log(`Error is ${e}`);
              });
            return { data: pumpResultData };
          });

          request(pumpServer)
            .post('/tpapi/auth/login')
            .auth(u.email, u.site_secret)
            .set(responseObject)
            .expect('Content-Type', /json/)
            .expect(200)
            .end((err, res) => {
              if (err) {
                done(err);
              }

              authTools.createSignature.restore();
              authTools.returnUser.restore();

              pumpBody = res.body;
              pumpResult = res;
              done();
            });
        })
        .catch((e) => {
          console.log(`Error when try to create user in pump test. Error code ${e}`);
          done(e);
        }); // sub, access_token, refresh_token,token_expiry_date
    }); // .expect('Content-Type', /json/)

    describe('Create new dataset', () => {
      const datasetStart = {
        type: 'upload',
        computerTime: '2019-05-07T10:19:13',
        time: '2019-05-07T10:19:13+03:00',
        timezoneOffset: 180,
        conversionOffset: 0,
        timezone: 'Europe/Helsinki',
        timeProcessing: 'utc-bootstrapping',
        version: '2.14.0-sensotrend',
        deviceTags: ['insulin-pump', 'cgm'],
        deviceManufacturers: ['Medtronic'],
        deviceModel: '1711',
        deviceSerialNumber: 'NG1112288H',
        deviceId: 'MMT-1711:NG1112288H',
        client: {
          name: 'org.tidepool.uploader',
          version: '2.14.0-sensotrend',
          private: { delta: { dataEnd: '2019-05-07T10:15:13.000Z' } },
        },
        deduplicator: {
          name: 'org.tidepool.deduplicator.device.deactivate.hash',
        },
      };

      after(() => {
        console.log('Create new dataset is ready to rock');
      });

      it('Test to create new dataset', (done) => {
        const HEADER = 'x-tidepool-session-token';

        const authHeader = pumpResult.headers[HEADER];
        const userID = pumpResult.body.userid;

        Object.assign(responseObject.headers, {
          'x-tidepool-session-token': authHeader,
        });

        request(pumpServer)
          .post('/tpdata/v1/users/' + userID + '/datasets')
          .set(responseObject)
          .send(datasetStart)
          .expect('Content-Type', /json/)
          .expect(201)
          .end((err, res) => {
            if (err) {
              done(err);
            }

            uploadId = res.body.data.uploadId;
            uploadId.should.be.a('string');
            console.log('Using uploadId', uploadId);
            done();
          });
      });
    });

    describe('Upload dataset', () => {
      const data = [
        {
          time: '2018-12-18T17:59:02.000Z',
          timezoneOffset: 180,
          clockDriftOffset: 0,
          conversionOffset: 0,
          deviceTime: '2018-12-18T20:59:02',
          deviceId: 'MMT-1711:NG1112288H',
          type: 'cbg',
          value: 102,
          units: 'mg/dL',
          payload: {
            interstitialSignal: 24.51,
            logIndices: [2184580913],
          },
        },
        {
          time: '2018-12-18T18:00:02.000Z',
          timezoneOffset: 180,
          clockDriftOffset: 0,
          conversionOffset: 0,
          deviceTime: '2018-12-18T21:00:02',
          deviceId: 'MMT-1711:NG1112288H',
          type: 'cbg',
          value: 101,
          units: 'mg/dL',
          payload: {
            interstitialSignal: 24.51,
            logIndices: [2184580913],
          },
        },
      ];

      after(() => {
        console.log('Upload dataset is ready');
      });

      it('Test to upload dataset', (done) => {
        const singleUploadResults = {
          created: 0,
          skipped: 0,
          errors: 0,
          records: [],
          latestDates: {},
        };

        sinon.stub(uploadToService, 'fhirUpload').callsFake(async (record, uploadResults) => {
          console.log('Capture upload');
          // eslint-disable-next-line no-unused-vars
          uploadResults = singleUploadResults;
        });

        sinon.stub(jwt, 'decode').callsFake((token) => {
          return { sub: token };
        });

        request(pumpServer)
          .post('/tpdata/v1/datasets/' + uploadId + '/data')
          .set(responseObject)
          .send(data)
          .expect('Content-Type', /json/)
          .expect(200)
          .end((err, res) => {
            if (err) {
              done(err);
            }

            uploadToService.fhirUpload.restore();
            jwt.decode.restore();

            console.log('GOT VALID DATA', JSON.stringify(res.body));
            done();
          });
      });
    });

    describe('FINALIZE dataset', () => {
      const finalize = { dataState: 'closed' };

      it('Test to finalize dataset', (done) => {
        request(pumpServer)
          .put('/tpdata/v1/datasets/' + uploadId)
          .set(responseObject)
          .send(finalize)
          .expect('Content-Type', /json/)
          .expect(200)
          .end((err, res) => {
            if (err) {
              done(err);
            }

            res.body.success.should.equal(1);
            done();
          });
      });
    });
  });
});
