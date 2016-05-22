/* jshint esversion: 6 */

// dependencies

import express from 'express';
import bodyParser from 'body-parser';
import session from 'express-session';
import passport from 'passport';
import refresh from 'passport-oauth2-refresh';
import Gmail from 'node-gmail-api';
import async from 'asyncawait/async';
import await from 'asyncawait/await';
import cors from 'cors';
import keys from './keys';
import mail from './mailController';

// mongoose init

import mongoose from 'mongoose';
import connectMongo from 'connect-mongo';

const MongoStore = connectMongo(session);
const Schema = mongoose.Schema;

mongoose.connect("mongodb://localhost/meanmail");

var google = require('googleapis');
var OAuth2 = google.auth.OAuth2;
var oauth2Client = new OAuth2(keys.GOOGLE_CLIENT_ID, keys.GOOGLE_CLIENT_SECRET, '/auth/google/callback');
google.options({ auth: oauth2Client }); // set auth as a global default
// var mail = require('./mailController');

// You must set the GOOGLE_APPLICATION_CREDENTIALS and GCLOUD_PROJECT

// Initialize gcloud
var gcloud = require('gcloud')({
  projectId: keys.GOOGLE_CLOUD_ID,
  keyFilename: 'keyfile.json'
});

// Get a reference to the pubsub component
var pubsub = gcloud.pubsub();

// Create init topic for gcloud notifications
function createTopic(topicName, callback) {
  var topic = pubsub.topic(topicName);

  // Get the topic if it exists. Create it if it does not exist.
  topic.get({
    autoCreate: true
  }, function (err, topic, apiResponse) {
    if (err) {
      return callback(err);
    }

    // Created the topic
    console.log('Created topic ' + topicName);
    callback(null, topic, apiResponse);
  });
}

createTopic('pull-topic', function (e) {
  console.log("topic: ", e);
});

// Create subscription
function subscribe(topicName, subscriptionName, callback) {
  var options = {
    reuseExisting: true
  };
  pubsub.subscribe(
    topicName,
    subscriptionName,
    options,
    function (err, subscription, apiResponse) {
      if (err) {
      return callback(err);
    }

      // Got the subscription
      console.log('Subscribed to ' + topicName);
      callback(null, subscription, apiResponse);
    }
  );
}

subscribe('pull-topic', 'pull-subscription', function (e) {
  console.log("subscription: ",e);
});

// express init

const app = express();
const port = 3000;

app.use(express.static(__dirname + '/views'));

app.use(require('express-session')({
  secret: keys.sessionSecret,
  resave: true,
  maxAge: new Date(Date.now() + 3600000),
  store: new MongoStore({ mongooseConnection: mongoose.connection },
    function(err){
        console.log(err || 'connect-mongodb setup ok');
    }
  ),
  saveUninitialized: true
}));

app.use(bodyParser());

app.engine('html', require('ejs').renderFile);

app.set('view engine', 'html');

// passport init

const GoogleStrategy = require('passport-google-oauth20').Strategy;

const SCOPES = 'https://mail.google.com/' + 'https://www.googleapis.com/auth/cloud-platform';

var userSchema = new Schema({
  googleId: String,
  name: String,
  accessToken: String,
  profileimg: String
});

const User = mongoose.model("User", userSchema);

// cors init

const corsOptions = {
  origin: 'http://localhost:3000'
};

app.use(cors(corsOptions));

// passport init

app.use(passport.initialize());

app.use(passport.session());

// variable init

let emails = {};
let user = {};

// Google Login Strategy

const strategy = new GoogleStrategy({
    clientID: keys.GOOGLE_CLIENT_ID,
    clientSecret: keys.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  function(accessToken, refreshToken, profile, cb) {

    console.log("refresh Token: ", refreshToken);

    // Store token locally for access later

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    console.log(profile);

    var gmail = google.gmail({ version: 'v1', auth: oauth2Client });

                var user = new User({
                    googleId: profile.id,
                    name: profile.displayName,
                    refreshToken: refreshToken,
                    accessToken: accessToken,
                    profileimg: profile._json.image.url
                });
                user.save((err) => {
                    if (err) console.log(err);
                    return cb(err, user);
                });

  });

passport.use(strategy);
refresh.use(strategy);

// setInterval(function () {
//   refresh.requestNewAccessToken('google', user.accessToken, function(err, accessToken, refreshToken) {
//
//     var user = new User({
//         googleId: profile.id,
//         name: profile.displayName,
//         refreshToken: refreshToken,
//         accessToken: accessToken,
//         profileimg: profile._json.image.url
//     });
//     user.save((err) => {
//         if (err) console.log(err);
//         return cb(err, user);
//     });
//
//   });
// }, 350000);

function ensureAuthenticated(req, res, next) {
  console.log("checking auth...");
  if (req.isAuthenticated()) {
    console.log("authentication good");
    return next();
  }
  else {
    console.log("bad auth. redirecting to login?");
    res.redirect('/#/login'); // NOT!
  }
}

// Define routes.

app.get('/',
  (req, res) => {
    res.redirect('/mail');
});

app.get('/watchMail',
  (req, res) => {
    mail.watchMail(req.user.accessToken);
});

app.get('/login',
  (req, res) => {
    res.redirect('/#/login');
});

app.get('/checkAuth',
  (req, res) => {
    if (req.isAuthenticated()) {
      console.log("authentication good. STATUS 200");
      return res.sendStatus(200);
    }
    return res.sendStatus(500);
});

app.get('/getUser',
ensureAuthenticated,
  (req, res) => {
    res.json({
      name: req.user.name,
      profileimg: req.user.profileimg
    });
});

app.get('/mail',
  ensureAuthenticated,
  (req, res) => {
    console.log("redirecting to mail");
    res.redirect('/#/mail');
});

app.post('/sendMail',
  (req, res) => {
    console.log(req.body);
    mail.sendMail(req.body.headers_obj, req.body.message, req.user.accessToken);
    res.send(req.body);
});

app.post('/trashMail',
  (req, res) => {
    console.log(req.body.messageId);
    mail.trashMail(req.body.messageId, req.user.accessToken);
    res.send(req.body);
});

app.post('/removeLabel',
  (req, res) => {
    console.log(req.body.messageId);
    mail.removeLabel(req.body.messageId, req.body.label, req.user.accessToken);
    res.send(req.body);
});

app.get('/getMail/:label',
  ensureAuthenticated,
  async (function (req, res){
    console.log("getting mail");
      let emailParsed = await(mail.getMail(req.user.accessToken, req.params.label));
      res.send(emailParsed);
}));

// Google Authentication Routes

app.get('/auth/google',
  passport.authenticate('google', {display: 'page', scope: ['profile', SCOPES],
                                  accessType: 'offline'}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    // Successful authentication, redirect home.
    console.log("Successfully Authenticated.");
    return res.status(200).send();
});

app.get('/oauthcallback?code={authorizationCode}',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    // Successful authentication, redirect home.
    console.log("Successfully Authenticated.");
    res.redirect('/#/mail');
});

// serialize / deserialize for passport

passport.serializeUser((user, done) => {
  	done(null, user); // put the whole user object from facebook on the session
});

passport.deserializeUser((obj, done) => {
  	done(null, obj); // get data from session and put it on req.user in every endpoint
});

// listen

app.listen(port, () => {
  	console.log(`Listening on port ${port}`);
});
