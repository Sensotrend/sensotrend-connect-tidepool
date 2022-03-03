import InsulinAdministration from './converter/InsulinAdministration.js';
import Observation from './converter/Observation.js';

function convert(data, options) {
  const { FHIR_userid: patient } = options;

  const bundle = {
    resourceType: 'Bundle',
    type: 'batch',
    entry: [],
  };
  
  data.forEach((d) => {
    switch(d.type) {
      case 'basal':
      case 'bolus':
        // Todo: handle more complex bolus types like extended and square wave
        bundle.entry.push(new InsulinAdministration(patient, d));
        break;
      case 'cbg':
      case 'smbg':
      case 'wizard':
        bundle.entry.push(new Observation(patient, d));
        break;
      case 'deviceEvent':
        // ignore for now...
        break;
      default:
        // console.error(`Unhandled type ${d.type}`, d);
    }
  });

  // console.log(JSON.stringify(bundle));
  return bundle.entry;
}


export default {
  convert,
};
