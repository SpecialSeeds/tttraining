/*
 * Vault: encrypts and decrypts the training plan and workout logs.
 *
 * The plan is never stored in plaintext on the public site. vault.json holds
 * AES-GCM ciphertext whose 256 bit key is derived from username + password
 * with PBKDF2 (SHA-256, 600,000 iterations, random 16 byte salt).
 * A wrong username or password fails the GCM authentication tag, so the
 * login check and the decryption are the same operation.
 *
 * Uses only the browser's built in Web Crypto API. No dependencies.
 */
(function (root) {
  'use strict';

  const ITERATIONS = 600000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function toB64(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < arr.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function fromB64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function random(n) {
    return root.crypto.getRandomValues(new Uint8Array(n));
  }

  function normalizeUser(username) {
    return String(username).trim().toLowerCase();
  }

  async function deriveKey(username, password, saltB64, iterations) {
    const material = await root.crypto.subtle.importKey(
      'raw',
      enc.encode(normalizeUser(username) + '\u0000' + password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return root.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false, // non extractable: the raw key can never be read back out
      ['encrypt', 'decrypt']
    );
  }

  async function encryptWithKey(key, value) {
    const iv = random(12);
    const ct = await root.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(JSON.stringify(value))
    );
    return { iv: toB64(iv), ct: toB64(ct) };
  }

  async function decryptWithKey(key, box) {
    const pt = await root.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(box.iv) },
      key,
      fromB64(box.ct)
    );
    return JSON.parse(dec.decode(pt));
  }

  async function createVault(username, password, plan) {
    const salt = toB64(random(16));
    const key = await deriveKey(username, password, salt, ITERATIONS);
    return {
      format: 'tt-vault',
      v: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt },
      data: await encryptWithKey(key, plan),
    };
  }

  async function unlock(vault, username, password) {
    const key = await deriveKey(username, password, vault.kdf.salt, vault.kdf.iterations);
    const plan = await decryptWithKey(key, vault.data); // throws on wrong credentials
    return { key, plan };
  }

  root.Vault = { createVault, unlock, encryptWithKey, decryptWithKey, ITERATIONS };
})(typeof window !== 'undefined' ? window : globalThis);
