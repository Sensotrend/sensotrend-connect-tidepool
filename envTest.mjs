import fs from 'fs';
import winstonModule from 'winston';
import { nanoid } from 'nanoid';
import Auth from './test/lib/Auth.mjs';
import Mongo from './mongo.mjs';

import DeviceLastSeenService from './test/lib/RecordSkipManager.mjs';
import { DefaultConversionService } from 'sensotrend-converter';

const { createLogger, format, transports } = winstonModule;

const { combine, timestamp, label } = format;

export function makeLogger() {
  const alignedWithColorsAndTime = format.combine(
    format.colorize(),
    format.timestamp(),
    format.align(),
    format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
  );

  const level = process.env.LOGGING_LEVEL ? process.env.LOGGING_LEVEL : 'info';

  const logger = createLogger({
    level,
    format: combine(label({ label: 'right meow!' }), timestamp(), alignedWithColorsAndTime),
    transports: [new transports.Console()],
  });

  return logger;
}

function Environment() {
  const envTest = {};
  envTest.logger = makeLogger();
  envTest.logger.info('Initializing the environment');

  const FHIR_SERVER = process.env.FHIR_SERVER;
  if (!FHIR_SERVER) {
    envTest.logger.error('FHIR_SERVER missing, cannot start');
    process.exit();
  }

  envTest.lastSeenService = DeviceLastSeenService(envTest);

  const TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;

  envTest.userProvider = Auth(TOKEN_ENCRYPTION_KEY, envTest);
  envTest.FHIRServer = FHIR_SERVER;

  if (process.env.MONGODB_URI) {
    envTest.MONGODB_URI = process.env.MONGODB_URI;
    envTest.mongo = Mongo(envTest);
  }

  envTest.randomString = nanoid;
  envTest.session_key =
    process.env.SESSION_KEY ||
    '2466c1cc-3bed-11e9-a4de-53cf880a6d1a-2d2ea702-3bed-11e9-8842-ef5457fba264';

  envTest.setOauthProvider = function (oauthProvider) {
    envTest.oauthProvider = oauthProvider;
  };

  const authCert = process.env.FIPHR_AUTH_CERT_PATH;
  const authKey = process.env.FIPHR_AUTH_KEY_PATH;

  if (authCert) {
    envTest.https_privateKey = fs.readFileSync(authKey, 'utf8');
    envTest.https_certificate = fs.readFileSync(authCert, 'utf8');
    envTest.logger.info('Using certificate and private key for HTTPS');
  }

  envTest.dataFormatConverter = DefaultConversionService(envTest.logger);

  return envTest;
}

export default Environment;
