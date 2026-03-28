# UniEvent — University Event Management System

A cloud-hosted web application where students browse university events and upload event media. Events are automatically fetched from the **Ticketmaster Discovery API** and displayed as official university events. Deployed on AWS using IAM, VPC, EC2, S3, and Elastic Load Balancing.

---

## AWS Architecture

```
Students (Browser)
        |
        v
[Application Load Balancer]  ← public subnet, internet-facing
        |
   ┌────┴────┐
   |         |
[EC2 AZ-1] [EC2 AZ-2]       ← private subnets, Node.js + PM2
   |         |
   └────┬────┘
        |
   [NAT Gateway]             ← outbound only (fetches Ticketmaster API)
        |
        v
[Ticketmaster API]           ← fetched every 30 minutes via node-cron

EC2 instances also talk to:
  → S3 Bucket               ← stores event posters + user uploads
  → MongoDB Atlas            ← stores event metadata
  → IAM Role                 ← grants EC2 access to S3 (no hardcoded keys)
```

**Why this design:**
- EC2 in **private subnets** — not reachable from the internet directly
- **ALB** distributes traffic; if one EC2 fails, the other keeps serving
- **NAT Gateway** lets private EC2s call external APIs without a public IP
- **IAM Role** on EC2 means no AWS credentials ever touch the code
- **S3** stores all media securely with public access blocked

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, Express 4 |
| Database | MongoDB (Atlas) |
| External API | Ticketmaster Discovery API v2 |
| Event Sync | node-cron (every 30 minutes) |
| Media Storage | AWS S3 |
| Process Manager | PM2 (cluster mode) |
| Cloud | AWS — IAM, VPC, EC2, S3, ALB |

---

## Project Structure

```
unievent/
├── src/
│   ├── config/
│   │   ├── index.js          # Environment config
│   │   ├── database.js       # MongoDB connection
│   │   └── logger.js         # Winston logger
│   ├── models/
│   │   ├── Event.js          # Event schema
│   │   └── MediaUpload.js    # Upload metadata schema
│   ├── routes/
│   │   ├── events.js         # GET /api/events and related
│   │   ├── media.js          # POST /api/media/upload
│   │   └── health.js         # GET /api/health (ALB health check)
│   ├── services/
│   │   ├── eventFetcher.js   # Ticketmaster API + mock seed + scheduler
│   │   └── s3Service.js      # S3 upload and presigned URLs
│   ├── middleware/index.js   # Error handling, admin auth
│   ├── app.js                # Express app setup
│   └── server.js             # Start server + scheduler
├── tests/
│   └── events.test.js        # 28 Jest tests
├── aws-infra/
│   ├── ec2-userdata.sh       # EC2 bootstrap script (runs on launch)
│   └── nginx.conf            # Nginx reverse proxy config
├── .env.example
├── package.json
└── Dockerfile
```

---

## Prerequisites

- Node.js 20+
- MongoDB running locally **or** a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) account
- A free Ticketmaster API key from [developer.ticketmaster.com](https://developer.ticketmaster.com) *(optional — mock events used if not set)*
- An AWS account

---

## Part 1 — Run Locally

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_ORG/unievent.git
cd unievent
cp .env.example .env
```

Edit `.env`:

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/unievent
TICKETMASTER_API_KEY=        # leave blank to use mock events
CORS_ORIGINS=http://localhost:3000
ADMIN_TOKEN=dev-admin
AWS_REGION=us-east-1
AWS_S3_BUCKET=unievent-media
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start MongoDB

```bash
# Local MongoDB
mongod

# OR use MongoDB Atlas — just paste the URI into MONGODB_URI in .env
```

### 4. Seed mock events

```bash
npm run seed
```

Expected output:
```
MongoDB connected: localhost
Seeded 6 mock events
```

### 5. Start the server

```bash
npm run dev
```

Expected output:
```
[info] MongoDB connected: localhost
[info] UniEvent API running on port 5000 [development]
[info] Seeded 6 mock events
[info] Event fetch scheduled every 30 minutes
```

### 6. Test the API

```bash
# Liveness check
curl http://localhost:5000/api/health/ping
# → {"pong":true}

# List events
curl http://localhost:5000/api/events
# → {"events":[...],"pagination":{...}}

# Event categories
curl http://localhost:5000/api/events/categories
# → {"categories":["All","Career","Education","Music","Social","Technology"]}
```

---

## Part 3 — AWS Deployment 


---

### Step 1 — IAM Role for EC2

1. Go to **IAM → Roles → Create role**
2. Select **EC2** as the trusted entity and click **Next**
3. Attach these policies:
   - **AmazonSSMManagedInstanceCore** (allows Session Manager login without SSH)
   - **AmazonSSMReadOnlyAccess** (read-only access to SSM parameters)
   - **AmazonS3FullAccess** (or create a custom policy allowing Get/Put/List for your S3 bucket)
4. Name the role `unievent-ec2-role` and create it
5. Once created, attach the role to your EC2 instances via the launch template or instance settings

> This ensures your EC2 instances can access S3 and SSM securely without hardcoded credentials.

---

### Step 2 — Store Secrets in SSM Parameter Store

1. Go to **Systems Manager → Parameter Store → Create parameter**
2. Enter the following for each secret:

| Name | Value | Type |
|------|-------|------|
| `/unievent/MONGODB_URI` | Your MongoDB Atlas connection string | SecureString |
| `/unievent/TICKETMASTER_API_KEY` | Your Ticketmaster API key | SecureString |
| `/unievent/ADMIN_TOKEN` | Random string for admin endpoints | SecureString |

3. Click **Create** for each parameter

> These parameters can now be fetched securely from EC2 using the IAM role.

---

### Step 3 — Create a VPC

1. Go to **VPC → Create VPC → VPC and more**
2. Settings:

| Option | Value |
|--------|-------|
| Name | `unievent-vpc` |
| IPv4 CIDR block | `10.0.0.0/16` |
| Number of Availability Zones | 2 |
| Public subnets | 2 |
| Private subnets | 2 |
| NAT Gateways | 1 (in one AZ) |
| DNS hostnames | Enabled |

3. Click **Create VPC**
4. AWS automatically creates subnets, route tables, Internet Gateway, and NAT Gateway

---

### Step 4 — Create Security Groups

**SG for ALB** (`sg-alb-unievent`):

- Inbound rules:
  - HTTP (80) from anywhere (`0.0.0.0/0`)
  - HTTPS (443) from anywhere (`0.0.0.0/0`)
- Outbound rules: All traffic

**SG for EC2** (`sg-ec2-unievent`):

- Inbound rules:
  - HTTP (80) from **ALB security group** only
- Outbound rules: All traffic

> EC2 instances are never directly exposed to the internet; only accessible via ALB.

---

### Step 5 — Create S3 Bucket

1. Go to **S3 → Create bucket**
2. Name: `unievent-media` (must be globally unique)
3. Region: same as VPC (e.g., `us-east-1`)
4. Block all public access
5. Enable versioning
6. Click **Create bucket**

> All event posters and user uploads will be stored here securely. Objects are accessed via presigned URLs only.

---

### Step 6 — MongoDB Atlas

1. Sign up at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a cluster:
   - Cloud provider: AWS
   - Region: same as your AWS setup (e.g., `us-east-1`)
   - Tier: Free (M0)
3. Database Access:
   - Add a user: `unievent_app` with a strong password
   - Role: `readWriteAnyDatabase`
4. Network Access:
   - Add IP: `0.0.0.0/0` (or your specific IP)
5. Connect → Drivers → Copy connection string
6. Store connection string in **SSM Parameter Store** (`/unievent/MONGODB_URI`)

---

### Step 7 — Launch EC2 Instances (Launch Template)

1. Go to **EC2 → Launch Templates → Create launch template**
2. Settings:

| Option | Value |
|--------|-------|
| Name | `unievent-lt` |
| AMI | Amazon Linux 2023 (64-bit x86) |
| Instance type | `t3.micro` (or `t3.medium`) |
| Security group | `sg-ec2-unievent` |
| IAM role | `unievent-ec2-role` |

3. Advanced → User Data (paste bootstrap script from earlier)
4. Launch the template in **private subnets**

---

### Step 8 — Create Application Load Balancer (ALB)

1. Go to **EC2 → Load Balancers → Create Load Balancer → Application Load Balancer**
2. Settings:

| Option | Value |
|--------|-------|
| Name | `unievent-alb` |
| Scheme | Internet-facing |
| VPC | `unievent-vpc` |
| Subnets | Both public subnets |
| Security group | `sg-alb-unievent` |

3. Create Target Group:

| Option | Value |
|--------|-------|
| Name | `unievent-tg` |
| Target type | Instances |
| Protocol/Port | HTTP / 80 |
| Health check path | `/api/health/ping` |
| Healthy threshold | 2 checks |
| Interval | 15 seconds |

4. Register EC2 instances from launch template with the target group
5. Attach the target group to the ALB listener

> Your ALB now distributes traffic to EC2 instances in private subnets and performs health checks.

---

### Step 9 — Event Fetching

- **node-cron** triggers every 30 minutes
- Fetches events from Ticketmaster Discovery API
- Parses event info and upserts MongoDB
- Mirrors posters to S3 if `STORE_EVENTS_IN_S3=true`
- Mock events are seeded if no API key is set

---

