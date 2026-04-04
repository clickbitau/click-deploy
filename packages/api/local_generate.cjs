const sshpk = require('sshpk');
const { createCipheriv, randomBytes, scryptSync } = require('crypto');

const secret = '28ec86b0b9d675b4fcf1a153f2c957b2027a33fa847821c67cffe8d2d768bf33';
const SALT = 'click-deploy-ssh-key-salt';
const keyDer = scryptSync(secret, SALT, 32);

function encrypt(plaintext) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', keyDer, iv);
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

const key = sshpk.generatePrivateKey('ed25519');
const pubKey = key.toPublic().toString('ssh') + ' cluster-key';
const privKey = key.toString('openssh');

const { createHash } = require('crypto');
const parts = pubKey.trim().split(/\s+/);
const hash = createHash('sha256').update(Buffer.from(parts[1], 'base64')).digest('base64').replace(/=+$/, '');
const fingerprint = 'SHA256:' + hash;

console.log('PUBLIC_KEY_START\n' + pubKey + '\nPUBLIC_KEY_END');
console.log('SQL_START');
console.log(`UPDATE ssh_keys SET private_key = '${encrypt(privKey)}', public_key = '${pubKey}', fingerprint = '${fingerprint}' WHERE name = 'cluster-key';`);
console.log('SQL_END');
