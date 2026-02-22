# AWS S3 Configuration Guide

This guide walks you through setting up AWS S3 for the Auto Reader project.

## Step 1: Create an AWS Account

If you don't have an AWS account:
1. Go to [https://aws.amazon.com/](https://aws.amazon.com/)
2. Click "Create an AWS Account"
3. Follow the registration process (requires credit card, but S3 has a free tier)

---

## Step 2: Create an S3 Bucket

1. Sign in to the [AWS Console](https://console.aws.amazon.com/)
2. Search for "S3" in the search bar and click on S3
3. Click **Create bucket**

### Bucket Configuration:

| Setting | Value |
|---------|-------|
| Bucket name | `auto-reader-documents` (must be globally unique, add random suffix if taken) |
| AWS Region | Choose closest to your users (e.g., `us-east-1`) |
| Object Ownership | ACLs disabled (recommended) |
| Block Public Access | **Keep all blocked** (we use presigned URLs) |
| Bucket Versioning | Enable (optional, helps with recovery) |
| Encryption | Server-side encryption with Amazon S3 managed keys (SSE-S3) |

4. Click **Create bucket**

---

## Step 3: Configure CORS

CORS (Cross-Origin Resource Sharing) allows the Chrome extension to upload directly to S3.

1. Go to your bucket → **Permissions** tab
2. Scroll to **Cross-origin resource sharing (CORS)**
3. Click **Edit** and paste this configuration:

```json
[
    {
        "AllowedHeaders": [
            "*"
        ],
        "AllowedMethods": [
            "GET",
            "PUT",
            "POST",
            "DELETE",
            "HEAD"
        ],
        "AllowedOrigins": [
            "http://localhost:3000",
            "chrome-extension://*",
            "https://your-production-domain.com"
        ],
        "ExposeHeaders": [
            "ETag",
            "x-amz-meta-custom-header"
        ],
        "MaxAgeSeconds": 3600
    }
]
```

4. Click **Save changes**

---

## Step 4: Create an IAM User

IAM (Identity and Access Management) controls who can access your AWS resources.

1. Go to [IAM Console](https://console.aws.amazon.com/iam/)
2. Click **Users** → **Create user**

### User Configuration:

| Setting | Value |
|---------|-------|
| User name | `auto-reader-backend` |
| Access type | Check "Access key - Programmatic access" |

3. Click **Next: Permissions**

---

## Step 5: Create IAM Policy

1. Click **Attach policies directly**
2. Click **Create policy** (opens new tab)
3. Click **JSON** tab and paste:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AutoReaderS3Access",
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::auto-reader-documents",
                "arn:aws:s3:::auto-reader-documents/*"
            ]
        }
    ]
}
```

> **Note**: Replace `auto-reader-documents` with your actual bucket name if different.

4. Click **Next: Tags** → **Next: Review**
5. Name the policy: `AutoReaderS3Policy`
6. Click **Create policy**

---

## Step 6: Attach Policy to User

1. Go back to the user creation tab
2. Click the refresh button next to the policy list
3. Search for `AutoReaderS3Policy` and check it
4. Click **Next: Tags** → **Next: Review** → **Create user**

---

## Step 7: Generate Access Keys

1. Click on the user you just created
2. Go to **Security credentials** tab
3. Scroll to **Access keys** → Click **Create access key**
4. Select **Application running outside AWS**
5. Click **Next** → **Create access key**

**IMPORTANT**: Save these credentials immediately! You won't be able to see the secret key again.

```
Access Key ID:     AKIA...............
Secret Access Key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Step 8: Update Backend Configuration

Edit your backend `.env` file:

```bash
# /Users/czk/auto-researcher/backend/.env

# Server Configuration
PORT=3000
NODE_ENV=development

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/auto_researcher

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=AKIA...............      # Your Access Key ID
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxx...      # Your Secret Access Key
AWS_REGION=us-east-1                        # Your bucket region
AWS_S3_BUCKET=auto-reader-documents         # Your bucket name

# CORS Configuration
CORS_ORIGIN=*
```

---

## Step 9: Verify Configuration

Test that everything works:

```bash
cd /Users/czk/auto-researcher/backend
npm install
npm run dev
```

Then test the upload endpoint:

```bash
# Test presigned URL generation
curl -X POST http://localhost:3000/api/upload/presigned \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.pdf", "contentType": "application/pdf"}'
```

Expected response:
```json
{
  "uploadUrl": "https://auto-reader-documents.s3.us-east-1.amazonaws.com/...",
  "key": "default_user/1234567890-abc123-test.pdf",
  "expiresIn": 3600
}
```

---

## Troubleshooting

### Error: "Access Denied"
- Check that the IAM policy has the correct bucket name
- Verify the access keys are correct in `.env`
- Ensure the bucket exists in the specified region

### Error: "CORS policy" in browser
- Verify CORS configuration in S3 bucket settings
- Make sure `chrome-extension://*` is in AllowedOrigins
- Check that the correct HTTP methods are allowed

### Error: "Invalid bucket name"
- Bucket names must be globally unique
- Only lowercase letters, numbers, and hyphens
- 3-63 characters long

### Error: "Region mismatch"
- Ensure `AWS_REGION` in `.env` matches the bucket's actual region
- Find your bucket region in S3 console under bucket properties

---

## Cost Estimation

AWS S3 pricing (as of 2024, us-east-1):

| Resource | Free Tier | After Free Tier |
|----------|-----------|-----------------|
| Storage | 5 GB/month (12 months) | $0.023/GB/month |
| PUT requests | 2,000/month | $0.005/1,000 requests |
| GET requests | 20,000/month | $0.0004/1,000 requests |
| Data transfer out | 100 GB/month | $0.09/GB |

For a personal research library with ~100 PDFs/month (avg 2MB each):
- Storage: ~200 MB/month = Free tier
- Requests: ~200 PUT + ~500 GET = Free tier
- **Estimated cost: $0** (within free tier)

---

## Security Best Practices

1. **Never commit `.env` to git** - Already in `.gitignore`
2. **Use minimal IAM permissions** - Our policy only allows necessary actions
3. **Enable bucket versioning** - Protects against accidental deletion
4. **Keep access keys secure** - Rotate keys periodically
5. **Use presigned URLs** - Files aren't publicly accessible
6. **Enable CloudTrail** - Audit access to your bucket (optional)

---

## Quick Reference

After setup, your configuration should look like:

```
AWS Account
└── S3 Bucket: auto-reader-documents
    ├── Region: us-east-1
    ├── Public Access: Blocked
    ├── CORS: Configured
    └── Encryption: SSE-S3

└── IAM User: auto-reader-backend
    ├── Policy: AutoReaderS3Policy
    └── Access Keys: Created and saved
```
