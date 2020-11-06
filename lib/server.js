import express from 'express';
import session from 'express-session';
import cors from 'cors';
import MongoStoreModule from 'connect-mongo';
import { decorateApp } from '@awaitjs/express';

import envModule from '../env';

import BootEvent from './bootevent.js';
import TidepoolRESTService from './TidepoolRESTService';




const env = envModule();

env.logger.info('Initializing the environment');

BootEvent(env);


const MongoStore = MongoStoreModule(session);

const app = decorateApp(express());

app.env = env;

app.use(session({
   secret: env.session_key,
   cookie: {
      maxAge: 65 * 60 * 1000
   },
   resave: false,
   saveUninitialized: false,
   store: new MongoStore({
      mongooseConnection: env.mongo.getConnection(),
      ttl: 65 * 60 * 1000
   })
}));

if (process.env.NODE_ENV != 'production') {
   var corsOptions = {
      origin: 'http://localhost:3000',
      credentials: true,
      optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
   };
   app.use(cors(corsOptions));
   app.options('*', cors(corsOptions));
}

// Middleware to check if the user is authenticated
async function isUserAuthenticated (req, res, next) {
   if (req.session && req.session.user) {
      next();
   } else {
      res.redirect('/');
   }
}


let tidepoolService = TidepoolRESTService(env);

app.use('/tpupload', tidepoolService.uploadApp);
app.use('/tpapi', tidepoolService.APIapp);
app.use('/tpdata', tidepoolService.dataApp);


app.listen(process.env.PORT, () => {
  const version = process.env.npm_package_version;
  env.logger.info('Started server ' +version);
});

export default app;