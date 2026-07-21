import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const onlyTarget = onlyIndex !== -1 ? args[onlyIndex + 1] : null;

console.log('🚀 Starting Pasdiu deployment pipeline...\n');

// 1. Verify .firebaserc & extract project ID
const firebasercPath = path.join(ROOT, '.firebaserc');
const firebasercContent = JSON.parse(fs.readFileSync(firebasercPath, 'utf8'));
const projectId = firebasercContent.projects?.default;

if (!projectId || projectId.includes('REPLACE_ME')) {
  console.error('✖ .firebaserc contains an invalid or placeholder project ID. Set your real Firebase project ID first.');
  process.exit(1);
}

const exec = (cmd, cwd = ROOT) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

const isHostingOnly = onlyTarget === 'hosting';
const isFunctionsOnly = onlyTarget === 'functions';

// 2. Build frontend assets if deploying hosting or full deployment
if (!isFunctionsOnly) {
  console.log('📦 Step: Building @pasdiu/shared...');
  exec('npm run build -w shared');

  console.log('\n🎨 Step: Building Vue web application...');
  exec('npm run build -w app');

  console.log('\n📁 Step: Staging app/dist for Firebase Hosting...');
  const targetDir = path.join(ROOT, 'firebase', 'app');
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(path.join(ROOT, 'app', 'dist'), targetDir, { recursive: true });
  console.log('✔ Staged dist to firebase/app');
}

// 3. Build functions if deploying functions or full deployment
if (!isHostingOnly) {
  if (isFunctionsOnly) {
    console.log('📦 Step: Building @pasdiu/shared...');
    exec('npm run build -w shared');
  }
  console.log('\n⚡ Step: Building Cloud Functions...');
  exec('npm run build -w firebase/functions');
}

// 4. Deploy to Firebase
const deployFlag = onlyTarget ? `--only ${onlyTarget}` : '';
console.log(`\n🔥 Deploying to Firebase project '${projectId}' (${onlyTarget ? `--only ${onlyTarget}` : 'Full Deployment'})...`);
exec(`npx firebase deploy ${deployFlag} --config firebase/firebase.json --project ${projectId}`, ROOT);

console.log('\n🎉 Deployment complete!');
