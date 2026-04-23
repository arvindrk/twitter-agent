# AWS EC2 + Docker Deployment Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy the twitter-agent Hono/Bun server on AWS EC2 behind Nginx, using Docker containers stored in Amazon ECR, with GitHub Actions for automated deploys on every push to `main`.

**Architecture:** EC2 t2.micro (free tier) runs Docker Compose which pulls the app image from ECR. Nginx on the host proxies port 80/443 → port 3010 inside the container. GitHub Actions builds, pushes to ECR, then SSH-deploys on every `git push main`. The `.env` file lives only on EC2 — never in the image or git.

**Tech Stack:** Bun (runtime), Docker + Docker Compose v2, Amazon ECR, Amazon EC2 (Ubuntu 22.04), Nginx, Certbot (TLS), GitHub Actions, AWS IAM

---

## Prerequisites (read before starting)

- AWS account with billing set up (t2.micro is free for 12 months on new accounts)
- GitHub repo for this project
- Your `.env` file contents (all the secrets — you'll SCP this to EC2 once)
- AWS CLI installed locally: `brew install awscli` → `aws configure`

---

## Task 1: Create the Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Step 1: Create `.dockerignore`**

```
node_modules
.env
.env.*
.git
*.md
docs/
drizzle/
api/
```

**Step 2: Create `Dockerfile`**

```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src/ ./src/

EXPOSE 3010
CMD ["bun", "src/index.ts"]
```

Why `--production`: strips `devDependencies` (typescript, drizzle-kit, tsx, @types/*). Bun runs TypeScript natively so no build step is needed.

**Step 3: Verify it builds locally**

```bash
docker build -t twitter-agent:local .
```

Expected: image builds successfully, no errors.

**Step 4: Smoke-test the container locally (with your .env)**

```bash
docker run --rm --env-file .env -p 3010:3010 twitter-agent:local
```

Expected output:
```
Server is running on http://localhost:3010
```

Hit it: `curl http://localhost:3010/` → `{"ok":true}`

Ctrl+C to stop.

**Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile for Bun/Hono app"
```

---

## Task 2: Create docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

**Step 1: Create `docker-compose.yml`**

```yaml
services:
  app:
    image: ${ECR_IMAGE}
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:3010:3010"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3010/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

Key decisions:
- `ports: "127.0.0.1:3010:3010"` — binds to loopback only. Port 3010 is NOT exposed to the internet. Nginx proxies to it.
- `ECR_IMAGE` is an env var set in the deploy step (GitHub Actions injects it).
- `env_file: .env` — reads the `.env` file from the same directory on EC2.

**Step 2: Verify locally with local image**

```bash
ECR_IMAGE=twitter-agent:local docker compose up
```

Expected: same `{"ok":true}` on port 3010.

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose for EC2 deployment"
```

---

## Task 3: AWS IAM Setup

Do this in the AWS Console (or CLI). One-time setup.

**Step 1: Create ECR repository**

```bash
aws ecr create-repository \
  --repository-name twitter-agent \
  --region us-east-1
```

Note the `repositoryUri` output — looks like:
`123456789012.dkr.ecr.us-east-1.amazonaws.com/twitter-agent`

Save this — you'll need it everywhere.

**Step 2: Create IAM role for EC2 (so it can pull from ECR without keys)**

In AWS Console → IAM → Roles → Create role:
- Trusted entity: AWS service → EC2
- Attach policy: `AmazonEC2ContainerRegistryReadOnly`
- Role name: `ec2-twitter-agent-role`

**Step 3: Create IAM user for GitHub Actions (to push to ECR)**

In AWS Console → IAM → Users → Create user:
- Name: `github-actions-ecr`
- Access type: Programmatic only
- Attach policy: `AmazonEC2ContainerRegistryPowerUser`
- Save the Access Key ID and Secret Access Key — you'll add these to GitHub Secrets

---

## Task 4: Launch EC2 Instance

Do this in the AWS Console. One-time setup.

**Step 1: Launch instance**

- AMI: Ubuntu Server 22.04 LTS (x86_64)
- Instance type: `t2.micro` (free tier eligible)
- Key pair: create new → download `.pem` file → save to `~/.ssh/twitter-agent.pem`
- IAM instance profile: select `ec2-twitter-agent-role`
- Storage: 8GB gp3 (default is fine)

**Step 2: Configure Security Group**

Name it `twitter-agent-sg`. Inbound rules:

| Type | Protocol | Port | Source |
|------|----------|------|--------|
| SSH | TCP | 22 | My IP (your current IP) |
| HTTP | TCP | 80 | 0.0.0.0/0 |
| HTTPS | TCP | 443 | 0.0.0.0/0 |

Do NOT open port 3010 — Nginx handles external traffic on 80/443.

**Step 3: Allocate and associate Elastic IP**

EC2 Console → Elastic IPs → Allocate → Associate → select your instance.

Note the IP — cron-job.org will hit `http://<ELASTIC_IP>/cron/daily`.

**Step 4: Fix SSH key permissions and connect**

```bash
chmod 400 ~/.ssh/twitter-agent.pem
ssh -i ~/.ssh/twitter-agent.pem ubuntu@<ELASTIC_IP>
```

Expected: Ubuntu shell prompt.

---

## Task 5: EC2 Baseline Setup (run these on EC2 via SSH)

**Step 1: Install Docker**

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker
```

Verify: `docker --version` → `Docker version 27.x.x`

**Step 2: Install AWS CLI (for ECR login)**

```bash
sudo apt-get install -y awscli
```

Verify: `aws --version`

**Step 3: Create app directory**

```bash
mkdir -p ~/twitter-agent
```

**Step 4: Upload your `.env` from local machine (run this locally, not on EC2)**

```bash
scp -i ~/.ssh/twitter-agent.pem .env ubuntu@<ELASTIC_IP>:~/twitter-agent/.env
```

Then on EC2, lock it down:

```bash
chmod 600 ~/twitter-agent/.env
```

**Step 5: Install Nginx**

```bash
sudo apt-get update && sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

Verify: `curl http://localhost` → default Nginx page HTML.

---

## Task 6: First Manual Deploy (validates ECR + Docker pull)

Run these commands to prove the pipeline works before automating it.

**Step 1: Locally — build and push image to ECR**

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  123456789012.dkr.ecr.us-east-1.amazonaws.com

# Build and tag
docker build -t twitter-agent:latest .
docker tag twitter-agent:latest \
  123456789012.dkr.ecr.us-east-1.amazonaws.com/twitter-agent:latest

# Push
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/twitter-agent:latest
```

Expected: layers uploading, then `latest: digest: sha256:...`

**Step 2: On EC2 — pull and run**

```bash
# Login to ECR (EC2 uses instance role, no keys needed)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  123456789012.dkr.ecr.us-east-1.amazonaws.com

# Copy docker-compose.yml to EC2 (run this locally)
scp -i ~/.ssh/twitter-agent.pem docker-compose.yml ubuntu@<ELASTIC_IP>:~/twitter-agent/

# Back on EC2 — run it
cd ~/twitter-agent
ECR_IMAGE=123456789012.dkr.ecr.us-east-1.amazonaws.com/twitter-agent:latest \
  docker compose up -d
```

**Step 3: Verify container is running**

```bash
docker compose ps
# Expected: app   running (healthy)

docker compose logs --tail=20
# Expected: Server is running on http://localhost:3010

curl http://localhost:3010/
# Expected: {"ok":true}
```

---

## Task 7: Nginx Reverse Proxy Config

**Files:**
- Create on EC2: `/etc/nginx/sites-available/twitter-agent`

**Step 1: Write Nginx config on EC2**

```bash
sudo tee /etc/nginx/sites-available/twitter-agent > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
EOF
```

`proxy_read_timeout 120s` — critical. Your `/cron/daily` pipeline can take 90s before returning 202. Without this, Nginx times out at 60s default.

**Step 2: Enable site and reload Nginx**

```bash
sudo ln -s /etc/nginx/sites-available/twitter-agent /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
# Expected: syntax is ok / test is successful
sudo systemctl reload nginx
```

**Step 3: Verify end-to-end through Nginx**

From your local machine:

```bash
curl http://<ELASTIC_IP>/
# Expected: {"ok":true}
```

**Step 4: (Optional but recommended) Add TLS via Certbot**

Only do this if you have a domain name pointing to the Elastic IP.

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

Certbot auto-modifies your Nginx config to handle 443 and redirect 80 → 443.

---

## Task 8: systemd Service for Auto-Restart on Reboot

**Files:**
- Create on EC2: `/etc/systemd/system/twitter-agent.service`

**Step 1: Create systemd unit**

```bash
sudo tee /etc/systemd/system/twitter-agent.service > /dev/null <<'EOF'
[Unit]
Description=Twitter Agent (Docker Compose)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/twitter-agent
Environment=ECR_IMAGE=123456789012.dkr.ecr.us-east-1.amazonaws.com/twitter-agent:latest
ExecStartPre=/usr/bin/aws ecr get-login-password --region us-east-1 | /usr/bin/docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
```

**Step 2: Enable and start**

```bash
sudo systemctl daemon-reload
sudo systemctl enable twitter-agent
sudo systemctl start twitter-agent
sudo systemctl status twitter-agent
# Expected: active (exited) — oneshot services show "exited" when done, not "running"
```

**Step 3: Test reboot**

```bash
sudo reboot
```

Wait 60 seconds, then SSH back in:

```bash
ssh -i ~/.ssh/twitter-agent.pem ubuntu@<ELASTIC_IP>
docker ps
# Expected: twitter-agent app container running
curl http://localhost:3010/
# Expected: {"ok":true}
```

---

## Task 9: GitHub Actions CI/CD

**Files:**
- Create: `.github/workflows/deploy.yml`

**Step 1: Add secrets to GitHub repo**

In GitHub → repo → Settings → Secrets and variables → Actions:

| Secret name | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | from the `github-actions-ecr` IAM user |
| `AWS_SECRET_ACCESS_KEY` | from the `github-actions-ecr` IAM user |
| `EC2_HOST` | your Elastic IP |
| `EC2_SSH_KEY` | contents of `~/.ssh/twitter-agent.pem` (the full PEM including headers) |
| `ECR_REGISTRY` | `123456789012.dkr.ecr.us-east-1.amazonaws.com` |

**Step 2: Create workflow file**

```yaml
name: Deploy

on:
  push:
    branches: [main]

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: twitter-agent

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push image
        id: build
        env:
          REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker tag $REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $REGISTRY/$ECR_REPOSITORY:latest
          docker push $REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $REGISTRY/$ECR_REPOSITORY:latest
          echo "image=$REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" >> $GITHUB_OUTPUT

      - name: Deploy to EC2
        env:
          ECR_IMAGE: ${{ steps.build.outputs.image }}
        run: |
          echo "${{ secrets.EC2_SSH_KEY }}" > /tmp/ec2_key.pem
          chmod 400 /tmp/ec2_key.pem
          ssh -o StrictHostKeyChecking=no -i /tmp/ec2_key.pem ubuntu@${{ secrets.EC2_HOST }} \
            "cd ~/twitter-agent && \
             aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY }} && \
             ECR_IMAGE=${{ steps.build.outputs.image }} docker compose pull && \
             ECR_IMAGE=${{ steps.build.outputs.image }} docker compose up -d && \
             docker image prune -f"
          rm /tmp/ec2_key.pem
```

**Step 3: Push to main and watch it run**

```bash
git add .github/
git commit -m "feat: add GitHub Actions deploy workflow"
git push origin main
```

Go to GitHub → Actions tab → watch the `Deploy` workflow run.

Expected progression:
1. Checkout ✓
2. Configure AWS credentials ✓
3. Login to ECR ✓
4. Build, tag, push image ✓ (~2-3 min)
5. Deploy to EC2 ✓ (~30s)

**Step 4: Verify after deploy**

```bash
curl http://<ELASTIC_IP>/
# Expected: {"ok":true}
```

---

## Task 10: Configure cron-job.org

Update your cron-job.org jobs to hit the new EC2 URL.

**Job 1 — Daily pipeline:**
- URL: `http://<ELASTIC_IP>/cron/daily`
- Method: GET
- Header: `x-cron-secret: <your CRON_SECRET value>`
- Schedule: daily at your preferred time (e.g. 07:00 UTC)
- Timeout: 10s (route returns 202 immediately, pipeline runs async)

**Job 2 — Execute posts:**
- URL: `http://<ELASTIC_IP>/cron/execute-post`
- Method: POST
- Header: `x-cron-secret: <your CRON_SECRET value>`
- Body: `{}` (scan mode — no postId)
- Schedule: every 30 minutes

**Verify job 1 manually:**

```bash
curl -v -X GET http://<ELASTIC_IP>/cron/daily \
  -H "x-cron-secret: <your_secret>"
# Expected: HTTP 202, {"ok":true,"runId":"..."}
```

Then check EC2 logs:

```bash
ssh -i ~/.ssh/twitter-agent.pem ubuntu@<ELASTIC_IP> \
  "cd ~/twitter-agent && docker compose logs --tail=50 --follow"
```

Watch the researcher → writer → scheduler pipeline logs appear.

---

## Troubleshooting Reference

| Symptom | Command | Common cause |
|---|---|---|
| Container not starting | `docker compose logs` | Bad env var, port conflict |
| 502 Bad Gateway | `sudo nginx -t && curl localhost:3010` | App crashed, check compose logs |
| ECR pull fails on EC2 | `aws sts get-caller-identity` | IAM role not attached to instance |
| SSH refused | Check Security Group port 22 | Your IP changed, update inbound rule |
| Cron returns 401 | `echo $CRON_SECRET` in container | .env not loaded, check env_file path |
| Image too large | `docker images` | Add more to .dockerignore, check node_modules |

---

## Cost Summary (post-setup)

| Resource | Monthly cost |
|---|---|
| EC2 t2.micro (free tier) | $0 for 12 months, then $9.50 |
| EBS 8GB gp3 | $0.64 |
| Elastic IP (attached) | $0 |
| ECR (< 500MB free tier) | $0 |
| Data transfer (< 100GB/month) | $0 |
| **Total** | **$0.64/month for 12 months** |
