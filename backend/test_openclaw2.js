import { execFile } from 'child_process';
import { promisify } from 'util';
import QRCode from 'qrcode';

const execFileAsync = promisify(execFile);

async function main() {
  const file = '/home/ubuntu/workspace-sobatngupi/backend/test_qris_openclaw.png';
  await QRCode.toFile(file, 'test-qr-string-2', { errorCorrectionLevel: 'M', margin: 1, width: 720, type: 'png' });
  
  console.log('Sending via openclaw...');
  const start = Date.now();
  const { stdout, stderr } = await execFileAsync('/home/ubuntu/.local/bin/openclaw', [
    'message', 'send', '--channel', 'whatsapp', '--target', '+6285155022960', '--media', file, '--message', 'Test openclaw image with local workspace path'
  ]);
  const end = Date.now();
  console.log(`Openclaw finished in ${end - start}ms`);
  console.log('stdout:', stdout);
  console.log('stderr:', stderr);
}
main().catch(console.error);
