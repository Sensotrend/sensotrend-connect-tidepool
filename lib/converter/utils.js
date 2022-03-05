import { v5 as uuidv5 } from 'uuid';

const GLUCOSE_MOLAR_MASS = 18.0156;

const NAMESPACE = uuidv5('https://www.hl7.org/fhir/', uuidv5.URL);

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
  return {
    system: 'urn:ietf:rfc:3986',
    value: uuidv5(string, NAMESPACE),
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

export function adjustTime(time, timezoneOffset) {
  const date = new Date(new Date(time).getTime() + (timezoneOffset * 60 * 1000));
  const offsetHours = Math.abs(Math.floor(timezoneOffset / 60));
  const offsetMinutes = Math.abs(timezoneOffset % 60);
  return date.toISOString().replace('Z', `${timezoneOffset >= 0 ? '+' : '-'}${pad(offsetHours)}:${pad(offsetMinutes)}`);
}

export function formatTime(time) {
  const date = new Date(time);
  return `${
    date.getDate()
  }.${
    date.getMonth() + 1
  }.${
    date.getFullYear()
  } ${
    date.getHours()
  }:${
    pad(date.getMinutes())
  }`;
}

export function formatPeriod(period) {
  return `${formatTime(period.start)} - ${formatTime(period.end)}`;
}

export function mgdl2mmoll(value) {
  return Math.round((value / GLUCOSE_MOLAR_MASS) * 100) / 100;
}

export function mmoll2mgdl(value) {
  return parseFloat((value * GLUCOSE_MOLAR_MASS).toFixed(2));
}
