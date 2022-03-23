export const defaultLanguage = 'fi';

export const fixedUnit = 'mmol/L';

export const kantaRestrictions = (process.env.FHIR_SERVER || '').startsWith('https://fhirsandbox2.kanta.fi/phr-resourceserver/base');

export const kantaR4Restrictions = process.env.FHIR_SERVER === 'https://fhirsandbox2.kanta.fi/phr-resourceserver/baseR4';

export const diabetesDossierRestrictions = false;
