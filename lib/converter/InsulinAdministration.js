import { defaultLanguage, kantaRestrictions, diabetesDossierRestrictions } from './config.js';
import {
  adjustTime,
  formatPeriod,
  formatTime,
  generateIdentifier,
  l10n as l10nCore,
} from './utils.js';

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
      payload,
      duration,
      normal,
      percentage,
      rate,
      tbr,
      time,
      timezoneOffset,
      type,
    } = entry;

    this.resourceType = 'MedicationAdministration';
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
      console.error({ time, duration, period: this.effectivePeriod });
    } else {
      this.effectiveDateTime = adjustedTime;
    }

    this.meta = {
      profile: [
        'http://phr.kanta.fi/StructureDefinition/fiphr-sd-insulindosing-stu3',
        'http://roche.com/fhir/rdc/StructureDefinition/medication-administration',
      ],
    };

    this.dosage = {
      dose: {
        value: normal || ((rate * duration) / (60 * 60 * 1000)),
        unit: 'IU',
        system: 'http://unitsofmeasure.org',
        code: '[iU]',
      },
    };

    switch (type) {
      case 'basal':
        if (tbr !== undefined || percentage !== undefined) {
          this.dosage.rateRatio = {
            numerator: {
              value: rate,
              unit: 'IU',
              system: 'http://unitsofmeasure.org',
              code: '[iU]',
            },
            denominator: {
              value: 1 / (percentage || tbr),
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
        this.type = shortActing;
        break;
      case 'long':
        this.type = longActing;
        break;
      default:
        throw new Error(`Invalid type ${type}`);
    }

    this.medicationCodeableConcept = {
      coding: coding[this.type],
      text: l10n[this.type][this.language],
    };

    this.dosage.text = `${
      l10n[this.type][this.language]
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
          l10n[this.type][this.language]
        }<br />${
          l10n.code[this.language]
        }${
          coding[this.type].map((c) => `${
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
      identifier = [generateIdentifier(this)],
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
      meta: {
        ...meta,
        profile: [
          'http://phr.kanta.fi/StructureDefinition/fiphr-sd-insulindosing-stu3',
        ],
      },
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
