import crypto from 'crypto';

const payload = {
  ref: "refs/heads/main",
  repository: {
    clone_url: "https://github.com/clickbitau/click-deploy.git",
    html_url: "https://github.com/clickbitau/click-deploy"
  }
};

const body = JSON.stringify(payload);
const secret = "848d5f1095a8a80b4745a7cf8297efba";
const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

fetch('https://deploy.clickbit.com.au/api/webhooks/github', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-GitHub-Event': 'push',
    'X-Hub-Signature-256': signature
  },
  body
}).then(res => res.text()).then(console.log).catch(console.error);
