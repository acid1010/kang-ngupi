import { execFile } from 'child_process';
import QRCode from 'qrcode';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function test() {
  const tempFile = '/tmp/test-qr-nodel.png';
  await QRCode.toFile(tempFile, 'test qris string', { width: 720, type: 'png' });
  
  console.log('Sending...');
  const { stdout, stderr } = await execFileAsync('openclaw', ['message', 'send', '--channel', 'whatsapp', '--target', '+6285155022960', '--media', tempFile, '--message', 'Test caption nodel']);
  console.log('CLI stdout:', stdout);
}

test();
