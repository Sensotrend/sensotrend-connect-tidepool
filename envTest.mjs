import winstonModule from 'winston';
import Auth from '../lib/Auth';
import Mongo from './mongo.mjs';


const { createLogger, format, transports } = winstonModule;

const { combine, timestamp, label } = format;

function makeLogger () {

  const alignedWithColorsAndTime = format.combine(
     format.colorize(),
     format.timestamp(),
     format.align(),
     format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
  );

  const level = process.env.LOGGING_LEVEL ? process.env.LOGGING_LEVEL : 'info';

  const logger = createLogger({
     level,
     format: combine(
        label({ label: 'right meow!' }),
        timestamp(),
        alignedWithColorsAndTime
     ),
     transports: [new transports.Console()]
  });

  return logger;
}

function Environment () {

  const envTest = {};
  envTest.logger = makeLogger();
  envTest.logger.info('Initializing the environment');

  const FHIR_SERVER = process.env.FHIR_SERVER;
  if (!FHIR_SERVER) {
     env.logger.error('FHIR_SERVER missing, cannot start');
     process.exit();
  }



  envTest.env.userProvider = Auth(TOKEN_ENCRYPTION_KEY, envTest.env);
  envTest.FHIRServer = FHIR_SERVER;
  if (process.env.MONGODB_URI) {
      envTest.MONGODB_URI = process.env.MONGODB_URI;
      envTest.mongo = Mongo(envTest);
  }  


  const authCert = process.env.FIPHR_AUTH_CERT_PATH;
  const authKey = process.env.FIPHR_AUTH_KEY_PATH;

  if (authCert) {
   envTest.https_privateKey = fs.readFileSync(authKey, 'utf8');
     envTest.https_certificate = fs.readFileSync(authCert, 'utf8');
     envTest.logger.info('Using certificate and private key for HTTPS');
  }

  return envTest;
}

export default Environment;