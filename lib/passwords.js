// Shared password hashing for Ryujin auth.
//
// MUST stay byte-for-byte compatible with the inline impl in api/auth.js (scrypt,
// 64-byte key, stored as "salt:hexhash") so a password set by one path verifies via
// the other. Used by api/users.js (admin-created crew accounts) so those users can
// log in through api/auth.js?action=login.
import crypto from 'crypto';

export function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === attempt;
}
