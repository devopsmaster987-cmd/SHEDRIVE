# Deploying SheDrive on AWS EKS

This guide takes a fresh AWS account to a working SheDrive deployment:

- frontend: Vite build in S3, served by CloudFront
- backend: 2 replicas behind an AWS LoadBalancer, with Redis for Socket.IO fan-out
- face service: 2 internal replicas
- database: MongoDB Atlas
- driver licence documents: Amazon EFS shared by both backend replicas
- observability: Prometheus, Grafana and Alertmanager in the `monitoring` namespace
- images: Amazon ECR

The commands are written for bash/Linux/macOS or Git Bash/WSL. Replace every
`example.com`, account ID and placeholder password before using them.

> **Cost warning:** the EKS control plane costs about **$0.10/hour** (roughly
> **$2.40/day**) before worker nodes, NAT gateways, load balancers, EFS, S3,
> CloudFront or Atlas. A two-node `t3.medium` cluster is a useful demo size but is
> not free. Delete the cluster and other resources when the demo is over.

## 1. Prerequisites

Install and configure:

- AWS CLI v2, authenticated with an account that can create EKS, ECR, EFS, IAM,
  S3, CloudFront and CloudWatch resources
- `eksctl` 0.190 or newer
- `kubectl`, `helm`, `jq` and Docker

Check access:

```bash
aws sts get-caller-identity
eksctl version
kubectl version --client
```

Set variables used throughout this guide:

```bash
export AWS_REGION=ap-south-1
export CLUSTER_NAME=shedrive
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
```

## 2. Billing alarm

Billing metrics are published in `us-east-1` regardless of where the app runs.
Enable **Billing preferences → Alert preferences → CloudWatch billing alerts** in
the AWS console first.

```bash
aws sns create-topic --name shedrive-billing-alerts --region us-east-1
aws sns subscribe \
  --topic-arn "arn:aws:sns:us-east-1:$ACCOUNT_ID:shedrive-billing-alerts" \
  --protocol email \
  --notification-endpoint you@example.com \
  --region us-east-1

aws cloudwatch put-metric-alarm \
  --region us-east-1 \
  --alarm-name "shedrive-monthly-estimate-25-usd" \
  --alarm-description "Warn when the AWS monthly estimate exceeds 25 USD" \
  --namespace AWS/Billing \
  --metric-name EstimatedCharges \
  --statistic Maximum \
  --period 21600 \
  --evaluation-periods 1 \
  --threshold 25 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=Currency,Value=USD \
  --alarm-actions "arn:aws:sns:us-east-1:$ACCOUNT_ID:shedrive-billing-alerts"
```

Confirm the SNS subscription from the email before relying on the alarm. The
estimate is not real-time and does not include all charges. Use AWS Budgets as well
if this account is shared.

## 3. Create ECR repositories

```bash
aws ecr create-repository \
  --repository-name shedrive/backend \
  --region "$AWS_REGION" \
  --image-scanning-configuration scanOnPush=true

aws ecr create-repository \
  --repository-name shedrive/face-service \
  --region "$AWS_REGION" \
  --image-scanning-configuration scanOnPush=true
```

## 4. Create the EKS cluster

Two managed `t3.medium` nodes are a practical minimum. The face service is
memory-hungry; if pods are `OOMKilled`, move to `t3.large` or reduce the number of
face replicas first.

```bash
eksctl create cluster \
  --name "$CLUSTER_NAME" \
  --region "$AWS_REGION" \
  --version 1.33 \
  --nodegroup-name standard-workers \
  --node-type t3.medium \
  --nodes 2 \
  --nodes-min 2 \
  --nodes-max 3 \
  --managed \
  --with-oidc

aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$AWS_REGION"
kubectl get nodes
```

If `1.33` is no longer offered in your region, choose a version shown by
`eksctl create cluster --help` or omit `--version`.

The managed node role normally includes ECR read access. Confirm the nodes can
pull from ECR later in step 7; if not, attach
`AmazonEC2ContainerRegistryReadOnly` to the node role.

## 5. Create EFS for driver licence documents

Both backend replicas must see the same private licence files. A single EBS
volume (`ReadWriteOnce`) is not suitable for pods on different nodes, so the
manifests use EFS with `ReadWriteMany`.

```bash
NODE_SG=$(aws ec2 describe-security-groups \
  --filters \
    "Name=tag:aws:cloudformation:logical-id,Values=ClusterSharedNodeSecurityGroup" \
    "Name=tag:aws:cloudformation:stack-name,Values=eksctl-$CLUSTER_NAME-cluster" \
  --query "SecurityGroups[0].GroupId" \
  --output text)

FS_ID=$(aws efs create-file-system \
  --creation-token "$CLUSTER_NAME" \
  --tags Key=Name,Value="$CLUSTER_NAME" \
  --query FileSystemId \
  --output text)

aws efs wait file-system-available --file-system-id "$FS_ID"

SUBNETS=$(aws eks describe-cluster \
  --name "$CLUSTER_NAME" \
  --query "cluster.resourcesVpcConfig.subnetIds" \
  --output text)

for subnet in $SUBNETS; do
  aws efs create-mount-target \
    --file-system-id "$FS_ID" \
    --subnet-id "$subnet" \
    --security-groups "$NODE_SG"
done

aws ec2 authorize-security-group-ingress \
  --group-id "$NODE_SG" \
  --protocol tcp \
  --port 2049 \
  --source-group "$NODE_SG"
```

Replace the placeholder in the storage class:

```bash
sed -i "s/fs-REPLACE_ME/$FS_ID/" k8s/storageclass-efs.yaml
```

Install the EFS CSI driver with an IAM role:

```bash
eksctl create iamserviceaccount \
  --cluster "$CLUSTER_NAME" \
  --region "$AWS_REGION" \
  --namespace kube-system \
  --name efs-csi-controller-sa \
  --attach-policy-arn arn:aws:iam::aws:policy/service-role/AmazonEFSCSIDriverPolicy \
  --approve

EFS_ROLE_ARN=$(kubectl get serviceaccount efs-csi-controller-sa \
  -n kube-system \
  -o jsonpath='{.metadata.annotations.eks\.amazonaws\.com/role-arn}')

eksctl create addon \
  --cluster "$CLUSTER_NAME" \
  --region "$AWS_REGION" \
  --name aws-efs-csi-driver \
  --service-account-role-arn "$EFS_ROLE_ARN"

kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-efs-csi-driver
```

If the EFS CSI add-on already exists, add `--force` to the `eksctl create addon`
command or update it from the EKS console.

## 6. Create MongoDB Atlas

1. Create a free **M0** cluster in MongoDB Atlas (Mumbai region is a good match).
2. Create a database user with a strong password.
3. Create database `shedrive`.
4. For a demo, allow network access from `0.0.0.0/0`. For anything longer-lived,
   use VPC peering or PrivateLink instead.
5. Copy the `mongodb+srv://...` connection string.

Edit the Kubernetes secret:

```bash
cp k8s/secrets.example.yaml k8s/secrets.yaml
```

Set `MONGODB_URI` to the Atlas string and generate a JWT secret:

```bash
openssl rand -hex 32
```

`k8s/secrets.yaml` is git-ignored. Never commit it.

## 7. Build and push images

```bash
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

export TAG=$(git rev-parse --short HEAD)

docker build -t "$ECR_REGISTRY/shedrive/backend:$TAG" backend
docker build -t "$ECR_REGISTRY/shedrive/face-service:$TAG" face-service

docker tag "$ECR_REGISTRY/shedrive/backend:$TAG" "$ECR_REGISTRY/shedrive/backend:latest"
docker tag "$ECR_REGISTRY/shedrive/face-service:$TAG" "$ECR_REGISTRY/shedrive/face-service:latest"

docker push "$ECR_REGISTRY/shedrive/backend:$TAG"
docker push "$ECR_REGISTRY/shedrive/backend:latest"
docker push "$ECR_REGISTRY/shedrive/face-service:$TAG"
docker push "$ECR_REGISTRY/shedrive/face-service:latest"
```

The face-service build downloads DeepFace ONNX weights and is several GB.

Update the image placeholders in the manifests:

```bash
sed -i "s|111122223333|$ACCOUNT_ID|g" k8s/backend.yaml k8s/face-service.yaml
```

Set `CORS_ORIGINS` in `k8s/configmap.yaml` to the final CloudFront domain, for
example `https://d111111abcdef8.cloudfront.net` or
`https://shedrive.example.com`. Save the same value for step 9.

## 8. Deploy and seed

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -k k8s
kubectl rollout status deployment/shedrive-redis -n shedrive
kubectl rollout status deployment/shedrive-face -n shedrive --timeout=10m
kubectl rollout status deployment/shedrive-backend -n shedrive --timeout=5m
kubectl get pods -n shedrive
```

Check the private services:

```bash
kubectl port-forward -n shedrive svc/shedrive-backend 5000:80
# in another terminal:
curl -s http://localhost:5000/health/ready | jq
```

If a face pod is `OOMKilled`, inspect resources and events:

```bash
kubectl describe pod -n shedrive -l app.kubernetes.io/name=shedrive-face
kubectl top pods -n shedrive
```

Seed the demo accounts once:

```bash
kubectl exec -n shedrive deploy/shedrive-backend -- npm run seed
```

The seed script is idempotent, so it is safe to run again.

Install Prometheus and Grafana from the Helm chart:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
kubectl create namespace monitoring
cp k8s/monitoring/grafana-admin-secret.example.yaml k8s/monitoring/grafana-admin-secret.yaml
# edit the password, then:
kubectl apply -f k8s/monitoring/grafana-admin-secret.yaml
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  -f k8s/monitoring/values-kube-prometheus-stack.yaml
kubectl apply -k k8s/monitoring
```

Open Grafana with `kubectl port-forward svc/grafana 3000:80 -n monitoring`. See
[`k8s/monitoring/README.md`](../k8s/monitoring/README.md) for dashboards, alerts and
troubleshooting.

Get the public API address:

```bash
kubectl get service shedrive-backend -n shedrive
```

It can take a few minutes for AWS to provision the load balancer hostname.

## 9. Frontend on S3 and CloudFront

Build the frontend and create a private bucket:

```bash
cd frontend
npm ci
npm run build
cd ..

export FRONTEND_BUCKET="shedrive-frontend-$ACCOUNT_ID"
aws s3 mb "s3://$FRONTEND_BUCKET" --region "$AWS_REGION"
aws s3 sync frontend/dist/ "s3://$FRONTEND_BUCKET/" --delete
```

In the AWS console:

1. Create a CloudFront distribution with the S3 bucket as a **private** origin
   using Origin Access Control (OAC). Attach the generated bucket policy.
2. Set `index.html` as the default root object.
3. Add a custom error response for `403` and `404` to `/index.html` with HTTP
   `200` so direct page URLs work.
4. Add an origin for the backend load balancer hostname from step 8.
5. Add ordered behaviors for `/api/*` and `/socket.io/*`:
   - forward all viewer headers and query strings
   - caching disabled / managed `CachingDisabled`
   - allow WebSocket for `/socket.io/*`
   - origin protocol HTTP only if the load balancer has no TLS listener
6. Put the CloudFront domain in `CORS_ORIGINS` and re-apply the ConfigMap:
   `kubectl apply -k k8s`.
7. Restart the backend so the environment change is picked up:
   `kubectl rollout restart deployment/shedrive-backend -n shedrive`.

The frontend calls `/api` and `/socket.io` relative to its own origin, so the
CloudFront behaviors are what connect the S3 site to EKS. If you use a custom
domain, create the ACM certificate in **us-east-1** for CloudFront and route
Route 53 (or your DNS provider) to the distribution.

Upload and invalidate after each frontend build:

```bash
aws s3 sync frontend/dist/ "s3://$FRONTEND_BUCKET/" --delete
aws cloudfront create-invalidation \
  --distribution-id REPLACE_WITH_DISTRIBUTION_ID \
  --paths "/*"
```

## 10. Smoke test

```bash
curl -s "https://YOUR_CLOUDFRONT_DOMAIN/api" | jq
curl -s "https://YOUR_CLOUDFRONT_DOMAIN/admin.html" | head
```

Then open the CloudFront URL and log in with the seeded accounts:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@shedrive.test` | `Admin@12345` |
| Review | `review@shedrive.test` | `Review@12345` |
| Rider | `rider@shedrive.test` | `Rider@12345` |
| Driver | `driver@shedrive.test` | `Driver@12345` |

Change these demo passwords and set `OTP_PROVIDER` to a real provider before any
public deployment.

## 11. CI/CD credentials

The deploy workflow uses GitHub OIDC, so there are no long-lived AWS keys. Run the
following once, replacing the GitHub owner, repository and secret values.

```bash
export GITHUB_REPO="YOUR_GITHUB_OWNER/YOUR_REPO"
export ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export AWS_REGION="ap-south-1"
export EKS_CLUSTER_NAME="shedrive"
export FRONTEND_BUCKET="shedrive-frontend-${ACCOUNT_ID}"
export CLOUDFRONT_DISTRIBUTION_ID="REPLACE_WITH_DISTRIBUTION_ID"

aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

If the GitHub OIDC provider already exists, skip that command. Run manual deploys
from `main`; the role only trusts that branch.

Create the deploy role and allow only pushes to `main`:

```bash
cat > github-oidc-trust.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:ref:refs/heads/main"
      }
    }
  }]
}
JSON

aws iam create-role \
  --role-name shedrive-github-deploy \
  --assume-role-policy-document file://github-oidc-trust.json

export ROLE_ARN="$(aws iam get-role --role-name shedrive-github-deploy --query Role.Arn --output text)"
```

Attach the minimum permissions needed by the two deploy jobs:

```bash
cat > github-deploy-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:CompleteLayerUpload",
        "ecr:GetDownloadUrlForLayer",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": "arn:aws:ecr:${AWS_REGION}:${ACCOUNT_ID}:repository/shedrive/*"
    },
    {
      "Effect": "Allow",
      "Action": ["eks:DescribeCluster"],
      "Resource": "arn:aws:eks:${AWS_REGION}:${ACCOUNT_ID}:cluster/${EKS_CLUSTER_NAME}"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::${FRONTEND_BUCKET}"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::${FRONTEND_BUCKET}/*"
    },
    {
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
      "Resource": "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${CLOUDFRONT_DISTRIBUTION_ID}"
    }
  ]
}
JSON

aws iam put-role-policy \
  --role-name shedrive-github-deploy \
  --policy-name shedrive-deploy \
  --policy-document file://github-deploy-policy.json
```

Grant the role Kubernetes access in EKS:

```bash
aws eks create-access-entry \
  --cluster-name "$EKS_CLUSTER_NAME" \
  --principal-arn "$ROLE_ARN" \
  --type STANDARD

aws eks associate-access-policy \
  --cluster-name "$EKS_CLUSTER_NAME" \
  --principal-arn "$ROLE_ARN" \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster
```

Add these repository secrets under **Settings → Secrets and variables → Actions**:

- `AWS_ROLE_TO_ASSUME` — the `ROLE_ARN` printed above
- `AWS_REGION` — `ap-south-1`
- `EKS_CLUSTER_NAME` — `shedrive`
- `FRONTEND_BUCKET` — the bucket name used above
- `CLOUDFRONT_DISTRIBUTION_ID` — the distribution ID

If access keys are unavoidable, also store `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`, then replace the `role-to-assume` input in both
`configure-aws-credentials` steps with those two inputs. Rotate the keys regularly.

## 12. Cleanup

Delete the application and cluster first:

```bash
kubectl delete -f k8s/secrets.yaml
kubectl delete -k k8s
eksctl delete cluster --name "$CLUSTER_NAME" --region "$AWS_REGION"
```

Then remove resources that outlive the cluster:

```bash
aws ecr delete-repository --repository-name shedrive/backend --force --region "$AWS_REGION"
aws ecr delete-repository --repository-name shedrive/face-service --force --region "$AWS_REGION"
aws s3 rb "s3://$FRONTEND_BUCKET" --force

for mount_target in $(aws efs describe-mount-targets \
  --file-system-id "$FS_ID" \
  --query "MountTargets[].MountTargetId" \
  --output text); do
  aws efs delete-mount-target --mount-target-id "$mount_target" --region "$AWS_REGION"
done
aws efs delete-file-system --file-system-id "$FS_ID" --region "$AWS_REGION"

aws sns delete-topic \
  --topic-arn "arn:aws:sns:us-east-1:$ACCOUNT_ID:shedrive-billing-alerts" \
  --region us-east-1
aws cloudwatch delete-alarms \
  --alarm-names "shedrive-monthly-estimate-25-usd" \
  --region us-east-1
```

Delete the CloudFront distribution and MongoDB Atlas cluster from the console
after disabling/deleting its origin access.
