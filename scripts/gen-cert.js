const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');

async function main() {
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = await selfsigned.generate(attrs);
  const certDir = path.join(__dirname, '..', 'cert');
  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(path.join(certDir, 'server.key'), pems.private);
  fs.writeFileSync(path.join(certDir, 'server.crt'), pems.cert);
  console.log('Generated: cert/server.key, cert/server.crt');
}
main().catch(e => { console.error(e); process.exit(1); });
