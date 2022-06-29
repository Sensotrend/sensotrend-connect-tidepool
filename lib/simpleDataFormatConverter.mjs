import InsulinAdministration from './converter/InsulinAdministration.mjs';
import Observation from './converter/Observation.mjs';

function convert(data, options) {
  const { FHIR_userid: patient, language } = options;

  const records = [];

  if (!Array.isArray(data)) {
    return records;
  }

  data.forEach((d) => {
    switch(d.type) {
      case 'basal':
      case 'bolus':
        // Todo: handle more complex bolus types like extended and square wave
        records.push(new InsulinAdministration(patient, d, language));
        break;
      case 'cbg':
      case 'smbg':
      case 'wizard':
        records.push(new Observation(patient, d, language));
        break;
      case 'deviceEvent':
        // ignore for now...
        break;
      default:
        // console.error(`Unhandled type ${d.type}`, d);
    }
  });
  return records;
}

export default {
  convert,
};
