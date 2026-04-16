import { execFile } from 'child_process';
import { promisify } from 'util';
import QRCode from 'qrcode';

const execFileAsync = promisify(execFile);

async function main() {
  const file = '/home/ubuntu/workspace-sobatngupi/backend/tmp/test_qris.jpeg';
  // Generate JPEG instead of PNG
  await QRCode.toFile(file, 'test-qr-string', { 
    errorCorrectionLevel: 'M', 
    margin: 1, 
    width: 720, 
    type: 'jpeg',
    color: {
      light: '#FFFFFFFF', // Ensure white background, no transparency
      dark: '#000000FF'
    }
  });
  
  console.log('Sending JPEG via openclaw...');
  const { stdout, stderr } = await execFileAsync('/home/ubuntu/.local/bin/openclaw', [
    'message', 'send', '--channel', 'whatsapp', '--target', '+6285155022960', 
    '--media', file, 
    '--message', 'Test openclaw image delay (JPEG)'
  ]);
  console.log('stdout:', stdout);
  console.log('stderr:', stderr);
}
main().catch(console.error);
