import chaiModule from 'chai';
import { v4 as uuidv4 } from 'uuid';
import _FHIRClient from '../lib/FHIRClient.mjs';
import envModule from '../envTest.mjs';

const { should } = chaiModule;

should();

const env = envModule();

const URL = 'http://hapi.fhir.org/baseDstu3';
const FHIRClient = _FHIRClient(URL, { env });

describe('FHIRClient', function () {
  let testPatient;
  let UUID;
  let patient_identifier;

  before(function () {
    UUID = uuidv4();
    patient_identifier = 'urn:uuid:' + UUID;

    testPatient = {
      resourceType: 'Patient',
      text: {
        status: 'generated',
        div:
          '<div xmlns="http://www.w3.org/1999/xhtml"><table class="hapiPropertyTable"><tbody><tr><td>Identifier</td><td>' +
          patient_identifier +
          '</td></tr></tbody></table></div>',
      },
      identifier: [
        {
          system: 'urn:ietf:rfc:3986',
          value: patient_identifier,
        },
      ],
    };
  });

  it('should create a sample patient', async function () {
    try {
      console.log('CREATING PATIENT');
      const results = await FHIRClient.createRecords(testPatient);
      console.log('patient results', results);
      const patient = results.records[0];
      patient.identifier[0].value.should.equal(patient_identifier);
    } catch (error) {
      console.error(error);
      false.should.equal(true);
    }
  });

  it('should get the sample patient ID from Identifier and load the patient', async function () {
    try {
      console.log('CREATING PATIENT');
      const id = await FHIRClient.getPatientId(patient_identifier);
      const patient = await FHIRClient.loadPatient(id);
      patient.identifier[0].value.should.equal(patient_identifier);
    } catch (error) {
      console.error(error);
      false.should.equal(error);
    }
  });
});
