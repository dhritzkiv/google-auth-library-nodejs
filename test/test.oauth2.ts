/**
 * Copyright 2013 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'assert';
import {AxiosRequestConfig} from 'axios';
import * as crypto from 'crypto';
import {randomBytes} from 'crypto';
import * as fs from 'fs';
import * as nock from 'nock';
import * as path from 'path';
import * as qs from 'querystring';
import * as url from 'url';

import {LoginTicket} from '../src/auth/loginticket';
import {CodeChallengeMethod, GoogleAuth, OAuth2Client} from '../src/index';

nock.disableNetConnect();

describe('OAuth2 client', () => {
  const CLIENT_ID = 'CLIENT_ID';
  const CLIENT_SECRET = 'CLIENT_SECRET';
  const REDIRECT_URI = 'REDIRECT';
  const ACCESS_TYPE = 'offline';
  const SCOPE = 'scopex';
  const SCOPE_ARRAY = ['scopex', 'scopey'];

  it('should generate a valid consent page url', (done) => {
    const opts = {
      access_type: ACCESS_TYPE,
      scope: SCOPE,
      response_type: 'code token'
    };

    const oauth2client = new OAuth2Client({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI
    });

    const generated = oauth2client.generateAuthUrl(opts);
    const parsed = url.parse(generated);
    if (typeof parsed.query !== 'string') {
      throw new Error('Unable to parse querystring');
    }
    const query = qs.parse(parsed.query);
    assert.equal(query.response_type, 'code token');
    assert.equal(query.access_type, ACCESS_TYPE);
    assert.equal(query.scope, SCOPE);
    assert.equal(query.client_id, CLIENT_ID);
    assert.equal(query.redirect_uri, REDIRECT_URI);
    done();
  });

  it('should throw an error if generateAuthUrl is called with invalid parameters',
     () => {
       const opts = {
         access_type: ACCESS_TYPE,
         scope: SCOPE,
         code_challenge_method: CodeChallengeMethod.S256
       };

       const oauth2client =
           new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
       try {
         const generated = oauth2client.generateAuthUrl(opts);
         assert.fail('Expected to throw');
       } catch (e) {
         assert.equal(
             e.message,
             'If a code_challenge_method is provided, code_challenge must be included.');
       }
     });

  it('should generate a valid code verifier and resulting challenge', () => {
    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const codes = oauth2client.generateCodeVerifier();

    // ensure the code_verifier matches all requirements
    assert.equal(codes.codeVerifier.length, 128);
    const match = codes.codeVerifier.match(/[a-zA-Z0-9\-\.~_]*/);
    assert(match);
    if (!match) return;
    assert(match.length > 0 && match[0] === codes.codeVerifier);
  });

  it('should include code challenge and method in the url', () => {
    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const codes = oauth2client.generateCodeVerifier();
    const authUrl = oauth2client.generateAuthUrl({
      code_challenge: codes.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256
    });
    const parsed = url.parse(authUrl);
    if (typeof parsed.query !== 'string') {
      throw new Error('Unable to parse querystring');
    }
    const props = qs.parse(parsed.query);
    assert.equal(props.code_challenge, codes.codeChallenge);
    assert.equal(props.code_challenge_method, CodeChallengeMethod.S256);
  });

  it('should verifyIdToken properly', async () => {
    const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const fakeCerts = {a: 'a', b: 'b'};
    const idToken = 'idToken';
    const audience = 'fakeAudience';
    const maxExpiry = 5;
    const payload =
        {aud: 'aud', sub: 'sub', iss: 'iss', iat: 1514162443, exp: 1514166043};
    nock('https://www.googleapis.com')
        .get('/oauth2/v1/certs')
        .reply(200, fakeCerts);
    client.verifySignedJwtWithCerts =
        (jwt: string, certs: {}, requiredAudience: string|string[],
         issuers?: string[], theMaxExpiry?: number) => {
          assert.equal(jwt, idToken);
          assert.equal(JSON.stringify(certs), JSON.stringify(fakeCerts));
          assert.equal(requiredAudience, audience);
          assert.equal(theMaxExpiry, maxExpiry);
          return new LoginTicket('c', payload);
        };
    const result = await client.verifyIdToken({idToken, audience, maxExpiry});
    assert.notEqual(result, null);
    if (result) {
      assert.equal(result.getEnvelope(), 'c');
      assert.equal(result.getPayload(), payload);
    }
  });

  it('should provide a reasonable error in verifyIdToken with wrong parameters',
     async () => {
       const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
       const fakeCerts = {a: 'a', b: 'b'};
       const idToken = 'idToken';
       const audience = 'fakeAudience';
       const payload = {
         aud: 'aud',
         sub: 'sub',
         iss: 'iss',
         iat: 1514162443,
         exp: 1514166043
       };
       nock('https://www.googleapis.com')
           .get('/oauth2/v1/certs')
           .reply(200, fakeCerts);
       client.verifySignedJwtWithCerts =
           (jwt: string, certs: {}, requiredAudience: string|string[],
            issuers?: string[], theMaxExpiry?: number) => {
             assert.equal(jwt, idToken);
             assert.equal(JSON.stringify(certs), JSON.stringify(fakeCerts));
             assert.equal(requiredAudience, audience);
             return new LoginTicket('c', payload);
           };
       try {
         // tslint:disable-next-line no-any
         await (client as any).verifyIdToken(idToken, audience);
         throw new Error('Expected to throw');
       } catch (e) {
         assert.equal(
             e.message,
             'This method accepts an options object as the first parameter, which includes the idToken, audience, and maxExpiry.');
       }
     });

  it('should allow scopes to be specified as array', (done) => {
    const opts = {
      access_type: ACCESS_TYPE,
      scope: SCOPE_ARRAY,
      response_type: 'code token'
    };

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const generated = oauth2client.generateAuthUrl(opts);
    const parsed = url.parse(generated);
    if (typeof parsed.query !== 'string') {
      throw new Error('Unable to parse querystring');
    }
    const query = qs.parse(parsed.query);
    assert.equal(query.scope, SCOPE_ARRAY.join(' '));
    done();
  });

  it('should set response_type param to code if none is given while' +
         'generating the consent page url',
     (done) => {
       const oauth2client =
           new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
       const generated = oauth2client.generateAuthUrl();
       const parsed = url.parse(generated);
       if (typeof parsed.query !== 'string') {
         throw new Error('Unable to parse querystring');
       }
       const query = qs.parse(parsed.query);
       assert.equal(query.response_type, 'code');
       done();
     });

  // jason: keep
  /*
  it('should return err no access or refresh token is set before making a
  request', (done) => { const auth = new GoogleAuth(); const oauth2client = new
  googleapis.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI); new
  googleapis.GoogleApis() .urlshortener('v1').url.get({ shortUrl: '123', auth:
  oauth2client }, function(err, result) { assert.equal(err.message, 'No access
  or refresh token is set.'); assert.equal(result, null); done();
      });
  });

  it('should not throw any exceptions if only refresh token is set', () => {
    const oauth2client = new googleapis.OAuth2Client(CLIENT_ID, CLIENT_SECRET,
  REDIRECT_URI); oauth2client.credentials = { refresh_token: 'refresh_token' };
    assert.doesNotThrow(() => {
      const google = new googleapis.GoogleApis();
      const options = { auth: oauth2client, shortUrl: '...' };
      google.urlshortener('v1').url.get(options, noop);
    });
  });

  it('should set access token type to Bearer if none is set', (done) => {
    const oauth2client = new googleapis.OAuth2Client(CLIENT_ID, CLIENT_SECRET,
  REDIRECT_URI); oauth2client.credentials = { access_token: 'foo',
  refresh_token: '' };

    const scope =
  nock('https://www.googleapis.com').get('/urlshortener/v1/url/history').reply(200);

    const google = new googleapis.GoogleApis();
    const urlshortener = google.urlshortener('v1');
    urlshortener.url.list({ auth: oauth2client }, function(err) {
      assert.equal(oauth2client.credentials.token_type, 'Bearer');
      scope.done();
      done(err);
    });
  });
*/

  it('should verify a valid certificate against a jwt', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const now = new Date().getTime() / 1000;
    const expiry = now + (maxLifetimeSecs / 2);

    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + now + ',' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const login = oauth2client.verifySignedJwtWithCerts(
        data, {keyid: publicKey}, 'testaudience');

    assert.equal(login.getUserId(), '123456789');
    done();
  });

  it('should fail due to invalid audience', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const now = new Date().getTime() / 1000;
    const expiry = now + (maxLifetimeSecs / 2);

    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"wrongaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + now + ',' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, 'testaudience');
    }, /Wrong recipient/);
    done();
  });

  it('should fail due to invalid array of audiences', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const now = new Date().getTime() / 1000;
    const expiry = now + (maxLifetimeSecs / 2);

    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"wrongaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + now + ',' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const validAudiences = ['testaudience', 'extra-audience'];
    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, validAudiences);
    }, /Wrong recipient/);
    done();
  });

  it('should fail due to invalid signature', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":1393241597,' +
        '"exp":1393245497' +
        '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    // Originally: data += '.'+signature;
    data += signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, 'testaudience');
    }, /Wrong number of segments/);

    done();
  });

  it('should fail due to invalid envelope', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const now = new Date().getTime() / 1000;
    const expiry = now + (maxLifetimeSecs / 2);

    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + now + ',' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid"' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, 'testaudience');
    }, /Can\'t parse token envelope/);

    done();
  });

  it('should fail due to invalid payload', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const now = new Date().getTime() / 1000;
    const expiry = now + (maxLifetimeSecs / 2);

    const idToken = '{' +
        '"iss":"testissuer"' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + now + ',' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, 'testaudience');
    }, /Can\'t parse token payload/);

    done();
  });

  it('should fail due to invalid signature', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const now = new Date().getTime() / 1000;
    const expiry = now + (maxLifetimeSecs / 2);

    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + now + ',' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    const data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64') + '.' +
        'broken-signature';

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, 'testaudience');
    }, /Invalid token signature/);

    done();
  });

  it('should fail due to no expiration date', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const now = new Date().getTime() / 1000;

    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + now + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, 'testaudience');
    }, /No expiration time/);

    done();
  });

  it('should fail due to no issue time', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const now = new Date().getTime() / 1000;
    const expiry = now + (maxLifetimeSecs / 2);

    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, 'testaudience');
    }, /No issue time/);

    done();
  });

  it('should fail due to certificate with expiration date in future',
     (done) => {
       const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
       const privateKey =
           fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

       const maxLifetimeSecs = 86400;
       const now = new Date().getTime() / 1000;
       const expiry = now + (2 * maxLifetimeSecs);
       const idToken = '{' +
           '"iss":"testissuer",' +
           '"aud":"testaudience",' +
           '"azp":"testauthorisedparty",' +
           '"email_verified":"true",' +
           '"id":"123456789",' +
           '"sub":"123456789",' +
           '"email":"test@test.com",' +
           '"iat":' + now + ',' +
           '"exp":' + expiry + '}';
       const envelope = '{' +
           '"kid":"keyid",' +
           '"alg":"RS256"' +
           '}';

       let data = new Buffer(envelope).toString('base64') + '.' +
           new Buffer(idToken).toString('base64');

       const signer = crypto.createSign('sha256');
       signer.update(data);
       const signature = signer.sign(privateKey, 'base64');

       data += '.' + signature;

       const oauth2client =
           new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
       assert.throws(() => {
         oauth2client.verifySignedJwtWithCerts(
             data, {keyid: publicKey}, 'testaudience');
       }, /Expiration time too far in future/);

       done();
     });

  it('should pass due to expiration date in future with adjusted max expiry',
     (done) => {
       const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
       const privateKey =
           fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

       const maxLifetimeSecs = 86400;
       const now = new Date().getTime() / 1000;
       const expiry = now + (2 * maxLifetimeSecs);
       const maxExpiry = (3 * maxLifetimeSecs);
       const idToken = '{' +
           '"iss":"testissuer",' +
           '"aud":"testaudience",' +
           '"azp":"testauthorisedparty",' +
           '"email_verified":"true",' +
           '"id":"123456789",' +
           '"sub":"123456789",' +
           '"email":"test@test.com",' +
           '"iat":' + now + ',' +
           '"exp":' + expiry + '}';
       const envelope = '{' +
           '"kid":"keyid",' +
           '"alg":"RS256"' +
           '}';

       let data = new Buffer(envelope).toString('base64') + '.' +
           new Buffer(idToken).toString('base64');

       const signer = crypto.createSign('sha256');
       signer.update(data);
       const signature = signer.sign(privateKey, 'base64');

       data += '.' + signature;

       const oauth2client =
           new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
       oauth2client.verifySignedJwtWithCerts(
           data, {keyid: publicKey}, 'testaudience', ['testissuer'], maxExpiry);

       done();
     });

  it('should fail due to token being used to early', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const clockSkews = 300;
    const now = (new Date().getTime() / 1000);
    const expiry = now + (maxLifetimeSecs / 2);
    const issueTime = now + (clockSkews * 2);
    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + issueTime + ',' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, 'testaudience');
    }, /Token used too early/);

    done();
  });

  it('should fail due to token being used to late', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const clockSkews = 300;
    const now = (new Date().getTime() / 1000);
    const expiry = now - (maxLifetimeSecs / 2);
    const issueTime = now - (clockSkews * 2);
    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + issueTime + ',' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, 'testaudience');
    }, /Token used too late/);

    done();
  });

  it('should fail due to invalid issuer', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const now = (new Date().getTime() / 1000);
    const expiry = now + (maxLifetimeSecs / 2);
    const idToken = '{' +
        '"iss":"invalidissuer",' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + now + ',' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    assert.throws(() => {
      oauth2client.verifySignedJwtWithCerts(
          data, {keyid: publicKey}, 'testaudience', ['testissuer']);
    }, /Invalid issuer/);

    done();
  });

  it('should pass due to valid issuer', (done) => {
    const publicKey = fs.readFileSync('./test/fixtures/public.pem', 'utf-8');
    const privateKey = fs.readFileSync('./test/fixtures/private.pem', 'utf-8');

    const maxLifetimeSecs = 86400;
    const now = (new Date().getTime() / 1000);
    const expiry = now + (maxLifetimeSecs / 2);
    const idToken = '{' +
        '"iss":"testissuer",' +
        '"aud":"testaudience",' +
        '"azp":"testauthorisedparty",' +
        '"email_verified":"true",' +
        '"id":"123456789",' +
        '"sub":"123456789",' +
        '"email":"test@test.com",' +
        '"iat":' + now + ',' +
        '"exp":' + expiry + '}';
    const envelope = '{' +
        '"kid":"keyid",' +
        '"alg":"RS256"' +
        '}';

    let data = new Buffer(envelope).toString('base64') + '.' +
        new Buffer(idToken).toString('base64');

    const signer = crypto.createSign('sha256');
    signer.update(data);
    const signature = signer.sign(privateKey, 'base64');

    data += '.' + signature;

    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    oauth2client.verifySignedJwtWithCerts(
        data, {keyid: publicKey}, 'testaudience', ['testissuer']);

    done();
  });

  it('should be able to retrieve a list of Google certificates', (done) => {
    const scope =
        nock('https://www.googleapis.com')
            .get('/oauth2/v1/certs')
            .replyWithFile(
                200,
                path.join(__dirname, '../../test/fixtures/oauthcerts.json'));
    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    oauth2client.getFederatedSignonCerts((err, certs) => {
      assert.equal(err, null);
      assert.equal(Object.keys(certs).length, 2);
      assert.notEqual(certs.a15eea964ab9cce480e5ef4f47cb17b9fa7d0b21, null);
      assert.notEqual(certs['39596dc3a3f12aa74b481579e4ec944f86d24b95'], null);
      scope.done();
      done();
    });
  });

  it('should be able to retrieve a list of Google certificates from cache again',
     (done) => {
       const scope =
           nock('https://www.googleapis.com')
               .defaultReplyHeaders({
                 'Cache-Control':
                     'public, max-age=23641, must-revalidate, no-transform',
                 'Content-Type': 'application/json'
               })
               .get('/oauth2/v1/certs')
               .once()
               .replyWithFile(
                   200,
                   path.join(__dirname, '../../test/fixtures/oauthcerts.json'));
       const oauth2client =
           new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
       oauth2client.getFederatedSignonCerts((err, certs) => {
         assert.equal(err, null);
         assert.equal(Object.keys(certs).length, 2);
         scope.done();  // has retrieved from nock... nock no longer will reply
         oauth2client.getFederatedSignonCerts((err2, certs2) => {
           assert.equal(err2, null);
           assert.equal(Object.keys(certs2).length, 2);
           scope.done();
           done();
         });
       });
     });

  it('should set redirect_uri if not provided in options', () => {
    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const generated = oauth2client.generateAuthUrl({});
    const parsed = url.parse(generated);
    if (typeof parsed.query !== 'string') {
      throw new Error('Unable to parse querystring');
    }
    const query = qs.parse(parsed.query);
    assert.equal(query.redirect_uri, REDIRECT_URI);
  });

  it('should set client_id if not provided in options', () => {
    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const generated = oauth2client.generateAuthUrl({});
    const parsed = url.parse(generated);
    if (typeof parsed.query !== 'string') {
      throw new Error('Unable to parse querystring');
    }
    const query = qs.parse(parsed.query);
    assert.equal(query.client_id, CLIENT_ID);
  });

  it('should override redirect_uri if provided in options', () => {
    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const generated =
        oauth2client.generateAuthUrl({redirect_uri: 'overridden'});
    const parsed = url.parse(generated);
    if (typeof parsed.query !== 'string') {
      throw new Error('Unable to parse querystring');
    }
    const query = qs.parse(parsed.query);
    assert.equal(query.redirect_uri, 'overridden');
  });

  it('should override client_id if provided in options', () => {
    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const generated =
        oauth2client.generateAuthUrl({client_id: 'client_override'});
    const parsed = url.parse(generated);
    if (typeof parsed.query !== 'string') {
      throw new Error('Unable to parse querystring');
    }
    const query = qs.parse(parsed.query);
    assert.equal(query.client_id, 'client_override');
  });

  it('should return error in callback on request', (done) => {
    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    oauth2client.request({}, (err, result) => {
      assert.equal(err!.message, 'No access, refresh token or API key is set.');
      assert.equal(result, null);
      done();
    });
  });

  it('should return error in callback on refreshAccessToken', (done) => {
    const oauth2client =
        new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    oauth2client.refreshAccessToken((err, result) => {
      assert.equal(err!.message, 'No refresh token is set.');
      assert.equal(result, null);
      done();
    });
  });

  describe('request()', () => {
    let scope: nock.Scope;

    beforeEach(() => {
      scope = nock('https://www.googleapis.com')
                  .post('/oauth2/v4/token', undefined, {
                    reqheaders:
                        {'content-type': 'application/x-www-form-urlencoded'}
                  })
                  .reply(200, {access_token: 'abc123', expires_in: 1});

      nock('http://example.com').get('/').reply(200);
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('should refresh token if missing access token', (done) => {
      const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      client.credentials = {refresh_token: 'refresh-token-placeholder'};
      client.request({url: 'http://example.com'}, err => {
        console.error(err);
        assert.equal('abc123', client.credentials.access_token);
        done();
      });
    });

    it('should refresh if access token is expired', (done) => {
      const oauth2client =
          new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

      oauth2client.setCredentials({
        access_token: 'initial-access-token',
        refresh_token: 'refresh-token-placeholder',
        expiry_date: (new Date()).getTime() - 1000
      });

      oauth2client.request({url: 'http://example.com'}, () => {
        assert.equal('abc123', oauth2client.credentials.access_token);
        done();
      });
    });


    it('should refresh if access token will expired soon and time to refresh' +
           ' before expiration is set',
       async () => {
         const auth = new GoogleAuth();
         const oauth2client = new OAuth2Client({
           clientId: CLIENT_ID,
           clientSecret: CLIENT_SECRET,
           redirectUri: REDIRECT_URI,
           eagerRefreshThresholdMillis: 5000
         });

         oauth2client.credentials = {
           access_token: 'initial-access-token',
           refresh_token: 'refresh-token-placeholder',
           expiry_date: (new Date()).getTime() + 3000
         };

         await oauth2client.request({url: 'http://example.com'});
         assert.equal('abc123', oauth2client.credentials.access_token);
       });

    it('should not refresh if access token will not expire soon and time to' +
           ' refresh before expiration is set',
       async () => {
         const oauth2client = new OAuth2Client({
           clientId: CLIENT_ID,
           clientSecret: CLIENT_SECRET,
           redirectUri: REDIRECT_URI,
           eagerRefreshThresholdMillis: 5000
         });

         oauth2client.credentials = {
           access_token: 'initial-access-token',
           refresh_token: 'refresh-token-placeholder',
           expiry_date: (new Date()).getTime() + 10000,
         };

         await oauth2client.request({url: 'http://example.com'});

         assert.equal(
             'initial-access-token', oauth2client.credentials.access_token);
         assert.equal(false, scope.isDone());
       });

    it('should not refresh if not expired', (done) => {
      const oauth2client =
          new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

      oauth2client.credentials = {
        access_token: 'initial-access-token',
        refresh_token: 'refresh-token-placeholder',
        expiry_date: (new Date()).getTime() + 500000
      };

      oauth2client.request({url: 'http://example.com'}, () => {
        assert.equal(
            'initial-access-token', oauth2client.credentials.access_token);
        assert.equal(false, scope.isDone());
        done();
      });
    });

    it('should assume access token is not expired', (done) => {
      const oauth2client =
          new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

      oauth2client.credentials = {
        access_token: 'initial-access-token',
        refresh_token: 'refresh-token-placeholder'
      };

      oauth2client.request({url: 'http://example.com'}, () => {
        assert.equal(
            'initial-access-token', oauth2client.credentials.access_token);
        assert.equal(false, scope.isDone());
        done();
      });
    });

    [401, 403].forEach((statusCode) => {
      it('should refresh token if the server returns ' + statusCode, (done) => {
        nock('http://example.com').get('/access').reply(statusCode, {
          error: {code: statusCode, message: 'Invalid Credentials'}
        });

        const oauth2client =
            new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

        oauth2client.credentials = {
          access_token: 'initial-access-token',
          refresh_token: 'refresh-token-placeholder'
        };

        oauth2client.request({url: 'http://example.com/access'}, () => {
          assert.equal('abc123', oauth2client.credentials.access_token);
          done();
        });
      });
    });
  });

  describe('revokeCredentials()', () => {
    it('should revoke credentials if access token present', (done) => {
      const scope = nock('https://accounts.google.com')
                        .get('/o/oauth2/revoke?token=abc')
                        .reply(200, {success: true});
      const oauth2client =
          new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      oauth2client.credentials = {access_token: 'abc', refresh_token: 'abc'};
      oauth2client.revokeCredentials((err, result) => {
        assert.equal(err, null);
        assert.equal(result!.data!.success, true);
        assert.equal(JSON.stringify(oauth2client.credentials), '{}');
        scope.done();
        done();
      });
    });

    it('should clear credentials and return error if no access token to revoke',
       (done) => {
         const oauth2client =
             new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
         oauth2client.credentials = {refresh_token: 'abc'};
         oauth2client.revokeCredentials((err, result) => {
           assert.equal(err!.message, 'No access token to revoke.');
           assert.equal(result, null);
           assert.equal(JSON.stringify(oauth2client.credentials), '{}');
           done();
         });
       });
  });

  describe('getToken()', () => {
    it('should allow a code_verifier to be passed', async () => {
      const oauth2client =
          new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      nock('https://www.googleapis.com')
          .post('/oauth2/v4/token', undefined, {
            reqheaders: {'Content-Type': 'application/x-www-form-urlencoded'}
          })
          .reply(
              200, {access_token: 'abc', refresh_token: '123', expires_in: 10});
      const res = await oauth2client.getToken(
          {code: 'code here', codeVerifier: 'its_verified'});
      assert(res.res);
      if (!res.res) return;
      const params = qs.parse(res.res.config.data);
      assert(params.code_verifier === 'its_verified');
    });

    it('should return expiry_date', (done) => {
      const now = (new Date()).getTime();
      const scope =
          nock('https://www.googleapis.com')
              .post('/oauth2/v4/token', undefined, {
                reqheaders:
                    {'Content-Type': 'application/x-www-form-urlencoded'}
              })
              .reply(
                  200,
                  {access_token: 'abc', refresh_token: '123', expires_in: 10});
      const oauth2client =
          new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      oauth2client.getToken('code here', (err, tokens) => {
        assert(tokens!.expiry_date! >= now + (10 * 1000));
        assert(tokens!.expiry_date! <= now + (15 * 1000));
        scope.done();
        done();
      });
    });

    it('should accept custom authBaseUrl and tokenUrl', async () => {
      const authBaseUrl = 'http://authBaseUrl.com';
      const tokenUrl = 'http://tokenUrl.com';
      const oauth2client = new OAuth2Client(
          CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, {authBaseUrl, tokenUrl});

      const authUrl = oauth2client.generateAuthUrl();
      const authUrlParts = url.parse(authUrl);
      assert.equal(
          authBaseUrl.toLowerCase(),
          authUrlParts.protocol + '//' + authUrlParts.hostname);

      nock(tokenUrl).post('/').reply(200, {});
      const result = await oauth2client.getToken('12345');
    });
  });
});
