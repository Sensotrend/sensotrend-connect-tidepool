import winstonModule from 'winston';


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

  const env = {};
  env.logger = makeLogger();
  env.logger.info('Initializing the environment');


  const authCert = process.env.FIPHR_AUTH_CERT_PATH;
  const authKey = process.env.FIPHR_AUTH_KEY_PATH;

  if (authCert) {
     env.https_privateKey = fs.readFileSync(authKey, 'utf8');
     env.https_certificate = fs.readFileSync(authCert, 'utf8');
     env.logger.info('Using certificate and private key for HTTPS');
  }

  return env;
}

export default Environment;