import ThrottleModule from 'promise-parallel-throttle';
import Client from 'fhir-kit-client';
import { batchSupported } from './TidepoolRESTPlugin.mjs';

const { all } = ThrottleModule;

const ThrottleAll = all;

function FHIRClient(URL, { patient, bearertoken, env } = {}) {
  const logger = env.logger;

  logger.info('FHIR Client Init on URL ' + URL + ' and patient ' + patient);

  const options = { baseUrl: URL };

  const converterName = process.env.CONVERTER_NAME || 'Sensotrend Connect';

  if (env && env.https_certificate) {
    options.cert = env.https_certificate;
    options.key = env.https_privateKey;
  }

  if (process.env.HTTP_BASIC_AUTH) {
    options.customHeaders = {
      Authorization: 'Basic ' + process.env.HTTP_BASIC_AUTH,
      'Content-Type': 'application/fhir+json; charset=UTF-8',
      Prefer: 'return=representation',
      Accept: 'application/fhir+json',
    };
  }

  const _fhirClient = new Client(options);

  FHIRClient.setBearerToken = function (token) {
    if (token && !process.env.HTTP_BASIC_AUTH) _fhirClient.bearerToken = token;
  };

  FHIRClient.setBearerToken(bearertoken);

  FHIRClient.getPatientId = async function (patientIdentifier) {
    logger.info('Querying for patient with identifier ' + patientIdentifier);
    try {
      var results = await _fhirClient.search({
        resourceType: 'Patient',
        searchParams: {
          identifier: patientIdentifier,
        },
      });

      if (results.total > 0) {
        return results.entry[0].resource.id;
      }
    } catch (error) {
      // TODO: better error handling
      logger.error('Error querying for patient! ' + JSON.stringify(error), null, 2);
    }
    return false;
  };

  FHIRClient.loadPatient = async function (patientID) {
    logger.info('Querying for patient ' + patientID);
    try {
      const r = await _fhirClient.read({
        resourceType: 'Patient',
        id: patientID,
      });
      return r;
    } catch (error) {
      logOperationOutcome(error);
    }
    return false;
  };

  function logOperationOutcome(outcome) {
    // ERROR
    if (outcome.status == 500) {
      const issue =
        outcome.data && outcome.data.issue
          ? outcome.data.issue[0]
          : {
              diagnostics: 'Unknown error',
            };
      logger.info('Operation failed with ' + outcome.status + ' - ' + issue.diagnostics);
    }
  }

  FHIRClient.getResultsOfType = async function (type, patientId, date) {
    const results = await _fhirClient.search({
      resourceType: type,
      searchParams: {
        _count: 20,
        _sort: date,
        patient: patientId,
      },
    });
    return results;
  };

  FHIRClient.search = async function (type, searchParams) {
    logger.info(
      'FHIRClient searching ' +
        type +
        ' records using search parameters ' +
        JSON.stringify(searchParams)
    );
    const results = await _fhirClient.search({
      resourceType: type,
      searchParams: searchParams,
    });
    return results;
  };

  FHIRClient.nextPage = async function (resultSet) {
    return await _fhirClient.nextPage(resultSet);
  };

  function getDeviceIdFromRecord(record) {
    // TODO: This should implement pulling the data from the device info

    let device = false;

    if (record.text && record.text.div) {
      const desc = record.text.div;

      const descriptionIllegalStrings = [
        ` (via ${converterName})`,
        ' (via Sensotrend Connect)',
        ' (via Nightscout Connect)',
      ];

      descriptionIllegalStrings.forEach(function (s) {
        desc.replace(s, '');
      });

      const split = desc
        .replace('</div>', '')
        .replace(/<br\s*\/>/g, '|||')
        .split('|||');

      split.some(function (e) {
        const keyValue = e.split(': ');
        switch (keyValue[0]) {
          case 'Laite':
          case 'Device':
            device = keyValue[1];
            descriptionIllegalStrings.forEach(function (s) {
              device = device.replace(s, '');
            });
            return true;
          default:
            return false;
        }
      });
    }
    return device;
  }

  FHIRClient.upload = async function (record, uploadResults) {
    let header = 'identifier=' + record?.identifier[0]?.value;

    let results = 'Not fetched.';
    try {
      results = await _fhirClient.create({
        resourceType: record.resourceType,
        body: record,
        options: {
          headers: {
            'Content-Type': 'application/fhir+json; charset=UTF-8',
            'If-None-Exist': header,
            Prefer: 'return=representation',
            Accept: 'application/fhir+json',
          },
        },
      });

      const status = results[Client.StatusCode];
      // logger.info('Got response ' + status + ': ' + JSON.stringify(results));
      results.response = {
        status: status,
      };

      if (status == 200 || status == 201) {
        if (status == 201) {
          if (results[Client.Location]) {
            const location = results[Client.Location];
            /*
            logger.info(
              record.resourceType +
                ' identifier ' +
                record.identifier[0].value +
                ' created at ' +
                location
            );
            */
            results.response.location = location;
          }
          uploadResults.created += 1;
          uploadResults.records.push(results);
        } else if (status == 200) {
          uploadResults.skipped += 1;
          // logger.info('Record skipped as duplicate');
        }

        const deviceID = getDeviceIdFromRecord(record);
        // logger.info('Checking upload date for device ' + deviceID);

        if (deviceID) {
          const d = new Date(record.effectiveDateTime);

          if (uploadResults.latestDates[deviceID]) {
            if (d > uploadResults.latestDates[deviceID]) {
              uploadResults.latestDates[deviceID] = d;
            }
          } else {
            uploadResults.latestDates[deviceID] = d;
          }
        }
      } else {
        const error = new Error('Unexpected status ' + status);
        error.response = results;
        throw error;
      }
    } catch (error) {
      uploadResults.errors += 1;
      uploadResults.error = error.message || JSON.stringify(error);
      // logger.error(`'FHIR client: error creating object: ${JSON.stringify(error)}`);
      throw error;
    }
  };

  FHIRClient.uploadBatch = async function (records, results) {
    records = records instanceof Array ? records : [records];
    const uploadResults = results || {
      created: 0,
      skipped: 0,
      errors: 0,
      records: [],
      latestDates: {},
    };

    const bundle = {
      resourceType: 'Bundle',
      type: 'batch',
      entry: records.map((r) => ({
        resource: r,
        request: {
          url: `${r.resourceType}/`,
          method: 'POST',
          ifNoneExist: 'identifier=' + r.identifier[0].value,
        },
      })),
    };
    // logger.info('Built bundle:\n' + JSON.stringify(bundle));

    await _fhirClient
      .batch({
        body: bundle,
        options: {
          headers: {
            'Content-Type': 'application/fhir+json; charset=UTF-8',
            Prefer: 'return=representation',
            Accept: 'application/fhir+json',
          },
        },
      })
      .then((data) => {
        // logger.info('Received data from bundle upload:\n' + JSON.stringify(data));
        (data.entry || []).forEach((e) => {
          if (e.response && e.response.status) {
            /*
            res.write(
              (uploadResults.records.length > 0 ? ',' : '') + JSON.stringify(e.response.location)
            );
            */
            uploadResults.records.push(e);
            if (e.response.status.indexOf('200') === 0) {
              uploadResults.skipped += 1;
            } else if (e.response.status.indexOf('201') === 0) {
              uploadResults.created += 1;
            } else {
              // logger.info('Unexpected status: ' + JSON.stringify(e));
              uploadResults.errors += 1;
            }
          }
        });
        if (uploadResults.errors) {
          logger.error(`Bundle upload error:\n${JSON.stringify(bundle)}\n${JSON.stringify(data)}`);
        }
      })
      .catch((error) => {
        // logger.error('Problem with batch upload:\n' + JSON.stringify(error));
        uploadResults.errors += records.length || 1;
        uploadResults.error = error.message;
        // logger.error('FHIR client: error creating object', JSON.stringify(error));
      });
    return uploadResults;
  };

  FHIRClient.createRecords = async function (records) {
    records = records instanceof Array ? records : [records];
    const uploadResults = {
      created: 0,
      skipped: 0,
      errors: 0,
      records: [],
      latestDates: {},
    };
    if (records.length > 1 && batchSupported) {
      await FHIRClient.uploadBatch(records, uploadResults);
    } else {
      const queue = records.map((record) => () => FHIRClient.upload(record, uploadResults));
      await ThrottleAll(queue);
    }
    return uploadResults;
  };

  FHIRClient.getObservations = async function (patientId = patient) {
    logger.info('Querying for treatments for patient ' + patientId);
    var results = await _fhirClient.search({
      resourceType: 'Observation',
      compartment: {
        resourceType: 'Patient',
        id: patientId,
      },
    });
    // logger.info('Got treatments:' + JSON.stringify(results, null, 2));
    if (results.data) {
      return results.data;
    }
  };
  return FHIRClient;
}

export default FHIRClient;
