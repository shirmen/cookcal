import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

initializeApp();
const auth = getAuth();
const db = getFirestore();
const PASSKEY_ORIGIN = defineString('PASSKEY_ORIGIN');
const PASSKEY_RP_ID = defineString('PASSKEY_RP_ID');
const OWNER_EMAILS = new Set(['migaakuz@gmail.com', 'zayamgl@gmail.com']);
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const credentialCollection = db.collection('passkeys');
const challengeCollection = db.collection('passkeyChallenges');

function configuredOrigins() {
  return PASSKEY_ORIGIN.value().split(',').map((value) => value.trim()).filter(Boolean);
}

function requireOrigin(req, res) {
  const origin = req.get('origin');
  const origins = configuredOrigins();
  if (!origin || !origins.includes(origin)) {
    res.status(403).json({ error: 'This site is not allowed to use passkey sign-in.' });
    return false;
  }
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Cache-Control', 'no-store');
  return true;
}

async function pruneChallenges() {
  const expired = await challengeCollection.where('expiresAt', '<=', Date.now()).limit(100).get();
  if (expired.empty) return;
  const batch = db.batch();
  expired.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

async function requireOwner(req, { requirePasskey = false } = {}) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) throw new Error('Sign in with Google to set up a passkey.');
  const decoded = await auth.verifyIdToken(match[1]);
  const email = normalizeEmail(decoded.email);
  if (!decoded.email_verified || !OWNER_EMAILS.has(email)) {
    throw new Error('This Google account is not an authorized CookCal owner.');
  }
  const existing = await credentialCollection.where('uid', '==', decoded.uid).limit(1).get();
  const passkeySession = decoded.passkeyOwner === true && decoded.firebase?.sign_in_provider === 'custom';
  if (requirePasskey && !passkeySession) {
    throw new Error('Sign in with a passkey before adding another one.');
  }
  if (!existing.empty && !passkeySession) {
    throw new Error('This account already has a passkey. Sign in with it before adding another one.');
  }
  return { decoded, email };
}

async function createChallenge(data) {
  const id = randomUUID();
  await challengeCollection.doc(id).create({ ...data, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return id;
}

async function consumeChallenge(id, expectedType, email, uid) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Passkey request expired. Please try again.');
  const ref = challengeCollection.doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Passkey request expired. Please try again.');
    const challenge = snap.data();
    tx.delete(ref);
    if (challenge.type !== expectedType || challenge.expiresAt < Date.now()) {
      throw new Error('Passkey request expired. Please try again.');
    }
    if (challenge.email !== email || (uid && challenge.uid !== uid)) {
      throw new Error('Passkey request did not match this account.');
    }
    return challenge;
  });
}

function credentialId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(value)) {
    throw new Error('Invalid passkey credential.');
  }
  return value;
}

function rpSettings() {
  const origins = configuredOrigins();
  const rpID = PASSKEY_RP_ID.value().trim().toLowerCase();
  if (!rpID || origins.some((origin) => {
    try {
      const parsed = new URL(origin);
      const secure = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === 'localhost');
      return !secure || parsed.origin !== origin || (parsed.hostname !== rpID && !parsed.hostname.endsWith(`.${rpID}`));
    } catch { return true; }
  })) throw new Error('Passkey origin and RP ID configuration do not match.');
  return { origins, rpID };
}

export const passkey = onRequest({ region: 'us-central1', maxInstances: 5 }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    if (requireOrigin(req, res)) return res.status(204).send('');
    return;
  }
  if (!requireOrigin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  try {
    await pruneChallenges();
    const { origins, rpID } = rpSettings();
    const { action } = req.body || {};

    if (action === 'register-options') {
      const { decoded, email } = await requireOwner(req);
      const existing = await credentialCollection.where('uid', '==', decoded.uid).get();
      const options = await generateRegistrationOptions({
        rpName: 'CookCal',
        rpID,
        userID: Buffer.from(decoded.uid),
        userName: email,
        userDisplayName: email,
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        excludeCredentials: existing.docs.map((doc) => ({
          id: doc.id,
          transports: doc.data().transports || [],
        })),
      });
      const challengeId = await createChallenge({
        type: 'registration', challenge: options.challenge, email, uid: decoded.uid,
      });
      return res.json({ options, challengeId });
    }

    if (action === 'register-verify') {
      const { decoded, email } = await requireOwner(req);
      const { challengeId, response } = req.body || {};
      const challenge = await consumeChallenge(challengeId, 'registration', email, decoded.uid);
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ error: 'Could not verify that passkey.' });
      }
      const credential = verification.registrationInfo.credential;
      const id = credentialId(credential.id);
      await credentialCollection.doc(id).create({
        uid: decoded.uid,
        email,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports || [],
        deviceType: verification.registrationInfo.credentialDeviceType,
        backedUp: verification.registrationInfo.credentialBackedUp,
        createdAt: Date.now(),
      });
      const user = await auth.getUser(decoded.uid);
      await auth.setCustomUserClaims(decoded.uid, { ...user.customClaims, passkeyOwner: true });
      return res.json({ ok: true });
    }

    if (action === 'authentication-options') {
      const email = normalizeEmail(req.body?.email);
      if (!OWNER_EMAILS.has(email)) throw new Error('Could not start passkey sign-in. Check the email and try again.');
      const credentials = await credentialCollection.where('email', '==', email).get();
      if (credentials.empty) throw new Error('No passkey is registered for that email yet. Use Google once to set one up.');
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: credentials.docs.map((doc) => ({
          id: doc.id,
          transports: doc.data().transports || [],
        })),
        userVerification: 'required',
      });
      const challengeId = await createChallenge({ type: 'authentication', challenge: options.challenge, email });
      return res.json({ options, challengeId });
    }

    if (action === 'authentication-verify') {
      const email = normalizeEmail(req.body?.email);
      if (!OWNER_EMAILS.has(email)) throw new Error('Could not verify passkey sign-in.');
      const { challengeId, response } = req.body || {};
      const challenge = await consumeChallenge(challengeId, 'authentication', email);
      const id = credentialId(response?.id);
      const ref = credentialCollection.doc(id);
      const snap = await ref.get();
      if (!snap.exists || snap.data().email !== email) throw new Error('Could not verify passkey sign-in.');
      const stored = snap.data();
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id,
          publicKey: Buffer.from(stored.publicKey, 'base64url'),
          counter: stored.counter,
          transports: stored.transports || [],
        },
      });
      if (!verification.verified) throw new Error('Could not verify passkey sign-in.');
      const user = await auth.getUser(stored.uid);
      if (!user.emailVerified || normalizeEmail(user.email) !== email) {
        throw new Error('This passkey is no longer authorized.');
      }
      await ref.update({ counter: verification.authenticationInfo.newCounter });
      await auth.setCustomUserClaims(stored.uid, { ...user.customClaims, passkeyOwner: true });
      const token = await auth.createCustomToken(stored.uid);
      return res.json({ token });
    }

    return res.status(400).json({ error: 'Unknown passkey action.' });
  } catch (error) {
    console.error('Passkey request failed:', error);
    const status = /not authorized|not allowed|already has a passkey|sign in with a passkey|sign in with Google|expired|did not match|not registered/i.test(error.message) ? 403 : 400;
    return res.status(status).json({ error: error.message || 'Passkey request failed.' });
  }
});
