#!/usr/bin/env bash
# Builds the GoCart image, creates (or reuses) a 3-node kind cluster, loads the
# image into it, and applies all manifests. Re-run anytime to redeploy after a
# code change (bump IMAGE_TAG to demonstrate a rolling update).
# Usage: ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER_NAME="gocart"
IMAGE_TAG="${IMAGE_TAG:-local}"
IMAGE="gocart:${IMAGE_TAG}"

if [ ! -f .env ]; then
    echo ".env not found. Copy your local .env onto this instance first." >&2
    exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

echo "==> Ensuring kind cluster '${CLUSTER_NAME}' exists"
if ! kind get clusters | grep -qx "${CLUSTER_NAME}"; then
    kind create cluster --config kind-cluster.yaml
else
    echo "    already exists"
fi

echo "==> Building image ${IMAGE}"
docker build \
    --build-arg NEXT_PUBLIC_CURRENCY_SYMBOL="${NEXT_PUBLIC_CURRENCY_SYMBOL:-\$}" \
    --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
    -t "${IMAGE}" .

echo "==> Loading image into kind"
kind load docker-image "${IMAGE}" --name "${CLUSTER_NAME}"

echo "==> Applying namespace"
kubectl apply -f k8s/namespace.yaml

echo "==> Applying ConfigMap"
kubectl apply -f k8s/configmap.yaml

echo "==> Applying Secret"
kubectl create secret generic gocart-secrets -n gocart \
    --from-literal=DATABASE_URL="${DATABASE_URL}" \
    --from-literal=DIRECT_URL="${DIRECT_URL}" \
    --from-literal=CLERK_SECRET_KEY="${CLERK_SECRET_KEY}" \
    --dry-run=client -o yaml | kubectl apply -f -

echo "==> Applying Deployment + Service"
sed "s|image: gocart:local|image: ${IMAGE}|" k8s/deployment.yaml | kubectl apply -f -
kubectl apply -f k8s/service.yaml

echo "==> Ensuring metrics-server is installed (required for the HPA)"
if ! kubectl get deployment metrics-server -n kube-system >/dev/null 2>&1; then
    kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
    # kind's kubelet serving certs aren't signed by a CA metrics-server trusts
    # by default; this is the standard kind workaround, not something you'd
    # do on a real cluster (e.g. EKS ships trusted kubelet certs already).
    kubectl patch deployment metrics-server -n kube-system --type=json \
        -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
fi
kubectl wait --namespace kube-system --for=condition=available deployment/metrics-server --timeout=120s

echo "==> Applying HorizontalPodAutoscaler + PodDisruptionBudget"
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/pdb.yaml

echo "==> Ensuring ingress-nginx controller is installed"
if ! kubectl get ns ingress-nginx >/dev/null 2>&1; then
    kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
fi

# The upstream kind manifest doesn't reliably pin the controller to the
# control-plane node, but that's the only node with the hostPort 80/443 ->
# EC2 port mapping (see kind-cluster.yaml). Without this nodeSelector the
# controller can land on a worker, where port 80 has nothing behind it.
kubectl patch deployment ingress-nginx-controller -n ingress-nginx \
    -p '{"spec":{"template":{"spec":{"nodeSelector":{"kubernetes.io/os":"linux","ingress-ready":"true"}}}}}'

kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/component=controller \
    --timeout=180s

echo "==> Applying Ingress"
kubectl apply -f k8s/ingress.yaml

echo "==> Waiting for rollout"
kubectl rollout status deployment/gocart -n gocart

echo
echo "Done. Open http://<this-instance-public-ip>/ (ports 80/443 must be open in the EC2 security group)."
