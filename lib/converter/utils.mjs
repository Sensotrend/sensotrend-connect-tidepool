import { v5 as uuidv5 } from 'uuid';

import { defaultLanguage, kantaRestrictions } from './config.mjs';

const GLUCOSE_MOLAR_MASS = 18.0156;

const NAMESPACE = uuidv5('https://www.hl7.org/fhir/', uuidv5.URL);

const timeSeparator = {
  de: ':',
  en: ':',
  fi: '.',
  sv: '.',
};

export function generateIdentifier(resource) {
  const {
    resourceType,
    effectiveDateTime,
    effectivePeriod,
    device,
    subject,
    dosage,
    valueQuantity,
    valueCodeableConcept,
    valueString,
    valueBoolean,
    valueInteger,
    valueRange,
    valueRatio,
    valueSampledData,
    valueTime,
    valueDateTime,
    valuePeriod,
  } = resource;
  const string = `${
    resourceType
  } ${
    device?.display || device?.reference || subject?.reference || subject?.display
  } ${
    effectiveDateTime || effectivePeriod?.start
  } ${
    JSON.stringify(dosage || valueQuantity || valueCodeableConcept || valueString || valueBoolean
      || valueInteger || valueRange || valueRatio || valueSampledData || valueTime || valueDateTime
      || valuePeriod)
  }`;
  const identifier = {
    system: 'urn:ietf:rfc:3986',
    value: `urn:uuid:${uuidv5(string, NAMESPACE)}`,
  };
  if (!kantaRestrictions) {
    identifier.use = 'official';
    identifier.assigner = {
      type: 'Organization',
      reference: 'https://www.sensotrend.com/',
    };
  }
  return identifier;
}

export function getTidepoolIdentifier(guid) {
  return {
    assigner: {
      type: 'Organization',
      reference: 'https://www.tidepool.org/',
    },
    system: 'urn:ietf:rfc:3986',
    // use: 'secondary',
    value: `urn:uuid:${guid}`,
  };
}

export const l10n = Object.freeze({
  code: Object.freeze({
    de: 'Code: ',
    en: 'Code: ',
    fi: 'Koodi: ',
    sv: 'Kod: ',
  }),
  time: Object.freeze({
    de: 'Zeit: ',
    en: 'Time: ',
    fi: 'Aika: ',
    sv: 'Tid: ',
  }),
  device: Object.freeze({
    de: 'Gerät: ',
    en: 'Device: ',
    fi: 'Laite: ',
    sv: 'Apparat: ',
  }),
  via: Object.freeze({
    de: 'via ',
    en: 'via ',
    fi: 'via ',
    sv: 'via ',
  }),
});

function pad(i) {
  return `${i < 10 ? '0' : ''}${i}`;
}

/*
  "time": "2021-10-23T02:56:21.000Z",
  "timezoneOffset": 180,
  "clockDriftOffset": -255000,
  "conversionOffset": -4194705000,
  "deviceTime": "2021-09-04T16:44:36",
 */
export function getTime(entry) {
  const {
    conversionOffset,
    time,
  } = entry;
  const fixedTime = new Date(new Date(time).getTime() + conversionOffset).toISOString();
  return fixedTime;
}

export function adjustTime(time, timezoneOffset) {
  const date = new Date(new Date(time).getTime() + (timezoneOffset * 60 * 1000));
  const offsetHours = Math.abs(Math.floor(timezoneOffset / 60));
  const offsetMinutes = Math.abs(timezoneOffset % 60);
  return date.toISOString().replace('Z', `${timezoneOffset >= 0 ? '+' : '-'}${pad(offsetHours)}:${pad(offsetMinutes)}`);
}

export function formatTime(time, lng = defaultLanguage) {
  return time.slice(11, 19).replace(':', timeSeparator[lng] || ':');
}

export function formatPeriod(period, lng = defaultLanguage) {
  return `${formatTime(period.start, lng)} - ${formatTime(period.end, lng)}`;
}

export function mgdl2mmoll(value) {
  return Math.round((value / GLUCOSE_MOLAR_MASS) * 100) / 100;
}

export function mmoll2mgdl(value) {
  return parseFloat((value * GLUCOSE_MOLAR_MASS).toFixed(2));
}
