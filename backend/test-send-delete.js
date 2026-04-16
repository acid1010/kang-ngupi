import { execFile } from 'child_process';
import QRCode from 'qrcode';
import { rm } from 'fs/promises';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function test() {
  const tempFile = '/tmp/test-qr-del.png';
  await QRCode.toFile(tempFile, 'test qris string', { width: 720, type: 'png' });
  
  console.log('Sending...');
  const { stdout, stderr } = await execFileAsync('openclaw', ['message', 'send', '--channel', 'whatsapp', '--target', '+6285155022960', '--media', tempFile, '--message', 'Test caption (deleted fast)']);
  console.log('CLI stdout:', stdout);
  
  await rm(tempFile, { force: true });
  console.log('File deleted immediately');
}

test();
