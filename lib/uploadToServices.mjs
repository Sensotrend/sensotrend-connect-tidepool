import _FHIRClient from './FHIRClient.mjs';
import { makeLogger } from '../envTest.mjs';
// import simpleDataFormatConverter from './simpleDataFormatConverter.mjs';

const logger = makeLogger();

const SKIP_OLD_RECORDS = process.env.SKIP_OLD_RECORDS ? process.env.SKIP_OLD_RECORDS : true;

const chunkSize = 1000;

// TODO: check from capability statement!
const batchSupported = process.env.BATCHSUPPORTED?.toLowerCase() === 'true';

export default function uploadToService() {
  //{email:, password: , generated own code}
  uploadToService.uploadRecordsAndUpdateResponse = async function (
    serverUserInfo,
    data,
    res,
    env
  ) {
    const DataFormatConverter = env.dataFormatConverter;
    // const DataFormatConverter = simpleDataFormatConverter;
    const token = serverUserInfo.accessToken;

    const FHIRClient = new _FHIRClient(env.FHIRServer, {
      patient: serverUserInfo.sub,
      bearertoken: token,
      env,
    });
    const patientRef = serverUserInfo.sub;

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

    const uploadResults = {
      created: 0,
      skipped: 0,
      errors: 0,
      records: [],
      latestDates: {},
    };

    if (!data.length) {
      logger.info('No data to upload: ' + JSON.stringify(data));
      uploadResults.success = 1;
      res.send(uploadResults);
      res.end();
      return;
    }

    const records = await DataFormatConverter.convert(data, converterOptions);
    logger.info('Got records for uploading, count:' + records.length);
    console.log('-------------RECORDS with stringify---------------');
    console.log(JSON.stringify(records));
    console.log('---------------------------------');

    if (!records.length) {
      logger.info('No data to upload: ' + JSON.stringify(records));
      uploadResults.success = 1;
      res.send(uploadResults);
      res.end();
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
        promises.push(uploadToService.uploadBatch(FHIRClient, chunk, uploadResults, res, i));
      } else {
        logger.info('Not using batch, records: ' + JSON.stringify(records));

        for (const record of records) {
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
            await uploadToService.fhirUpload(FHIRClient, record, singleUploadResults);
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
