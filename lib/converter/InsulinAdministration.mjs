import { defaultLanguage, kantaRestrictions, diabetesDossierRestrictions } from './config.mjs';
import {
  adjustTime,
  formatPeriod,
  formatTime,
  generateIdentifier,
  getTidepoolIdentifier,
  l10n as l10nCore,
} from './utils.mjs';

export const [shortActing, longActing] = ['shortActing', 'longActing'];

const l10n = {
  ...l10nCore,
  typeOfInsulin: {
    de: 'Art des Insulins: ',
    en: 'Type of insulin: ',
    fi: 'Insuliinin tyyppi: ',
    sv: 'Typ av insulin: ',
  },
  [shortActing]: {
    de: 'Kurzwirkendes Insulin',
    en: 'Fast-acting insulin',
    fi: 'Lyhytvaikutteinen insuliini',
    sv: 'Direktverkande insulin',
  },
  [longActing]: {
    de: 'Langwirkendes Insulin',
    en: 'Long-acting insulin',
    fi: 'Pitkävaikutteinen insuliini',
    sv: 'Långverkande insulin',
  },
  dose: {
    de: 'Dosis: ',
    en: 'Dose: ',
    fi: 'Annos: ',
    sv: 'Dos: ',
  },
};

const coding = {
  [longActing]: diabetesDossierRestrictions
  ? [
    {
      system: 'http://snomed.info/sct',
      code: '25305005',
      display: 'Long-acting insulin (substance)',
    },
  ]
  : [
    {
      system: 'http://snomed.info/sct',
      code: '25305005',
      display: 'Long-acting insulin (substance)',
    },
    {
      system: 'http://phr.kanta.fi/CodeSystem/fiphr-cs-insulincode',
      code: 'ins-intermediate-long',
      display: 'Pitkävaikutteinen insuliini',
    },
    {
      system: 'http://snomed.info/sct',
      code: '67866001',
      display: 'Insulin (substance)',
    },
  ],
  [shortActing]: diabetesDossierRestrictions
  ? [
    {
      system: 'http://snomed.info/sct',
      code: '411531001',
      display: 'Short-acting insulin (substance)',
    },
  ]
  : [
    {
      system: 'http://snomed.info/sct',
      code: '411531001',
      display: 'Short-acting insulin (substance)',
    },
    {
      system: 'http://phr.kanta.fi/CodeSystem/fiphr-cs-insulincode',
      code: 'ins-short-fast',
      display: 'Lyhytvaikutteinen insuliini',
    },
    {
      system: 'http://snomed.info/sct',
      code: '67866001',
      display: 'Insulin (substance)',
    },
  ],
};

export default class InsulinAdministration {
  constructor(patient, entry, language) {
    const {
      deviceId,
      duration,
      guid,
      normal,
      percent,
      rate = 0,
      tbr,
      time,
      timezoneOffset,
      type,
    } = entry;

    this.resourceType = 'MedicationAdministration';
    this.meta = {
      profile: [
        'http://phr.kanta.fi/StructureDefinition/fiphr-sd-insulindosing-stu3',
        'http://roche.com/fhir/rdc/StructureDefinition/medication-administration',
      ],
    };

    this.language = language || defaultLanguage;

    const adjustedTime = adjustTime(time, timezoneOffset);
    if (duration) {
      this.effectivePeriod = {
        start: adjustedTime,
        end: adjustTime(
          new Date(new Date(adjustedTime).getTime() + duration).toISOString(),
          timezoneOffset,
        ),
      };
    } else {
      this.effectiveDateTime = adjustedTime;
    }

    this.dosage = {
      dose: {
        unit: 'IU',
        system: 'http://unitsofmeasure.org',
        code: '[iU]',
      },
    };

    if (normal !== undefined) {
      this.dosage.dose.value = normal;
    } else if (duration !== undefined) {
      this.dosage.dose.value = ((rate * duration) / (60 * 60 * 1000));
    } else {
      this.dosage.dose.value = 0;
    }

    let insulinType;
    switch (type) {
      case 'basal':
        if ((tbr !== undefined) || (percent !== undefined)) {
          this.dosage.rateRatio = {
            numerator: {
              value: rate,
              unit: 'IU',
              system: 'http://unitsofmeasure.org',
              code: '[iU]',
            },
            denominator: {
              value: 1 / (percent || tbr || 1),
              unit: 'h',
              system: 'http://unitsofmeasure.org',
              code: 'h',
            },
          };
        } else {
          this.dosage.rateQuantity = {
            value: rate,
            unit: '[iU]/h',
            system: 'http://unitsofmeasure.org',
            code: '[iU]/h',
          };
        }
        // falls through
      case 'bolus':
        insulinType = shortActing;
        break;
      case 'long':
        insulinType = longActing;
        break;
      default:
        throw new Error(`Invalid type ${type}`);
    }

    this.medicationCodeableConcept = {
      coding: coding[insulinType],
      text: l10n[insulinType][this.language],
    };

    this.dosage.text = `${
      l10n[insulinType][this.language]
    } ${
      this.dosage.dose.value.toFixed(2)
    } ${
      this.dosage.dose.unit
    }${
      this.dosage.rateRatio
        ? ` (${
          this.dosage.rateRatio.numerator.comparator || ''
        }${
          (this.dosage.rateRatio.numerator.value !== undefined)
            ? this.dosage.rateRatio.numerator.value
            : ''
        } ${
          this.dosage.rateRatio.numerator.unit || ''
        }/${
          this.dosage.rateRatio.denominator.comparator || ''
        }${
          ((this.dosage.rateRatio.denominator.value !== undefined)
          && (this.dosage.rateRatio.denominator.value !== 1))
            ? `${this.dosage.rateRatio.denominator.value} `
            : ''
        }${
          this.dosage.rateRatio.denominator.unit || ''
        })`
        : ''
    }${this.dosage.rateQuantity
      ? ` (${
        this.dosage.rateQuantity.comparator || ''
      }${
        this.dosage.rateQuantity.value
      }${
        this.dosage.rateQuantity.unit
          ? ` ${this.dosage.rateQuantity.unit}`
          : ''
      })`
      : ''
    }`;

    this.subject = {
      reference: `Patient/${patient}`,
    };
    this.device = [
      { display: deviceId },
    ];
    this.identifier = [generateIdentifier(this)];
    if (!kantaRestrictions && guid) {
      this.identifier.push(getTidepoolIdentifier(guid));
    }
  }

  toString() {
    return {
      status: 'generated',
      div: `<div lang="${
        this.language
      }" xml:lang="${
        this.language
      }" xmlns="http://www.w3.org/1999/xhtml">${
        `${
          l10n.typeOfInsulin[this.language]
        }${
          this.medicationCodeableConcept.text
        }<br />${
          l10n.code[this.language]
        }${
          this.medicationCodeableConcept.coding.map((c) => `${
            c.system === 'http://snomed.info/sct' ? 'SNOMED ' : ''
          }${
            c.code
          } (${
            c.display
          })`).join(', ')
        }`
      }${
        this.effectivePeriod
          ? `<br />${l10n.time[this.language]}${formatPeriod(this.effectivePeriod)}`
          : ''
      }${
        this.effectiveDateTime
          ? `<br />${l10n.time[this.language]}${formatTime(this.effectiveDateTime)}`
          : ''
      }${
        this.dosage
          ? `<br />${
            this.dosage.text
          }`
          : ''
      }${
        this.device
          ? `<br />${l10n.device[this.language]}${
            this.device.map((d) => d.display).join(', ')}`
          : ''
      }</div>`,
    };
  }

  toJSON() {
    const {
      resourceType,
      id,
      meta,
      implicitRules,
      language,
      text = this.toString(),
      contained,
      extension,
      modifierExtension,
      identifier,
      definition,
      instantiates,
      partOf,
      status = 'completed',
      statusReason,
      category,
      medicationCodeableConcept,
      medicationReference,
      subject,
      context,
      supportingInformation,
      effectiveDateTime,
      effectivePeriod,
      performer,
      notGiven,
      reasonNotGiven,
      reasonCode,
      reasonReference,
      prescription,
      request,
      device,
      note,
      dosage,
      eventHistory,
    } = this;

    return kantaRestrictions
    ? {
      resourceType,
      id,
      meta,
      implicitRules,
      language,
      text,
      contained,
      extension,
      modifierExtension,
      identifier,
      status,
      medicationCodeableConcept,
      medicationReference,
      subject,
      effectiveDateTime,
      effectivePeriod,
      performer,
      note,
      dosage,
    }
    : {
      resourceType,
      id,
      meta,
      implicitRules,
      language,
      text,
      contained,
      extension,
      modifierExtension,
      identifier,
      definition,
      instantiates,
      partOf,
      status,
      statusReason,
      category,
      medicationCodeableConcept,
      medicationReference,
      subject,
      context,
      supportingInformation,
      effectiveDateTime,
      effectivePeriod,
      performer,
      notGiven,
      reasonNotGiven,
      reasonCode,
      reasonReference,
      prescription,
      request,
      device,
      note,
      dosage,
      eventHistory,
    };
  }
}
