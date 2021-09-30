import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import _FHIRClient from './FHIRClient.mjs';
import { makeLogger } from '../envTest.mjs';
import authTools from './authTools.mjs';

const logger = makeLogger();

const SKIP_OLD_RECORDS = process.env.SKIP_OLD_RECORDS || true;

const chunkSize = 1000;

const batchSupported =
  process.env.BATCHSUPPORTED && process.env.BATCHSUPPORTED.toLowerCase() === 'true';

async function createSignatureAndRefreshToken(userInfo) {
  try {
    const uuid = uuidv4();
    const signature = authTools
      .createSignature(`Bearer ${userInfo.refreshToken} || ${uuid}`)
      .toString('base64');
    return await authTools.refreshNotCacheToken(userInfo, signature, uuid);
  } catch (error) {
    throw new Error(JSON.stringify(error));
  }
}

async function findTokenData(models, userInfo) {
  try {
    return await models.TidepoolTokenHandler.findOneAndRemove({ user_id: userInfo.user });
  } catch (error) {
    throw new Error(JSON.stringify(error));
  }
}

async function saveNewUserTidepoolToken(models, user) {
  try {
    await models.TidepoolTokenHandler.create({
      user_id: user.user,
      email: user.email,
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
      token_expiry_date: user.expires,
      name: user.name,
    });
  } catch (error) {
    throw new Error(JSON.stringify(error));
  }
}

export default function uploadToService() {
  //{email:, password: , generated own code}
  uploadToService.uploadRecordsAndUpdateResponse = async function (
    models,
    serverUserInfo,
    data,
    res,
    env
  ) {
    const DataFormatConverter = env.dataFormatConverter;
    const token = serverUserInfo.accessToken;
    const user = jwt.decode(serverUserInfo.accessToken);

    const FHIRClient = {
      server: new _FHIRClient(env.FHIRServer, {
        patient: user.sub,
        bearertoken: token,
        env,
      }),
    };
    const patientRef = user.sub;

    const converterOptions = {
      source: 'tidepool',
      target: 'fiphr',
      FHIR_userid: patientRef, // Needed for FHIR conversion
    };

    if (SKIP_OLD_RECORDS) {
      const latestDeviceDates = await env.lastSeenService.getLatestDates(patientRef);

      if (latestDeviceDates) {
        converterOptions.skipRecordsUsingDates = latestDeviceDates;
      }
    }
    logger.info('Got records for uploading, converting, ' + data.length);

    const records = await DataFormatConverter.convert(data, converterOptions);
    logger.info('Got records for uploading, count:' + records.length);
    logger.info('-------------RECORDS with stringify---------------');
    logger.info(JSON.stringify(records));
    logger.info('---------------------------------');

    const uploadResults = {
      created: 0,
      skipped: 0,
      errors: 0,
      records: [],
      latestDates: {},
    };

    if (!records.length) {
      logger.info('No data to upload: ' + JSON.stringify(records));
      uploadResults.success = 1;
      res.send(uploadResults);
      return;
    }

    res.setHeader('Content-Type', 'application/fhir+json; charset=UTF-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Writing JSON structure fragments by hand is a little iffy, but it will let us
    // actually send something every time a record is submitted.
    const promises = [];
    res.write('{"records": [');
    for (let i = 0; i < records.length / chunkSize; i += 1) {
      const chunk = records.slice(i * chunkSize, i * chunkSize + chunkSize);
      if (records.length > 1 && batchSupported) {
        promises.push(
          uploadToService.uploadBatch(FHIRClient.server, chunk, uploadResults, res, i)
        );
      } else {
        logger.info('Not using batch, records: ' + JSON.stringify(records));

        for (const record of records) {
          const checkNotCacheToken = await createSignatureAndRefreshToken(serverUserInfo);

          if (checkNotCacheToken.refresh) {
            const tokenNew = checkNotCacheToken.tokenData.accessToken;
            const subUser = checkNotCacheToken.tokenData.sub;
            FHIRClient.server = new _FHIRClient(env.FHIRServer, {
              patient: subUser.sub,
              bearertoken: tokenNew,
              env,
            });

            logger.info('Updated serverUserInfo');
            serverUserInfo.accessToken = checkNotCacheToken.tokenData.accessToken;
            serverUserInfo.expires = checkNotCacheToken.tokenData.expires;
            serverUserInfo.refreshToken = checkNotCacheToken.tokenData.refreshToken;
            serverUserInfo.sub = checkNotCacheToken.tokenData.sub;
            try {
              await findTokenData(models, serverUserInfo);
              await saveNewUserTidepoolToken(models, serverUserInfo);
            } catch (error) {
              logger.error(
                `Error when remove or save tidepoolToken. Error is ${JSON.stringify(error)}`
              );
            }
          }

          logger.info('Processing record: ' + JSON.stringify(record));
          const recordId = record.identifier[0].value;
          logger.info('Starting to send record ' + recordId);
          logger.debug(JSON.stringify(record));
          const singleUploadResults = {
            created: 0,
            skipped: 0,
            errors: 0,
            records: [],
            latestDates: {},
          };
          try {
            await uploadToService.fhirUpload(FHIRClient.server, record, singleUploadResults);
            logger.info('Record sent. Result: ' + JSON.stringify(singleUploadResults));
            if (singleUploadResults.errors === 0) {
              let result = '';
              const r = singleUploadResults.records[0];
              if (r && r.response && r.response.location) {
                result = r.response.location;
              }
              res.write(
                (uploadResults.records.length > 0 ? ',' : '') + JSON.stringify(result)
              );
              uploadResults.records.push(r);
              uploadResults.created += singleUploadResults.created;
              uploadResults.skipped += singleUploadResults.skipped;
              logger.info(
                'Sent record ' + recordId + ', result: ' + JSON.stringify(singleUploadResults)
              );
            } else {
              logger.warn(
                'Failed sending record ' +
                  recordId +
                  ', result: ' +
                  JSON.stringify(singleUploadResults)
              );
              logger.warn('Results: ' + JSON.stringify(uploadResults));
              uploadResults.errors += 1;
            }
            promises.push(Promise.resolve(singleUploadResults));
          } catch (error) {
            logger.warn('Error sending record ' + recordId + ': ' + JSON.stringify(error));
            promises.push(Promise.reject(error));
          }
        }
      }
    }
    Promise.all(promises)
      .catch((error) => {
        logger.warn('Failed uploading records:\n' + JSON.stringify(error));
      })
      .then(() => {
        logger.info('Sent records ' + JSON.stringify(uploadResults.records));
        res.write('],');
        res.write(`"created": ${uploadResults.created},`);
        res.write(`"skipped": ${uploadResults.skipped},`);
        /*
       res.write(`"errors": ${uploadResults.errors},`);
       res.write(`"success": ${JSON.stringify(uploadResults.errors.length === 0) ? 1 : 0}}`);
       */
        res.write('"errors": 0,');
        res.write('"success": 1}');
        res.end();
      });
  };

  uploadToService.fhirUpload = async function (FHIRClient, record, singleUploadResults) {
    return await FHIRClient.upload(record, singleUploadResults);
  };

  uploadToService.uploadBatch = function (FHIRClient, chunk, uploadResults, res, i) {
    return FHIRClient.uploadBatch(chunk)
      .then((chunkResults) => {
        (chunkResults.records || []).forEach((r) => {
          let result = '';
          if (r.response && r.response.location) {
            result = r.response.location;
          }
          res.write((uploadResults.records.length > 0 ? ',' : '') + JSON.stringify(result));
          uploadResults.records.push(r);
        });
        uploadResults.created += chunkResults.created;
        uploadResults.skipped += chunkResults.skipped;
        uploadResults.errors += chunkResults.errors;
        logger.info('Sent batch chunk ' + i + ', results: ' + JSON.stringify(chunkResults));
      })
      .catch((error) => {
        logger.error('Failed sending batch chunk ' + i + ': ' + JSON.stringify(chunk));
        logger.warn(JSON.stringify(error));
      });
  };

  return uploadToService;
}
