export const defaultLanguage = 'fi';

export const fixedUnit = 'mmol/L';

export const kantaRestrictions = true;

export const kantaR4Restrictions = process.env.FHIR_SERVER?.toLowerCase()?.includes('r4') || false;

export const diabetesDossierRestrictions = false;
