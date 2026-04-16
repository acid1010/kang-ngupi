import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

// Let's create a tiny base64 1x1 JPEG to test true mime type
const b64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const buf = Buffer.from(b64, 'base64');
fs.writeFileSync('/home/ubuntu/workspace-sobatngupi/backend/tmp/real_test.jpg', buf);

async function main() {
  const file = '/home/ubuntu/workspace-sobatngupi/backend/tmp/real_test.jpg';
  console.log('Sending True JPEG via openclaw...');
  const { stdout, stderr } = await execFileAsync('/home/ubuntu/.local/bin/openclaw', [
    'message', 'send', '--channel', 'whatsapp', '--target', '+6285155022960', 
    '--media', file, 
    '--message', 'Test openclaw with true JPEG file'
  ]);
  console.log('stdout:', stdout);
  console.log('stderr:', stderr);
}
main().catch(console.error);
